/* ============================================================
   SHADER SOURCE
   The engine is a multi-pass film pipeline, not a filter stack:

     INPUT → EXPOSURE → MATERIAL RESPONSE → DEVELOPMENT → COLOUR
           → [highlight extraction → halation / diffusion blurs]
           → OPTICS → GRAIN → EXPERIMENTAL DAMAGE → DEPTH → OUTPUT
   ============================================================ */

export const VERT = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* ---- shared helpers ---------------------------------------- */
const COMMON = `
const float EPS = 1e-5;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * vec3(127.11, 311.7, 74.7));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p, int oct, float gain) {
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a;
    p = rot * p * 2.03;
    a *= gain;
  }
  return s / max(n, EPS);
}
`;

/* ============================================================
   PASS 1 — BASE: exposure, material response, development, colour
   ============================================================ */
export const FRAG_BASE = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uSrc;

uniform float uEV;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uLatitude;

uniform float uToe;
uniform float uShoulder;
uniform float uGamma;
uniform float uMatContrast;
uniform float uSaturation;
uniform vec3  uChannelGamma;
uniform vec3  uShadowTint;
uniform vec3  uHighTint;
uniform float uCrossover;
uniform float uMono;          // 1.0 = monochrome material
uniform vec3  uMonoMix;

uniform float uPushPull;      // stops
uniform float uDevContrast;
uniform float uDevSat;
uniform float uDevFog;        // base fog lifts the black point
uniform float uDevCross;      // cross-process channel divergence
uniform float uBleach;        // silver retention

uniform float uExpired;       // age fog + dye loss
uniform float uRedscale;

${COMMON}

/* characteristic curve: toe compression, shoulder rolloff, slope */
vec3 filmCurve(vec3 c, float toe, float shoulder, float gamma) {
  c = max(c, 0.0);
  // slope around an 18% mid grey
  c = 0.18 * pow(max(c / 0.18, EPS), vec3(gamma));
  // shoulder — soft clip, never a hard ceiling
  float s = mix(5.5, 1.15, clamp(shoulder, 0.0, 1.0));
  c = c / pow(1.0 + pow(max(c, EPS), vec3(s)), vec3(1.0 / s));
  // toe — separation lost at the bottom of the scale
  vec3 t = smoothstep(vec3(0.0), vec3(0.26), c);
  c *= mix(vec3(1.0), t, clamp(toe, 0.0, 1.0) * 0.85);
  return c;
}

void main() {
  vec3 c = srgbToLinear(texture(uSrc, vUV).rgb);

  /* ---- EXPOSURE ---- */
  c *= exp2(uEV + uPushPull * 0.22);

  /* ---- MATERIAL RESPONSE ---- */
  float lat = clamp(uLatitude, 0.0, 1.0);
  float toe = uToe * mix(1.15, 0.7, lat);
  float shoulder = clamp(uShoulder * mix(0.75, 1.25, lat), 0.0, 1.0);
  float gamma = uGamma + uMatContrast * 0.35 + uDevContrast + uPushPull * 0.12;
  c = filmCurve(c, toe, shoulder, gamma);

  /* ---- OPERATOR TONE ---- */
  c = 0.18 * pow(max(c / 0.18, EPS), vec3(1.0 + uContrast * 0.7));
  float l = luma(c);
  float hiMask = smoothstep(0.42, 1.0, l);
  float loMask = 1.0 - smoothstep(0.0, 0.46, l);
  c *= 1.0 + uHighlights * 0.75 * hiMask;
  c += uShadows * 0.09 * loMask;

  /* ---- CHANNEL BEHAVIOUR ---- */
  vec3 cg = uChannelGamma + vec3(uDevCross * 0.34, 0.0, -uDevCross * 0.3);
  c = pow(max(c, EPS), cg);

  /* redscale: exposure through the base, blue record starved */
  if (uRedscale > 0.0) {
    vec3 rs = vec3(
      c.r * 1.14 + c.g * 0.26 + c.b * 0.06,
      c.g * 0.58 + c.r * 0.18,
      c.b * 0.14 + c.g * 0.06);
    c = mix(c, rs, uRedscale);
  }

  /* ---- SATURATION / BLEACH / MONO ---- */
  float sat = uSaturation * uDevSat * (1.0 - uBleach * 0.72) * (1.0 - uExpired * 0.34);
  vec3 grey = vec3(dot(c, vec3(0.2126, 0.7152, 0.0722)));
  c = mix(grey, c, sat);

  if (uMono > 0.0) {
    float m = dot(max(c, 0.0), uMonoMix / max(dot(uMonoMix, vec3(1.0)), EPS));
    c = mix(c, vec3(m), uMono);
  }

  /* ---- COLOUR CROSSOVER: the dye layers diverge at the ends of the
     scale. Applied as a density difference, so a black stays black. ---- */
  l = luma(c);
  float hi = smoothstep(0.3, 0.95, l);
  float lo = 1.0 - smoothstep(0.015, 0.4, l);
  vec3 castLo = 1.0 + uShadowTint * lo * (1.0 + uCrossover) * 3.2;
  vec3 castHi = 1.0 + uHighTint * hi * (1.0 + uCrossover * 0.6) * 2.6;
  c *= castLo * castHi;

  /* bleach bypass retains silver: density and contrast climb */
  if (uBleach > 0.0) {
    vec3 b = 0.18 * pow(max(c / 0.18, EPS), vec3(1.0 + uBleach * 0.55));
    c = mix(c, b, 1.0);
  }

  /* ---- BASE FOG: development and age both lift the black ---- */
  float fog = uDevFog + uExpired * 0.085;
  c = c * (1.0 - fog * 0.45) + fog * vec3(0.052, 0.045, 0.058);

  outColor = vec4(max(c, 0.0), 1.0);
}`;

/* ============================================================
   PASS 2 — HIGHLIGHT EXTRACTION
   ============================================================ */
export const FRAG_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
${COMMON}
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float l = luma(c);
  float w = smoothstep(uThreshold, uThreshold + uKnee, l);
  outColor = vec4(c * w, w);
}`;

/* ============================================================
   PASS 3 — SEPARABLE GAUSSIAN
   ============================================================ */
