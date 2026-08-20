import { acquireGpu, gpuCaps, type GpuCaps, type GpuContext } from './device';
import { FrameGraph, type NodeTiming } from './graph';
import { DepthNode, type DepthModel, type DepthModelInfo } from './nodes/depth';
import { LightingNode, type Light, type LightView } from './nodes/lighting';
import { PresentNode } from './nodes/present';

/* ============================================================
   THE RIG
   Source → depth → lighting → present, one encoder, one submit.
   The source frame is copied into a GPU texture with
   copyExternalImageToTexture, which is a queue operation, so a
   camera frame never round-trips through JavaScript memory.
   ============================================================ */

export interface RigReport {
  caps: GpuCaps;
  running: boolean;
  fps: number;
  cpuSubmitMs: number;
  timings: NodeTiming[];
  totalDispatches: number;
  timestampsAvailable: boolean;
  depthSource: 'model' | 'proxy';
  depthModel: DepthModelInfo | null;
  depthResolution: number;
  reason?: string;
}

export class LightRig {
  private ctx: GpuContext | null = null;
  private graph: FrameGraph | null = null;
  private depth: DepthNode | null = null;
  private lighting: LightingNode | null = null;
  private present: PresentNode | null = null;

  private srcTex: GPUTexture | null = null;
  private srcW = 0;
  private srcH = 0;
  private raf = 0;
  private source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null = null;
  private canvas: HTMLCanvasElement | null = null;

  private frames = 0;
  private fpsAt = performance.now();
  private fps = 0;
  private failed: string | undefined;

  async start(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = await acquireGpu();
    if (!ctx) {
      this.failed = gpuCaps().reason ?? 'WebGPU is unavailable.';
      return false;
    }
    this.ctx = ctx;
    try {
      this.graph = new FrameGraph(ctx);
      this.depth = new DepthNode(ctx, 448);
      this.lighting = new LightingNode(ctx);
      this.present = new PresentNode(ctx, canvas);
      this.graph.add(this.depth);
      this.graph.add(this.lighting);
      this.graph.add(this.present);
      this.lighting.setInputs(
        // set properly once a source arrives
        this.depth.outputs.depth,
        this.depth.outputs.depth,
      );
      this.present.setInput(this.depth.outputs.depth);
      this.loop();
      return true;
    } catch (e) {
      this.failed = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  setSource(src: HTMLVideoElement | HTMLCanvasElement | ImageBitmap, w: number, h: number) {
    this.source = src;
    if (!this.ctx) return;
    if (this.srcW !== w || this.srcH !== h) {
      this.srcTex?.destroy();
      this.srcTex = this.ctx.device.createTexture({
        label: 'source',
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.srcW = w;
      this.srcH = h;
      const view = this.srcTex.createView();
      this.depth?.setInput(view);
      const depthView = this.depth?.outputs.depth;
      if (depthView) this.lighting?.setInputs(view, depthView);
      const lit = this.lighting?.outputs.lit;
      if (lit) this.present?.setInput(lit);
    }
  }

  /** hand the rig a real monocular model; nothing else changes */
  async useDepthModel(model: DepthModel) {
    await this.depth?.useModel(model);
    const view = this.depth?.outputs.depth;
    if (view && this.srcTex) this.lighting?.setInputs(this.srcTex.createView(), view);
  }

  get lights(): Light[] {
    return this.lighting?.lights ?? [];
  }
  setLights(l: Light[]) {
    if (this.lighting) this.lighting.lights = l;
  }
  setView(v: LightView) {
    if (this.lighting) this.lighting.view3 = v;
  }
  setParam(k: 'ambient' | 'normalZ' | 'shadow' | 'parallax' | 'exposure', v: number) {
    if (this.lighting) this.lighting[k] = v;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const { ctx, graph, canvas } = this;
    if (!ctx || !graph || !canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    graph.resize(w, h);

    // upload the current frame. A queue copy, not a readback.
    if (this.source && this.srcTex) {
      const live = this.source as HTMLVideoElement;
      const ready = !(live instanceof HTMLVideoElement) || live.readyState >= 2;
      if (ready) {
        ctx.device.queue.copyExternalImageToTexture(
          { source: this.source as GPUCopyExternalImageSource },
          { texture: this.srcTex },
          [this.srcW, this.srcH],
        );
      }
    }

    graph.frame();

    this.frames++;
    const now = performance.now();
    if (now - this.fpsAt >= 500) {
      this.fps = (this.frames * 1000) / (now - this.fpsAt);
      this.frames = 0;
      this.fpsAt = now;
    }
  };

  report(): RigReport {
    const r = this.graph?.report();
    return {
      caps: gpuCaps(),
      running: !!this.graph,
      fps: this.fps,
      cpuSubmitMs: r?.cpuSubmitMs ?? 0,
      timings: r?.timings ?? [],
      totalDispatches: r?.totalDispatches ?? 0,
      timestampsAvailable: r?.timestampsAvailable ?? false,
      depthSource: this.depth?.sourceKind ?? 'proxy',
      depthModel: this.depth?.modelInfo ?? null,
      depthResolution: this.depth?.resolution ?? 0,
      reason: this.failed,
    };
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.graph?.dispose();
    this.graph = null;
    this.srcTex?.destroy();
    this.srcTex = null;
  }
}

export type { Light, LightView, DepthModel, DepthModelInfo };
