/* ============================================================
   A MOVING SPECIMEN, DRAWN IN THE LAB
   Every effect that needs motion — the tracker's frame
   difference, sequence drift, flicker, gate jitter, the vision
   layer — had nothing to run on unless you happened to have a
   clip to hand. So the bench now keeps a loop of its own.

   It is drawn, not filmed, and it says so. Its job is to move:
   a figure crossing a window, light sweeping, dust drifting,
   the gate never quite steady.
   ============================================================ */

export interface MotionSpecimen {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  name: string;
  note: string;
  /** advance to the frame for time t (seconds) */
  tick: (t: number) => void;
  duration: number;
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

export function makeHouseMotion(w = 1280, h = 854): MotionSpecimen {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { alpha: false })!;

  const R = rnd(9137);
  // the dust is fixed at load; it drifts rather than being re-scattered,
  // or the tracker would see a new field every frame
  const motes = Array.from({ length: 160 }, () => ({
    x: R(),
    y: R(),
    r: 0.4 + R() * 2.2,
    sp: 0.004 + R() * 0.02,
    ph: R() * Math.PI * 2,
  }));

  const tick = (t: number) => {
    // --- the wall, lit from a window off to the left
    const wall = g.createLinearGradient(0, 0, w * 0.95, h);
    wall.addColorStop(0, '#8a8174');
    wall.addColorStop(0.44, '#585149');
    wall.addColorStop(1, '#26221d');
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);

    // --- the window, with the light swinging slowly across the day
    const swing = Math.sin(t * 0.16) * 0.5 + 0.5;
    const wx = w * (0.04 + swing * 0.02);
    const wy = h * 0.05;
    const ww = w * 0.33;
    const wh = h * 0.6;

    const glow = g.createRadialGradient(
      wx + ww * 0.5, wy + wh * 0.4, 10,
      wx + ww * 0.5, wy + wh * 0.4, ww * (1.7 + swing * 0.35),
    );
    glow.addColorStop(0, 'rgba(255,251,240,0.95)');
    glow.addColorStop(0.34, 'rgba(233,217,190,0.42)');
    glow.addColorStop(1, 'rgba(120,108,90,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    const pane = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
    pane.addColorStop(0, '#fffdf7');
    pane.addColorStop(0.6, '#f3e9d6');
    pane.addColorStop(1, '#d6cab2');
    g.fillStyle = pane;
    g.fillRect(wx, wy, ww, wh);

    g.fillStyle = 'rgba(20,17,14,0.88)';
    const bar = Math.max(3, w * 0.0045);
    for (let i = 1; i < 3; i++) g.fillRect(wx + (ww / 3) * i - bar / 2, wy, bar, wh);
    for (let i = 1; i < 5; i++) g.fillRect(wx, wy + (wh / 5) * i - bar / 2, ww, bar);
    g.strokeStyle = 'rgba(20,17,14,0.9)';
    g.lineWidth = bar * 1.7;
    g.strokeRect(wx, wy, ww, wh);

    // --- the bench
    const by = h * 0.74;
    const bench = g.createLinearGradient(0, by, 0, h);
    bench.addColorStop(0, '#463225');
    bench.addColorStop(0.1, '#33251b');
    bench.addColorStop(1, '#1a130e');
    g.fillStyle = bench;
    g.fillRect(0, by, w, h - by);
    g.fillStyle = 'rgba(255,240,214,0.16)';
    g.fillRect(0, by, w, Math.max(2, h * 0.004));

    // --- a figure crossing the light, right to left and back
    const period = 11;
    const u = (t % period) / period;
    const sweep = u < 0.5 ? u * 2 : (1 - u) * 2;
    const fx = w * (1.06 - sweep * 1.18);
    const fh = h * 0.52;
    const fw = fh * 0.3;
    const fy = by - fh;

    // cast shadow, thrown away from the window and stretching with distance
    g.save();
    g.globalAlpha = 0.44;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(fx + fw * 0.9, by + h * 0.006, fw * (1.1 + sweep), h * 0.012, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // the body: lit hard on the window side
    const body = g.createLinearGradient(fx - fw * 0.5, 0, fx + fw * 0.5, 0);
    body.addColorStop(0, '#efe2c8');
    body.addColorStop(0.2, '#6d6152');
    body.addColorStop(0.62, '#191410');
    body.addColorStop(1, '#2b241c');
    g.fillStyle = body;

    // torso, tapering, with a small sway so it is never a rigid block
    const sway = Math.sin(t * 2.4) * fw * 0.05;
    g.beginPath();
    g.moveTo(fx - fw * 0.42 + sway, fy + fh * 0.18);
    g.quadraticCurveTo(fx, fy + fh * 0.1, fx + fw * 0.42 + sway, fy + fh * 0.18);
    g.lineTo(fx + fw * 0.5, by);
    g.lineTo(fx - fw * 0.5, by);
    g.closePath();
    g.fill();

    // head
    g.beginPath();
    g.ellipse(fx + sway * 1.4, fy + fh * 0.09, fw * 0.24, fh * 0.1, 0, 0, Math.PI * 2);
    g.fill();

    // the rim the window puts on the shoulder
    g.strokeStyle = 'rgba(255,250,236,0.7)';
    g.lineWidth = Math.max(1.5, fw * 0.035);
    g.beginPath();
    g.moveTo(fx - fw * 0.4 + sway, fy + fh * 0.2);
    g.lineTo(fx - fw * 0.48, by);
    g.stroke();

    // --- glass on the bench, still, so the tracker has something fixed
    for (const [cx, cw2, ch2] of [[0.62, 0.05, 0.13], [0.72, 0.038, 0.1], [0.8, 0.045, 0.16]] as const) {
      const ox = w * cx;
      const ow = w * cw2;
      const oh = h * ch2;
      const oy = by - oh;
      const gl = g.createLinearGradient(ox - ow / 2, 0, ox + ow / 2, 0);
      gl.addColorStop(0, '#d8e2da');
      gl.addColorStop(0.24, '#2c3630');
      gl.addColorStop(0.72, '#12100d');
      gl.addColorStop(1, '#39332a');
      g.fillStyle = gl;
      g.fillRect(ox - ow / 2, oy, ow, oh);
      g.fillStyle = 'rgba(255,252,244,0.95)';
      g.fillRect(ox - ow * 0.4, oy + oh * 0.06, ow * 0.07, oh * 0.86);
    }

    // --- dust drifting through the shaft
    for (const m of motes) {
      const y = (m.y + t * m.sp) % 1;
      const x = m.x + Math.sin(t * 0.5 + m.ph) * 0.01;
      const a = (1 - x) * 0.55 * (0.4 + swing * 0.6);
      if (a <= 0.01) continue;
      g.fillStyle = `rgba(255,248,232,${a.toFixed(3)})`;
      g.beginPath();
      g.arc(x * w, y * h, m.r, 0, Math.PI * 2);
      g.fill();
    }
  };

  tick(0);
  return {
    canvas,
    width: w,
    height: h,
    name: 'Passing',
    note: 'A loop the lab draws for itself. Something moves, so the effects that need motion have work to do.',
    tick,
    duration: 11,
  };
}