export const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;      // texel-space direction * radius
void main() {
  // 9-tap gaussian using linear-sampling offsets
  const float o[5] = float[](0.0, 1.4117647, 3.2941176, 5.1764706, 7.0588235);
  const float w[5] = float[](0.1964825, 0.2969069, 0.0944703, 0.0103813, 0.0002624);
  vec4 sum = texture(uTex, vUV) * w[0];
  for (int i = 1; i < 5; i++) {
    sum += texture(uTex, vUV + uDir * o[i]) * w[i];
    sum += texture(uTex, vUV - uDir * o[i]) * w[i];
  }
  outColor = sum;
}`;

/* ============================================================
   PASS 4 — DEPTH PROXY
   No monocular depth model is connected yet. This is an explicit
   proxy derived from the image itself and is labelled as such
   everywhere it is shown. It is never presented as inference.
   ============================================================ */
export const FRAG_DEPTH = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
${COMMON}
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float l = luma(c);

  // local detail: high-frequency energy falls off with distance
  float acc = 0.0;
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      vec3 s = texture(uTex, vUV + vec2(float(i), float(j)) * uTexel * 2.0).rgb;
      acc += abs(luma(s) - l);
    }
  }
  float detail = clamp(acc * 1.6, 0.0, 1.0);

  // aerial perspective: distant matter is lighter and less saturated
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, EPS);
  float haze = clamp(l * 0.8 + (1.0 - sat) * 0.35, 0.0, 1.0);

  // frame geometry: the ground plane usually runs to the bottom edge
  float geo = smoothstep(0.0, 1.0, vUV.y * 0.55 + 0.22);

  float near = clamp(detail * 0.55 + (1.0 - haze) * 0.3 + geo * 0.3, 0.0, 1.0);
  outColor = vec4(vec3(near), 1.0);
}`;

/* ============================================================
   PASS 5 — COMPOSITE
   Optics, grain, halation, diffusion, damage, depth, comparison.
   ============================================================ */
export const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uBase;    // material-processed image
uniform sampler2D uRaw;     // untouched control
uniform sampler2D uHalo;    // blurred threshold highlights
uniform sampler2D uDiff;    // wide blur for diffusion / acutance
uniform sampler2D uDepth;   // proxy depth

uniform vec2  uRes;         // canvas pixels
uniform vec2  uImgRes;      // specimen pixels
uniform vec4  uMapA;        // xy scale, zw offset  (screen uv -> image uv)
uniform vec4  uMapB;
uniform int   uMode;        // 0 single, 1 split slider, 2 side by side
uniform float uSplit;
uniform int   uView;        // 0 colour, 1 depth, 2 normals, 3 depth effect
uniform float uZoom;
uniform float uTime;

uniform float uHalIntensity, uHalRadius, uHalThreshold, uHalEdge;
uniform vec3  uHalTint;
uniform float uDifSoft, uDifBloom;
uniform float uAcutance;

uniform float uDistort, uChroma, uVignette, uEdgeSoft;

uniform float uGrainAmount, uGrainSize, uGrainDensity, uGrainClump;
uniform float uGrainLum, uGrainChroma, uGrainRand, uGrainSeed;

uniform float uSoup, uSoupTemp, uSoupContam, uSoupFog, uSoupBleed;
uniform float uSoupDensity, uSoupRand, uSoupSeed;
uniform vec3  uSoupTint;

uniform float uSolar, uLeak, uScratch, uDust, uDamageSeed, uExpiredAge;

/* REAL MATERIAL: artefacts traced from 35mm scans, scattered into
   frame-sized plates. Sampled here rather than invented, because the
   shape of actual dirt and hair is not something noise reproduces.
   Atlas layout: 2x2 — dust, scratches, hair, stain. */
uniform sampler2D uDamage;
uniform vec4  uDamageXf;    // scale, rotation, offset.xy
uniform float uDamageMix;   // 0 = procedural fallback, 1 = scanned plates

uniform int   uBurnCount;
uniform vec4  uBurnA[8];    // x, y, amount, spread
uniform vec4  uBurnB[8];    // density, hue, edge, randomness
uniform float uBurnSeed[8];

uniform float uSeqOn, uSeqRows, uSeqCols, uSeqDrift, uSeqGutter;
uniform float uDither, uLevels, uComb, uScanline;
uniform float uScanRoll, uScanThick;
uniform float uHalftone, uHalfSize, uHalfAngle, uHalfColour;
uniform float uDuotone;
uniform vec3  uDuoDark, uDuoLight;

/* directional blur: 0 motion, 1 zoom, 2 spin */
uniform float uBlurAmt, uBlurAngle, uBlurMode, uBlurTaper;
uniform vec2  uBlurCentre;

/* the print itself */
uniform sampler2D uPaper;
uniform float uPaperAmt, uPaperScale, uPaperRelief, uPaperBleed, uPaperDeckle;
uniform vec3  uPaperTint;

uniform float uDepthOn, uDepthInf;
uniform vec4  uDepthTargets; // grain, halation, diffusion, burn
uniform float uDepthHaze;

${COMMON}

vec2 mapUV(vec2 uv, vec4 m) { return uv * m.xy + m.zw; }

bool inside(vec2 p) { return p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0; }

vec2 distortUV(vec2 uv, float k) {
  vec2 p = uv - 0.5;
  float r2 = dot(p, p);
  return 0.5 + p * (1.0 + k * r2 * 1.9);
}

/* --- procedural grain -------------------------------------
   Multi-scale, spatially correlated, density dependent.
   Coordinates live in film space so the structure magnifies
   with the loupe instead of dissolving into screen noise. */
float grainField(vec2 fp, float scale, float seed, float clump, float rand) {
  vec2 p = fp / max(scale, 0.35);
  // zero-mean octaves, summed so the variance survives the sum instead of
  // averaging itself away
  float n1 = vnoise(p + seed) - 0.5;
  float n2 = vnoise(p * 2.17 + seed * 1.7 + 31.4) - 0.5;
  float n3 = vnoise(p * 4.61 + seed * 2.3 + 77.7) - 0.5;
  float n4 = vnoise(p * 0.53 + seed * 3.1 + 11.1) - 0.5;

  float fine = (n1 * 0.72 + n2 * 0.52 + n3 * 0.34) * 1.62;
  // clumping moves energy into the coarse structures: fewer, larger,
  // more clustered crystals rather than an even dispersion
  float clumped = (n4 * 0.86 + n1 * 0.52 + n2 * 0.24) * 1.72;
  float v = mix(fine, clumped, clamp(clump, 0.0, 1.0));

  // randomness dissolves the spatial correlation toward pure stochastic noise
  float w = (hash21(floor(p * 2.6) + seed) - 0.5) * 1.9;
  return mix(v, w, clamp(rand, 0.0, 1.0) * 0.4);
}

