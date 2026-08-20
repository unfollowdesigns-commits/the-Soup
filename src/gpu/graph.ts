import type { GpuContext } from './device';

/* ============================================================
   FRAME GRAPH
   Every GPU stage in the platform is a node. Nodes record into
   one command encoder and are submitted once. Nothing between
   them touches the CPU — the only readback in the whole graph is
   the timing resolve, and that is one frame behind on purpose.

   This is the part that makes it many of these rather than one:
   a segmentation node, an optical-flow node or a matting node
   drops in beside the depth node and inherits the encoder, the
   timing and the capability reporting for free.
   ============================================================ */

export interface FrameInfo {
  width: number;
  height: number;
  /** seconds since the graph started */
  time: number;
  frame: number;
}

/** A node opens its own passes and puts the timestamps the graph hands
 *  it on the pass descriptor. `writeTimestamp` on the encoder was removed
 *  from the spec; this is the current way to measure a pass. */
export interface PassStamps {
  querySet: GPUQuerySet;
  beginningOfPassWriteIndex: number;
  endOfPassWriteIndex: number;
}

export interface GpuNode {
  readonly id: string;
  readonly label: string;
  /** dispatches this node issued last frame — counted, never estimated */
  readonly dispatches: number;
  /** textures this node publishes for later nodes to sample */
  readonly outputs: Readonly<Record<string, GPUTextureView>>;
  resize(w: number, h: number): void;
  /** record work. Must not submit, must not map, must not await. */
  encode(encoder: GPUCommandEncoder, frame: FrameInfo, stamps: PassStamps | null): void;
  dispose(): void;
}

export interface NodeTiming {
  id: string;
  label: string;
  /** real GPU nanoseconds, when timestamp-query is available */
  gpuMs: number | null;
  dispatches: number;
}

const MAX_STAMPS = 32;

export class FrameGraph {
  readonly ctx: GpuContext;
  private nodes: GpuNode[] = [];
  private w = 0;
  private h = 0;
  private started = performance.now();
  private frameNo = 0;

  /* timing */
  private querySet: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBuf: GPUBuffer | null = null;
  private reading = false;
  private timings: NodeTiming[] = [];
  private cpuMs = 0;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    if (ctx.caps.timestamps) {
      const d = ctx.device;
      this.querySet = d.createQuerySet({ type: 'timestamp', count: MAX_STAMPS });
      this.resolveBuf = d.createBuffer({
        size: MAX_STAMPS * 8,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.readBuf = d.createBuffer({
        size: MAX_STAMPS * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
  }

  add(node: GpuNode) {
    this.nodes.push(node);
    if (this.w) node.resize(this.w, this.h);
    return node;
  }

  remove(id: string) {
    const i = this.nodes.findIndex((n) => n.id === id);
    if (i >= 0) {
      this.nodes[i].dispose();
      this.nodes.splice(i, 1);
    }
  }

  get(id: string) {
    return this.nodes.find((n) => n.id === id);
  }

  /** a later node reads an earlier node's output by name */
  output(nodeId: string, name: string): GPUTextureView | null {
    return this.get(nodeId)?.outputs[name] ?? null;
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const n of this.nodes) n.resize(w, h);
  }

  /* ------------------------------------------------------------
     ONE ENCODER
     Depth inference, lighting and composite are recorded together
     and submitted once. There is no sync point between them.
     ------------------------------------------------------------ */
  frame(): void {
    const { device } = this.ctx;
    const t0 = performance.now();
    const info: FrameInfo = {
      width: this.w,
      height: this.h,
      time: (t0 - this.started) / 1000,
      frame: this.frameNo++,
    };

    const encoder = device.createCommandEncoder({ label: 'soup:frame' });

    const qs = this.querySet;
    let slot = 0;
    const marks: { id: string; label: string; a: number; b: number }[] = [];

    for (const node of this.nodes) {
      let stamps: PassStamps | null = null;
      if (qs && slot + 2 <= MAX_STAMPS) {
        stamps = {
          querySet: qs,
          beginningOfPassWriteIndex: slot,
          endOfPassWriteIndex: slot + 1,
        };
        marks.push({ id: node.id, label: node.label, a: slot, b: slot + 1 });
        slot += 2;
      }
      node.encode(encoder, info, stamps);
    }

    if (qs && this.resolveBuf && slot > 0) {
      encoder.resolveQuerySet(qs, 0, slot, this.resolveBuf, 0);
      if (this.readBuf && !this.reading) {
        encoder.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, slot * 8);
      }
    }

    device.queue.submit([encoder.finish()]);
    this.cpuMs = performance.now() - t0;

    // the timings arrive a frame late; nothing in the render path waits
    if (qs && this.readBuf && !this.reading && marks.length) {
      this.reading = true;
      const buf = this.readBuf;
      void buf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const t = new BigInt64Array(buf.getMappedRange().slice(0));
          buf.unmap();
          this.timings = marks.map((m) => ({
            id: m.id,
            label: m.label,
            gpuMs: Number(t[m.b] - t[m.a]) / 1e6,
            dispatches: this.get(m.id)?.dispatches ?? 0,
          }));
        })
        .catch(() => undefined)
        .finally(() => {
          this.reading = false;
        });
    } else if (!qs) {
      this.timings = this.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        gpuMs: null,
        dispatches: n.dispatches,
      }));
    }
  }

  /** what actually happened, for the overlay. Nothing here is invented. */
  report() {
    return {
      timings: this.timings,
      /** wall clock to record and submit, not GPU time */
      cpuSubmitMs: this.cpuMs,
      totalDispatches: this.nodes.reduce((s, n) => s + n.dispatches, 0),
      timestampsAvailable: !!this.querySet,
      nodes: this.nodes.map((n) => n.id),
    };
  }

  dispose() {
    for (const n of this.nodes) n.dispose();
    this.nodes = [];
    this.querySet?.destroy();
    this.resolveBuf?.destroy();
    this.readBuf?.destroy();
  }
}
