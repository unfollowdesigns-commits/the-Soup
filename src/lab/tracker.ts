/* ============================================================
   TRACE
   Contrast-and-motion tracking, done classically and named
   honestly. There is no object detection model here: the lab
   finds regions of high local energy — and, on a moving
   specimen, regions that changed — then follows them frame to
   frame by nearest centroid.

   Every number the overlay prints comes out of this file. None
   of them are decoration.
   ============================================================ */

export interface TraceBox {
  id: number;
  /** normalised image space */
  x: number;
  y: number;
  w: number;
  h: number;
  /** measured local energy, 0..1 */
  energy: number;
  /** measured frame-to-frame change, 0..1; always 0 on a still */
  motion: number;
  /** frames this track has survived */
  age: number;
  /** smoothed centroid velocity, normalised units per frame */
  vx: number;
  vy: number;
}

/** how regions are found. Energy locks onto edges — which on a static
 *  frame means the window, not the person walking past it. Blob segments
 *  what is actually moving and follows it. */
export type TrackMode = 'energy' | 'blob';

export interface TraceResult {
  boxes: TraceBox[];
  /** wall-clock cost of the analysis pass */
  ms: number;
  gridW: number;
  gridH: number;
  /** true once a second frame has been seen */
  motionAvailable: boolean;
  mode: TrackMode;
  /** share of the frame the mover occupies, 0..1 */
  coverage: number;
}

const GRID = 48;