/* one ink's dot: a screen at its own angle, area following density */
float halfDot(vec2 sp, float ang, float density, float fw) {
  mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 cell = fract(R * sp) - 0.5;
  float r = sqrt(clamp(density, 0.0, 1.0)) * 0.62;
  return 1.0 - smoothstep(r - fw, r + fw, length(cell));
}

/* 4x4 ordered dither matrix */
float bayer4(vec2 p) {
  float x = p.x, y = p.y;
  float m = 0.0;
  m += mod(y, 2.0) * 8.0 + mod(x, 2.0) * 4.0;
  m += mod(floor(y / 2.0), 2.0) * 2.0 + mod(floor(x / 2.0), 2.0);
  return m / 16.0;
}

/* sample one quadrant of the damage atlas, wrapped and transformed
   so a plate never lands the same way twice */
float damagePlate(vec2 uv, vec2 quad, float scale, float rot, vec2 off) {
  vec2 p = uv - 0.5;
  float c = cos(rot), sn = sin(rot);
  p = mat2(c, -sn, sn, c) * p * scale + 0.5 + off;
  vec2 q = fract(p) * 0.499 + 0.0005;
  return texture(uDamage, quad + q).r;
}

void main() {
  vec2 suv = vUV;
  bool paneB = false;
  vec4 map = uMapA;

  if (uMode == 2) {
    paneB = suv.x > 0.5;
    map = paneB ? uMapB : uMapA;
  } else if (uMode == 1) {
    paneB = suv.x > uSplit;
    map = uMapA;
  }

  vec2 iuv = mapUV(suv, map);

  /* ---- SEQUENCE ----
     The frame repeated as a strip or a grid, the way a contact sheet
     carries one roll. Each cell gets its own drift, so the sheet reads
     as a set of exposures rather than a duplicated image. */
  float cellIndex = 0.0;
  float cellDrift = 0.0;
  if (uSeqOn > 0.5 && inside(iuv)) {
    vec2 grid = vec2(max(uSeqCols, 1.0), max(uSeqRows, 1.0));
    vec2 g2 = iuv * grid;
    vec2 cell = floor(g2);
    vec2 f = fract(g2);
    cellIndex = cell.y * grid.x + cell.x;
    // the gutter between frames on the sheet
    float gut = uSeqGutter * 0.09;
    if (f.x < gut || f.x > 1.0 - gut || f.y < gut || f.y > 1.0 - gut) {
      outColor = vec4(0.02, 0.019, 0.017, 1.0);
      return;
    }
    f = (f - gut) / max(1.0 - gut * 2.0, EPS);
    cellDrift = (hash21(cell + 7.3) - 0.5) * 2.0 * uSeqDrift;
    iuv = f;
  }

  if (!inside(iuv)) {
    // outside the specimen: leave the light table showing through,
    // with the shadow the print casts on it
    vec2 d = max(abs(iuv - 0.5) - 0.5, 0.0) * vec2(uImgRes) / max(uImgRes.y, 1.0);
    float dist = length(d) * 26.0 / max(uZoom, 0.25);
    float sh = exp(-dist * 1.6) * 0.55;
    outColor = vec4(0.0, 0.0, 0.0, sh);
    return;
  }

  bool showControl = (uMode == 1 && !paneB) || (uMode == 2 && !paneB);

  vec3 raw = texture(uRaw, iuv).rgb;
  if (showControl) {
    outColor = vec4(raw, 1.0);
    return;
  }

  /* ================= OPTICS ================= */
  vec2 ouv = distortUV(iuv, uDistort * 0.5);
  vec2 pc = ouv - 0.5;
  float r2 = dot(pc, pc);

  // lateral chromatic aberration grows toward the frame edge
  float ca = uChroma * 0.006 * r2 * 4.0;
  vec3 col;
  col.r = texture(uBase, ouv + pc * ca).r;
  col.g = texture(uBase, ouv).g;
  col.b = texture(uBase, ouv - pc * ca).b;

  /* ================= DIRECTIONAL BLUR =================
     A real sample loop along a direction, not a symmetric kernel.
     Motion runs along one angle; zoom and spin take their direction
     from the pixel's relation to a centre, so the streak lengthens
     with distance the way a real camera move does. */
  if (uBlurAmt > 0.001) {
    vec2 rel = ouv - uBlurCentre;
    vec2 dir;
    float len;
    if (uBlurMode < 0.5) {
      dir = vec2(cos(uBlurAngle), sin(uBlurAngle));
      len = uBlurAmt * 0.14;
    } else if (uBlurMode < 1.5) {
      dir = normalize(rel + vec2(1e-5));
      len = uBlurAmt * 0.24 * length(rel);
    } else {
      dir = normalize(vec2(-rel.y, rel.x) + vec2(1e-5));
      len = uBlurAmt * 0.30 * length(rel);
    }
    // the frame edge streaks harder than the middle when tapered
    len *= mix(1.0, smoothstep(0.0, 0.5, length(rel)) * 1.6, uBlurTaper);

    // a per-pixel offset breaks the tap count into grain instead of ghosts
    float jitter = hash21(ouv * uImgRes) - 0.5;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    const int TAPS = 17;
    for (int i = 0; i < TAPS; i++) {
      float t = (float(i) + jitter) / float(TAPS - 1) - 0.5;
      // weight the middle so the subject survives the smear
      float w = 1.0 - abs(t) * 0.75;
      acc += texture(uBase, ouv + dir * t * len).rgb * w;
      wsum += w;
    }
    col = acc / max(wsum, EPS);
  }

  vec3 wide = texture(uDiff, ouv).rgb;
  float depth = texture(uDepth, ouv).r;

  // edge softness: the corners of an old lens never quite resolve
  float edgeBlur = clamp(uEdgeSoft * smoothstep(0.06, 0.5, r2), 0.0, 1.0);
  col = mix(col, wide, edgeBlur * 0.75);

  // developer acutance — the adjacency effect at density boundaries
  if (uAcutance > 0.0) col += (col - wide) * uAcutance;

  /* ================= DEPTH MODULATION ================= */
  float dNear = clamp(depth, 0.0, 1.0);
  float dFar = 1.0 - dNear;
  float dInf = uDepthOn * uDepthInf;
  float mGrain = mix(1.0, mix(0.45, 1.55, dFar), dInf * uDepthTargets.x);
  float mHal   = mix(1.0, mix(0.4, 1.6, dNear), dInf * uDepthTargets.y);
  float mDiff  = mix(1.0, mix(0.5, 1.8, dFar), dInf * uDepthTargets.z);
  float mBurn  = mix(1.0, mix(0.55, 1.5, dNear), dInf * uDepthTargets.w);

  /* ================= HALATION ================= */
  vec4 halo = texture(uHalo, ouv);
  vec3 halTint = uHalTint;
  float halL = luma(halo.rgb);
  // light scattered back through the emulsion, strongest where a
  // bright edge meets a dark neighbour
  float local = clamp(halL - luma(col), 0.0, 4.0);
  float edgeResp = mix(halL, local * 1.8, clamp(uHalEdge, 0.0, 1.0));
  col += halTint * edgeResp * uHalIntensity * 1.35 * mHal;

  /* ================= DIFFUSION ================= */
  col = mix(col, max(col, wide), uDifSoft * 0.85 * mDiff);
  col += wide * uDifBloom * 0.5 * mDiff;

  /* ================= ATMOSPHERIC DEPTH ================= */
  if (uDepthHaze > 0.0) {
    float h = uDepthHaze * dFar * dFar;
    col = mix(col, vec3(0.42, 0.45, 0.5) * (0.35 + luma(col) * 0.8), h * 0.5);
  }

  /* ================= FILM SOUP ================= */
  vec2 fuv = iuv * vec2(uImgRes.x / max(uImgRes.y, 1.0), 1.0);
  if (uSoup > 0.0) {
    float sd = uSoupSeed;
    // chemistry creeps in from the edges of the strip
    float edge = min(min(iuv.x, 1.0 - iuv.x), min(iuv.y, 1.0 - iuv.y));
    float edgeIn = 1.0 - smoothstep(0.0, mix(0.28, 0.06, uSoupDensity), edge);
    float warp = fbm(fuv * 2.2 + sd, 4, 0.55);
    vec2 wuv = fuv * mix(1.6, 5.5, uSoupRand) + vec2(warp * 2.4, -warp * 1.8) + sd * 1.3;
    float stain = fbm(wuv, 5, mix(0.42, 0.66, uSoupTemp));
    // the chemistry reaches part of the frame, not all of it: a high
    // threshold keeps the attack patchy the way a real bath leaves it
    float front = smoothstep(0.54 - uSoupContam * 0.12, 0.76, stain + edgeIn * 0.34);
    float amt = uSoup * front;

    // dye migration: channels move at different rates
    float bleedBase = fbm(wuv + 3.1, 3, 0.5) - 0.5;
    vec3 bleedOff = vec3(
      mix(bleedBase, fbm(wuv + 11.7, 3, 0.5) - 0.5, 0.55),
      bleedBase,
      mix(bleedBase, fbm(wuv + 23.3, 3, 0.5) - 0.5, 0.55));
    col += bleedOff * uSoupBleed * amt * 0.34 * (0.35 + luma(col));

    // contamination stain
    col = mix(col, col * uSoupTint * 1.18 + uSoupTint * 0.05, amt * uSoupContam * 0.62);

    // milky fog where the emulsion lifted
    float fogMask = smoothstep(0.66, 0.92, stain) * amt;
    col = col * (1.0 - fogMask * 0.22) + uSoupTint * fogMask * uSoupFog * 0.3;

    // hard chemical burn edges at the front
    float rim = smoothstep(0.6, 0.655, stain) - smoothstep(0.655, 0.72, stain);
    col += uSoupTint * rim * amt * uSoupDensity * 0.55;

    // real staining, from scanned material, sitting under the procedural front
    if (uDamageMix > 0.5) {
      float aspect2 = uImgRes.x / max(uImgRes.y, 1.0);
      vec2 sv = vec2(iuv.x * aspect2, iuv.y) / max(aspect2, 1.0);
      float plate = damagePlate(sv, vec2(0.5, 0.5), uDamageXf.x * 0.55,
                                uDamageXf.y * 1.7, uDamageXf.zw + 0.47);
      float ps = plate * uSoup * uSoupContam;
      col = mix(col, col * uSoupTint * 1.12 + uSoupTint * 0.03, ps * 0.45);
      col *= 1.0 - ps * 0.12;
    }
  }

  /* ================= FILM BURNS =================
     The emulsion lifts, chars at the rim and clears in the middle.
     A radial falloff would read as a lens flare, so the perimeter is
     domain-warped and the interior carries its own structure. */
  for (int i = 0; i < 8; i++) {
    if (i >= uBurnCount) break;
    vec4 a = uBurnA[i];
    vec4 b = uBurnB[i];
    float sd = uBurnSeed[i];
    float aspB = uImgRes.x / max(uImgRes.y, 1.0);
    vec2 q = (iuv - a.xy) * vec2(aspB, 1.0) / max(a.w, 0.02);

    // warp the field before measuring distance: the edge stops being a circle
    float wob = fbm(q * 1.7 + sd, 4, 0.6) - 0.5;
    float wob2 = fbm(q * 3.3 - sd * 1.4, 3, 0.55) - 0.5;
    vec2 qw = q + vec2(wob, wob2) * mix(0.35, 1.45, b.w);
    float d = length(qw);

    // interior structure — the emulsion does not go evenly
    float grainB = fbm(q * mix(5.0, 20.0, b.w) + sd * 2.0, 5, 0.6);
    float soft = mix(0.14, 0.62, b.z);
    float mask = 1.0 - smoothstep(0.62 - soft * 0.4, 1.05 + soft, d + (grainB - 0.5) * 0.5 * b.w);

    float coreM = smoothstep(0.68, 0.94, mask) * mix(0.55, 1.0, grainB);
    float ringM = max(smoothstep(0.34, 0.7, mask) - coreM, 0.0);
    float charM = max(smoothstep(0.14, 0.4, mask) - ringM - coreM, 0.0);
    float glowM = max(smoothstep(0.0, 0.22, mask) - charM - ringM - coreM, 0.0);

    float amt = clamp(a.z * mBurn, 0.0, 1.5);
    vec3 ember = mix(vec3(0.9, 0.16, 0.03), vec3(1.0, 0.66, 0.22), clamp(b.y, 0.0, 1.0));
    vec3 clear = vec3(1.0, 0.97, 0.92);
    vec3 char_ = vec3(0.16, 0.09, 0.06);

    // the middle burns through and prints clear
    col = mix(col, clear, clamp(coreM * amt * b.x, 0.0, 1.0));
    // the rim is still glowing when it stops
    col += ember * ringM * amt * b.x * 1.5;
    // scorch: density gained, then lost
    col = mix(col, char_ * (0.4 + luma(col)), clamp(charM * amt * 0.75, 0.0, 0.85));
    // heat spilling past the edge onto surrounding emulsion
    col += ember * glowM * amt * 0.35;
  }

  /* ================= AGE / SOLARISATION / LEAK ================= */
  if (uSolar > 0.0) {
    float l2 = luma(col);
    vec3 inv = abs(col - vec3(smoothstep(0.55, 1.0, l2)) * 1.15);
    col = mix(col, inv, uSolar * smoothstep(0.4, 0.95, l2));
  }

  if (uLeak > 0.0) {
    float sd = uDamageSeed * 0.37;
    // light entering past the felt: strongest at one edge, falling inward
    float side = hash21(vec2(sd, 3.7));
    vec2 lp = side < 0.5 ? vec2(iuv.x, iuv.y) : vec2(1.0 - iuv.x, iuv.y);
    float band = fbm(vec2(lp.y * 3.2 + sd, sd * 2.0), 4, 0.5);
    float streak = fbm(vec2(lp.y * 14.0 + sd * 3.0, lp.x * 1.6), 3, 0.45);
    float reach = mix(11.0, 3.0, uLeak) * (0.7 + band * 0.9);
    float leak = exp(-lp.x * reach) * (0.35 + streak * 1.1);
    vec3 leakCol = mix(vec3(1.0, 0.36, 0.11), vec3(1.0, 0.84, 0.56), band * 0.7 + streak * 0.3);
    col += leakCol * leak * uLeak * 1.05;
  }

  if (uExpiredAge > 0.0) {
    // uneven age fog: mottling at very low frequency
    float mott = fbm(fuv * 1.4 + uDamageSeed, 4, 0.6);
    col += vec3(0.05, 0.035, 0.055) * uExpiredAge * (0.4 + mott);
    col = mix(col, col * vec3(1.04, 0.98, 0.94), uExpiredAge * 0.6);
  }

  /* ================= GRAIN ================= */
  if (uGrainAmount > 0.0) {
    // film space: micrometres on the negative, not pixels on the screen
    vec2 fp = iuv * uImgRes * 0.5;
    float scale = mix(0.55, 7.0, uGrainSize);
    float seed = uGrainSeed;

    float gl = luma(col);
    // granularity peaks in the mid densities and falls away at both ends
    float dens = pow(clamp(4.0 * gl * (1.0 - gl), 0.0, 1.0), 0.55);
    float lumResp = mix(1.0, dens, clamp(uGrainLum, 0.0, 1.0));

    float gA = grainField(fp, scale, seed, uGrainClump, uGrainRand);
    // fewer, larger crystals fluctuate more: amplitude follows size as well
    // as density, which is what keeps ISO 100 and ISO 3200 apart
    float amp = uGrainAmount
              * (0.3 + uGrainDensity * 0.8)
              * (0.3 + uGrainSize * 1.5)
              * 0.30 * lumResp * mGrain;

    vec3 g;
    if (uGrainChroma > 0.001) {
      float gR = grainField(fp, scale * 1.06, seed + 17.0, uGrainClump, uGrainRand);
      float gB = grainField(fp, scale * 0.94, seed + 41.0, uGrainClump, uGrainRand);
      // the dye clouds are not independent: colour grain is a small
      // divergence around a shared luminance fluctuation, not three
      // separate noises, which is what stops it reading as confetti
      float ch = uGrainChroma * 0.42;
      g = vec3(mix(gA, gR, ch), gA, mix(gA, gB, ch));
    } else {
      g = vec3(gA);
    }
    // grain is a modulation of density, not an overlay on top of it.
    // The additive term follows density too, so the deepest shadows —
    // where almost nothing developed — stay clean.
    col *= 1.0 + g * amp * 2.0;
    col += g * amp * 0.14 * dens;
  }

  /* ================= PHYSICAL DAMAGE =================
     Real scanned artefacts first. The procedural path below only
     runs if the plates have not loaded yet. */
  float aspect = uImgRes.x / max(uImgRes.y, 1.0);
  vec2 duv = vec2(iuv.x * aspect, iuv.y) / max(aspect, 1.0);

  if (uDust > 0.0) {
    float sc = uDamageXf.x;
    float rot = uDamageXf.y;
    vec2 off = uDamageXf.zw;

    float dust = damagePlate(duv, vec2(0.0, 0.0), sc, rot, off);
    float hair = damagePlate(duv, vec2(0.0, 0.5), sc * 0.82, rot + 2.1, off.yx + 0.31);

    if (uDamageMix < 0.5) {
      // plates unavailable — a plain sparse fallback, deliberately dull
      vec2 dp = iuv * uImgRes / 22.0;
      vec2 cell = floor(dp);
      float h = hash21(cell + uDamageSeed * 2.3);
      dust = h > 1.0 - uDust * 0.16
        ? 1.0 - smoothstep(0.25, 1.0, length(fract(dp) - 0.5) * 6.0)
        : 0.0;
      hair = 0.0;
    }

    // dirt sits on the emulsion and blocks light; it does not tint
    float occl = clamp(dust * 1.15 + hair * 1.35, 0.0, 1.0) * uDust;
    col *= 1.0 - occl * 0.88;
    // a fraction of it is on the far side of the gate and prints white
    float shine = smoothstep(0.72, 1.0, dust) * uDust * 0.35;
    col += vec3(0.95, 0.93, 0.88) * shine;
  }

  if (uScratch > 0.0) {
    float sc = uDamageXf.x * 0.9;
    float rot = uDamageXf.y * 0.4;
    vec2 off = uDamageXf.zw * 1.7 + 0.13;
    float scr = damagePlate(duv, vec2(0.5, 0.0), sc, rot, off);

    if (uDamageMix < 0.5) {
      vec2 sp = vec2(iuv.x * aspect, iuv.y);
      float lane = floor(sp.x * 140.0 + uDamageSeed);
      float pick = hash21(vec2(lane, uDamageSeed * 1.7));
      scr = pick > 1.0 - uScratch * 0.08
        ? 1.0 - smoothstep(0.0, 0.34, abs(fract(sp.x * 140.0 + uDamageSeed) - 0.5))
        : 0.0;
    }

    // a scratch through the emulsion prints clear; one in the base prints dark
    float polarity = step(0.42, hash21(vec2(uDamageSeed, 5.5)));
    float amt = scr * uScratch;
    col += vec3(1.0, 0.98, 0.94) * amt * 0.85 * polarity;
    col *= 1.0 - amt * 0.7 * (1.0 - polarity);
  }

  /* ---- per-cell drift on a contact sheet ---- */
  if (uSeqOn > 0.5) {
    col *= exp2(cellDrift * 0.85);
    col *= 1.0 + vec3(cellDrift * 0.06, 0.0, -cellDrift * 0.05);
  }

  /* ================= VIGNETTE ================= */
  float vig = 1.0 - uVignette * smoothstep(0.06, 0.78, r2) * 1.25;
  col *= clamp(vig, 0.0, 1.4);

  /* ================= SCREEN =================
     The output stage: how the picture is finally laid down.
     A halftone screen, a duotone, a scan structure and an ordered
     dither — in that order, because that is the order a press and
     a monitor actually apply them. */

  // ---- halftone: a rotated dot screen, dot area following density
  if (uHalftone > 0.0) {
    float a = uHalfAngle;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 sp = rot * (suv * uRes) / max(uHalfSize, 1.5);
    vec2 cell = fract(sp) - 0.5;
    float d = length(cell);

    vec3 srgbc = linearToSrgb(col);
    vec3 screened;
    if (uHalfColour > 0.5) {
      // A press lays three screens at different angles and the inks
      // subtract. Screening R, G and B additively is what produces
      // confetti instead of rosettes.
      vec2 sp0 = suv * uRes / max(uHalfSize, 1.5);
      float fw = fwidth(sp0.x) * 0.9 + 1e-4;
      // Grey component replacement: the ink all three plates share is
      // pulled out and printed as black instead. Without it a grey
      // photograph screens as rainbow confetti rather than as a
      // photograph, because three colour plates are doing black's job.
      vec3 ink = 1.0 - srgbc;
      float k = min(ink.r, min(ink.g, ink.b));
      vec3 cmy = ink - k;

      float dc = halfDot(sp0, a + 0.2618, cmy.r, fw);   // 15 deg
      float dm = halfDot(sp0, a + 1.3090, cmy.g, fw);   // 75 deg
      float dy = halfDot(sp0, a,          cmy.b, fw);   //  0 deg
      float dk = halfDot(sp0, a + 0.7854, k,     fw);   // 45 deg

      // inks subtract, and black absorbs everything
      screened = clamp(vec3(1.0 - dc, 1.0 - dm, 1.0 - dy) * (1.0 - dk), 0.0, 1.0);
    } else {
      float l = luma(srgbc);
      float r = sqrt(max(1.0 - l, 0.0)) * 0.62;
      float fw = fwidth(d) * 1.2 + 1e-4;
      screened = vec3(1.0 - smoothstep(r - fw, r + fw, d));
      screened = 1.0 - screened;
    }
    col = srgbToLinear(mix(srgbc, screened, uHalftone));
  }

  // ---- duotone: the whole scale mapped between two inks
  if (uDuotone > 0.0) {
    float l = clamp(luma(linearToSrgb(col)), 0.0, 1.0);
    vec3 duo = mix(uDuoDark, uDuoLight, smoothstep(0.0, 1.0, l));
    col = mix(col, srgbToLinear(duo), uDuotone);
  }

  // ---- scan structure: thickness, a roll bar, and interlace
  if (uComb > 0.0) {
    float bars = 0.5 + 0.5 * cos(suv.x * uRes.x * 0.55);
    col *= 1.0 - uComb * 0.55 * bars;
    col += vec3(0.02, 0.03, 0.04) * uComb * (1.0 - bars);
  }
  if (uScanline > 0.0) {
    float pitch = mix(1.0, 3.4, uScanThick);
    float line = 0.5 + 0.5 * cos(suv.y * uRes.y * (1.57 / pitch));
    line = pow(line, mix(1.0, 3.0, uScanThick));
    col *= 1.0 - uScanline * 0.55 * line;

    // the roll bar a camera pointed at a screen picks up
    if (uScanRoll > 0.0) {
      float roll = fract(suv.y + uTime * 0.19);
      float band = smoothstep(0.0, 0.16, roll) * (1.0 - smoothstep(0.16, 0.34, roll));
      col *= 1.0 - band * uScanRoll * 0.5;
      col += vec3(0.03, 0.035, 0.045) * band * uScanRoll;
    }
  }

  if (uDither > 0.0) {
    // 4x4 ordered matrix, screen aligned
    vec2 ip = floor(mod(suv * uRes, 4.0));
    float bayer = bayer4(ip) - 0.5;
    float steps = max(2.0, floor(mix(24.0, 2.0, clamp(uLevels, 0.0, 1.0))));
    vec3 c2 = linearToSrgb(col);
    // as the levels fall the image converges on a bitmap: three channels
    // quantised separately at two levels is colour fringing, not print
    float mono = 1.0 - clamp((steps - 2.0) / 7.0, 0.0, 1.0);
    c2 = mix(c2, vec3(dot(c2, vec3(0.299, 0.587, 0.114))), mono);
    c2 += bayer / steps * uDither * 1.4;
    c2 = floor(c2 * steps + 0.5) / steps;
    col = srgbToLinear(mix(linearToSrgb(col), c2, uDither));
  }

  /* ================= PAPER =================
     The last thing that happens to a print is the paper. Ink sits
     down into the tooth, the sheet lifts against the light, and the
     base colour shows through wherever the ink is thin. The plate is
     real material — see docs/ANALOG_SYSTEM.md. */
  if (uPaperAmt > 0.0) {
    vec2 pscale = uRes / max(uPaperScale, 32.0);
    vec2 puv = suv * pscale;
    float tooth = texture(uPaper, puv).r;

    // relief: light across the fibre, taken from the plate's own slope
    vec2 pt = 1.0 / pscale * 0.6;
    float hx = texture(uPaper, puv + vec2(pt.x, 0.0)).r
             - texture(uPaper, puv - vec2(pt.x, 0.0)).r;
    float hy = texture(uPaper, puv + vec2(0.0, pt.y)).r
             - texture(uPaper, puv - vec2(0.0, pt.y)).r;

    // ink pools in the low fibre and thins on the high
    float ink = (tooth - 0.5);
    col *= 1.0 + ink * uPaperBleed * 1.4 * uPaperAmt;

    // the sheet catches the light from the top left
    col += vec3(hx * 0.6 - hy * 0.6) * uPaperRelief * uPaperAmt;

    // base colour through the thin ink, strongest in the highlights
    float hi = smoothstep(0.35, 1.0, luma(col));
    col = mix(col, col * srgbToLinear(uPaperTint), uPaperAmt * (0.25 + hi * 0.55));

    // a torn edge, because a sheet has one
    if (uPaperDeckle > 0.0) {
      float e = min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y));
      float rag = fbm(suv * vec2(18.0, 18.0), 3, 0.5) * 0.028 * uPaperDeckle;
      float edge = smoothstep(0.0, 0.012 + rag, e - rag * 0.4);
      col = mix(srgbToLinear(uPaperTint) * 0.92, col, edge);
    }
  }

  /* ================= VIEW MODES ================= */
  if (uView == 1) {
    col = vec3(dNear);
  } else if (uView == 2) {
    vec2 tx = 1.0 / max(uImgRes, vec2(1.0)) * 3.0;
    float dx = texture(uDepth, ouv + vec2(tx.x, 0.0)).r - texture(uDepth, ouv - vec2(tx.x, 0.0)).r;
    float dy = texture(uDepth, ouv + vec2(0.0, tx.y)).r - texture(uDepth, ouv - vec2(0.0, tx.y)).r;
    vec3 n = normalize(vec3(-dx * 12.0, -dy * 12.0, 1.0));
    col = n * 0.5 + 0.5;
    outColor = vec4(col, 1.0);
    return;
  } else if (uView == 3) {
    float infl = abs(mGrain - 1.0) + abs(mHal - 1.0) + abs(mDiff - 1.0) + abs(mBurn - 1.0);
    col = mix(vec3(dNear) * 0.35, vec3(0.85, 0.55, 0.2), clamp(infl * 0.6, 0.0, 1.0));
    outColor = vec4(col, 1.0);
    return;
  }

  outColor = vec4(linearToSrgb(col), 1.0);
}`;

/* pass-through for the control side and for readback */
export const FRAG_ENCODE = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
${COMMON}
void main() { outColor = vec4(linearToSrgb(texture(uTex, vUV).rgb), 1.0); }`;

