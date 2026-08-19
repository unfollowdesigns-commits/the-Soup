import type { Material, PhotoRecipe } from '../lab/types';
import { DEV_LABEL, seedLabel } from '../lab/recipe';

/* ============================================================
   THE PRESS
   The lab makes an image. A poster is that image set on a grid
   with type. This file is the composition engine: it draws to any
   2D context at any size, so the preview on screen and the file
   that comes off the press are the same code at different scales.
   ============================================================ */

export type PosterFormat = 'a2' | 'square' | 'story' | 'print';
export type PosterTemplate = 'plate' | 'index' | 'sheet' | 'terminal';
export type PosterGround = 'paper' | 'bone' | 'ink' | 'chem' | 'blue';

export interface PosterSpec {
  format: PosterFormat;
  template: PosterTemplate;
  ground: PosterGround;
  title: string;
  subtitle: string;
  index: string;
  credit: string;
  showSpec: boolean;
  margin: number;      /* 0..1 */
  scaleImage: number;  /* 0..1 */
  rules: number;       /* how much rule work sits on the page */
  /** screening happens at the press, not in the lab: an ordered
   *  dither applied to the placed image the way a plate is screened */
  screen: number;
  screenLevels: number;
  seed: number;
}

export const POSTER_DEFAULT: PosterSpec = {
  format: 'a2',
  template: 'plate',
  ground: 'paper',
  title: 'MATERIAL STUDY',
  subtitle: '',
  index: '',
  credit: 'Photographic Material Lab',
  showSpec: true,
  margin: 0.5,
  scaleImage: 0.6,
  rules: 0.5,
  screen: 0,
  screenLevels: 0.85,
  seed: 7,
};

export const FORMATS: { id: PosterFormat; label: string; ratio: number; note: string }[] = [
  { id: 'a2', label: 'A2', ratio: 420 / 594, note: '420 × 594 mm' },
  { id: 'print', label: '2 : 3', ratio: 2 / 3, note: 'print proportion' },
  { id: 'square', label: 'Square', ratio: 1, note: '1 : 1' },
  { id: 'story', label: '9 : 16', ratio: 9 / 16, note: 'screen' },
];

export const TEMPLATES: { id: PosterTemplate; label: string; note: string }[] = [
  { id: 'plate', label: 'Plate', note: 'One large image, the title set beneath it, the specification down the side.' },
  { id: 'index', label: 'Index', note: 'A numbered list holding the page, the image kept small and high.' },
  { id: 'sheet', label: 'Sheet', note: 'The frame repeated as a proof sheet under a rule and a header.' },
  { id: 'terminal', label: 'Terminal', note: 'Flat ground, monospace throughout, the image reduced to a bitmap.' },
];

export const GROUNDS: Record<PosterGround, { bg: string; ink: string; dim: string; accent: string; label: string }> = {
  paper: { bg: '#e9e3d6', ink: '#16150f', dim: '#6d675a', accent: '#9a3527', label: 'Warm paper' },
  bone:  { bg: '#f4f2ec', ink: '#101010', dim: '#77756e', accent: '#1b4dd8', label: 'Bone' },
  ink:   { bg: '#0d0c0b', ink: '#f4efe4', dim: '#8a8377', accent: '#d99a3f', label: 'Ink' },
  chem:  { bg: '#c8e824', ink: '#0b0f04', dim: '#3f4a12', accent: '#0b0f04', label: 'Chemical' },
  blue:  { bg: '#0c2338', ink: '#e6ecef', dim: '#7d97a8', accent: '#e2622c', label: 'Cyanotype' },
};

const SANS = '"Inter", -apple-system, "Helvetica Neue", Arial, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
const SERIF = '"Spectral", Georgia, serif';

export function posterSize(format: PosterFormat, longEdge: number) {
  const ratio = FORMATS.find((f) => f.id === format)!.ratio;
  return { w: Math.round(longEdge * ratio), h: longEdge };
}

/* ------------------------------------------------------------
   DRAW
   `image` is the processed specimen, already rendered by the
   engine. The press never processes pixels itself.
   ------------------------------------------------------------ */
