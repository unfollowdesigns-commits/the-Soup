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

  /* ================= VIGNETTE ================= */
  float vig = 1.0 - uVignette * smoothstep(0.06, 0.78, r2) * 1.25;
  col *= clamp(vig, 0.0, 1.4);

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