/* ============================================================
   TIME
   Until now the engine had no memory: every frame was computed
   from nothing and thrown away. These three passes give it one.

   A feedback buffer holds the last frame the lab put on screen.
   The current frame is mixed back into it through a transform —
   a little zoom, a little rotation, a little drift — which is
   the whole of video feedback: the reason a camera pointed at
   its own monitor makes tunnels.

   On top of that buffer:
     · trails and echo, in four blend behaviours
     · slit-scan, where a band sweeps the frame and everything
       behind it is held at the moment the band passed
     · time displacement, where each pixel reads the past at a
       depth set by its own brightness
     · Gray-Scott reaction-diffusion, fed by the picture itself
   ============================================================ */

export const FRAG_TIME = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 frag;

uniform sampler2D uNow;      /* what the process just produced */
uniform sampler2D uPast;     /* what was on screen last frame */
uniform sampler2D uRD;       /* reaction-diffusion state */

uniform vec2  uRes;
uniform float uTime;
uniform float uFrame;

/* feedback */
uniform float uEcho;         /* how much of the past survives */
uniform float uDecay;        /* how fast it gives up */
uniform float uFeedZoom;     /* the transform the past is read through */
uniform float uFeedRot;
uniform vec2  uFeedShift;
uniform float uFeedHue;      /* rotate colour on every trip round the loop */
uniform float uFeedGain;     /* contrast added on every trip — without it
                                the loop low-passes itself into fog */