export function drawPoster(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  spec: PosterSpec,
  image: CanvasImageSource | null,
  imageAspect: number,
  meta: { material: Material; recipe: PhotoRecipe; date: Date },
) {
  const c = GROUNDS[spec.ground];
  const u = H / 100;                       // one layout unit
  const m = u * (4 + spec.margin * 7);     // margin

  g.save();
  g.fillStyle = c.bg;
  g.fillRect(0, 0, W, H);

  const ctx = { g, W, H, u, m, c, spec, image, imageAspect, meta };
  switch (spec.template) {
    case 'plate': drawPlate(ctx); break;
    case 'index': drawIndex(ctx); break;
    case 'sheet': drawSheet(ctx); break;
    case 'terminal': drawTerminal(ctx); break;
  }
  g.restore();
}

interface Ctx {
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  u: number;
  m: number;
  c: (typeof GROUNDS)[PosterGround];
  spec: PosterSpec;
  image: CanvasImageSource | null;
  imageAspect: number;
  meta: { material: Material; recipe: PhotoRecipe; date: Date };
}

/* ---- shared parts ------------------------------------------- */

function specLines(meta: Ctx['meta']): [string, string][] {
  const { material: mt, recipe: r, date } = meta;
  const out: [string, string][] = [
    ['MATERIAL', mt.name.toUpperCase()],
    ['ARCHIVE', mt.archiveNo],
    ['TYPE', `${mt.isoLabel} · ${mt.era.replace('-', '–')}`],
    ['EXPOSURE', `${r.exposure.ev >= 0 ? '+' : ''}${r.exposure.ev.toFixed(1)} EV`],
    ['DEVELOPMENT', DEV_LABEL[r.development.mode].toUpperCase()],
    ['GRAIN', r.grain.amount.toFixed(2)],
    ['HALATION', r.halation.intensity.toFixed(2)],
  ];
  if (r.experimental.filmSoup > 0) out.push(['SOUP', r.experimental.filmSoup.toFixed(2)]);
  if (r.burns.length) out.push(['BURNS', String(r.burns.filter((b) => b.enabled).length)]);
  out.push(['SEED', seedLabel(r.grain.seed)]);
  out.push(['DATE', date.toISOString().slice(0, 10)]);
  return out;
}

function fitRect(x: number, y: number, w: number, h: number, aspect: number) {
  const boxAspect = w / h;
  if (aspect > boxAspect) return { x, y: y + (h - w / aspect) / 2, w, h: w / aspect };
  return { x: x + (w - h * aspect) / 2, y, w: h * aspect, h };
}

function place(ctx: Ctx, x: number, y: number, w: number, h: number, cover = false) {
  const { g, image, imageAspect } = ctx;
  if (!image) {
    g.save();
    g.strokeStyle = ctx.c.dim;
    g.lineWidth = ctx.u * 0.08;
    g.strokeRect(x, y, w, h);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w, y + h);
    g.moveTo(x + w, y);
    g.lineTo(x, y + h);
    g.stroke();
    g.restore();
    return;
  }
  if (cover) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    const boxAspect = w / h;
    let dw = w;
    let dh = h;
    if (imageAspect > boxAspect) dw = h * imageAspect;
    else dh = w / imageAspect;
    g.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    g.restore();
  } else {
    const r = fitRect(x, y, w, h, imageAspect);
    g.drawImage(image, r.x, r.y, r.w, r.h);
  }
}

function rule(ctx: Ctx, x1: number, y: number, x2: number, weight = 0.07) {
  const { g, u, c } = ctx;
  g.strokeStyle = c.ink;
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(0.6, u * weight);
  g.beginPath();
  g.moveTo(x1, y);
  g.lineTo(x2, y);
  g.stroke();
  g.globalAlpha = 1;
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, dim = false) {
  const { g, u, c } = ctx;
  g.fillStyle = dim ? c.dim : c.ink;
  g.font = `500 ${u * size}px ${MONO}`;
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y);
}

function tracked(ctx: Ctx, text: string, x: number, y: number, size: number, track: number, dim = false) {
  const { g, u, c } = ctx;
  g.fillStyle = dim ? c.dim : c.ink;
  g.font = `500 ${u * size}px ${MONO}`;
  let cx = x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + u * track;
  }
}

