import { applyMaterial, makeBurn } from './recipe';
import { getMaterial } from './materials';
import type { PhotoRecipe } from './types';

/* ============================================================
   LOOKS
   Whole processes, not filters. One click puts a complete recipe
   on the bench — material, development, emulsion, damage, the
   lot — so the lab shows what it does before you touch a slider.

   Every look is still just a recipe. Load one, then take it apart.
   ============================================================ */

export interface Look {
  id: string;
  name: string;
  note: string;
  material: string;
  apply: (r: PhotoRecipe) => void;
}

export const LOOKS: Look[] = [
  {
    id: 'house',
    name: 'House Soup',
    note: 'What the shop makes if you do not ask. Portra, warm chemistry, a light bath.',
    material: 'kodak-portra',
    apply: (r) => {
      r.exposure.ev = 0.45;
      r.exposure.contrast = -0.06;
      r.grain.amount = 0.46;
      r.halation.intensity = 0.5;
      r.halation.radius = 0.4;
      r.halation.threshold = 0.64;
      r.diffusion.bloom = 0.26;
      // the shop's own bath: present, not shouting
      r.experimental.filmSoup = 0.3;
      r.experimental.soupChemical = 'coffee';
      r.experimental.contamination = 0.45;
      r.experimental.bleed = 0.4;
      r.experimental.soupDensity = 0.3;
      r.experimental.dust = 0.2;
      r.optics.vignette = 0.28;
    },
  },
  {
    id: 'trix-push',
    name: 'Tri-X / Push +2',
    note: 'Reportage. Contrast up, grain structural, printed hard.',
    material: 'kodak-tri-x',
    apply: (r) => {
      r.development.mode = 'push';
      r.development.pushPull = 2;
      r.development.developer = 'rodinal';
      r.exposure.contrast = 0.22;
      r.exposure.shadows = -0.1;
      r.grain.amount = 0.82;
      r.grain.clumping = 0.55;
      r.optics.vignette = 0.34;
      r.experimental.dust = 0.18;
    },
  },
  {
    id: 'portra-glow',
    name: 'Portra / Halation',
    note: 'Skin protected, highlights bleeding back through the emulsion.',
    material: 'kodak-portra',
    apply: (r) => {
      r.exposure.ev = 0.6;
      r.exposure.contrast = -0.1;
      r.grain.amount = 0.44;
      r.halation.intensity = 0.62;
      r.halation.radius = 0.44;
      r.halation.threshold = 0.6;
      r.diffusion.bloom = 0.34;
      r.diffusion.softness = 0.18;
      r.optics.vignette = 0.24;
    },
  },
  {
    id: 'cross-soup',
    name: 'Cross / Wine Soup',
    note: 'Wrong chemistry, then a bath it should never have had.',
    material: 'kodak-ektachrome',
    apply: (r) => {
      r.development.mode = 'cross-process';
      r.exposure.ev = 0.3;
      r.grain.amount = 0.6;
      r.halation.intensity = 0.4;
      r.experimental.filmSoup = 0.62;
      r.experimental.soupChemical = 'wine';
      r.experimental.contamination = 0.7;
      r.experimental.bleed = 0.6;
      r.experimental.lightLeak = 0.3;
      r.optics.vignette = 0.36;
      r.optics.chromatic = 0.3;
    },
  },
  {
    id: 'burnt',
    name: 'End of Reel',
    note: 'The emulsion lifts, chars at the rim and clears in the middle.',
    material: 'super-8-color',
    apply: (r) => {
      r.exposure.ev = 0.2;
      r.grain.amount = 0.75;
      r.halation.intensity = 0.5;
      r.burns = [makeBurn(0.62, 0.42), makeBurn(0.28, 0.7)];
      r.burns[0].amount = 0.85;
      r.burns[0].spread = 0.42;
      r.burns[1].amount = 0.5;
      r.burns[1].spread = 0.24;
      r.experimental.lightLeak = 0.42;
      r.experimental.scratches = 0.3;
      r.optics.vignette = 0.4;
    },
  },
  {
    id: 'bitmap',
    name: 'Bitmap',
    note: 'One bit. Ordered screen, no colour left to argue about.',
    material: 'ilford-hp5',
    apply: (r) => {
      r.exposure.contrast = 0.3;
      r.grain.amount = 0.2;
      r.halation.intensity = 0;
      r.raster.dither = 1;
      r.raster.levels = 1;
      r.optics.vignette = 0;
    },
  },
  {
    id: 'trace',
    name: 'Trace / Swarm',
    note: 'The lab draws what it found in the frame, over the frame.',
    material: 'fuji-provia',
    apply: (r) => {
      r.exposure.contrast = 0.2;
      r.grain.amount = 0.3;
      r.raster.comb = 0.35;
      r.trace.enabled = true;
      r.trace.mode = 'swarm';
      r.trace.density = 0.62;
      r.trace.colour = 'ice';
      r.trace.labels = true;
      r.optics.vignette = 0.3;
    },
  },
  {
    id: 'typeset',
    name: 'Typeset',
    note: 'The picture re-set in characters, one glyph per cell.',
    material: 'kodak-plus-x',
    apply: (r) => {
      r.exposure.contrast = 0.24;
      r.grain.amount = 0.16;
      r.trace.enabled = true;
      r.trace.mode = 'type';
      r.trace.cell = 0.78;
      r.trace.glyphs = ' .:-=+*#%@';
      r.trace.colour = 'paper';
    },
  },
  {
    id: 'sheet',
    name: 'Proof Sheet',
    note: 'The frame repeated as a roll, each exposure drifting.',
    material: 'kodak-gold',
    apply: (r) => {
      r.grain.amount = 0.5;
      r.halation.intensity = 0.3;
      r.sequence.enabled = true;
      r.sequence.rows = 3;
      r.sequence.cols = 4;
      r.sequence.drift = 0.45;
      r.sequence.stamp = true;
      r.experimental.dust = 0.22;
      r.optics.vignette = 0.26;
    },
  },
  {
    id: 'redscale',
    name: 'Redscale',
    note: 'Loaded backwards. Light hits the base before the emulsion.',
    material: 'lomography-redscale',
    apply: (r) => {
      r.experimental.redscale = 0.9;
      r.exposure.ev = -0.4;
      r.exposure.contrast = 0.16;
      r.grain.amount = 0.6;
      r.halation.intensity = 0.44;
      r.halation.hue = 0.85;
      r.optics.vignette = 0.42;
    },
  },
  {
    id: 'expired',
    name: 'Expired',
    note: 'Age fog, dye drift, a speed that no longer exists.',
    material: 'expired-stock',
    apply: (r) => {
      r.experimental.expired = 0.8;
      r.exposure.ev = 0.7;
      r.exposure.contrast = -0.2;
      r.grain.amount = 0.7;
      r.halation.intensity = 0.36;
      r.experimental.dust = 0.34;
      r.experimental.scratches = 0.26;
      r.experimental.lightLeak = 0.24;
      r.optics.vignette = 0.3;
    },
  },
  {
    id: 'cyanotype',
    name: 'Cyanotype',
    note: 'Prussian blue on rag paper. The pigment is the image.',
    material: 'cyanotype',
    apply: (r) => {
      r.exposure.contrast = 0.1;
      r.grain.amount = 0.3;
      r.diffusion.softness = 0.24;
      r.experimental.dust = 0.3;
      r.optics.vignette = 0.3;
      r.optics.edgeSoftness = 0.3;
    },
  },
  {
    id: 'velvia',
    name: 'Velvia 50',
    note: 'Five stops and no argument. Greens and reds at full volume.',
    material: 'fuji-velvia',
    apply: (r) => {
      r.exposure.ev = -0.2;
      r.exposure.contrast = 0.14;
      r.grain.amount = 0.28;
      r.halation.intensity = 0.3;
      r.optics.vignette = 0.3;
      r.optics.chromatic = 0.12;
    },
  },
];

