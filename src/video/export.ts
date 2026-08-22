import { LabRenderer } from '../engine/renderer';
import { getGate, getSize, type FrameFit, type GateId } from '../lab/gate';
import type { Material, PhotoRecipe, Specimen } from '../lab/types';
import { gateGround, gateOverlay } from './gatePaint';
import { containerOf, familyOf, muxMp4, muxWebm, type Bytes, type Mp4Sample, type WebmFrame } from './mux';

/* ============================================================
   RUNNING A CLIP THROUGH THE LAB
   The clip is stepped one frame at a time. Every frame goes
   through exactly the same engine the bench uses — same recipe,
   same grain seed advancing, same everything — then gets the
   film gate drawn around it and handed to the encoder.

   Nothing about this is realtime. It runs as fast as the machine
   can decode, render and encode, and it never drops a frame to
   keep up, because there is nothing to keep up with.
   ============================================================ */

export interface ExportSettings {
  gate: GateId;
  fit: FrameFit;
  size: string;
  /** 0 = the gate's own rate */
  fps: number;
  /** seconds */
  from: number;
  to: number;
  /** megabits per second */
  bitrate: number;
  /** how worn the print is */
  wear: number;
  /** the grain and the soup move frame to frame, like real stock */
  liveGrain: boolean;
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'writing' | 'done' | 'error';
  frame: number;
  frames: number;
  /** frames per second we are managing */
  rate: number;
  codec: string;
  container: string;
  message?: string;
  bytes?: number;
}

/* the order matters: the first that this browser can encode wins, and
   H.264 is first because that is what an editor will open */
const CANDIDATES = [
  'avc1.640033', /* High 5.1 — 4K */
  'avc1.640028', /* High 4.0 — 1080 */
  'avc1.4D0028',
  'avc1.42E01F',
  'vp09.00.51.08',
  'vp09.00.41.08',
  'vp8',
  'av01.0.08M.08',
];

export async function pickCodec(width: number, height: number, bitrate: number, framerate: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of CANDIDATES) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
      if (s.supported) return codec;
    } catch {
      /* the browser does not know this one; try the next */
    }
  }
  return null;
}

/* ============================================================
   ONE FRAME
   The preview in the export sheet and the export itself must not
   be able to disagree, so they run the same code.
   ============================================================ */

export class ClipFrames {
  private gl: HTMLCanvasElement;
  private renderer: LabRenderer;
  private warm: Promise<void>;

  constructor(private specimen: Specimen) {
    this.gl = document.createElement('canvas');
    this.renderer = new LabRenderer(this.gl);
    this.renderer.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
    // the damage plates are fetched once per context
    this.warm = sleep(320);
  }

  ready() {
    return this.warm;
  }

  /** Render frame `index` of the clip onto `target`, film and all. */
  async draw(
    target: HTMLCanvasElement,
    recipe: PhotoRecipe,
    material: Material,
    settings: ExportSettings,
    index: number,
    fps: number,
  ) {
    const gate = getGate(settings.gate);
    const g = target.getContext('2d');
    if (!g) return;

    await positionSource(this.specimen, settings.from + index / fps);
    this.renderer.updateSource(this.specimen.bitmap as TexImageSource);

    const mark = { index, seed: recipe.grain.seed, wear: settings.wear };
    const ground = gateGround(g, gate, target.width, target.height, settings.fit, mark);
    const pic = ground.picture;

    const pw = Math.max(2, Math.round(pic.w));
    const ph = Math.max(2, Math.round(pic.h));
    this.renderer.resize(pw, ph, 1);
    this.renderer.render(frameRecipe(recipe, settings.liveGrain, index), material, {
      zoom: 1,
      panX: 0,
      panY: 0,
      compare: 'single',
      split: 0.5,
      view: 'color',
    });

    g.save();
    if (pic.rot) {
      g.translate(pic.x + pic.w / 2, pic.y + pic.h / 2);
      g.rotate(pic.rot);
      g.drawImage(this.gl, -pic.w / 2, -pic.h / 2, pic.w, pic.h);
    } else {
      g.drawImage(this.gl, pic.x, pic.y, pic.w, pic.h);
    }
    g.restore();

    gateOverlay(g, gate, target.width, target.height, settings.fit, mark, ground);
  }

  dispose() {
    this.renderer.dispose();
  }
}

/** Real stock never repeats: the grain and the soup move on each frame. */
function frameRecipe(recipe: PhotoRecipe, live: boolean, i: number): PhotoRecipe {
  if (!live) return recipe;
  return {
    ...recipe,
    grain: { ...recipe.grain, seed: recipe.grain.seed + i * 977 },
    experimental: {
      ...recipe.experimental,
      soupSeed: recipe.experimental.soupSeed + i * 613,
      seed: recipe.experimental.seed + i * 419,
    },
  };
}

export interface ExportResult {
  blob: Blob;
  codec: string;
  container: string;
  frames: number;
  width: number;
  height: number;
  fps: number;
}