/* ---- 1. PLATE ------------------------------------------------ */
function drawPlate(ctx: Ctx) {
  const { g, W, H, u, m, c, spec, meta } = ctx;
  const colW = (W - m * 2) * 0.2;
  const imgW = W - m * 2 - colW - u * 3;
  // the plate keeps close to the proportion of the frame rather than
  // cropping it into a shape the layout happens to want
  const maxH = (H - m * 2) * (0.44 + spec.scaleImage * 0.34);
  const imgH = Math.min(maxH, imgW / Math.max(ctx.imageAspect, 0.3) * 1.08);

  tracked(ctx, 'PHOTOGRAPHIC MATERIAL LAB', m, m - u * 1.4, 1.5, 0.42, true);
  rule(ctx, m, m, W - m);

  place(ctx, m, m + u * 2.4, imgW, imgH, true);

  // title beneath the plate
  const ty = m + u * 2.4 + imgH + u * 7;
  g.fillStyle = c.ink;
  g.font = `300 ${u * 7.4}px ${SANS}`;
  g.textBaseline = 'alphabetic';
  const title = spec.title || meta.material.name;
  wrapText(g, title.toUpperCase(), m, ty, imgW, u * 7.6);

  if (spec.subtitle) {
    g.fillStyle = c.dim;
    g.font = `300 italic ${u * 2.6}px ${SERIF}`;
    wrapText(g, spec.subtitle, m, ty + u * 9.4, imgW, u * 3.4);
  }

  // the specification, set as a column down the right
  if (spec.showSpec) {
    let y = m + u * 4;
    const x = W - m - colW;
    for (const [k, v] of specLines(meta)) {
      label(ctx, k, x, y, 1.45, true);
      g.font = `500 ${u * 1.75}px ${MONO}`;
      g.fillStyle = c.ink;
      g.fillText(clip(g, v, colW), x, y + u * 2.3);
      y += u * 5.2;
    }
  }

  rule(ctx, m, H - m, W - m);
  label(ctx, spec.credit.toUpperCase(), m, H - m + u * 2.6, 1.4, true);
  label(
    ctx,
    meta.date.toISOString().slice(0, 10),
    W - m - u * 12,
    H - m + u * 2.6,
    1.4,
    true,
  );
}

/* ---- 2. INDEX ------------------------------------------------ */
function drawIndex(ctx: Ctx) {
  const { g, W, H, u, m, c, spec, meta } = ctx;
  const imgW = (W - m * 2) * (0.3 + spec.scaleImage * 0.24);
  const imgX = W - m - imgW;

  tracked(ctx, (spec.title || 'INDEX').toUpperCase(), m, m + u * 3, 3.2, 0.5);
  rule(ctx, m, m + u * 5.4, W - m);

  place(ctx, imgX, m + u * 8, imgW, imgW / Math.max(ctx.imageAspect, 0.2), false);

  const lines = (spec.index || defaultIndex(meta))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let y = m + u * 11;
  const room = H - m * 2 - u * 15;
  const step = Math.min(u * 5.4, Math.max(u * 2.6, room / Math.max(lines.length, 1)));
  const listW = imgX - m - u * 4;
  g.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    if (y > H - m - u * 6) return;
    const fs = Math.min(2.6, Math.max(1.6, step / u * 0.62));
    label(ctx, String(i + 1).padStart(2, '0'), m, y, fs * 0.85, true);
    g.fillStyle = c.ink;
    g.font = `400 ${u * fs}px ${MONO}`;
    // a highlighter pass on a few entries, the way a list gets marked up
    if (((i * 7 + spec.seed) % 5) === 0) {
      const w = Math.min(g.measureText(line).width, listW);
      g.fillStyle = c.accent;
      g.globalAlpha = 0.24;
      g.fillRect(m + u * 4.4, y - u * fs * 0.95, w + u * 0.8, u * fs * 1.35);
      g.globalAlpha = 1;
      g.fillStyle = c.ink;
    }
    g.fillText(clip(g, line, listW), m + u * 5.2, y);
    y += step;
  });

  if (spec.showSpec) {
    let sy = m + u * 12 + imgW / Math.max(ctx.imageAspect, 0.2);
    for (const [k, v] of specLines(meta).slice(0, 6)) {
      label(ctx, `${k}  ${v}`, imgX, sy, 1.5, true);
      sy += u * 2.6;
    }
  }

  rule(ctx, m, H - m, W - m);
  label(ctx, spec.credit.toUpperCase(), m, H - m + u * 2.6, 1.4, true);
}

