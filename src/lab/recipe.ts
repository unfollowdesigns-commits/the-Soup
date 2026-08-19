import type {
  BurnMark,
  DevelopmentMode,
  Material,
  PhotoRecipe,
  SoupChemical,
  StageId,
} from './types';
import { getMaterial, MATERIALS } from './materials';

/* ============================================================
   DETERMINISTIC RANDOMNESS
   Every experiment can be run again and land in the same place.
   ============================================================ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => Math.floor(Math.random() * 0xfffff);

/** Seeds are shown the way a lab would write them on a tape label. */
export const seedLabel = (seed: number) =>
  seed.toString(16).toUpperCase().padStart(5, '0');

/* ============================================================
   DEFAULT RECIPE
   ============================================================ */

export function defaultRecipe(materialId = 'kodak-tri-x'): PhotoRecipe {
  const m = getMaterial(materialId);
  return {
    material: materialId,
    exposure: { ev: 0, contrast: 0, highlights: 0, shadows: 0, latitude: m.profile.latitude },
    development: { mode: 'normal', pushPull: 0, developer: m.developers[0] ?? 'stock', agitation: 0.5 },
    grain: {
      amount: 0.35,
      size: m.profile.grainSize,
      density: m.profile.grainDensity,
      clumping: m.profile.grainClump,
      luminance: 0.7,
      chroma: m.profile.grainChroma,
      randomness: 0.5,
      seed: 0x1f3a2,
    },
    halation: {
      intensity: m.profile.halationBase * 0.6,
      radius: 0.34,
      threshold: 0.74,
      hue: 0.5,
      edge: 0.5,
    },
    diffusion: { softness: 0, bloom: m.profile.bloom * 0.35, spread: 0.4 },
    optics: {
      distortion: 0,
      chromatic: 0.06,
      vignette: 0.18,
      edgeSoftness: 0.1,
      focus: 0.5,
      depthOfField: 0,
    },
    experimental: {
      filmSoup: 0,
      soupChemical: 'salt',
      soupTemperature: 0.45,
      contamination: 0.4,
      fog: 0.3,
      bleed: 0.35,
      soupDensity: 0.45,
      soupRandomness: 0.5,
      soupSeed: 0x8f29a,
      expired: 0,
      redscale: 0,
      solarization: 0,
      lightLeak: 0,
      scratches: 0,
      dust: 0,
      seed: 0x2b71c,
    },
    burns: [],
    depth: { enabled: false, influence: 0.4, target: ['grain', 'haze'] },
  };
}

/** Loading a material re-seats the material-intrinsic defaults but keeps
 *  everything the photographer has deliberately dialled in. */
