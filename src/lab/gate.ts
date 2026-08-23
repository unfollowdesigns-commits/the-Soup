/* ============================================================
   THE GATE
   The rectangle the light actually goes through, and the film
   around it.

   The apertures below are the published camera-aperture figures
   for each format in millimetres. They decide the shape of the
   picture, the size and pitch of the perforations beside it, and
   how much the frame moves in the gate — a claw-registered 8mm
   camera weaves; a 35mm movement with pilot pins barely does.

   Fidelity: the dimensions are documented. The weave figures are
   a reconstruction — they are in the right region for each
   movement, not a measurement of any one camera.
   ============================================================ */

export type GateId = 'as-shot' | 'r8' | 's8' | 'm16' | 's16' | 'm35';

export interface Gate {
  id: GateId;
  name: string;
  note: string;
  /** camera aperture, mm */
  apertureW: number;
  apertureH: number;
  /** frames per second the format is normally run at */
  fps: number;
  /** film width, mm — sets how much stock sits beside the picture */
  stock: number;
  /** perforations per frame, per edge */
  perfsPerFrame: number;
  /** perforation size, mm */
  perfW: number;
  perfH: number;
  /** perforated edges */
  edges: 'one' | 'both' | 'none';
  /** gate weave, as a fraction of picture width / height */
  weaveX: number;
  weaveY: number;
  /** corner softness of the aperture, as a fraction of the short side */
  corner: number;
  /** what is printed along the edge of the stock */
  edgePrint: string;
}

export const GATES: Gate[] = [
  {
    id: 'as-shot',
    name: 'As shot',
    note: 'No gate. The clip keeps its own shape.',
    apertureW: 16,
    apertureH: 9,
    fps: 0,
    stock: 16,
    perfsPerFrame: 0,
    perfW: 0,
    perfH: 0,
    edges: 'none',
    weaveX: 0,
    weaveY: 0,
    corner: 0,
    edgePrint: '',
  },
  {
    id: 'r8',
    name: 'Regular 8',
    note: '4.8 × 3.5 mm. 16 fps. The smallest gate anyone shot anything serious on, and it never sits still.',
    apertureW: 4.8,
    apertureH: 3.5,
    fps: 16,
    stock: 8,
    perfsPerFrame: 1,
    perfW: 1.83,
    perfH: 1.27,
    edges: 'one',
    weaveX: 0.0075,
    weaveY: 0.0105,
    corner: 0.1,
    edgePrint: 'DOUBLE 8 · SAFETY',
  },
  {
    id: 's8',
    name: 'Super 8',
    note: '5.79 × 4.01 mm. 18 fps. Smaller perforations bought a bigger picture, and the cartridge cost it steadiness.',
    apertureW: 5.79,
    apertureH: 4.01,
    fps: 18,
    stock: 8,
    perfsPerFrame: 1,
    perfW: 1.14,
    perfH: 0.91,
    edges: 'one',
    weaveX: 0.006,
    weaveY: 0.009,
    corner: 0.11,
    edgePrint: 'SUPER 8 · SAFETY FILM',
  },
  {
    id: 'm16',
    name: '16 mm',
    note: '10.26 × 7.49 mm. 24 fps. Documentary stock. Steadier, and the grain has room to be seen.',
    apertureW: 10.26,
    apertureH: 7.49,
    fps: 24,
    stock: 16,
    perfsPerFrame: 1,
    perfW: 1.83,
    perfH: 1.27,
    edges: 'both',
    weaveX: 0.0028,
    weaveY: 0.0038,
    corner: 0.07,
    edgePrint: '16 · KS · SAFETY',
  },
  {
    id: 's16',
    name: 'Super 16',
    note: '12.52 × 7.41 mm. 24 fps. The second row of perforations given up for picture; 1.66 straight out of the camera.',
    apertureW: 12.52,
    apertureH: 7.41,
    fps: 24,
    stock: 16,
    perfsPerFrame: 1,
    perfW: 1.83,
    perfH: 1.27,
    edges: 'one',
    weaveX: 0.0026,
    weaveY: 0.0036,
    corner: 0.06,
    edgePrint: 'SUPER 16 · SAFETY',
  },
  {
    id: 'm35',
    name: '35 mm Academy',
    note: '21.0 × 15.2 mm. 24 fps. Four perforations a frame and pilot pins: it does not move.',
    apertureW: 21,
    apertureH: 15.2,
    fps: 24,
    stock: 35,
    perfsPerFrame: 4,
    perfW: 2.8,
    perfH: 1.98,
    edges: 'both',
    weaveX: 0.0008,
    weaveY: 0.0011,
    corner: 0.035,
    edgePrint: 'EASTMAN · SAFETY · KODAK',
  },
];

export const getGate = (id: GateId): Gate => GATES.find((g) => g.id === id) ?? GATES[0];