/* ---- 3. SHEET ------------------------------------------------ */
function drawSheet(ctx: Ctx) {
  const { g, W, H, u, m, c, spec, meta } = ctx;
  tracked(ctx, (spec.title || 'PROOF SHEET').toUpperCase(), m, m + u * 2.6, 2.4, 0.44);
  label(ctx, meta.material.name.toUpperCase(), W - m - u * 24, m + u * 2.6, 1.6, true);
  rule(ctx, m, m + u * 4.4, W - m);

  const cols = 3 + Math.round((1 - spec.scaleImage) * 3);
  const gap = u * 1.2;
  const cellW = (W - m * 2 - gap * (cols - 1)) / cols;
  const cellH = cellW / Math.max(ctx.imageAspect, 0.2);
  const top = m + u * 7;
  const rows = Math.max(1, Math.floor((H - top - m - u * 8) / (cellH + gap + u * 2.4)));

  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = m + col * (cellW + gap);
      const y = top + r * (cellH + gap + u * 2.4);
      g.save();
      g.globalAlpha = 0.55 + 0.45 * (((n * 13 + spec.seed) % 7) / 7);
      place(ctx, x, y, cellW, cellH, true);
      g.restore();
      g.strokeStyle = c.ink;
      g.globalAlpha = 0.25;
      g.lineWidth = Math.max(0.5, u * 0.05);
      g.strokeRect(x, y, cellW, cellH);
      g.globalAlpha = 1;
      label(
        ctx,
        `${String(n + 1).padStart(2, '0')}  ${seedLabel(meta.recipe.grain.seed + n)}`,
        x,
        y + cellH + u * 1.8,
        1.25,
        true,
      );
      n++;
    }
  }

  rule(ctx, m, H - m, W - m);
  label(ctx, spec.credit.toUpperCase(), m, H - m + u * 2.6, 1.4, true);
  label(ctx, meta.date.toISOString().slice(0, 10), W - m - u * 12, H - m + u * 2.6, 1.4, true);
}

