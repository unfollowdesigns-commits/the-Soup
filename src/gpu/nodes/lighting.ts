import type { GpuContext } from '../device';
import type { FrameInfo, GpuNode, PassStamps } from '../graph';

/* ============================================================
   DEPTH-AWARE LIGHT INJECTION
   Reads the depth texture the depth node published — the same
   texture object, in the same encoder, with no copy between
   them — and writes a lit image.

     depth  → normals      central differences, scaled by the
                           depth range so the surface does not
                           shear when the model rescales
     depth  → attenuation  inverse-square on the reconstructed
                           position, so a light dims with real
                           distance rather than with screen radius
     lights → injection    N point lights, wrap-lit so a normal
                           facing away is not simply black

   Contact shadows are a short march along the vector to the
   light through the depth field: if anything in front blocks the
   path, the sample is occluded.
   ============================================================ */

export const MAX_LIGHTS = 4;

export interface Light {
  /** screen space 0..1, and depth 0 (far) .. 1 (near) */
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
  radius: number;
}

export type LightView = 'lit' | 'rgb' | 'depth' | 'normals';

const WGSL = /* wgsl */ `
struct Light {
  pos   : vec4f,   // xyz + radius
  color : vec4f,   // rgb + intensity
};

struct Uniforms {
  lightCount : u32,
  view       : u32,   // 0 lit, 1 rgb, 2 depth, 3 normals
  time       : f32,
  ambient    : f32,
  normalZ    : f32,   // how much relief the depth is given
  shadow     : f32,   // contact shadow strength
  parallax   : f32,
  exposure   : f32,
};

@group(0) @binding(0) var src     : texture_2d<f32>;
@group(0) @binding(1) var depthT  : texture_2d<f32>;
@group(0) @binding(2) var samp    : sampler;
@group(0) @binding(3) var dst     : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> u : Uniforms;
@group(0) @binding(5) var<storage, read> lights : array<Light, ${MAX_LIGHTS}>;

fn depthAt(uv : vec2f) -> f32 {
  return textureSampleLevel(depthT, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
}

// central differences on the depth field. The z term controls how much
// relief we grant the surface; a flat z makes everything face the camera.
fn normalAt(uv : vec2f, texel : vec2f) -> vec3f {
  let dx = depthAt(uv + vec2f(texel.x, 0.0)) - depthAt(uv - vec2f(texel.x, 0.0));
  let dy = depthAt(uv + vec2f(0.0, texel.y)) - depthAt(uv - vec2f(0.0, texel.y));
  return normalize(vec3f(-dx * u.normalZ, -dy * u.normalZ, 1.0));
}

// a short march through the depth field toward the light
fn contact(uv : vec2f, d : f32, toLight : vec3f) -> f32 {
  if (u.shadow <= 0.001) { return 1.0; }
  var occ = 0.0;
  let step = toLight.xy * 0.012;
  var p = uv;
  var z = d;
  for (var i = 0; i < 12; i = i + 1) {
    p = p + step;
    z = z + toLight.z * 0.012;
    let s = depthAt(p);
    if (s > z + 0.012) { occ = occ + 1.0; }
  }
  return 1.0 - clamp(occ / 12.0, 0.0, 1.0) * u.shadow;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(size);
  let texel = 1.0 / vec2f(size);

  let d = depthAt(uv);
  let n = normalAt(uv, texel * 2.0);

  // parallax: near matter shifts against far matter
  var suv = uv;
  if (u.parallax != 0.0) {
    suv = uv + (uv - vec2f(0.5)) * (d - 0.5) * u.parallax * 0.06;
  }
  let base = textureSampleLevel(src, samp, clamp(suv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;

  if (u.view == 1u) { textureStore(dst, vec2i(gid.xy), vec4f(base, 1.0)); return; }
  if (u.view == 2u) { textureStore(dst, vec2i(gid.xy), vec4f(vec3f(d), 1.0)); return; }
  if (u.view == 3u) { textureStore(dst, vec2i(gid.xy), vec4f(n * 0.5 + 0.5, 1.0)); return; }

  // the shading point, reconstructed from screen position and depth
  let P = vec3f(uv, d);
  var lit = base * u.ambient;

  for (var i = 0u; i < u.lightCount; i = i + 1u) {
    let L = lights[i];
    let toL = L.pos.xyz - P;
    // z is a much shorter axis than the screen, so it is weighted up
    let v = vec3f(toL.x, toL.y, toL.z * 1.6);
    let dist = length(v);
    let dir = v / max(dist, 1e-4);

    // inverse square, cut off at the light's radius
    let falloff = 1.0 / (1.0 + (dist / max(L.pos.w, 1e-3)) * (dist / max(L.pos.w, 1e-3)));
    let edge = clamp(1.0 - dist / max(L.pos.w * 2.0, 1e-3), 0.0, 1.0);

    // wrap lighting: a surface turned away still catches something
    let ndl = clamp((dot(n, dir) + 0.35) / 1.35, 0.0, 1.0);
    let sh = contact(uv, d, dir);

    lit = lit + base * L.color.rgb * (L.color.a * ndl * falloff * edge * sh);
  }

  textureStore(dst, vec2i(gid.xy), vec4f(lit * u.exposure, 1.0));
}
`;

