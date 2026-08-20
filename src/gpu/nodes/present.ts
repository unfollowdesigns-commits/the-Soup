import type { GpuContext } from '../device';
import type { FrameInfo, GpuNode, PassStamps } from '../graph';

/* ============================================================
   PRESENT
   Draws the last node's texture to the canvas. It is a node like
   any other, so the render pass is recorded into the same
   encoder as the compute work above it and the whole frame is
   one submit.
   ============================================================ */

const WGSL = /* wgsl */ `
@group(0) @binding(0) var tex  : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> VSOut {
  // one oversized triangle, no vertex buffer
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out : VSOut;
  out.pos = vec4f(p[i], 0.0, 1.0);
  out.uv  = vec2f((p[i].x + 1.0) * 0.5, 1.0 - (p[i].y + 1.0) * 0.5);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let c = textureSample(tex, samp, in.uv).rgb;
  // the compute pass works in linear; the surface is sRGB-ish
  return vec4f(pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}
`;

export class PresentNode implements GpuNode {
  readonly id = 'present';
  readonly label = 'Present';
  readonly dispatches = 0;
  readonly outputs: Readonly<Record<string, GPUTextureView>> = {};

  private ctx: GpuContext;
  private canvasCtx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private layout: GPUBindGroupLayout;
  private sampler: GPUSampler;
  private srcView: GPUTextureView | null = null;
  private bind: GPUBindGroup | null = null;

  constructor(ctx: GpuContext, canvas: HTMLCanvasElement) {
    this.ctx = ctx;
    const gctx = canvas.getContext('webgpu');
    if (!gctx) throw new Error('This canvas will not give a webgpu context.');
    this.canvasCtx = gctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    gctx.configure({ device: ctx.device, format, alphaMode: 'opaque' });

    const d = ctx.device;
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const mod = d.createShaderModule({ code: WGSL });
    this.pipeline = d.createRenderPipeline({
      label: 'present',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  setInput(view: GPUTextureView) {
    this.srcView = view;
    this.bind = null;
  }

  resize() {
    /* the canvas context follows the canvas element's own size */
  }

  encode(encoder: GPUCommandEncoder, _frame: FrameInfo, stamps: PassStamps | null) {
    if (!this.srcView) return;
    if (!this.bind) {
      this.bind = this.ctx.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: this.srcView },
          { binding: 1, resource: this.sampler },
        ],
      });
    }
    const pass = encoder.beginRenderPass({
      label: 'present',
      colorAttachments: [
        {
          view: this.canvasCtx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.023, g: 0.023, b: 0.023, a: 1 },
        },
      ],
      ...(stamps ? { timestampWrites: stamps } : {}),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.draw(3);
    pass.end();
  }

  dispose() {
    this.canvasCtx.unconfigure();
  }
}
