import { makeBurn, newSeed } from './recipe';
import type { PhotoRecipe, StageId } from './types';

/* ============================================================
   STAGE DIAL
   Every stage on the recipe strip has one number that matters
   most. This is where that number lives, so a card can be an
   instrument instead of a read-out that says "None".

   `wake` is what turning a stage on should mean — a value that
   is clearly visible without being a joke.
   ============================================================ */

export interface Dial {
  /** the number the card shows and drags, 0..1 */
  get: (r: PhotoRecipe) => number;
  set: (r: PhotoRecipe, v: number) => PhotoRecipe;
  /** what "on" means for a dormant stage */
  wake: number;
  /** stages that are a choice, not a quantity */
  chooseOnly?: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const DIALS: Record<StageId, Dial> = {
  material: {
    get: () => 1,
    set: (r) => r,
    wake: 1,
    chooseOnly: true,
  },
  exposure: {
    // exposure is bipolar; the card drags the whole -3..+3 range
    get: (r) => (r.exposure.ev + 3) / 6,
    set: (r, v) => ({
      ...r,
      exposure: { ...r.exposure, ev: Math.round((v * 6 - 3) * 10) / 10 },
    }),
    wake: 0.6,
  },
  development: {
    get: (r) => (r.development.pushPull + 3) / 6,
    set: (r, v) => {
      const stops = Math.round((v * 6 - 3) * 2) / 2;
      return {
        ...r,
        development: {
          ...r.development,
          pushPull: stops,
          mode: stops > 0.1 ? 'push' : stops < -0.1 ? 'pull' : 'normal',
        },
      };
    },
    wake: 0.75,
  },
  grain: {
    get: (r) => r.grain.amount,
    set: (r, v) => ({ ...r, grain: { ...r.grain, amount: clamp01(v) } }),
    wake: 0.62,
  },
  halation: {
    get: (r) => r.halation.intensity,
    set: (r, v) => ({ ...r, halation: { ...r.halation, intensity: clamp01(v) } }),
    wake: 0.55,
  },
  diffusion: {
    get: (r) => Math.max(r.diffusion.softness, r.diffusion.bloom),
    set: (r, v) => ({
      ...r,
      diffusion: { ...r.diffusion, bloom: clamp01(v), softness: clamp01(v * 0.6) },
    }),
    wake: 0.45,
  },
  optics: {
    get: (r) => r.optics.vignette,
    set: (r, v) => ({ ...r, optics: { ...r.optics, vignette: clamp01(v) } }),
    wake: 0.4,
  },
  burn: {
    // the card drags the strength of every mark at once; dragging up
    // from nothing puts the first mark on the frame
    get: (r) => {
      const on = r.burns.filter((b) => b.enabled);
      return on.length ? on.reduce((s, b) => s + b.amount, 0) / on.length : 0;
    },
    set: (r, v) => {
      const amt = clamp01(v);
      if (!r.burns.length) {
        if (amt <= 0.01) return r;
        const b = makeBurn(0.42 + Math.random() * 0.3, 0.38 + Math.random() * 0.26);
        b.amount = amt;
        return { ...r, burns: [b] };
      }
      return { ...r, burns: r.burns.map((b) => ({ ...b, amount: amt, enabled: amt > 0.01 })) };
    },
    wake: 0.6,
  },
  soup: {
    get: (r) => r.experimental.filmSoup,
    set: (r, v) => ({
      ...r,
      experimental: { ...r.experimental, filmSoup: clamp01(v) },
    }),
    wake: 0.5,
  },
  damage: {
    get: (r) => {
      const e = r.experimental;
      return Math.max(e.dust, e.scratches, e.lightLeak, e.expired);
    },
    set: (r, v) => {
      const a = clamp01(v);
      return {
        ...r,
        experimental: {
          ...r.experimental,
          dust: a,
          scratches: a * 0.75,
          lightLeak: a * 0.6,
        },
      };
    },
    wake: 0.5,
  },
  depth: {
    get: (r) => (r.depth.enabled ? r.depth.influence : 0),
    set: (r, v) => ({
      ...r,
      depth: { ...r.depth, enabled: v > 0.01, influence: clamp01(v) },
    }),
    wake: 0.5,
  },
  trace: {
    get: (r) => (r.trace.enabled ? r.trace.density : 0),
    set: (r, v) => ({
      ...r,
      trace: { ...r.trace, enabled: v > 0.01, density: clamp01(v) },
    }),
    wake: 0.4,
  },
  sequence: {
    get: (r) => (r.sequence.enabled ? (r.sequence.cols - 1) / 7 : 0),
    set: (r, v) => ({
      ...r,
      sequence: {
        ...r.sequence,
        enabled: v > 0.01,
        cols: Math.max(1, Math.round(1 + clamp01(v) * 7)),
        rows: Math.max(1, Math.round(1 + clamp01(v) * 5)),
      },
    }),
    wake: 0.45,
  },
  raster: {
    get: (r) => Math.max(r.raster.dither, r.raster.comb),
    set: (r, v) => ({ ...r, raster: { ...r.raster, dither: clamp01(v) } }),
    wake: 0.8,
  },
  /* vision is a way of looking, not a quantity in the recipe */
  vision: { get: () => 0, set: (r) => r, wake: 0, chooseOnly: true },
};

/** wake a dormant stage, or put it back to sleep */
export function toggleStage(r: PhotoRecipe, id: StageId): PhotoRecipe {
  const d = DIALS[id];
  if (d.chooseOnly) return r;
  const on = d.get(r) > 0.01;
  if (id === 'burn' && on) return { ...r, burns: [] };
  if (id === 'soup' && !on) {
    // a fresh cook gets a fresh seed, or it is the same soup twice
    return DIALS.soup.set(
      { ...r, experimental: { ...r.experimental, soupSeed: newSeed() } },
      d.wake,
    );
  }
  return d.set(r, on ? 0 : d.wake);
}