export class Tracker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = GRID;
  private h = GRID;
  private prev: Float32Array | null = null;
  /** a slowly-updated model of what is standing still */
  private bg: Float32Array | null = null;
  private tracks: TraceBox[] = [];
  private nextId = 1;
  private seenFrames = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable for trace analysis');
    this.ctx = ctx;
  }

  reset() {
    this.prev = null;
    this.bg = null;
    this.tracks = [];
    this.nextId = 1;
    this.seenFrames = 0;
  }

  analyse(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    opts: { count: number; sensitivity: number; motionWeight: number; mode?: TrackMode },
  ): TraceResult {
    const t0 = performance.now();
    const aspect = srcW / Math.max(srcH, 1);
    this.w = aspect >= 1 ? GRID : Math.max(8, Math.round(GRID * aspect));
    this.h = aspect >= 1 ? Math.max(8, Math.round(GRID / aspect)) : GRID;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.drawImage(source, 0, 0, this.w, this.h);

    const px = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const lum = new Float32Array(this.w * this.h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = (px[p] * 0.2126 + px[p + 1] * 0.7152 + px[p + 2] * 0.0722) / 255;
    }

    // local energy: gradient magnitude, the classic corner/edge measure
    const energy = new Float32Array(this.w * this.h);
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        const i = y * this.w + x;
        const gx = lum[i + 1] - lum[i - 1];
        const gy = lum[i + this.w] - lum[i - this.w];
        energy[i] = Math.min(1, Math.hypot(gx, gy) * 2.2);
      }
    }

    // motion: absolute frame difference, only once we have a previous frame
    const motion = new Float32Array(this.w * this.h);
    const motionAvailable = this.prev !== null;
    if (this.prev) {
      for (let i = 0; i < lum.length; i++) {
        motion[i] = Math.min(1, Math.abs(lum[i] - this.prev[i]) * 6);
      }
    }
    this.prev = lum;
    this.seenFrames++;

    /* ---- the background model -------------------------------
       A running average of what has been sitting still. Anything
       far enough from it is a mover. The rate is low so a subject
       that pauses does not dissolve into the background within a
       second, and high enough that a camera which is nudged
       recovers instead of flagging the whole frame forever. */
    if (!this.bg) this.bg = Float32Array.from(lum);
    else {
      const rate = 0.02;
      for (let i = 0; i < lum.length; i++) {
        this.bg[i] += (lum[i] - this.bg[i]) * rate;
      }
    }

    /* A light that swings across the room raises every pixel at once,
       and a raw difference calls that motion. Taking each field's own
       mean out first leaves only what moved relative to the scene, so
       the boxes land on the figure instead of on the window. */
    let mCur = 0;
    let mBg = 0;
    for (let i = 0; i < lum.length; i++) {
      mCur += lum[i];
      mBg += this.bg[i];
    }
    mCur /= lum.length;
    mBg /= lum.length;
    const lift = mCur - mBg;

    const mode: TrackMode = opts.mode ?? 'energy';
    if (mode === 'blob' && motionAvailable) {
      const blobs = this.blobs(lum, this.bg, energy, opts, lift);
      this.tracks = this.associate(blobs.boxes);
      return {
        boxes: this.tracks,
        ms: performance.now() - t0,
        gridW: this.w,
        gridH: this.h,
        motionAvailable,
        mode,
        coverage: blobs.coverage,
      };
    }

    // score, then take non-overlapping peaks
    const score = new Float32Array(this.w * this.h);
    const mw = motionAvailable ? opts.motionWeight : 0;
    for (let i = 0; i < score.length; i++) {
      score[i] = energy[i] * (1 - mw) + motion[i] * mw;
    }

    const found: TraceBox[] = [];
    const taken = new Uint8Array(this.w * this.h);
    const want = Math.max(0, Math.round(opts.count));
    const floor = 0.06 + (1 - opts.sensitivity) * 0.34;

    for (let n = 0; n < want; n++) {
      let best = -1;
      let bestV = floor;
      for (let i = 0; i < score.length; i++) {
        if (!taken[i] && score[i] > bestV) {
          bestV = score[i];
          best = i;
        }
      }
      if (best < 0) break;
      const bx = best % this.w;
      const by = (best - bx) / this.w;

      // grow the box outward while the neighbourhood keeps scoring
      let x0 = bx, x1 = bx, y0 = by, y1 = by;
      const thresh = bestV * 0.42;
      for (let step = 0; step < 6; step++) {
        if (x0 > 0 && rowMax(score, this.w, x0 - 1, y0, y1) > thresh) x0--;
        if (x1 < this.w - 1 && rowMax(score, this.w, x1 + 1, y0, y1) > thresh) x1++;
        if (y0 > 0 && colMax(score, this.w, y0 - 1, x0, x1) > thresh) y0--;
        if (y1 < this.h - 1 && colMax(score, this.w, y1 + 1, x0, x1) > thresh) y1++;
      }
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) taken[y * this.w + x] = 1;
      }

      let e = 0;
      let m = 0;
      let c = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * this.w + x;
          e += energy[i];
          m += motion[i];
          c++;
        }
      }
      found.push({
        id: 0,
        x: x0 / this.w,
        y: y0 / this.h,
        w: (x1 - x0 + 1) / this.w,
        h: (y1 - y0 + 1) / this.h,
        energy: c ? e / c : 0,
        motion: c ? m / c : 0,
        age: 1,
        vx: 0,
        vy: 0,
      });
    }

    this.tracks = this.associate(found);
    return {
      boxes: this.tracks,
      ms: performance.now() - t0,
      gridW: this.w,
      gridH: this.h,
      motionAvailable,
      mode,
      coverage: 0,
    };
  }

  /* ------------------------------------------------------------
     BLOBS
     Foreground mask against the background model, then connected
     components by flood fill. One box per thing that is moving,
     which is what a box on a person actually is.
     ------------------------------------------------------------ */
  private blobs(
    lum: Float32Array,
    bg: Float32Array,
    energy: Float32Array,
    opts: { count: number; sensitivity: number },
    lift = 0,
  ): { boxes: TraceBox[]; coverage: number } {
    const W = this.w;
    const H = this.h;
    const n = W * H;
    const thresh = 0.035 + (1 - opts.sensitivity) * 0.13;

    const fg = new Uint8Array(n);
    let on = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(lum[i] - bg[i] - lift) > thresh) {
        fg[i] = 1;
        on++;
      }
    }

    // close one-pixel holes so a body does not shatter into confetti
    const closed = new Uint8Array(n);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        let c = 0;
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) c += fg[i + j * W + k];
        }
        closed[i] = c >= 3 ? 1 : 0;
      }
    }

    // flood fill each component with an explicit stack
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const minArea = Math.max(4, Math.round(n * 0.0016));
    const found: TraceBox[] = [];

    for (let start = 0; start < n; start++) {
      if (!closed[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let x0 = W, x1 = 0, y0 = H, y1 = 0, area = 0, e = 0, m = 0;

      while (sp > 0) {
        const i = stack[--sp];
        const x = i % W;
        const y = (i - x) / W;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        area++;
        e += energy[i];
        m += Math.abs(lum[i] - bg[i] - lift);

        if (x > 0 && closed[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < W - 1 && closed[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && closed[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W; }
        if (y < H - 1 && closed[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W; }
      }

      if (area < minArea) continue;
      found.push({
        id: 0,
        x: x0 / W,
        y: y0 / H,
        w: (x1 - x0 + 1) / W,
        h: (y1 - y0 + 1) / H,
        energy: e / area,
        motion: Math.min(1, (m / area) * 6),
        age: 1,
        vx: 0,
        vy: 0,
      });
    }

    // biggest movers first, then take as many as were asked for
    found.sort((a, b) => b.w * b.h - a.w * a.h);
    return { boxes: found.slice(0, Math.max(1, opts.count)), coverage: on / n };
  }

  /** nearest-centroid association, with a little smoothing so the boxes
   *  settle instead of twitching */
  private associate(found: TraceBox[]): TraceBox[] {
    const prev = this.tracks.slice();
    const out: TraceBox[] = [];
    const used = new Set<number>();

    for (const f of found) {
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      let match: TraceBox | null = null;
      let bestD = 0.14;
      for (const p of prev) {
        if (used.has(p.id)) continue;
        const d = Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy);
        if (d < bestD) {
          bestD = d;
          match = p;
        }
      }
      if (match) {
        used.add(match.id);
        const k = 0.45;
        const nx = match.x + (f.x - match.x) * k;
        const ny = match.y + (f.y - match.y) * k;
        out.push({
          ...f,
          id: match.id,
          x: nx,
          y: ny,
          w: match.w + (f.w - match.w) * k,
          h: match.h + (f.h - match.h) * k,
          age: match.age + 1,
          vx: (nx - match.x) * 0.6 + match.vx * 0.4,
          vy: (ny - match.y) * 0.6 + match.vy * 0.4,
        });
      } else {
        out.push({ ...f, id: this.nextId++ });
      }
    }
    return out;
  }
}

function rowMax(a: Float32Array, w: number, x: number, y0: number, y1: number) {
  let m = 0;
  for (let y = y0; y <= y1; y++) m = Math.max(m, a[y * w + x]);
  return m;
}
function colMax(a: Float32Array, w: number, y: number, x0: number, x1: number) {
  let m = 0;
  for (let x = x0; x <= x1; x++) m = Math.max(m, a[y * w + x]);
  return m;
}
