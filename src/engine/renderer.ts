import type { Material, PhotoRecipe } from '../lab/types';
import { SOUP_TINT } from '../lab/recipe';
import {
  FRAG_BASE,
  FRAG_BLUR,
  FRAG_BRIGHT,
  FRAG_COMPOSITE,
  FRAG_DEPTH,
  VERT,
} from './glsl';

/* ============================================================
   THE ENGINE
   Consumes a recipe. Knows nothing about React.
   ============================================================ */

export type ViewMode = 'color' | 'depth' | 'normals' | 'depth-effect';
export type CompareMode = 'single' | 'split' | 'side-by-side';

export interface ViewState {
  zoom: number;
  panX: number;      /* image-space units, 0..1 */
  panY: number;
  compare: CompareMode;
  split: number;     /* 0..1 */
  view: ViewMode;
}

export interface RenderStats {
  /** wall-clock time for the render call, measured on the CPU side */
  frameMs: number;
  /** true GPU time, only when the timer query extension is present */
  gpuMs: number | null;
  gpuTimerAvailable: boolean;
  passes: number;
  baseW: number;
  baseH: number;
  canvasW: number;
  canvasH: number;
  floatBuffers: boolean;
  damagePlates: boolean;
}

const MAX_BASE = 2560;

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class LabRenderer {
  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private progs: Record<string, WebGLProgram> = {};
  private locs: Record<string, Map<string, WebGLUniformLocation | null>> = {};
  private vao: WebGLVertexArrayObject | null = null;

  private srcTex: WebGLTexture | null = null;
  private damageTex: WebGLTexture | null = null;
  private damageReady = false;
  private srcW = 0;
  private srcH = 0;

  private targets: Record<string, Target> = {};
  private floatOK = false;
  private timerExt: any = null;
  private pendingQuery: WebGLQuery | null = null;
  private lastGpuMs: number | null = null;

  private baseW = 0;
  private baseH = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for the processing engine.');
    this.gl = gl;
    this.canvas = canvas;

    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

    this.vao = gl.createVertexArray();

    this.progs.base = this.build(VERT, FRAG_BASE, 'base');
    this.progs.bright = this.build(VERT, FRAG_BRIGHT, 'bright');
    this.progs.blur = this.build(VERT, FRAG_BLUR, 'blur');
    this.progs.depth = this.build(VERT, FRAG_DEPTH, 'depth');
    this.progs.composite = this.build(VERT, FRAG_COMPOSITE, 'composite');

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    void this.loadDamagePlates();
  }

  /* ---- shader plumbing ---------------------------------- */

  private compile(type: number, src: string, tag: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? '';
      const line = /ERROR: \d+:(\d+)/.exec(log)?.[1];
      const ctx = line
        ? src.split('\n').slice(Math.max(0, +line - 4), +line + 2).join('\n')
        : '';
      gl.deleteShader(sh);
      throw new Error(`[${tag}] shader compile failed\n${log}\n${ctx}`);
    }
    return sh;
  }

  private build(vs: string, fs: string, tag: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    const v = this.compile(gl.VERTEX_SHADER, vs, `${tag}:vert`);
    const f = this.compile(gl.FRAGMENT_SHADER, fs, `${tag}:frag`);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`[${tag}] link failed: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.locs[tag] = new Map();
    return p;
  }

  private u(tag: string, name: string): WebGLUniformLocation | null {
    const cache = this.locs[tag];
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(this.progs[tag], name));
    return cache.get(name)!;
  }

  /* ---- targets ------------------------------------------- */

  private target(key: string, w: number, h: number, float: boolean): Target {
    const gl = this.gl;
    const existing = this.targets[key];
    if (existing && existing.w === w && existing.h === h) return existing;
    if (existing) {
      gl.deleteFramebuffer(existing.fbo);
      gl.deleteTexture(existing.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const useFloat = float && this.floatOK;
    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      useFloat ? gl.RGBA16F : gl.RGBA8,
      w, h, 0, gl.RGBA,
      useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const t = { fbo, tex, w, h };
    this.targets[key] = t;
    return t;
  }

  private drawTo(t: Target | null, prog: WebGLProgram) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bind(tag: string, name: string, tex: WebGLTexture | null, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u(tag, name), unit);
  }

  /* ---- source -------------------------------------------- */

  /** re-upload the current frame of a moving specimen; cheap enough to
   *  run every animation frame because the texture is already allocated */
  updateSource(img: TexImageSource) {
    const gl = this.gl;
    if (!this.srcTex) return;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img as any);
  }

  setSource(img: TexImageSource, w: number, h: number) {
    const gl = this.gl;
    if (!this.srcTex) this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img as any);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.srcW = w;
    this.srcH = h;

    const long = Math.max(w, h);
    const k = long > MAX_BASE ? MAX_BASE / long : 1;
    this.baseW = Math.max(2, Math.round(w * k));
    this.baseH = Math.max(2, Math.round(h * k));
  }

  /* ---- real material ------------------------------------- */

  private async loadDamagePlates() {
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('damage plate missing'));
        img.src = `${import.meta.env.BASE_URL}analog/plates/damage-atlas-1.png`;
      });
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.damageTex = tex;
      this.damageReady = true;
    } catch {
      // the engine falls back to its procedural path and says so in the readout
      this.damageReady = false;
    }
  }

  get hasDamagePlates() {
    return this.damageReady;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */

  render(recipe: PhotoRecipe, m: Material, view: ViewState): RenderStats | null {
    const gl = this.gl;
    if (!this.srcTex || !this.baseW) return null;

    const t0 = performance.now();
    let passes = 0;

    if (this.timerExt && !this.pendingQuery) {
      this.pendingQuery = gl.createQuery();
      gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.pendingQuery!);
    }

    gl.bindVertexArray(this.vao);

    /* ---------- PASS 1 — BASE ---------- */
    const base = this.target('base', this.baseW, this.baseH, true);
    const dev = developmentTerms(recipe, m);
    {
      const P = 'base';
      gl.useProgram(this.progs.base);
      this.bind(P, 'uSrc', this.srcTex, 0);
      const e = recipe.exposure;
      gl.uniform1f(this.u(P, 'uEV'), e.ev);
      gl.uniform1f(this.u(P, 'uContrast'), e.contrast);
      gl.uniform1f(this.u(P, 'uHighlights'), e.highlights);
      gl.uniform1f(this.u(P, 'uShadows'), e.shadows);
      gl.uniform1f(this.u(P, 'uLatitude'), e.latitude);

      const pr = m.profile;
      gl.uniform1f(this.u(P, 'uToe'), pr.toe);
      gl.uniform1f(this.u(P, 'uShoulder'), pr.shoulder);
      gl.uniform1f(this.u(P, 'uGamma'), pr.gamma);
      gl.uniform1f(this.u(P, 'uMatContrast'), pr.contrast);
      gl.uniform1f(this.u(P, 'uSaturation'), pr.saturation);
      gl.uniform3fv(this.u(P, 'uChannelGamma'), pr.channelGamma);
      gl.uniform3fv(this.u(P, 'uShadowTint'), pr.shadowTint);
      gl.uniform3fv(this.u(P, 'uHighTint'), pr.highlightTint);
      gl.uniform1f(this.u(P, 'uCrossover'), pr.crossover);
      gl.uniform1f(this.u(P, 'uMono'), pr.monochrome ? 1 : 0);
      gl.uniform3fv(this.u(P, 'uMonoMix'), pr.monoMix);

      gl.uniform1f(this.u(P, 'uPushPull'), recipe.development.pushPull);
      gl.uniform1f(this.u(P, 'uDevContrast'), dev.contrast);
      gl.uniform1f(this.u(P, 'uDevSat'), dev.saturation);
      gl.uniform1f(this.u(P, 'uDevFog'), dev.fog);
      gl.uniform1f(this.u(P, 'uDevCross'), dev.crossover);
      gl.uniform1f(this.u(P, 'uBleach'), dev.bleach);
      gl.uniform1f(this.u(P, 'uExpired'), recipe.experimental.expired);
      gl.uniform1f(this.u(P, 'uRedscale'), recipe.experimental.redscale);
      this.drawTo(base, this.progs.base);
      passes++;
    }

    /* ---------- PASS 2/3 — HALATION ---------- */
    const hw = Math.max(2, this.baseW >> 1);
    const hh = Math.max(2, this.baseH >> 1);
    const bright = this.target('bright', hw, hh, true);
    const halo = this.target('halo', hw, hh, true);
    const ping = this.target('ping', hw, hh, true);
    {
      const P = 'bright';
      gl.useProgram(this.progs.bright);
      this.bind(P, 'uTex', base.tex, 0);
      gl.uniform1f(this.u(P, 'uThreshold'), recipe.halation.threshold * 0.9);
      gl.uniform1f(this.u(P, 'uKnee'), 0.12 + recipe.halation.edge * 0.2);
      this.drawTo(bright, this.progs.bright);
      passes++;
    }
    const halRadius = 1.5 + recipe.halation.radius * 22;
    passes += this.blur(bright, ping, halo, halRadius, 2);

    /* ---------- DIFFUSION ---------- */
    const dw = Math.max(2, this.baseW >> 2);
    const dh = Math.max(2, this.baseH >> 2);
    const dbright = this.target('dbright', dw, dh, true);
    const diff = this.target('diff', dw, dh, true);
    const dping = this.target('dping', dw, dh, true);
    {
      const P = 'bright';
      gl.useProgram(this.progs.bright);
      this.bind(P, 'uTex', base.tex, 0);
      gl.uniform1f(this.u(P, 'uThreshold'), 0.02);
      gl.uniform1f(this.u(P, 'uKnee'), 0.9);
      this.drawTo(dbright, this.progs.bright);
      passes++;
    }
    passes += this.blur(dbright, dping, diff, 3 + recipe.diffusion.spread * 16, 2);

    /* ---------- DEPTH PROXY ---------- */
    const depth = this.target('depth', dw, dh, false);
    const dep2 = this.target('depth2', dw, dh, false);
    const needDepth = recipe.depth.enabled || view.view !== 'color';
    if (needDepth) {
      const P = 'depth';
      gl.useProgram(this.progs.depth);
      this.bind(P, 'uTex', base.tex, 0);
      gl.uniform2f(this.u(P, 'uTexel'), 1 / dw, 1 / dh);
      this.drawTo(depth, this.progs.depth);
      passes++;
      passes += this.blur(depth, dep2, depth, 3, 1);
    }

    /* ---------- COMPOSITE ---------- */
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const map = computeMaps(cw, ch, this.srcW, this.srcH, view);

    {
      const P = 'composite';
      gl.useProgram(this.progs.composite);
      this.bind(P, 'uBase', base.tex, 0);
      this.bind(P, 'uRaw', this.srcTex, 1);
      this.bind(P, 'uHalo', halo.tex, 2);
      this.bind(P, 'uDiff', diff.tex, 3);
      this.bind(P, 'uDepth', depth.tex, 4);
      this.bind(P, 'uDamage', this.damageTex, 5);

      gl.uniform2f(this.u(P, 'uRes'), cw, ch);
      gl.uniform2f(this.u(P, 'uImgRes'), this.srcW, this.srcH);
      gl.uniform4fv(this.u(P, 'uMapA'), map.a);
      gl.uniform4fv(this.u(P, 'uMapB'), map.b);
      gl.uniform1i(this.u(P, 'uMode'), map.mode);
      gl.uniform1f(this.u(P, 'uSplit'), view.split);
      gl.uniform1i(this.u(P, 'uView'), VIEW_INDEX[view.view]);
      gl.uniform1f(this.u(P, 'uZoom'), view.zoom);
      gl.uniform1f(this.u(P, 'uTime'), performance.now() * 0.001);

      const h = recipe.halation;
      gl.uniform1f(this.u(P, 'uHalIntensity'), h.intensity);
      gl.uniform1f(this.u(P, 'uHalRadius'), h.radius);
      gl.uniform1f(this.u(P, 'uHalThreshold'), h.threshold);
      gl.uniform1f(this.u(P, 'uHalEdge'), h.edge);
      gl.uniform3fv(this.u(P, 'uHalTint'), halationTint(m, h.hue));

      gl.uniform1f(this.u(P, 'uDifSoft'), recipe.diffusion.softness);
      gl.uniform1f(this.u(P, 'uDifBloom'), recipe.diffusion.bloom);
      gl.uniform1f(this.u(P, 'uAcutance'), dev.acutance);

      const o = recipe.optics;
      gl.uniform1f(this.u(P, 'uDistort'), o.distortion);
      gl.uniform1f(this.u(P, 'uChroma'), o.chromatic);
      gl.uniform1f(this.u(P, 'uVignette'), o.vignette);
      gl.uniform1f(this.u(P, 'uEdgeSoft'), o.edgeSoftness);

      const g = recipe.grain;
      gl.uniform1f(this.u(P, 'uGrainAmount'), g.amount * dev.grain);
      gl.uniform1f(this.u(P, 'uGrainSize'), g.size);
      gl.uniform1f(this.u(P, 'uGrainDensity'), g.density);
      gl.uniform1f(this.u(P, 'uGrainClump'), g.clumping);
      gl.uniform1f(this.u(P, 'uGrainLum'), g.luminance);
      gl.uniform1f(this.u(P, 'uGrainChroma'), m.profile.monochrome ? 0 : g.chroma);
      gl.uniform1f(this.u(P, 'uGrainRand'), g.randomness);
      gl.uniform1f(this.u(P, 'uGrainSeed'), (g.seed % 1024) * 0.6180339887);

      const x = recipe.experimental;
      gl.uniform1f(this.u(P, 'uSoup'), x.filmSoup);
      gl.uniform1f(this.u(P, 'uSoupTemp'), x.soupTemperature);
      gl.uniform1f(this.u(P, 'uSoupContam'), x.contamination);
      gl.uniform1f(this.u(P, 'uSoupFog'), x.fog);
      gl.uniform1f(this.u(P, 'uSoupBleed'), x.bleed);
      gl.uniform1f(this.u(P, 'uSoupDensity'), x.soupDensity);
      gl.uniform1f(this.u(P, 'uSoupRand'), x.soupRandomness);
      gl.uniform1f(this.u(P, 'uSoupSeed'), (x.soupSeed % 2048) * 0.381966);
      gl.uniform3fv(this.u(P, 'uSoupTint'), SOUP_TINT[x.soupChemical]);

      gl.uniform1f(this.u(P, 'uSolar'), x.solarization);
      gl.uniform1f(this.u(P, 'uLeak'), x.lightLeak);
      gl.uniform1f(this.u(P, 'uScratch'), x.scratches);
      gl.uniform1f(this.u(P, 'uDust'), x.dust);
      gl.uniform1f(this.u(P, 'uExpiredAge'), x.expired);
      gl.uniform1f(this.u(P, 'uDamageSeed'), (x.seed % 2048) * 0.7548776662);

      const dseed = (x.seed % 997) / 997;
      gl.uniform4f(
        this.u(P, 'uDamageXf'),
        0.85 + dseed * 0.5,
        dseed * Math.PI * 2,
        dseed * 0.83,
        ((x.seed >> 7) % 997) / 997,
      );
      gl.uniform1f(this.u(P, 'uDamageMix'), this.damageReady ? 1 : 0);

      const burns = recipe.burns.filter((b) => b.enabled && b.amount > 0).slice(0, 8);
      gl.uniform1i(this.u(P, 'uBurnCount'), burns.length);
      if (burns.length) {
        const A = new Float32Array(32);
        const B = new Float32Array(32);
        const S = new Float32Array(8);
        burns.forEach((b, i) => {
          A.set([b.x, b.y, b.amount, 0.04 + b.spread * 0.5], i * 4);
          B.set([b.density, b.hue, b.edge, b.randomness], i * 4);
          S[i] = (b.seed % 1024) * 0.2971;
        });
        gl.uniform4fv(this.u(P, 'uBurnA'), A);
        gl.uniform4fv(this.u(P, 'uBurnB'), B);
        gl.uniform1fv(this.u(P, 'uBurnSeed'), S);
      }

      const q = recipe.sequence;
      gl.uniform1f(this.u(P, 'uSeqOn'), q.enabled ? 1 : 0);
      gl.uniform1f(this.u(P, 'uSeqRows'), q.rows);
      gl.uniform1f(this.u(P, 'uSeqCols'), q.cols);
      gl.uniform1f(this.u(P, 'uSeqDrift'), q.drift);
      gl.uniform1f(this.u(P, 'uSeqGutter'), q.gutter);

      const ra = recipe.raster;
      gl.uniform1f(this.u(P, 'uDither'), ra.dither);
      gl.uniform1f(this.u(P, 'uLevels'), ra.levels);
      gl.uniform1f(this.u(P, 'uComb'), ra.comb);
      gl.uniform1f(this.u(P, 'uScanline'), ra.scanline);

      const d = recipe.depth;
      gl.uniform1f(this.u(P, 'uDepthOn'), d.enabled ? 1 : 0);
      gl.uniform1f(this.u(P, 'uDepthInf'), d.influence);
      gl.uniform4f(
        this.u(P, 'uDepthTargets'),
        d.target.includes('grain') ? 1 : 0,
        d.target.includes('halation') ? 1 : 0,
        d.target.includes('diffusion') ? 1 : 0,
        d.target.includes('burn') ? 1 : 0,
      );
      gl.uniform1f(
        this.u(P, 'uDepthHaze'),
        d.enabled && d.target.includes('haze') ? d.influence : 0,
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      passes++;
    }

    if (this.timerExt && this.pendingQuery) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
      const q = this.pendingQuery;
      queueMicrotask(() => {
        const ready = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
        const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
        if (ready && !disjoint) {
          this.lastGpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        }
        if (ready) {
          gl.deleteQuery(q);
          this.pendingQuery = null;
        }
      });
    }

    return {
      frameMs: performance.now() - t0,
      gpuMs: this.lastGpuMs,
      gpuTimerAvailable: !!this.timerExt,
      passes,
      baseW: this.baseW,
      baseH: this.baseH,
      canvasW: cw,
      canvasH: ch,
      floatBuffers: this.floatOK,
      damagePlates: this.damageReady,
    };
  }

  private blur(src: Target, tmp: Target, dst: Target, radius: number, iterations: number) {
    const gl = this.gl;
    const P = 'blur';
    let passes = 0;
    let input = src;
    for (let i = 0; i < iterations; i++) {
      const r = radius / (i + 1);
      gl.useProgram(this.progs.blur);
      this.bind(P, 'uTex', input.tex, 0);
      gl.uniform2f(this.u(P, 'uDir'), r / tmp.w, 0);
      this.drawTo(tmp, this.progs.blur);

      gl.useProgram(this.progs.blur);
      this.bind(P, 'uTex', tmp.tex, 0);
      gl.uniform2f(this.u(P, 'uDir'), 0, r / dst.h);
      this.drawTo(dst, this.progs.blur);
      input = dst;
      passes += 2;
    }
    return passes;
  }

  dispose() {
    const gl = this.gl;
    Object.values(this.targets).forEach((t) => {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    });
    Object.values(this.progs).forEach((p) => gl.deleteProgram(p));
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    if (this.damageTex) gl.deleteTexture(this.damageTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}

const VIEW_INDEX: Record<ViewMode, number> = {
  color: 0,
  depth: 1,
  normals: 2,
  'depth-effect': 3,
};

/* ============================================================
   VIEW TRANSFORM — screen uv → image uv
   ============================================================ */

export function fitScale(cw: number, ch: number, iw: number, ih: number) {
  return Math.min(cw / iw, ch / ih);
}

function computeMaps(cw: number, ch: number, iw: number, ih: number, v: ViewState) {
  const mode = v.compare === 'side-by-side' ? 2 : v.compare === 'split' ? 1 : 0;

  const make = (paneX: number, paneW: number) => {
    const fit = fitScale(paneW, ch, iw, ih);
    const s = fit * v.zoom;
    const dw = iw * s;
    const dh = ih * s;
    // image uv per screen uv
    const sx = cw / dw;
    // v runs up the screen and down the image, so the y map is inverted
    const sy = -(ch / dh);
    const cx = paneX + paneW / 2;
    const ox = 0.5 - (cx / cw) * sx + v.panX;
    const oy = 0.5 - 0.5 * sy + v.panY;
    return new Float32Array([sx, sy, ox, oy]);
  };

  if (mode === 2) {
    return { a: make(0, cw / 2), b: make(cw / 2, cw / 2), mode };
  }
  const m = make(0, cw);
  return { a: m, b: m, mode };
}

/* ============================================================
   DEVELOPMENT — how the process changes the material
   ============================================================ */

interface DevTerms {
  contrast: number;
  saturation: number;
  fog: number;
  crossover: number;
  bleach: number;
  grain: number;
  acutance: number;
}

export function developmentTerms(r: PhotoRecipe, m: Material): DevTerms {
  const { mode, pushPull, developer, agitation } = r.development;
  const t: DevTerms = {
    contrast: 0,
    saturation: 1,
    fog: 0,
    crossover: 0,
    bleach: 0,
    grain: 1,
    acutance: 0,
  };

  switch (mode) {
    case 'push':
      t.contrast = 0.1 + Math.max(0, pushPull) * 0.1;
      t.fog = 0.02 + Math.max(0, pushPull) * 0.022;
      t.grain = 1 + Math.max(0, pushPull) * 0.32;
      break;
    case 'pull':
      t.contrast = -0.06 + Math.min(0, pushPull) * 0.07;
      t.grain = 1 + Math.min(0, pushPull) * 0.14;
      break;
    case 'cross-process':
      t.contrast = 0.26;
      t.saturation = 1.35;
      t.crossover = 0.55;
      t.fog = 0.05;
      t.grain = 1.25;
      break;
    case 'bleach-bypass':
      t.contrast = 0.14;
      t.bleach = 0.7;
      t.grain = 1.15;
      break;
    case 'stand':
      t.contrast = -0.1;
      t.acutance = 0.35;
      t.fog = 0.03;
      t.grain = 1.1;
      break;
    default:
      break;
  }

  switch (developer) {
    case 'rodinal':
      t.acutance += 0.42;
      t.grain *= 1.22;
      break;
    case 'xtol':
      t.grain *= 0.82;
      t.contrast -= 0.02;
      break;
    case 'hc110':
      t.fog *= 0.6;
      t.acutance += 0.12;
      break;
    case 'd76':
      t.grain *= 0.94;
      break;
    default:
      break;
  }

  // agitation drives contrast and edge effects in opposite directions
  t.contrast += (agitation - 0.5) * 0.12;
  t.acutance += (0.5 - agitation) * 0.28;
  if (m.profile.monochrome) t.saturation = 1;
  return t;
}

/** the halation hue control moves between the material's own tint,
 *  a colder scatter and bare ember red */
export function halationTint(m: Material, hue: number): Float32Array {
  const base = m.profile.halationTint;
  const cold: [number, number, number] = [0.62, 0.72, 1.0];
  const ember: [number, number, number] = [1.0, 0.24, 0.06];
  const t = hue * 2 - 1;
  const mixed =
    t < 0
      ? base.map((v, i) => v + (cold[i] - v) * -t)
      : base.map((v, i) => v + (ember[i] - v) * t);
  return new Float32Array(mixed);
}
