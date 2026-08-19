/* ============================================================
   HOUSE SPECIMENS
   Two reference images the lab keeps on the bench so the
   instruments have something to work on before a photographer
   brings their own. Both are drawn here, in code — they are not
   photographs and are never presented as photographs.
   ============================================================ */

export type HouseSpecimen = 'target' | 'window';

export interface DrawnSpecimen {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  name: string;
  note: string;
}

const rnd = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^= t >>> 15) >>> 0) / 4294967296;
  };
};

export function makeHouseSpecimen(kind: HouseSpecimen, w = 1800, h = 1200): DrawnSpecimen {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  if (kind === 'target') drawTarget(g, w, h);
  else drawWindow(g, w, h);
  return {
    canvas,
    width: w,
    height: h,
    name: kind === 'target' ? 'Bench Test Target' : 'Window Study',
    note:
      kind === 'target'
        ? 'Step wedge, primaries and a resolution comb. Drawn in the lab for judging density, crossover and grain structure.'
        : 'A drawn light study — window, bench and glass. Drawn in the lab, not photographed.',
  };
}

/* ---- 1. the calibration target on the wall above the bench ---- */
function drawTarget(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#6d6a64';
  g.fillRect(0, 0, w, h);

  const pad = w * 0.06;
  const inner = w - pad * 2;

  // 21-step wedge
  const steps = 21;
  const sw = inner / steps;
  const sy = h * 0.1;
  const sh = h * 0.22;
  for (let i = 0; i < steps; i++) {
    const v = Math.pow(i / (steps - 1), 1 / 2.2);
    const c = Math.round(v * 255);
    g.fillStyle = `rgb(${c},${c},${c})`;
    g.fillRect(pad + i * sw, sy, sw + 1, sh);
  }

  // primaries, secondaries and two skin references
  const patches = [
    '#b1281c', '#c8871f', '#c9b93c', '#4f7a33', '#2f6f7e',
    '#2b4f8e', '#5f3172', '#a8386b', '#e4c9a8', '#8a5c42',
  ];
  const pw = inner / patches.length;
  const py = sy + sh + h * 0.05;
  const ph = h * 0.18;
  patches.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(pad + i * pw, py, pw + 1, ph);
  });

  // resolution comb — the pitch halves across the width
  const ry = py + ph + h * 0.06;
  const rh = h * 0.14;
  for (let i = 0; i < 7; i++) {
    const bx = pad + (inner / 7) * i;
    const bw = inner / 7 - 10;
    const pitch = 2 + i * 3;
    for (let x = 0; x < bw; x += pitch * 2) {
      g.fillStyle = '#111';
      g.fillRect(bx + x, ry, pitch, rh);
    }
  }

  // specular row: the halation reference
  const cy = ry + rh + h * 0.12;
  for (let i = 0; i < 7; i++) {
    const r = 5 + i * 6;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(pad + inner * (0.06 + i * 0.15), cy, r, 0, Math.PI * 2);
    g.fill();
  }

  // a black and a paper-white field for base and Dmax
  g.fillStyle = '#000';
  g.fillRect(pad, h * 0.9, inner * 0.48, h * 0.06);
  g.fillStyle = '#fff';
  g.fillRect(pad + inner * 0.52, h * 0.9, inner * 0.48, h * 0.06);

  paperTooth(g, w, h, 0.035, 7717);
}