/** Build the full recipe a look describes, from any starting recipe. */
export function applyLook(base: PhotoRecipe, look: Look): PhotoRecipe {
  const next = applyMaterial(structuredClone(base), getMaterial(look.material));
  // start each look from the material's own character, not the last one's
  const m = getMaterial(look.material);
  next.grain.size = m.profile.grainSize;
  next.grain.density = m.profile.grainDensity;
  next.grain.clumping = m.profile.grainClump;
  next.grain.chroma = m.profile.grainChroma;
  next.halation.intensity = m.profile.halationBase * 0.6;
  next.diffusion = { softness: 0, bloom: m.profile.bloom * 0.35, spread: 0.4 };
  next.development = { mode: 'normal', pushPull: 0, developer: m.developers[0] ?? 'stock', agitation: 0.5 };
  next.exposure = { ...next.exposure, ev: 0, contrast: 0, highlights: 0, shadows: 0 };
  next.optics = { ...next.optics, vignette: 0.18, chromatic: 0.06, edgeSoftness: 0.1, distortion: 0 };
  next.experimental = {
    ...next.experimental,
    filmSoup: 0, expired: 0, redscale: 0, solarization: 0,
    lightLeak: 0, scratches: 0, dust: 0,
  };
  next.burns = [];
  next.trace = { ...next.trace, enabled: false };
  next.sequence = { ...next.sequence, enabled: false };
  next.raster = { dither: 0, levels: 0.5, comb: 0, scanline: 0 };

  look.apply(next);
  return next;
}

export const DEFAULT_LOOK = 'house';
