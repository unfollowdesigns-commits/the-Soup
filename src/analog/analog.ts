/* ============================================================
   THE ANALOG MATERIAL SYSTEM
   A composable layer stack for surfaces in the interface —
   separate from the photographic engine, which processes the
   photograph itself.

   Order of preference, and it matters:
     1. REAL MATERIAL   artefacts traced from film scans
     2. PROCEDURAL      filter primitives, generated per element
     3. CSS             only where neither of the above will do

   Nothing here applies every effect at once. Presets exist so
   that a surface picks a character, not a checklist.
   ============================================================ */

export interface AnalogConfig {
  /** procedural, non-repeating; the only effect that is never an asset */
  grain: number;
  /** real: dirt and lint traced from 35mm scans */
  dust: number;
  /** real: emulsion and base scratches */
  scratches: number;
  /** procedural: localised over-exposure with a charred rim */
  burn: number;
  /** procedural: highlights bleeding back into the surface */
  halation: number;
  /** procedural: uneven lamp output, irregular by design */
  flicker: number;
  /** procedural: the gate never held the frame perfectly still */
  jitter: number;
  /** procedural: registration error and emulsion movement */
  displace: number;
  /** real: paper fibre or toner */
  texture: TextureKind;
  textureOpacity: number;
  /** deterministic: the same seed lays the material down the same way */
  seed: number;
}

export type TextureKind = 'none' | 'paper' | 'photocopy';

export const ANALOG_DEFAULT: AnalogConfig = {
  grain: 0,
  dust: 0,
  scratches: 0,
  burn: 0,
  halation: 0,
  flicker: 0,
  jitter: 0,
  displace: 0,
  texture: 'none',
  textureOpacity: 0.5,
  seed: 1,
};

/* ------------------------------------------------------------
   PRESETS
   Each is a character, not a maximum. The restraint is the point:
   a surface that reads as "damaged" at a glance is already wrong.
   ------------------------------------------------------------ */
export const ANALOG_PRESETS = {
  /** barely there — the tooth of a coated sheet under everything */
  bench: { grain: 0.1, texture: 'paper', textureOpacity: 0.16 },
  /** an archival print that has been handled */
  archival: { grain: 0.16, dust: 0.22, texture: 'paper', textureOpacity: 0.3 },
  /** a working contact sheet: scratched, dusty, not precious */
  contact: { grain: 0.22, dust: 0.3, scratches: 0.24, texture: 'paper', textureOpacity: 0.22 },
  /** a duplicated document — toner, registration drift */
  document: { grain: 0.12, texture: 'photocopy', textureOpacity: 0.34, displace: 0.25 },
  /** projected: the lamp is old and the gate is loose */
  projected: { grain: 0.28, dust: 0.34, scratches: 0.3, flicker: 0.4, jitter: 0.3 },
  /** the end of the reel */
  scorched: { grain: 0.3, dust: 0.2, scratches: 0.2, burn: 0.45, halation: 0.3 },
} as const satisfies Record<string, Partial<AnalogConfig>>;

export type AnalogPreset = keyof typeof ANALOG_PRESETS;

export function resolveAnalog(
  preset: AnalogPreset | undefined,
  over: Partial<AnalogConfig>,
): AnalogConfig {
  return {
    ...ANALOG_DEFAULT,
    ...(preset ? ANALOG_PRESETS[preset] : null),
    ...over,
  } as AnalogConfig;
}

/* ------------------------------------------------------------
   THE DAMAGE ATLAS
   2 x 2, one frame-sized field per artefact class. Positions are
   expressed as background-position percentages so a layer can pick
   its quadrant without a sprite runtime.
   ------------------------------------------------------------ */
export const ATLAS_SLOT = {
  dust: '0% 0%',
  scratches: '100% 0%',
  hair: '0% 100%',
  stain: '100% 100%',
} as const;

export const ATLAS_URL = (variant: 1 | 2 = 1) =>
  `${import.meta.env.BASE_URL}analog/plates/damage-atlas-${variant}.png`;

export const TEXTURE_URL: Record<Exclude<TextureKind, 'none'>, string[]> = {
  paper: ['analog/paper/paper-fibre-1.png', 'analog/paper/paper-fibre-2.png'],
  photocopy: ['analog/photocopy/toner-1.png', 'analog/photocopy/toner-2.png'],
};

/* ------------------------------------------------------------
   PLACEMENT
   A seed decides where the material lands, how it is turned and
   how far it is scaled, so two surfaces never wear the same marks.
   ------------------------------------------------------------ */
export interface Placement {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  flip: boolean;
}

export function placement(seed: number, salt: number): Placement {
  const r = hash(seed * 7919 + salt * 104729);
  return {
    x: Math.round(r(0) * 100),
    y: Math.round(r(1) * 100),
    scale: 1.1 + r(2) * 1.6,
    rotate: Math.round(r(3) * 360),
    flip: r(4) > 0.5,
  };
}

function hash(seed: number) {
  return (i: number) => {
    let t = (seed + i * 0x9e3779b9) >>> 0;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^= t >>> 15) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------
   IRREGULAR MOTION
   A sine wave reads as an effect. Real lamp flicker and real gate
   jitter are irregular, mostly quiet, occasionally not — so the
   keyframes are generated, weighted toward doing nothing.
   ------------------------------------------------------------ */
export function flickerKeyframes(seed: number, amount: number, steps = 14): string {
  const r = hash(seed * 2654435761);
  const frames: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((i / steps) * 100).toFixed(1);
    const v = r(i);
    // most frames sit at nominal; a few dip
    const dip = v > 0.72 ? (v - 0.72) / 0.28 : 0;
    const b = 1 - dip * amount * 0.22;
    const c = 1 + dip * amount * 0.1;
    frames.push(`${t}%{filter:brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)})}`);
  }
  return frames.join('');
}

export function jitterKeyframes(seed: number, amount: number, steps = 16): string {
  const r = hash(seed * 40503 + 17);
  const frames: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((i / steps) * 100).toFixed(1);
    const v = r(i * 3);
    const w = r(i * 3 + 1);
    // the gate holds, then slips
    const slip = v > 0.78 ? (v - 0.78) / 0.22 : 0;
    const dx = (w - 0.5) * amount * 1.4 * slip;
    const dy = (r(i * 3 + 2) - 0.5) * amount * 2.6 * slip;
    frames.push(`${t}%{transform:translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0)}`);
  }
  return frames.join('');
}
