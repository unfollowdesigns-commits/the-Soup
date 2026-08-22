import type { Material, PhotoRecipe } from '../lab/types';
import { SOUP_TINT } from '../lab/recipe';
import {
  FRAG_BASE,
  FRAG_BLUR,
  FRAG_BRIGHT,
  FRAG_COMPOSITE,
  FRAG_DEPTH,
  FRAG_PRESENT,
  FRAG_RD,
  FRAG_TIME,
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

const PAPER_FILES: Record<string, string> = {
  fibre: 'analog/paper/paper-fibre-1.png',
  rag: 'analog/paper/paper-fibre-2.png',
  toner: 'analog/photocopy/toner-1.png',
  copy: 'analog/photocopy/toner-2.png',
};

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
  private paperTex: WebGLTexture | null = null;
  private blankTex: WebGLTexture | null = null;
  private paperReady = false;
  private paperStock = '';
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

  /* ---- the engine's memory ----
     Two canvas-sized buffers the time pass ping-pongs between, and
     two more at a quarter size holding the reaction-diffusion state.
     `timeFrames` counts how long the feedback has been running: the
     chemistry is reseeded whenever the loop is restarted. */
  private histIdx = 0;
  private timeFrames = 0;
  private rdIdx = 0;
  private rdFrames = 0;
  private rdKey = '';

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

    // a 1x1 mid-grey stands in for any plate that has not loaded yet, so a
    // sampler is never bound to an incomplete texture
    this.blankTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    this.progs.base = this.build(VERT, FRAG_BASE, 'base');
    this.progs.bright = this.build(VERT, FRAG_BRIGHT, 'bright');
    this.progs.blur = this.build(VERT, FRAG_BLUR, 'blur');
    this.progs.depth = this.build(VERT, FRAG_DEPTH, 'depth');
    this.progs.time = this.build(VERT, FRAG_TIME, 'time');
    this.progs.rd = this.build(VERT, FRAG_RD, 'rd');
    this.progs.present = this.build(VERT, FRAG_PRESENT, 'present');
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

  /** the paper the print is laid on. Real material — one plate per stock. */
  private ensurePaper(stock: string) {
    if (this.paperStock === stock) return;
    this.paperStock = stock;
    this.paperReady = false;
    const file = PAPER_FILES[stock] ?? PAPER_FILES.fibre;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const gl = this.gl;
      if (!this.paperTex) this.paperTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.paperTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // the plates are periodic, so they may repeat without a seam
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.paperReady = true;
    };
    img.onerror = () => { this.paperReady = false; };
    img.src = `${import.meta.env.BASE_URL}${file}`;
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

    // Only one timer query may be in flight. If the last one has not
    // resolved we simply do not time this frame — ending a query we never
    // began raises INVALID_OPERATION every frame and hides real errors.
    let timing = false;
    if (this.timerExt && !this.pendingQuery) {
      this.pendingQuery = gl.createQuery();
      gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.pendingQuery!);
      timing = true;
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
    const tmOn = recipe.time;
    const timeOn =
      view.compare === 'single' &&
      view.view === 'color' &&
      (tmOn.echo > 0 || tmOn.slit > 0 || tmOn.displace > 0 || tmOn.rd > 0);
    // allocated before the composite binds its samplers: creating a
    // target binds a texture on whatever unit happens to be active
    const frameTarget = timeOn ? this.target('frame', cw, ch, true) : null;

    {
      const P = 'composite';
      gl.useProgram(this.progs.composite);
      this.bind(P, 'uBase', base.tex, 0);
      this.bind(P, 'uRaw', this.srcTex, 1);
      this.bind(P, 'uHalo', halo.tex, 2);
      this.bind(P, 'uDiff', diff.tex, 3);
      this.bind(P, 'uDepth', depth.tex, 4);
      this.bind(P, 'uDamage', this.damageTex ?? this.blankTex, 5);

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

      const bl = recipe.blur;
      gl.uniform1f(this.u(P, 'uBlurAmt'), bl.amount);
      gl.uniform1f(this.u(P, 'uBlurAngle'), bl.angle);
      gl.uniform1f(this.u(P, 'uBlurMode'), bl.mode === 'motion' ? 0 : bl.mode === 'zoom' ? 1 : 2);
      gl.uniform1f(this.u(P, 'uBlurTaper'), bl.taper);
      gl.uniform2f(this.u(P, 'uBlurCentre'), bl.cx, bl.cy);

      const sc = recipe.screen;
      gl.uniform1f(this.u(P, 'uHalftone'), sc.halftone);
      gl.uniform1f(this.u(P, 'uHalfSize'), sc.halfSize);
      gl.uniform1f(this.u(P, 'uHalfAngle'), sc.halfAngle);
      gl.uniform1f(this.u(P, 'uHalfColour'), sc.halfColour ? 1 : 0);
      gl.uniform1f(this.u(P, 'uDuotone'), sc.duotone);
      gl.uniform3fv(this.u(P, 'uDuoDark'), sc.duoDark);
      gl.uniform3fv(this.u(P, 'uDuoLight'), sc.duoLight);

      const pa = recipe.paper;
      this.bind(P, 'uPaper', this.paperReady ? this.paperTex : this.blankTex, 6);
      gl.uniform1f(this.u(P, 'uPaperAmt'), this.paperReady ? pa.amount : 0);
      gl.uniform1f(this.u(P, 'uPaperScale'), pa.scale);
      gl.uniform1f(this.u(P, 'uPaperRelief'), pa.relief);
      gl.uniform1f(this.u(P, 'uPaperBleed'), pa.bleed);
      gl.uniform1f(this.u(P, 'uPaperDeckle'), pa.deckle);
      gl.uniform3fv(this.u(P, 'uPaperTint'), pa.tint);
      if (pa.amount > 0) this.ensurePaper(pa.stock);

      const ra = recipe.raster;
      gl.uniform1f(this.u(P, 'uDither'), ra.dither);
      gl.uniform1f(this.u(P, 'uLevels'), ra.levels);
      gl.uniform1f(this.u(P, 'uComb'), ra.comb);
      gl.uniform1f(this.u(P, 'uScanline'), ra.scanline);
      gl.uniform1f(this.u(P, 'uScanThick'), ra.scanThick);
      gl.uniform1f(this.u(P, 'uScanRoll'), ra.scanRoll);

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

      if (timeOn) {
        // the process result goes into a buffer so the time pass can
        // read it alongside the frame before it
        this.drawTo(frameTarget, this.progs.composite);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
      }
      passes++;
    }

    /* ---------- TIME ----------
       Everything above computes one frame from nothing. This is the
       part that remembers. */
    if (timeOn) {
      const tm = recipe.time;
      const frame = frameTarget!;

      /* --- reaction-diffusion, at a quarter of the frame so it can
         run several steps per displayed frame without costing much --- */
      let rdTex = this.blankTex;
      if (tm.rd > 0) {
        const rw = Math.max(8, cw >> 2);
        const rh = Math.max(8, ch >> 2);
        const a = this.target('rdA', rw, rh, true);
        const b = this.target('rdB', rw, rh, true);
        // restarting the loop, resizing, or changing the seeding rule
        // means the chemistry starts again from the picture
        const key = `${rw}x${rh}:${tm.rdSeed.toFixed(2)}`;
        if (key !== this.rdKey) {
          this.rdKey = key;
          this.rdFrames = 0;
        }
        const P = 'rd';
        const steps = Math.max(1, Math.min(64, Math.round(tm.rdSteps)));
        for (let i = 0; i < steps; i++) {
          const src = this.rdIdx === 0 ? a : b;
          const dst = this.rdIdx === 0 ? b : a;
          gl.useProgram(this.progs.rd);
          this.bind(P, 'uState', src.tex, 0);
          this.bind(P, 'uSrc', frame.tex, 1);
          gl.uniform2f(this.u(P, 'uRes'), rw, rh);
          gl.uniform1f(this.u(P, 'uFeed'), tm.rdFeed);
          gl.uniform1f(this.u(P, 'uKill'), tm.rdKill);
          gl.uniform1f(this.u(P, 'uRate'), tm.rdRate);
          gl.uniform1f(this.u(P, 'uSeedFrom'), tm.rdSeed);
          gl.uniform1f(this.u(P, 'uReset'), this.rdFrames === 0 ? 1 : 0);
          this.drawTo(dst, this.progs.rd);
          this.rdIdx = 1 - this.rdIdx;
          this.rdFrames++;
          passes++;
        }
        rdTex = (this.rdIdx === 0 ? a : b).tex;
      } else {
        this.rdFrames = 0;
      }

      /* --- the feedback pass itself --- */
      const h0 = this.target('histA', cw, ch, true);
      const h1 = this.target('histB', cw, ch, true);
      const past = this.histIdx === 0 ? h0 : h1;
      const cur = this.histIdx === 0 ? h1 : h0;

      {
        const P = 'time';
        gl.useProgram(this.progs.time);
        this.bind(P, 'uNow', frame.tex, 0);
        // the very first frame has no past; read itself so the loop
        // starts from the picture rather than from black
        this.bind(P, 'uPast', this.timeFrames === 0 ? frame.tex : past.tex, 1);
        this.bind(P, 'uRD', rdTex, 2);
        gl.uniform2f(this.u(P, 'uRes'), cw, ch);
        gl.uniform1f(this.u(P, 'uTime'), performance.now() * 0.001);
        gl.uniform1f(this.u(P, 'uFrame'), this.timeFrames);

        gl.uniform1f(this.u(P, 'uEcho'), tm.echo);
        gl.uniform1f(this.u(P, 'uDecay'), tm.decay);
        gl.uniform1f(this.u(P, 'uFeedZoom'), tm.feedZoom);
        gl.uniform1f(this.u(P, 'uFeedRot'), tm.feedRot);
        gl.uniform2f(this.u(P, 'uFeedShift'), tm.feedShiftX, tm.feedShiftY);
        gl.uniform1f(this.u(P, 'uFeedHue'), tm.feedHue);
        gl.uniform1f(this.u(P, 'uFeedGain'), tm.feedGain);
        gl.uniform1i(this.u(P, 'uEchoMode'), ECHO_INDEX[tm.mode] ?? 0);

        gl.uniform1f(this.u(P, 'uSlit'), tm.slit);
        gl.uniform1f(this.u(P, 'uSlitAngle'), tm.slitAngle);
        gl.uniform1f(this.u(P, 'uSlitSpeed'), tm.slitSpeed);
        gl.uniform1f(this.u(P, 'uSlitWidth'), Math.max(0.005, tm.slitWidth));

        gl.uniform1f(this.u(P, 'uDisplace'), tm.displace);
        gl.uniform1f(this.u(P, 'uDisplaceBias'), tm.displaceBias);

        gl.uniform1f(this.u(P, 'uRDMix'), tm.rd);
        gl.uniform1i(this.u(P, 'uRDStyle'), RD_INDEX[tm.rdStyle] ?? 0);

        this.drawTo(cur, this.progs.time);
        passes++;
      }

      /* --- and out to the screen --- */
      {
        const P = 'present';
        gl.useProgram(this.progs.present);
        this.bind(P, 'uTex', cur.tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        passes++;
      }

      this.histIdx = 1 - this.histIdx;
      this.timeFrames++;
    } else if (this.timeFrames !== 0) {
      // the loop was switched off; forget what it had built up
      this.timeFrames = 0;
      this.rdFrames = 0;
    }

    if (timing && this.pendingQuery) {
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
    if (this.paperTex) gl.deleteTexture(this.paperTex);
    if (this.blankTex) gl.deleteTexture(this.blankTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}

const ECHO_INDEX: Record<string, number> = {
  trail: 0,
  lighten: 1,
  darken: 2,
  difference: 3,
};

const RD_INDEX: Record<string, number> = { etch: 0, dye: 1, relief: 2 };

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