uniform int   uEchoMode;     /* 0 mix · 1 lighten · 2 darken · 3 difference */

/* slit-scan */
uniform float uSlit;
uniform float uSlitAngle;
uniform float uSlitSpeed;
uniform float uSlitWidth;

/* time displacement */
uniform float uDisplace;
uniform float uDisplaceBias;

/* reaction-diffusion */
uniform float uRDMix;
uniform int   uRDStyle;      /* 0 etch · 1 dye · 2 relief */

float luma3(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec2 uv = vUV;
  vec3 now = texture(uNow, uv).rgb;

  /* ---- read the past through the feedback transform ----
     A frame that is scaled and turned a fraction of a degree each
     time round the loop is what builds a tunnel out of nothing. */
  vec2 c = uv - 0.5;
  float s = sin(uFeedRot);
  float co = cos(uFeedRot);
  c = mat2(co, -s, s, co) * c;
  c *= (1.0 - uFeedZoom);
  vec2 puv = c + 0.5 + uFeedShift;

  /* ---- time displacement: each pixel reads a different past ----
     Brightness decides how far back you look, so highlights lag and
     shadows keep up, or the other way round. */
  if (uDisplace > 0.0) {
    float d = luma3(now) - uDisplaceBias;
    vec2 dir = normalize(vec2(cos(uSlitAngle), sin(uSlitAngle)) + 1e-6);
    puv += dir * d * uDisplace * 0.5;
  }

  vec2 pc = clamp(puv, 0.002, 0.998);
  vec3 past = texture(uPast, pc).rgb;

  /* Reading the past through a scale is a resample, and a resample is a
     blur. Left alone the loop low-passes itself into grey fog within a
     couple of seconds — which is exactly what a feedback rig does when
     the monitor is out of focus. Putting the edge back on every trip is
     what makes rings instead of fog. */
  if (uFeedGain > 0.0) {
    vec2 t1 = 1.0 / uRes;
    vec3 soft = (texture(uPast, clamp(pc + vec2(t1.x, 0.0), 0.002, 0.998)).rgb
               + texture(uPast, clamp(pc - vec2(t1.x, 0.0), 0.002, 0.998)).rgb
               + texture(uPast, clamp(pc + vec2(0.0, t1.y), 0.002, 0.998)).rgb
               + texture(uPast, clamp(pc - vec2(0.0, t1.y), 0.002, 0.998)).rgb) * 0.25;
    past += (past - soft) * uFeedGain * 7.0;
  }

  past = hueShift(past, uFeedHue);
  past *= (1.0 - uDecay);
  past = past + (past - vec3(0.45)) * uFeedGain * 0.5;
  /* soft ceiling: the loop is allowed to get bright, not to detonate */
  past = past / (1.0 + max(past - vec3(1.0), vec3(0.0)) * 0.85);
  past = clamp(past, 0.0, 1.15);

  /* ---- the four ways a trail can behave ----
     uEcho is the weight the past carries, directly. At 0.9 a tenth of
     each new frame enters the loop and the rest is what was already
     going round, which is what builds structure out of nothing. */
  float e = clamp(uEcho, 0.0, 0.995);
  vec3 col;
  if (uEchoMode == 1) {
    /* lighten: the new frame is dimmed on the way in so the past can
       actually win somewhere. Light writes and stays. */
    col = max(now * (1.0 - e * 0.62), past);
  } else if (uEchoMode == 2) {
    /* darken: shadows accumulate and the frame closes down */
    col = min(now + e * 0.42, past + (1.0 - e));
  } else if (uEchoMode == 3) {
    /* difference: a still frame goes black; only movement survives */
    col = mix(now, clamp(abs(now - past) * (1.0 + e * 2.2), 0.0, 4.0), e);
  } else {
    col = mix(now, past, e);
  }

  /* ---- slit-scan ----
     A band crosses the frame. Ahead of it you see now; behind it you
     see the moment the band went past. The frame stops being one
     instant and becomes a graph of time across space. */
  if (uSlit > 0.0) {
    vec2 dir = vec2(cos(uSlitAngle), sin(uSlitAngle));
    float along = dot(uv - 0.5, dir) + 0.5;
    float head = fract(uTime * uSlitSpeed * 0.14);
    float d = along - head;
    d -= floor(d + 0.5);                          /* wrap to -0.5..0.5 */
    float band = smoothstep(uSlitWidth, 0.0, abs(d));
    vec3 held = texture(uPast, clamp(puv, 0.001, 0.999)).rgb;
    col = mix(mix(held, col, band), col, 1.0 - uSlit);
  }

  /* ---- reaction-diffusion laid over the picture ---- */
  if (uRDMix > 0.0) {
    float b = texture(uRD, uv).g;
    float rdE = smoothstep(0.05, 0.28, b);
    if (uRDStyle == 0) {
      col = mix(col, col * (1.0 - rdE * 0.88), uRDMix);           /* etched into the emulsion */
    } else if (uRDStyle == 1) {
      vec3 dye = vec3(0.78, 0.94, 0.19) * rdE;                    /* the chemical itself */
      col = mix(col, col * (1.0 - rdE * 0.55) + dye * 0.95, uRDMix);
    } else {
      float gx = texture(uRD, uv + vec2(1.5 / uRes.x, 0.0)).g - texture(uRD, uv - vec2(1.5 / uRes.x, 0.0)).g;
      float gy = texture(uRD, uv + vec2(0.0, 1.5 / uRes.y)).g - texture(uRD, uv - vec2(0.0, 1.5 / uRes.y)).g;
      float lift = clamp((gx * 0.6 + gy * 0.8) * 5.0, -1.0, 1.0);
      col = mix(col, col * (1.0 + lift * 0.85), uRDMix);         /* relief, as if it dried raised */
    }
  }

  frag = vec4(max(col, 0.0), 1.0);
}`;

/* ---- Gray-Scott, fed by the picture ------------------------
   u is eaten, v grows. The feed rate is pushed around by the
   brightness of the photograph, so the pattern grows out of the
   picture rather than sitting on top of it. */
export const FRAG_RD = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 frag;

uniform sampler2D uState;
uniform sampler2D uSrc;
uniform vec2  uRes;
uniform float uFeed;
uniform float uKill;
uniform float uRate;
uniform float uSeedFrom;   /* how much the picture drives the feed */
uniform float uReset;

vec2 lap(vec2 uv) {
  vec2 t = 1.0 / uRes;
  vec2 s = vec2(0.0);
  s += texture(uState, uv + vec2(-t.x,  0.0)).rg * 0.2;
  s += texture(uState, uv + vec2( t.x,  0.0)).rg * 0.2;
  s += texture(uState, uv + vec2( 0.0, -t.y)).rg * 0.2;
  s += texture(uState, uv + vec2( 0.0,  t.y)).rg * 0.2;
  s += texture(uState, uv + vec2(-t.x, -t.y)).rg * 0.05;
  s += texture(uState, uv + vec2( t.x, -t.y)).rg * 0.05;
  s += texture(uState, uv + vec2(-t.x,  t.y)).rg * 0.05;
  s += texture(uState, uv + vec2( t.x,  t.y)).rg * 0.05;
  return s - texture(uState, uv).rg;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
}

void main() {
  vec2 uv = vUV;
  vec2 ab = texture(uState, uv).rg;

  if (uReset > 0.5) {
    // seed from the picture's own edges: the pattern starts where the
    // photograph already has detail
    // blobs, not single pixels: Gray-Scott grows outward from a seed and
    // a one-pixel seed dies before it starts
    vec3 c = texture(uSrc, uv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 cell = floor(uv * uRes / 9.0);
    float n = hash(cell);
    float here = length(fract(uv * uRes / 9.0) - 0.5);
    float seeded = step(here, 0.34) * step(0.34, n * 0.8 + l * 0.3);
    frag = vec4(1.0, seeded, 0.0, 1.0);
    return;
  }

  /* the picture steers the reaction; it must not be allowed to push it
     out of the regime where a pattern can form at all, and it must be
     read blurred or the grain drives it instead of the photograph */
  vec2 t2 = 2.5 / uRes;
  vec3 sm = texture(uSrc, uv).rgb * 0.36
          + texture(uSrc, uv + vec2(t2.x, 0.0)).rgb * 0.16
          + texture(uSrc, uv - vec2(t2.x, 0.0)).rgb * 0.16
          + texture(uSrc, uv + vec2(0.0, t2.y)).rgb * 0.16
          + texture(uSrc, uv - vec2(0.0, t2.y)).rgb * 0.16;
  float l = dot(sm, vec3(0.2126, 0.7152, 0.0722));
  float feed = uFeed + (l - 0.5) * 0.0075 * uSeedFrom;
  float kill = uKill + (0.5 - l) * 0.0038 * uSeedFrom;

  vec2 L = lap(uv);
  float a = ab.x, b = ab.y;
  float abb = a * b * b;
  float na = a + (1.0 * L.x - abb + feed * (1.0 - a)) * uRate;
  float nb = b + (0.5 * L.y + abb - (kill + feed) * b) * uRate;
  frag = vec4(clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0, 1.0);
}`;

/* ---- present: the last buffer, straight to the screen ---- */
export const FRAG_PRESENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 frag;
uniform sampler2D uTex;
void main() { frag = texture(uTex, vUV); }`;