export function applyMaterial(r: PhotoRecipe, m: Material): PhotoRecipe {
  const prev = getMaterial(r.material);
  const keep = (cur: number, prevBase: number, nextBase: number) =>
    clamp01(cur - prevBase + nextBase);
  return {
    ...r,
    material: m.id,
    exposure: { ...r.exposure, latitude: m.profile.latitude },
    development: {
      ...r.development,
      mode: m.development.includes(r.development.mode) ? r.development.mode : 'normal',
      developer: m.developers.includes(r.development.developer)
        ? r.development.developer
        : (m.developers[0] ?? 'stock'),
    },
    grain: {
      ...r.grain,
      size: keep(r.grain.size, prev.profile.grainSize, m.profile.grainSize),
      density: keep(r.grain.density, prev.profile.grainDensity, m.profile.grainDensity),
      clumping: keep(r.grain.clumping, prev.profile.grainClump, m.profile.grainClump),
      chroma: keep(r.grain.chroma, prev.profile.grainChroma, m.profile.grainChroma),
    },
  };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ============================================================
   BURNS
   ============================================================ */

export function makeBurn(x = 0.5, y = 0.5, rng = Math.random): BurnMark {
  return {
    id: `burn-${Math.floor(rng() * 0xffffff).toString(16)}`,
    x,
    y,
    amount: 0.5,
    spread: 0.34,
    density: 0.55,
    hue: 0.35,
    edge: 0.5,
    randomness: 0.6,
    seed: Math.floor(rng() * 0xfffff),
    enabled: true,
  };
}

/* ============================================================
   VOCABULARY
   ============================================================ */

export const DEV_LABEL: Record<DevelopmentMode, string> = {
  normal: 'Normal',
  push: 'Push',
  pull: 'Pull',
  'cross-process': 'Cross Process',
  'bleach-bypass': 'Bleach Bypass',
  stand: 'Stand',
};

export const DEV_NOTE: Record<DevelopmentMode, string> = {
  normal: 'Manufacturer time and temperature.',
  push: 'Extended development. Raises contrast and grain, opens the shadows less than the highlights.',
  pull: 'Shortened development. Lowers contrast and holds the highlight.',
  'cross-process': 'Developed in the wrong chemistry. Contrast climbs and the channels separate.',
  'bleach-bypass': 'Silver retained alongside the dye. Density up, saturation down.',
  stand: 'Highly dilute, barely agitated. Compensating: local contrast up, highlights held back.',
};

export const DEVELOPER_LABEL: Record<string, string> = {
  stock: 'Stock Process',
  d76: 'D-76',
  rodinal: 'Rodinal',
  hc110: 'HC-110',
  xtol: 'XTOL',
  c41: 'C-41',
  e6: 'E-6',
};

export const DEVELOPER_NOTE: Record<string, string> = {
  stock: 'The process the material was designed around.',
  d76: 'Balanced solvent developer. Fine grain, full speed, the reference standard.',
  rodinal: 'High acutance. Grain is sharp and clearly drawn; smooth tones suffer.',
  hc110: 'Flexible syrup concentrate. Clean highlights, low base fog, forgiving at dilution.',
  xtol: 'Ascorbate developer. Finest grain of the four with a slight speed gain.',
  c41: 'Standard colour negative chemistry at 38°C.',
  e6: 'Colour reversal chemistry, first developer critical.',
};

export const SOUP_CHEMICALS: { id: SoupChemical; label: string; note: string }[] = [
  { id: 'water', label: 'Water', note: 'Softens the emulsion. Mild lifting and fog.' },
  { id: 'salt', label: 'Salt Solution', note: 'Crystalline edges and hard-bordered stains.' },
  { id: 'vinegar', label: 'Vinegar', note: 'Acid attack on the dyes. Warm shifts, thinning density.' },
  { id: 'coffee', label: 'Coffee', note: 'Heavy staining. Brown contamination and lifted blacks.' },
  { id: 'wine', label: 'Red Wine', note: 'Deep magenta bleeding along the emulsion surface.' },
  { id: 'bleach', label: 'Bleach', note: 'Aggressive. Removes dye in patches, leaves paper-white voids.' },
  { id: 'dish-soap', label: 'Dish Soap', note: 'Surfactant marbling. Wide, soft, iridescent fronts.' },
  { id: 'seawater', label: 'Seawater', note: 'Salt and organics together. Green-blue fog with granular residue.' },
];

export const SOUP_TINT: Record<SoupChemical, [number, number, number]> = {
  water: [0.6, 0.68, 0.74],
  salt: [0.78, 0.8, 0.72],
  vinegar: [0.86, 0.72, 0.42],
  coffee: [0.62, 0.4, 0.2],
  wine: [0.66, 0.18, 0.34],
  bleach: [0.9, 0.92, 0.88],
  'dish-soap': [0.42, 0.66, 0.7],
  seawater: [0.36, 0.6, 0.52],
};

export const STAGE_LABEL: Record<StageId, string> = {
  material: 'Material',
  exposure: 'Exposure',
  development: 'Development',
  grain: 'Grain',
  halation: 'Halation',
  diffusion: 'Diffusion',
  optics: 'Optics',
  burn: 'Film Burn',
  soup: 'Film Soup',
  damage: 'Damage',
  depth: 'Depth',
};

export const STAGE_ORDER: StageId[] = [
  'material',
  'exposure',
  'development',
  'grain',
  'halation',
  'diffusion',
  'optics',
  'burn',
  'soup',
  'damage',
  'depth',
];

/* ============================================================
   STAGE SUMMARY — what the process stack prints on each card
   ============================================================ */

export function stageSummary(id: StageId, r: PhotoRecipe): string {
  const m = getMaterial(r.material);
  switch (id) {
    case 'material':
      return m.name;
    case 'exposure': {
      const ev = r.exposure.ev;
      return `${ev >= 0 ? '+' : ''}${ev.toFixed(1)} EV`;
    }
    case 'development': {
      const { mode, pushPull } = r.development;
      if (mode === 'push' || mode === 'pull')
        return `${DEV_LABEL[mode]} ${pushPull >= 0 ? '+' : ''}${pushPull.toFixed(0)}`;
      return DEV_LABEL[mode];
    }
    case 'grain':
      return `${describeAmount(r.grain.amount)} · ${r.grain.size.toFixed(2)}`;
    case 'halation':
      return r.halation.intensity.toFixed(2);
    case 'diffusion':
      return Math.max(r.diffusion.softness, r.diffusion.bloom).toFixed(2);
    case 'optics':
      return `V ${r.optics.vignette.toFixed(2)} · CA ${r.optics.chromatic.toFixed(2)}`;
    case 'burn': {
      const n = r.burns.filter((b) => b.enabled).length;
      return n === 0 ? 'None' : `${n} mark${n > 1 ? 's' : ''}`;
    }
    case 'soup':
      return r.experimental.filmSoup === 0
        ? 'None'
        : `${labelOf(SOUP_CHEMICALS, r.experimental.soupChemical)} · ${r.experimental.filmSoup.toFixed(2)}`;
    case 'damage': {
      const e = r.experimental;
      const active = [
        e.expired > 0 && 'Expired',
        e.redscale > 0 && 'Redscale',
        e.solarization > 0 && 'Solarised',
        e.lightLeak > 0 && 'Leak',
        e.scratches > 0 && 'Scratches',
        e.dust > 0 && 'Dust',
      ].filter(Boolean) as string[];
      return active.length ? active.join(' · ') : 'None';
    }
    case 'depth':
      return r.depth.enabled ? `Influence ${r.depth.influence.toFixed(2)}` : 'Off';
  }
}

const labelOf = <T extends { id: string; label: string }>(list: T[], id: string) =>
  list.find((x) => x.id === id)?.label ?? id;

export function describeAmount(v: number): string {
  if (v <= 0.001) return 'None';
  if (v < 0.2) return 'Trace';
  if (v < 0.4) return 'Light';
  if (v < 0.62) return 'Medium';
  if (v < 0.82) return 'Heavy';
  return 'Extreme';
}

/** Stages that currently do nothing are shown, but shown as dormant. */
export function stageActive(id: StageId, r: PhotoRecipe): boolean {
  switch (id) {
    case 'material':
      return true;
    case 'exposure':
      return (
        r.exposure.ev !== 0 ||
        r.exposure.contrast !== 0 ||
        r.exposure.highlights !== 0 ||
        r.exposure.shadows !== 0
      );
    case 'development':
      return r.development.mode !== 'normal' || r.development.pushPull !== 0;
    case 'grain':
      return r.grain.amount > 0;
    case 'halation':
      return r.halation.intensity > 0;
    case 'diffusion':
      return r.diffusion.softness > 0 || r.diffusion.bloom > 0;
    case 'optics':
      return (
        r.optics.vignette > 0 ||
        r.optics.chromatic > 0 ||
        r.optics.distortion !== 0 ||
        r.optics.edgeSoftness > 0
      );
    case 'burn':
      return r.burns.some((b) => b.enabled && b.amount > 0);
    case 'soup':
      return r.experimental.filmSoup > 0;
    case 'damage': {
      const e = r.experimental;
      return e.expired + e.redscale + e.solarization + e.lightLeak + e.scratches + e.dust > 0;
    }
    case 'depth':
      return r.depth.enabled;
  }
}

/* ============================================================
   RANDOM EXPERIMENT
   ============================================================ */

export function randomExperiment(seed = newSeed(), base?: PhotoRecipe): PhotoRecipe {
  const rng = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const m = pick(MATERIALS);
  const r = base ? applyMaterial(base, m) : defaultRecipe(m.id);
  const bias = (p: number) => Math.pow(rng(), p);

  return {
    ...r,
    exposure: {
      ...r.exposure,
      ev: Math.round((rng() * 2.6 - 1.1) * 10) / 10,
      contrast: Math.round((rng() * 0.8 - 0.3) * 100) / 100,
      highlights: Math.round((rng() * 0.7 - 0.35) * 100) / 100,
      shadows: Math.round((rng() * 0.7 - 0.3) * 100) / 100,
    },
    development: {
      ...r.development,
      mode: pick(m.development),
      pushPull: Math.round(rng() * 4 - 1.6),
      developer: pick(m.developers),
      agitation: Math.round(rng() * 100) / 100,
    },
    grain: {
      ...r.grain,
      amount: 0.25 + bias(1.4) * 0.7,
      size: clamp01(m.profile.grainSize + (rng() - 0.5) * 0.35),
      density: clamp01(m.profile.grainDensity + (rng() - 0.5) * 0.35),
      clumping: clamp01(m.profile.grainClump + (rng() - 0.5) * 0.4),
      seed: Math.floor(rng() * 0xfffff),
    },
    halation: {
      ...r.halation,
      intensity: bias(1.5) * 0.75,
      radius: 0.15 + rng() * 0.6,
      threshold: 0.55 + rng() * 0.35,
      hue: rng(),
    },
    diffusion: { ...r.diffusion, softness: bias(2) * 0.5, bloom: bias(1.6) * 0.6 },
    optics: {
      ...r.optics,
      vignette: bias(1.3) * 0.6,
      chromatic: bias(2) * 0.4,
      distortion: (rng() - 0.5) * 0.4,
      edgeSoftness: bias(1.8) * 0.5,
    },
    experimental: {
      ...r.experimental,
      filmSoup: rng() < 0.55 ? bias(1.5) * 0.6 : 0,
      soupChemical: pick(SOUP_CHEMICALS).id,
      soupTemperature: rng(),
      contamination: rng(),
      fog: bias(1.4),
      bleed: rng(),
      soupDensity: rng(),
      soupSeed: Math.floor(rng() * 0xfffff),
      expired: rng() < 0.3 ? bias(1.5) * 0.7 : 0,
      redscale: rng() < 0.16 ? bias(1.4) * 0.8 : 0,
      solarization: rng() < 0.14 ? bias(2) * 0.6 : 0,
      lightLeak: rng() < 0.4 ? bias(1.6) * 0.6 : 0,
      scratches: rng() < 0.35 ? bias(2) * 0.5 : 0,
      dust: rng() < 0.45 ? bias(1.8) * 0.5 : 0,
      seed: Math.floor(rng() * 0xfffff),
    },
    burns:
      rng() < 0.45
        ? Array.from({ length: 1 + Math.floor(rng() * 2) }, () => {
            const b = makeBurn(0.1 + rng() * 0.8, 0.1 + rng() * 0.8, rng);
            b.amount = 0.2 + bias(1.4) * 0.6;
            b.spread = 0.15 + rng() * 0.5;
            b.hue = rng();
            return b;
          })
        : [],
  };
}

/** Nudge an existing experiment rather than starting over. */
export function mutateRecipe(r: PhotoRecipe, seed = newSeed(), strength = 0.25): PhotoRecipe {
  const rng = mulberry32(seed);
  const j = (v: number, lo = 0, hi = 1) => clamp(v + (rng() - 0.5) * 2 * strength, lo, hi);
  return {
    ...r,
    exposure: {
      ...r.exposure,
      ev: Math.round(clamp(r.exposure.ev + (rng() - 0.5) * 2 * strength * 2, -3, 3) * 10) / 10,
      contrast: j(r.exposure.contrast, -1, 1),
      highlights: j(r.exposure.highlights, -1, 1),
      shadows: j(r.exposure.shadows, -1, 1),
    },
    grain: { ...r.grain, amount: j(r.grain.amount), size: j(r.grain.size), clumping: j(r.grain.clumping) },
    halation: {
      ...r.halation,
      intensity: j(r.halation.intensity),
      radius: j(r.halation.radius),
      threshold: j(r.halation.threshold, 0.3, 1),
    },
    diffusion: { ...r.diffusion, softness: j(r.diffusion.softness), bloom: j(r.diffusion.bloom) },
    optics: { ...r.optics, vignette: j(r.optics.vignette), chromatic: j(r.optics.chromatic) },
    experimental: {
      ...r.experimental,
      filmSoup: j(r.experimental.filmSoup),
      fog: j(r.experimental.fog),
      bleed: j(r.experimental.bleed),
      soupSeed: Math.floor(rng() * 0xfffff),
      seed: Math.floor(rng() * 0xfffff),
    },
    burns: r.burns.map((b) => ({ ...b, amount: j(b.amount), spread: j(b.spread), seed: Math.floor(rng() * 0xfffff) })),
  };
}

/* ============================================================
   RECIPE NAMING — the way a lab writes on the sleeve
   ============================================================ */

export function proposeRecipeCode(r: PhotoRecipe, index: number): string {
  const m = getMaterial(r.material);
  const parts: string[] = [m.name.split(' ').slice(-1)[0].toUpperCase()];
  if (r.experimental.expired > 0.05) parts.push('EXPIRED');
  if (r.development.mode === 'cross-process') parts.push('CROSS');
  else if (r.development.mode === 'bleach-bypass') parts.push('BYPASS');
  else if (r.development.mode === 'push') parts.push(`PUSH ${r.development.pushPull >= 0 ? '+' : ''}${r.development.pushPull}`);
  else if (r.development.mode === 'pull') parts.push('PULL');
  if (r.experimental.filmSoup > 0.05) parts.push('CHEMICAL');
  else if (r.burns.some((b) => b.enabled)) parts.push('BURN');
  else if (r.grain.amount > 0.7) parts.push('GRAIN');
  return `${parts.join(' / ')} ${String(index).padStart(2, '0')}`;
}