/* ---- 2. the light study: window, bench, glass ---- */
function drawWindow(g: CanvasRenderingContext2D, w: number, h: number) {
  const R = rnd(4831);

  // --- the wall, lit from the window at the left
  const wall = g.createLinearGradient(0, 0, w * 0.95, h);
  wall.addColorStop(0, '#8c8375');
  wall.addColorStop(0.42, '#5d564b');
  wall.addColorStop(1, '#2b2721');
  g.fillStyle = wall;
  g.fillRect(0, 0, w, h);

  // --- the window: the brightest thing in the room
  const wx = w * 0.055;
  const wy = h * 0.06;
  const ww = w * 0.34;
  const wh = h * 0.62;

  const glow = g.createRadialGradient(
    wx + ww * 0.5, wy + wh * 0.42, 10,
    wx + ww * 0.5, wy + wh * 0.42, ww * 1.9,
  );
  glow.addColorStop(0, 'rgba(255,250,238,0.95)');
  glow.addColorStop(0.35, 'rgba(232,216,188,0.45)');
  glow.addColorStop(1, 'rgba(120,108,90,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  const pane = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  pane.addColorStop(0, '#fffdf6');
  pane.addColorStop(0.6, '#f4ead6');
  pane.addColorStop(1, '#d9cdb4');
  g.fillStyle = pane;
  g.fillRect(wx, wy, ww, wh);

  // industrial glazing bars
  g.fillStyle = 'rgba(24,21,17,0.86)';
  const cols = 3;
  const rows = 5;
  const bar = Math.max(3, w * 0.0042);
  for (let i = 1; i < cols; i++) g.fillRect(wx + (ww / cols) * i - bar / 2, wy, bar, wh);
  for (let i = 1; i < rows; i++) g.fillRect(wx, wy + (wh / rows) * i - bar / 2, ww, bar);
  g.strokeStyle = 'rgba(24,21,17,0.9)';
  g.lineWidth = bar * 1.6;
  g.strokeRect(wx, wy, ww, wh);

  // --- the pool of light thrown across the wall
  const pool = g.createLinearGradient(wx, wy + wh, w * 0.78, h * 0.9);
  pool.addColorStop(0, 'rgba(255,244,222,0.42)');
  pool.addColorStop(1, 'rgba(255,244,222,0)');
  g.fillStyle = pool;
  g.beginPath();
  g.moveTo(wx + ww * 0.1, h);
  g.lineTo(wx + ww * 1.05, h * 0.52);
  g.lineTo(w * 0.86, h * 0.72);
  g.lineTo(w * 0.6, h);
  g.closePath();
  g.fill();

  // --- the bench
  const by = h * 0.72;
  const bench = g.createLinearGradient(0, by, 0, h);
  bench.addColorStop(0, '#4a3527');
  bench.addColorStop(0.12, '#37281d');
  bench.addColorStop(1, '#1d1510');
  g.fillStyle = bench;
  g.fillRect(0, by, w, h - by);
  g.fillStyle = 'rgba(255,238,208,0.16)';
  g.fillRect(0, by, w, Math.max(2, h * 0.004));

  // --- glass and metal on the bench: the specular references
  const objs: [number, number, number, string, string][] = [
    [0.5, 0.2, 0.3, '#2f3a33', '#cfe3d2'],
    [0.6, 0.15, 0.22, '#3a2a22', '#e8d3b4'],
    [0.72, 0.11, 0.26, '#22262b', '#dfe6ea'],
    [0.82, 0.13, 0.17, '#3b3126', '#f0e2c4'],
  ];
  for (const [cx, cw, ch, dark, lit] of objs) {
    const ox = w * cx;
    const ow = w * cw;
    const oh = h * ch;
    const oy = by - oh;

    // cast shadow, away from the window
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.beginPath();
    g.ellipse(ox + ow * 0.75, by + oh * 0.06, ow * 0.72, oh * 0.07, 0, 0, Math.PI * 2);
    g.fill();

    const body = g.createLinearGradient(ox - ow / 2, 0, ox + ow / 2, 0);
    body.addColorStop(0, lit);
    body.addColorStop(0.22, dark);
    body.addColorStop(0.7, '#15120e');
    body.addColorStop(0.96, dark);
    g.fillStyle = body;
    roundRect(g, ox - ow / 2, oy, ow, oh, ow * 0.14);
    g.fill();

    // the specular rim where the window sits on the glass
    g.fillStyle = 'rgba(255,252,244,0.95)';
    roundRect(g, ox - ow * 0.42, oy + oh * 0.06, ow * 0.06, oh * 0.86, ow * 0.03);
    g.fill();
    g.fillStyle = 'rgba(255,250,236,0.55)';
    roundRect(g, ox - ow * 0.3, oy + oh * 0.12, ow * 0.022, oh * 0.6, ow * 0.02);
    g.fill();

    // a small blown highlight — the halation seed
    g.fillStyle = '#fffdf7';
    g.beginPath();
    g.arc(ox - ow * 0.36, oy + oh * 0.17, Math.max(2, ow * 0.035), 0, Math.PI * 2);
    g.fill();
  }

  // --- contact sheet pinned to the wall, out of the light
  const sx = w * 0.62;
  const sy = h * 0.1;
  const sw = w * 0.3;
  const sh = h * 0.34;
  g.fillStyle = 'rgba(18,16,13,0.9)';
  g.fillRect(sx, sy, sw, sh);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const v = 0.1 + R() * 0.42;
      const cell = g.createLinearGradient(0, sy, 0, sy + sh);
      cell.addColorStop(0, `rgba(${v * 255 | 0},${v * 240 | 0},${v * 210 | 0},1)`);
      cell.addColorStop(1, `rgba(${v * 90 | 0},${v * 86 | 0},${v * 78 | 0},1)`);
      g.fillStyle = cell;
      g.fillRect(
        sx + sw * 0.03 + c * sw * 0.238,
        sy + sh * 0.05 + r * sh * 0.315,
        sw * 0.21,
        sh * 0.26,
      );
    }
  }

  // --- dust in the shaft of light
  for (let i = 0; i < 220; i++) {
    const x = wx + ww * 0.2 + R() * w * 0.5;
    const y = wy + R() * h * 0.8;
    const a = (1 - (x / w)) * 0.5 * R();
    g.fillStyle = `rgba(255,248,232,${a.toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, R() * 2.2 + 0.4, 0, Math.PI * 2);
    g.fill();
  }

  paperTooth(g, w, h, 0.022, 991);
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** a faint irregularity so the drawn specimen is not mathematically flat */
function paperTooth(
  g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number,
) {
  const R = rnd(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * 255 * amount;
    d[i] = clamp8(d[i] + n);
    d[i + 1] = clamp8(d[i + 1] + n);
    d[i + 2] = clamp8(d[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