export async function exportClip(
  specimen: Specimen,
  recipe: PhotoRecipe,
  material: Material,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  signal?: { cancelled: boolean },
): Promise<ExportResult> {
  const gate = getGate(settings.gate);
  const out = getSize(settings.size);
  const fps = settings.fps || gate.fps || 24;
  const duration = Math.max(1 / fps, settings.to - settings.from);
  const frames = Math.max(1, Math.round(duration * fps));
  const bitrate = Math.round(settings.bitrate * 1_000_000);

  const report = (p: Partial<ExportProgress>) =>
    onProgress({
      phase: 'rendering',
      frame: 0,
      frames,
      rate: 0,
      codec: '',
      container: '',
      ...p,
    } as ExportProgress);

  report({ phase: 'preparing' });

  const codec = await pickCodec(out.w, out.h, bitrate, fps);
  if (!codec) {
    throw new Error(
      'This browser will not encode video. Chrome, Edge and Safari 17 will; Firefox needs WebCodecs turned on.',
    );
  }
  const container = containerOf(codec);
  const family = familyOf(codec);

  /* ---- the two canvases: the engine draws the picture, the 2D
     context draws the film around it ---- */
  const paint = document.createElement('canvas');
  paint.width = out.w;
  paint.height = out.h;
  const g = paint.getContext('2d', { alpha: true });
  if (!g) throw new Error('The browser refused a 2D context for the film frame.');

  const frameSource = new ClipFrames(specimen);
  await frameSource.ready();

  /* ---- the encoder ---- */
  const chunks: { data: Bytes; key: boolean; timestamp: number }[] = [];
  let description: Bytes | undefined;
  let failure: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !description) {
        const d = meta.decoderConfig.description as ArrayBuffer | ArrayBufferView;
        const view = ArrayBuffer.isView(d)
          ? new Uint8Array(d.buffer as ArrayBuffer, d.byteOffset, d.byteLength)
          : new Uint8Array(d as ArrayBuffer);
        description = new Uint8Array(view) as Bytes;
      }
      const data = new Uint8Array(chunk.byteLength) as Bytes;
      chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });

  encoder.configure({
    codec,
    width: out.w,
    height: out.h,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    ...(family === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  });

  const usPerFrame = 1_000_000 / fps;
  const started = performance.now();

  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.cancelled) throw new Error('Stopped.');
      if (failure) throw failure;

      await frameSource.draw(paint, recipe, material, settings, i, fps);

      const frame = new VideoFrame(paint, {
        timestamp: Math.round(i * usPerFrame),
        duration: Math.round(usPerFrame),
      });
      // a key frame every second keeps the file seekable
      encoder.encode(frame, { keyFrame: i % Math.round(fps) === 0 });
      frame.close();

      if (i % 4 === 0 || i === frames - 1) {
        const secs = (performance.now() - started) / 1000;
        report({
          phase: 'rendering',
          frame: i + 1,
          frames,
          rate: secs > 0 ? (i + 1) / secs : 0,
          codec,
          container,
        });
        // let the encoder drain and the interface repaint
        await raf();
      }
      if (encoder.encodeQueueSize > 12) {
        while (encoder.encodeQueueSize > 4) await sleep(4);
      }
    }

    report({ phase: 'encoding', frame: frames, frames, rate: 0, codec, container });
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed by the error path */
    }
    frameSource.dispose();
  }

  report({ phase: 'writing', frame: frames, frames, rate: 0, codec, container });

  let blob: Blob;
  if (container === 'mp4') {
    if (!description) throw new Error('The encoder gave no H.264 configuration to write.');
    const samples: Mp4Sample[] = chunks.map((c) => ({ size: c.data.length, key: c.key }));
    const total = samples.reduce((n, s) => n + s.size, 0);
    const data = new Uint8Array(total) as Bytes;
    let o = 0;
    for (const c of chunks) {
      data.set(c.data, o);
      o += c.data.length;
    }
    // 90 kHz is the usual film-and-video tick and divides 24, 25 and 30
    const timescale = 90000;
    blob = muxMp4({
      width: out.w,
      height: out.h,
      timescale,
      delta: Math.round(timescale / fps),
      samples,
      description,
      data,
    });
  } else {
    const wf: WebmFrame[] = chunks.map((c) => ({
      data: c.data,
      timestamp: c.timestamp,
      key: c.key,
    }));
    blob = muxWebm({
      width: out.w,
      height: out.h,
      family,
      frameNs: Math.round(1_000_000_000 / fps),
      frames: wf,
      description: family === 'av01' ? description : undefined,
    });
  }

  report({ phase: 'done', frame: frames, frames, rate: 0, codec, container, bytes: blob.size });
  return { blob, codec, container, frames, width: out.w, height: out.h, fps };
}

/* ------------------------------------------------------------
   Putting the source on a given second.
   ------------------------------------------------------------ */
async function positionSource(specimen: Specimen, t: number) {
  if (specimen.tick) {
    specimen.tick(t);
    return;
  }
  const v = specimen.video;
  if (!v) return;
  const target = Math.min(t, Math.max(0, (v.duration || 0) - 1e-3));
  if (Math.abs(v.currentTime - target) < 1e-4) return;
  if (!v.paused) v.pause();
  await new Promise<void>((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', finish);
      res();
    };
    v.addEventListener('seeked', finish, { once: true });
    v.currentTime = target;
    // a stream that will not seek should not hang the export
    setTimeout(finish, 400);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
