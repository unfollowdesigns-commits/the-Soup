import type { GpuContext } from '../device';
import type { FrameInfo, GpuNode, PassStamps } from '../graph';

/* ============================================================
   DEPTH
   The node that owns the depth texture. It publishes `depth` as
   an r16float texture that stays on the GPU for its whole life —
   nothing here maps, copies to a buffer, or awaits.

   Two sources can fill it:

     MODEL   a monocular depth network, supplied through the
             DepthModel interface below. It records its own
             dispatches into the encoder we hand it.

     PROXY   no model loaded: a single compute pass derives a
             stand-in from local contrast, aerial perspective and
             frame geometry. It is labelled PROXY everywhere it
             is shown and it is not an inference.

   The interface is the whole point. Weights and layout belong to
   whoever trained the model; this file only guarantees when it
   runs, what it writes into, and that it never leaves the GPU.
   ============================================================ */

export interface DepthModelInfo {
  name: string;
  /** the square the network actually runs at, e.g. 448 */
  resolution: number;
  /** dispatches per inference — reported by the model, counted here */
  dispatches: number;
  /** where the weights came from, so the panel can say so */
  source: string;
  /** 'metric' | 'relative' — affects nothing but honesty in the readout */
  kind: 'metric' | 'relative';
}

export interface DepthModel {
  readonly info: DepthModelInfo;
  /** called once, with the shared device/root. Upload weights here. */
  init(ctx: GpuContext): Promise<void>;
  /**
   * Record one inference. `input` is the source frame, `output` is an
   * r16float storage texture of `info.resolution` square that the model
   * must fill with normalised depth, near = 1.
   * Must not submit, map or await.
   */
  encode(
    encoder: GPUCommandEncoder,
    input: GPUTextureView,
    output: GPUTextureView,
    stamps: PassStamps | null,
  ): void;
  dispose(): void;
}

/* ---- the proxy, as a real compute pass -------------------- */
const PROXY_WGSL = /* wgsl */ `
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<r16float, write>;

fn luma(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let ss = vec2f(textureDimensions(src));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(size);
  let p  = vec2i(uv * ss);

  let c = textureLoad(src, p, 0).rgb;
  let l = luma(c);

  // local detail: high frequency energy falls away with distance
  var acc = 0.0;
  for (var j = -2; j <= 2; j = j + 1) {
    for (var i = -2; i <= 2; i = i + 1) {
      let q = clamp(p + vec2i(i, j) * 2, vec2i(0), vec2i(ss) - vec2i(1));
      acc = acc + abs(luma(textureLoad(src, q, 0).rgb) - l);
    }
  }
  let detail = clamp(acc * 1.6, 0.0, 1.0);

  // aerial perspective: distant matter is lighter and less saturated
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let sat = (mx - mn) / max(mx, 1e-5);
  let haze = clamp(l * 0.8 + (1.0 - sat) * 0.35, 0.0, 1.0);

  // frame geometry: the ground usually runs to the bottom edge
  let geo = smoothstep(0.0, 1.0, uv.y * 0.55 + 0.22);

  let near = clamp(detail * 0.55 + (1.0 - haze) * 0.3 + geo * 0.3, 0.0, 1.0);
  textureStore(dst, vec2i(gid.xy), vec4f(near, 0.0, 0.0, 1.0));
}
`;

export class DepthNode implements GpuNode {
  readonly id = 'depth';
  readonly label = 'Depth';

  private ctx: GpuContext;
  private model: DepthModel | null = null;
  private res: number;

  private tex: GPUTexture | null = null;
  private view: GPUTextureView | null = null;
  private source: GPUTextureView | null = null;

  private pipeline: GPUComputePipeline;
  private layout: GPUBindGroupLayout;
  private bind: GPUBindGroup | null = null;
  private _dispatches = 0;

  constructor(ctx: GpuContext, resolution = 448) {
    this.ctx = ctx;
    this.res = resolution;

    const d = ctx.device;
    this.layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r16float' },
        },
      ],
    });
    this.pipeline = d.createComputePipeline({
      label: 'depth:proxy',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: { module: d.createShaderModule({ code: PROXY_WGSL }), entryPoint: 'main' },
    });
    this.allocate();
  }

  /** the model drops in here and nothing else in the graph changes */
  async useModel(model: DepthModel) {
    await model.init(this.ctx);
    this.model?.dispose();
    this.model = model;
    if (model.info.resolution !== this.res) {
      this.res = model.info.resolution;
      this.allocate();
    }
  }

  clearModel() {
    this.model?.dispose();
    this.model = null;
  }

  get modelInfo(): DepthModelInfo | null {
    return this.model?.info ?? null;
  }

  /** what is actually filling the texture right now */
  get sourceKind(): 'model' | 'proxy' {
    return this.model ? 'model' : 'proxy';
  }

  get resolution() {
    return this.res;
  }

  /** the frame the depth is derived from */
  setInput(view: GPUTextureView) {
    this.source = view;
    this.bind = null;
  }

  private allocate() {
    this.tex?.destroy();
    this.tex = this.ctx.device.createTexture({
      label: 'depth:r16f',
      size: [this.res, this.res],
      format: 'r16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.view = this.tex.createView();
    this.bind = null;
  }

  get outputs(): Readonly<Record<string, GPUTextureView>> {
    return this.view ? { depth: this.view } : ({} as Record<string, GPUTextureView>);
  }

  get dispatches() {
    return this._dispatches;
  }

  resize() {
    /* depth runs at the model's own resolution, not the viewport's */
  }

  encode(encoder: GPUCommandEncoder, _frame: FrameInfo, stamps: PassStamps | null) {
    if (!this.source || !this.view) return;

    if (this.model) {
      this.model.encode(encoder, this.source, this.view, stamps);
      this._dispatches = this.model.info.dispatches;
      return;
    }

    if (!this.bind) {
      this.bind = this.ctx.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: this.source },
          { binding: 1, resource: this.view },
        ],
      });
    }

    const pass = encoder.beginComputePass({
      label: 'depth:proxy',
      ...(stamps ? { timestampWrites: stamps } : {}),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    const groups = Math.ceil(this.res / 8);
    pass.dispatchWorkgroups(groups, groups);
    pass.end();
    this._dispatches = 1;
  }

  dispose() {
    this.model?.dispose();
    this.tex?.destroy();
    this.tex = null;
    this.view = null;
  }
}
