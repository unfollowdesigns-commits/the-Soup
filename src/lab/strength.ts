import type { PhotoRecipe } from './types';

/* ============================================================
   STRENGTH
   One number that moves a whole look between "the stock, plainly
   developed" and "everything the look asks for".

   It walks the two recipes together field by field. Numbers are
   interpolated; choices — the chemical, the paper, the blur mode —
   come from whichever end you are nearer, because there is no
   halfway between coffee and bleach.
   ============================================================ */

type Any = Record<string, unknown>;

function blend(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * t;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((v, i) => blend(v, b[i], t));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Any = {};
    for (const k of Object.keys(b as Any)) {
      out[k] = k in (a as Any) ? blend((a as Any)[k], (b as Any)[k], t) : (b as Any)[k];
    }
    return out;
  }
  // booleans, strings, seeds: whichever end we are nearer
  return t < 0.5 ? a : b;
}

/**
 * `plain` is the stock with nothing done to it; `full` is the look at
 * everything it asks for. Burns are all-or-nothing — half a burn mark is
 * not a thing — so they arrive with the second half of the travel.
 */
export function atStrength(plain: PhotoRecipe, full: PhotoRecipe, t: number): PhotoRecipe {
  const s = Math.max(0, Math.min(1, t));
  const out = blend(plain, full, s) as PhotoRecipe;
  out.material = full.material;
  out.burns = s > 0.5 ? full.burns.map((b) => ({ ...b, amount: b.amount * (s - 0.5) * 2 })) : [];
  return out;
}
