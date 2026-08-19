/* ============================================================
   DOMAIN MODEL
   The UI edits a recipe. The rendering engine consumes a recipe.
   Nothing in this file knows what a shader is.
   ============================================================ */

export type Era =
  | '1800s'
  | '1900-1929'
  | '1930-1949'
  | '1950-1969'
  | '1970-1989'
  | '1990-2009'
  | '2010-present';

export type MaterialKind =
  | 'bw-negative'
  | 'color-negative'
  | 'color-reversal'
  | 'instant'
  | 'motion-picture'
  | 'early-process'
  | 'experimental';

export type FilmFormat =
  | 'large-format'
  | 'medium-format'
  | '35mm'
  | '16mm'
  | 'super-8'
  | 'instant'
  | 'plate';

/** How much we actually know. Never claim more than this. */
export type Fidelity = 'documented' | 'reconstructed' | 'interpretation';

export type DevelopmentMode =
  | 'normal'
  | 'push'
  | 'pull'
  | 'cross-process'
  | 'bleach-bypass'
  | 'stand';

export type DeveloperStyle =
  | 'stock'
  | 'd76'
  | 'rodinal'
  | 'hc110'
  | 'xtol'
  | 'c41'
  | 'e6';

/* ---- ENGINE-FACING MATERIAL PROFILE ------------------------
   A compact description of how the emulsion answers light.
   Values are normalised; the engine decides what to do with them. */
export interface MaterialProfile {
  monochrome: boolean;
  /** luminance weights when monochrome (panchromatic vs. orthochromatic) */
  monoMix: [number, number, number];
  /** characteristic curve */
  toe: number;        /* shadow compression  0..1 */
  shoulder: number;   /* highlight rolloff   0..1 */
  gamma: number;      /* overall slope       0.6..1.6 */
  contrast: number;   /* baked contrast      -1..1 */
  latitude: number;   /* exposure forgiveness 0..1 */
  /* colour behaviour */
  saturation: number;         /* 0..1.6 */
  channelGamma: [number, number, number];
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  crossover: number;          /* channel divergence 0..1 */
  /* material-intrinsic texture */
  grainSize: number;          /* microns, normalised 0..1 */
  grainDensity: number;
  grainClump: number;
  grainChroma: number;
  /* light in the emulsion */
  halationTint: [number, number, number];
  halationBase: number;
  bloom: number;
}

export interface MaterialTraits {
  grain: number;
  contrast: number;
  latitude: number;
  sharpness: number;
  saturation: number;
}

export interface MaterialNotes {
  tonal: string;
  grain: string;
  color: string;
  highlight: string;
  shadow: string;
  history: string;
}

export interface Material {
  id: string;
  name: string;
  manufacturer: string;
  archiveNo: string;
  era: Era;
  yearFrom: number;
  yearTo: number | null;      /* null = still manufactured */
  kind: MaterialKind;
  formats: FilmFormat[];
  iso: number | null;
  isoLabel: string;
  fidelity: Fidelity;
  traits: MaterialTraits;
  profile: MaterialProfile;
  notes: MaterialNotes;
  development: DevelopmentMode[];
  developers: DeveloperStyle[];
  /** three-stop reference chip: shadow / mid / highlight rendering */
  swatch: [string, string, string];
}

/* ============================================================
   RECIPE
   ============================================================ */

export interface BurnMark {
  id: string;
  x: number;          /* 0..1 in image space */
  y: number;
  amount: number;
  spread: number;
  density: number;
  hue: number;        /* 0..1 → ember red through paper white */
  edge: number;       /* softness */
  randomness: number;
  seed: number;
  enabled: boolean;
}

export interface PhotoRecipe {
  material: string;

  exposure: {
    ev: number;         /* -3 .. +3 */
    contrast: number;   /* -1 .. 1 */
    highlights: number;
    shadows: number;
    latitude: number;   /* 0 .. 1 */
  };

  development: {
    mode: DevelopmentMode;
    pushPull: number;   /* stops, -3 .. +3 */
    developer: DeveloperStyle;
    agitation: number;  /* 0 .. 1 */
  };

  grain: {
    amount: number;
    size: number;
    density: number;
    clumping: number;
    luminance: number;  /* how strongly grain follows density */
    chroma: number;
    randomness: number;
    seed: number;
  };

  halation: {
    intensity: number;
    radius: number;
    threshold: number;
    hue: number;
    edge: number;
  };

  diffusion: {
    softness: number;
    bloom: number;
    spread: number;
  };

  optics: {
    distortion: number;   /* -1 .. 1 */
    chromatic: number;
    vignette: number;
    edgeSoftness: number;
    focus: number;        /* 0 .. 1 — plane of focus */
    depthOfField: number;
  };

  experimental: {
    filmSoup: number;
    soupChemical: SoupChemical;
    soupTemperature: number;
    contamination: number;
    fog: number;
    bleed: number;
    soupDensity: number;
    soupRandomness: number;
    soupSeed: number;

    expired: number;
    redscale: number;
    solarization: number;
    lightLeak: number;
    scratches: number;
    dust: number;
    seed: number;
  };

  burns: BurnMark[];

  depth: {
    enabled: boolean;
    influence: number;
    target: DepthTarget[];
  };
}

export type SoupChemical =
  | 'water'
  | 'salt'
  | 'vinegar'
  | 'coffee'
  | 'wine'
  | 'bleach'
  | 'dish-soap'
  | 'seawater';

export type DepthTarget = 'grain' | 'halation' | 'diffusion' | 'burn' | 'haze';

/* ============================================================
   SESSION OBJECTS
   ============================================================ */

export interface Recipe {
  id: string;
  name: string;
  code: string;         /* PORTRA / EXPIRED / CHEMICAL 03 */
  createdAt: number;
  materialId: string;
  recipe: PhotoRecipe;
  note?: string;
}

export type LogKind =
  | 'material'
  | 'exposure'
  | 'development'
  | 'grain'
  | 'halation'
  | 'diffusion'
  | 'optics'
  | 'burn'
  | 'soup'
  | 'experiment'
  | 'depth'
  | 'archive'
  | 'specimen'
  | 'export';

export interface LogEntry {
  id: string;
  at: number;
  kind: LogKind;
  title: string;
  detail: string;
  /** full recipe snapshot — every entry is a state you can return to */
  snapshot: PhotoRecipe;
}

export interface Specimen {
  id: string;
  name: string;
  source: 'imported' | 'house';
  width: number;
  height: number;
  bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  importedAt: number;
  fileSize?: number;
  note?: string;
}

/* ---- process stack: the visible, editable recipe ---- */
export type StageId =
  | 'material'
  | 'exposure'
  | 'development'
  | 'grain'
  | 'halation'
  | 'diffusion'
  | 'optics'
  | 'burn'
  | 'soup'
  | 'damage'
  | 'depth';

export interface StageState {
  id: StageId;
  enabled: boolean;
}