/* ---- 4. TERMINAL --------------------------------------------- */
function drawTerminal(ctx: Ctx) {
  const { g, W, H, u, m, c, spec, meta } = ctx;
  const line = u * 2.5;

  // header block
  label(ctx, '// PHOTOGRAPHIC MATERIAL LAB', m, m + line, 1.5, true);
  label(ctx, `// ${meta.material.archiveNo}  ${meta.date.toISOString().slice(0, 10)}`, m, m + line * 2, 1.5, true);
  rule(ctx, m, m + line * 2.9, W - m, 0.05);

  // the headline, boxed
  const title = (spec.title || 'ERROR 404').toUpperCase();
  g.font = `500 ${u * 6.5}px ${MONO}`;
  const tw = g.measureText(title).width;
  const bx = m;
  const by = m + line * 4.2;
  g.strokeStyle = c.ink;
  g.lineWidth = Math.max(0.8, u * 0.12);
  g.strokeRect(bx, by, tw + u * 4, u * 9);
  g.fillStyle = c.ink;
  g.textBaseline = 'alphabetic';
  g.fillText(title, bx + u * 2, by + u * 6.6);

  // the image, held hard against the grid
  const colW = Math.min(u * 34, (W - m * 2) * 0.36);
  const imgW = W - m * 2 - colW - u * 3;
  const imgH = imgW / Math.max(ctx.imageAspect, 0.2);
  const iy = by + u * 13;
  place(ctx, m, iy, imgW, imgH, false);
  g.strokeStyle = c.ink;
  g.globalAlpha = 0.5;
  g.lineWidth = Math.max(0.5, u * 0.06);
  g.strokeRect(m, iy, imgW, imgH);
  g.globalAlpha = 1;

  // rule work down the right, driven by the recipe rather than invented
  let colBottom = iy;
  if (spec.rules > 0) {
    const lines = specLines(meta);
    let y = iy + line * 0.4;
    const x = m + imgW + u * 3;
    const room = W - m - x;
    g.font = `500 ${u * 1.5}px ${MONO}`;
    for (const [k, v] of lines) {
      if (y > H - m - line * 4) break;
      label(ctx, k, x, y, 1.35, true);
      g.font = `500 ${u * 1.5}px ${MONO}`;
      g.fillStyle = c.ink;
      g.fillText(clip(g, v, room), x, y + line * 0.72);
      y += line * 1.55;
    }
    colBottom = y;
  }

  // a block of the recipe filling the lower page, set as a listing
  const blockTop = Math.max(iy + imgH, colBottom) + line * 2.2;
  const footRule = H - m - line * 2.6;
  if (blockTop < footRule - line * 3) {
    const r0 = meta.recipe;
    const rows: string[] = [
      `material    ${meta.material.name}`,
      `manufacture ${meta.material.manufacturer} · ${meta.material.isoLabel}`,
      `era         ${meta.material.era.replace('-', ' – ')}`,
      `exposure    ${r0.exposure.ev >= 0 ? '+' : ''}${r0.exposure.ev.toFixed(2)} EV   contrast ${r0.exposure.contrast.toFixed(2)}`,
      `development ${DEV_LABEL[r0.development.mode]}  push/pull ${r0.development.pushPull.toFixed(1)}`,
      `grain       amount ${r0.grain.amount.toFixed(2)}  size ${r0.grain.size.toFixed(2)}  clump ${r0.grain.clumping.toFixed(2)}`,
      `halation    ${r0.halation.intensity.toFixed(2)}  radius ${r0.halation.radius.toFixed(2)}  threshold ${r0.halation.threshold.toFixed(2)}`,
      `optics      vignette ${r0.optics.vignette.toFixed(2)}  ca ${r0.optics.chromatic.toFixed(2)}`,
      `experiment  soup ${r0.experimental.filmSoup.toFixed(2)}  dust ${r0.experimental.dust.toFixed(2)}  scratch ${r0.experimental.scratches.toFixed(2)}`,
      `trace       ${r0.trace.enabled ? r0.trace.mode : 'off'}   sequence ${r0.sequence.enabled ? `${r0.sequence.rows}x${r0.sequence.cols}` : 'off'}`,
      `raster      dither ${r0.raster.dither.toFixed(2)}  comb ${r0.raster.comb.toFixed(2)}`,
    ];
    let by2 = blockTop;
    for (const row of rows) {
      if (by2 > footRule - line) break;
      label(ctx, row, m, by2, 1.4, true);
      by2 += line * 0.95;
    }
  }

  // a strip of measured values along the foot
  const foot = H - m - line;
  rule(ctx, m, foot - line * 1.4, W - m, 0.05);
  const r = meta.recipe;
  const strip = [
    `EV ${r.exposure.ev.toFixed(1)}`,
    `GR ${r.grain.amount.toFixed(2)}`,
    `HA ${r.halation.intensity.toFixed(2)}`,
    `SO ${r.experimental.filmSoup.toFixed(2)}`,
    `SEED ${seedLabel(r.grain.seed)}`,
  ].join('   ');
  label(ctx, strip, m, foot, 1.5, true);
}

/* ---- helpers ------------------------------------------------- */
function wrapText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
) {
  const words = text.split(' ');
  let line = '';
  let cy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, cy);
      line = w;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) g.fillText(line, x, cy);
}

function clip(g: CanvasRenderingContext2D, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 2 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function defaultIndex(meta: Ctx['meta']) {
  const { material: mt, recipe: r } = meta;
  return [
    mt.name,
    `${mt.manufacturer} · ${mt.isoLabel}`,
    mt.era.replace('-', ' – '),
    `Development: ${DEV_LABEL[r.development.mode]}`,
    `Exposure ${r.exposure.ev >= 0 ? '+' : ''}${r.exposure.ev.toFixed(1)} EV`,
    `Grain ${r.grain.amount.toFixed(2)} · size ${r.grain.size.toFixed(2)}`,
    `Halation ${r.halation.intensity.toFixed(2)}`,
    `Diffusion ${r.diffusion.bloom.toFixed(2)}`,
    `Vignette ${r.optics.vignette.toFixed(2)}`,
    r.experimental.filmSoup > 0 ? `Film soup ${r.experimental.filmSoup.toFixed(2)}` : 'No chemistry',
    r.burns.length ? `${r.burns.length} burn marks` : 'No burns',
    `Grain seed ${seedLabel(r.grain.seed)}`,
    `Soup seed ${seedLabel(r.experimental.soupSeed)}`,
    `Damage seed ${seedLabel(r.experimental.seed)}`,
  ].join('\n');
}