/**
 * How much smaller the photograph has to sit so the whole strip fits
 * beside it. The picture is the aperture; the stock is wider than the
 * aperture; so showing the film means giving up that much of the frame.
 * Without this the gutters — and with them the perforations and the
 * edge print — are drawn off the edge of the stage.
 */
export function gateFit(gate: Gate): number {
  if (gate.edges === 'none' || gate.stock <= gate.apertureW) return 1;
  return (gate.apertureW / gate.stock) * 0.9;
}

/* ============================================================
   OUTPUT
   ============================================================ */

export type FrameFit =
  /** the picture only, filled to the output frame */
  | 'clean'
  /** the whole film frame — perforations, edge print and all */
  | 'gate';

export interface OutputSize {
  id: string;
  name: string;
  w: number;
  h: number;
  note: string;
}

export const SIZES: OutputSize[] = [
  { id: 'hd', name: '1080', w: 1920, h: 1080, note: 'HD' },
  { id: 'uhd', name: '4K', w: 3840, h: 2160, note: 'UHD · 3840 × 2160' },
  { id: 'dci', name: '4K DCI', w: 4096, h: 2160, note: 'Cinema · 4096 × 2160' },
];

export const getSize = (id: string): OutputSize => SIZES.find((s) => s.id === id) ?? SIZES[0];

/* ------------------------------------------------------------
   LAYOUT
   Where the picture, the perforations and the edge print land
   inside an output frame of w × h. Everything is in pixels.
   ------------------------------------------------------------ */

export interface GateLayout {
  /** the picture */
  x: number;
  y: number;
  w: number;
  h: number;
  /** the stock behind it */
  stockX: number;
  stockW: number;
  /** one perforation, in pixels */
  perfW: number;
  perfH: number;
  /** pitch between perforations down the strip */
  pitch: number;
  /** centres of the perforated columns */
  cols: number[];
  corner: number;
  weaveX: number;
  weaveY: number;
  /** where the edge print runs */
  legendX: number;
  /** height of the edge print, px */
  legendSize: number;
}

export function layoutGate(
  gate: Gate,
  outW: number,
  outH: number,
  fit: FrameFit,
): GateLayout {
  const aspect = gate.apertureW / gate.apertureH;

  if (fit === 'clean' || gate.edges === 'none') {
    // fill the output frame with the picture at the gate's aspect
    const byW = outW / aspect <= outH;
    const w = byW ? outW : Math.round(outH * aspect);
    const h = byW ? Math.round(outW / aspect) : outH;
    return {
      x: Math.round((outW - w) / 2),
      y: Math.round((outH - h) / 2),
      w,
      h,
      stockX: 0,
      stockW: 0,
      perfW: 0,
      perfH: 0,
      pitch: 0,
      cols: [],
      corner: Math.round(Math.min(w, h) * gate.corner),
      weaveX: w * gate.weaveX,
      weaveY: h * gate.weaveY,
      legendX: 0,
      legendSize: 0,
    };
  }

  /* the whole strip: the full width of the stock, and one frame's
     pitch of it top to bottom */
  const pitchMm = gate.perfH * 0 + gate.apertureH * 1.06; /* frame line */
  const stripW = gate.stock;
  const stripH = pitchMm;
  const stripAspect = stripW / stripH;

  const byW = outW / stripAspect <= outH;
  const sw = byW ? outW : outH * stripAspect;
  const sh = byW ? outW / stripAspect : outH;
  const sx = (outW - sw) / 2;
  const sy = (outH - sh) / 2;
  const mm = sw / stripW; /* pixels per millimetre */

  const w = gate.apertureW * mm;
  const h = gate.apertureH * mm;

  /* Regular 8 and Super 16 are perforated on one edge; the picture
     sits over towards the unperforated side. */
  const gutter = (stripW - gate.apertureW) * mm;
  const x = gate.edges === 'both' ? sx + gutter / 2 : sx + gutter * 0.78;
  const y = sy + (sh - h) / 2;

  /* perforations sit out at the edge of the stock; the edge print goes
     between them and the picture, where the lab actually puts it */
  const cols =
    gate.edges === 'both'
      ? [sx + gutter * 0.16, sx + sw - gutter * 0.16]
      : [sx + gutter * 0.26];
  const legendX = gate.edges === 'both' ? sx + gutter * 0.4 : sx + gutter * 0.58;

  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    stockX: Math.round(sx),
    stockW: Math.round(sw),
    perfW: gate.perfW * mm,
    perfH: gate.perfH * mm,
    pitch: (pitchMm / gate.perfsPerFrame) * mm,
    cols,
    corner: Math.min(w, h) * gate.corner,
    weaveX: w * gate.weaveX,
    weaveY: h * gate.weaveY,
    legendX,
    legendSize: Math.max(6, Math.min(gate.perfH * mm * 0.42, gutter * 0.17)),
  };
}