export class LightingNode implements GpuNode {
  readonly id = 'lighting';
  readonly label = 'Light injection';

  private ctx: GpuContext;
  private pipeline: GPUComputePipeline;
  private layout: GPUBindGroupLayout;
  private sampler: GPUSampler;
  private uniforms: GPUBuffer;
  private lightBuf: GPUBuffer;

  private tex: GPUTexture | null = null;
  private view: GPUTextureView | null = null;
  private src: GPUTextureView | null = null;
  private depth: GPUTextureView | null = null;
  private bind: GPUBindGroup | null = null;
  private w = 0;
  private h = 0;
  private _dispatches = 0;

  lights: Light[] = [
    { x: 0.32, y: 0.36, z: 0.72, r: 1, g: 0.86, b: 0.62, intensity: 1.5, radius: 0.7 },
  ];
  view3: LightView = 'lit';
  ambient = 0.42;
  normalZ = 14;
  shadow = 0.5;
  parallax = 0;
  exposure = 1;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    const d = ctx.device;
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniforms = d.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.lightBuf = d.createBuffer({
      size: MAX_LIGHTS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.pipeline = d.createComputePipeline({
      label: 'lighting',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: { module: d.createShaderModule({ code: WGSL }), entryPoint: 'main' },
    });
  }

  setInputs(src: GPUTextureView, depth: GPUTextureView) {
    this.src = src;
    this.depth = depth;
    this.bind = null;
  }

  get outputs(): Readonly<Record<string, GPUTextureView>> {
    return this.view ? { lit: this.view } : ({} as Record<string, GPUTextureView>);
  }

  get dispatches() {
    return this._dispatches;
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.tex?.destroy();
    this.tex = this.ctx.device.createTexture({
      label: 'lighting:out',
      size: [Math.max(1, w), Math.max(1, h)],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.view = this.tex.createView();
    this.bind = null;
  }

  encode(encoder: GPUCommandEncoder, frame: FrameInfo, stamps: PassStamps | null) {
    if (!this.src || !this.depth || !this.view) return;
    const d = this.ctx.device;

    const VIEWS: Record<LightView, number> = { lit: 0, rgb: 1, depth: 2, normals: 3 };
    const u = new ArrayBuffer(32);
    new Uint32Array(u, 0, 2).set([Math.min(this.lights.length, MAX_LIGHTS), VIEWS[this.view3]]);
    new Float32Array(u, 8, 6).set([
      frame.time, this.ambient, this.normalZ, this.shadow, this.parallax, this.exposure,
    ]);
    d.queue.writeBuffer(this.uniforms, 0, u);

    const L = new Float32Array(MAX_LIGHTS * 8);
    this.lights.slice(0, MAX_LIGHTS).forEach((l, i) => {
      L.set([l.x, l.y, l.z, l.radius, l.r, l.g, l.b, l.intensity], i * 8);
    });
    d.queue.writeBuffer(this.lightBuf, 0, L);

    if (!this.bind) {
      this.bind = d.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: this.src },
          { binding: 1, resource: this.depth },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: this.view },
          { binding: 4, resource: { buffer: this.uniforms } },
          { binding: 5, resource: { buffer: this.lightBuf } },
        ],
      });
    }

    const pass = encoder.beginComputePass({
      label: 'lighting',
      ...(stamps ? { timestampWrites: stamps } : {}),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.dispatchWorkgroups(Math.ceil(this.w / 8), Math.ceil(this.h / 8));
    pass.end();
    this._dispatches = 1;
  }

  dispose() {
    this.tex?.destroy();
    this.uniforms.destroy();
    this.lightBuf.destroy();
  }
}
