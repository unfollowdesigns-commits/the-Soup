import { layoutGate, type FrameFit, type Gate, type GateLayout } from '../lab/gate';

/* ============================================================
   PAINTING THE GATE
   The engine renders the picture. This puts the film around it:
   the aperture with its slightly soft corners, the perforations,
   the edge print, and the weave that comes of pulling the stock
   down with a claw.

   All of it is drawn, none of it is a stock overlay, and every
   part of it moves frame to frame the way the stock does.
   ============================================================ */

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export interface GateFrame {
  /** which frame of the strip this is */
  index: number;
  seed: number;
  /** 0..1 — how much the stock has been run through a projector */
  wear: number;
}

/** How far the frame has wandered in the gate this time round. */
export function weaveOf(l: GateLayout, f: GateFrame) {
  const r = mulberry32(f.seed + f.index * 7919);
  // two rates: a slow drift as the loop tightens and loosens, and the
  // per-frame jump of the claw
  const slow = Math.sin(f.index * 0.11 + f.seed * 0.001) * 0.55;
  return {
    dx: (r() * 2 - 1 + slow * 0.4) * l.weaveX,
    dy: (r() * 2 - 1 + slow) * l.weaveY,
    // the gate is never quite square to the movement
    rot: (r() * 2 - 1) * l.weaveY * 0.00018,
  };
}

/** A rectangle with the corners the aperture plate actually has. */
function aperturePath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.lineTo(x + w - k, y);
  g.quadraticCurveTo(x + w, y, x + w, y + k);
  g.lineTo(x + w, y + h - k);
  g.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  g.lineTo(x + k, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - k);
  g.lineTo(x, y + k);
  g.quadraticCurveTo(x, y, x + k, y);
  g.closePath();
}

export interface PaintedGate {
  layout: GateLayout;
  /** where to draw the rendered picture, weave included */
  picture: { x: number; y: number; w: number; h: number; rot: number };
}

/**
 * Lay the ground: stock colour behind everything, and work out where
 * the picture goes this frame. Call before drawing the picture.
 */
export function gateGround(
  g: CanvasRenderingContext2D,
  gate: Gate,
  outW: number,
  outH: number,
  fit: FrameFit,
  frame: GateFrame,
): PaintedGate {
  const l = layoutGate(gate, outW, outH, fit);
  const wv = weaveOf(l, frame);

  g.save();
  g.fillStyle = '#000';
  g.fillRect(0, 0, outW, outH);

  if (fit === 'gate' && gate.edges !== 'none') {
    // clear base with the dye still in it: a warm near-black, not black
    const base = g.createLinearGradient(l.stockX, 0, l.stockX + l.stockW, 0);
    base.addColorStop(0, '#141210');
    base.addColorStop(0.5, '#191512');
    base.addColorStop(1, '#131110');
    g.fillStyle = base;
    g.fillRect(l.stockX, 0, l.stockW, outH);
  }
  g.restore();

  return {
    layout: l,
    picture: {
      x: l.x + wv.dx,
      y: l.y + wv.dy,
      w: l.w,
      h: l.h,
      rot: wv.rot,
    },
  };
}

/**
 * Everything that sits in front of the picture: the aperture mask,
 * the perforations, the edge print, the halation of the lamp round
 * the gate. Call after drawing the picture.
 */
export function gateOverlay(
  g: CanvasRenderingContext2D,
  gate: Gate,
  outW: number,
  outH: number,
  fit: FrameFit,
  frame: GateFrame,
  painted: PaintedGate,
) {
  const l = painted.layout;
  const p = painted.picture;
  const rnd = mulberry32(frame.seed * 31 + frame.index);

  /* ---- the aperture: everything outside it is masked off ---- */
  g.save();
  g.globalCompositeOperation = 'destination-in';
  aperturePath(g, p.x, p.y, p.w, p.h, l.corner);
  g.fillStyle = '#fff';
  g.fill();
  g.restore();

  /* the picture is now cut out; put the stock back behind it */
  if (fit === 'gate' && gate.edges !== 'none') {
    g.save();
    g.globalCompositeOperation = 'destination-over';
    const base = g.createLinearGradient(l.stockX, 0, l.stockX + l.stockW, 0);
    base.addColorStop(0, '#141210');
    base.addColorStop(0.5, '#191512');
    base.addColorStop(1, '#131110');
    g.fillStyle = base;
    g.fillRect(l.stockX, 0, l.stockW, outH);
    g.fillStyle = '#000';
    g.fillRect(0, 0, l.stockX, outH);
    g.fillRect(l.stockX + l.stockW, 0, outW - l.stockX - l.stockW, outH);
    g.restore();
  } else {
    g.save();
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, outW, outH);
    g.restore();
  }

  if (fit !== 'gate' || gate.edges === 'none') return;

  /* ---- perforations ---- */
  const phase = (frame.index * l.pitch * gate.perfsPerFrame) % l.pitch;
  g.save();
  for (const cx of l.cols) {
    for (let y = -l.pitch + phase * 0; y < outH + l.pitch; y += l.pitch) {
      const py = y + (p.y - l.y) + (l.h - l.pitch * gate.perfsPerFrame) / 2;
      // a perforation is light coming through: draw it, then the wear
      const r = Math.min(l.perfW, l.perfH) * 0.16;
      // a perforation is a hole: the lamp comes straight through it
      aperturePath(g, cx - l.perfW / 2, py, l.perfW, l.perfH, r);
      const hole = g.createLinearGradient(cx - l.perfW / 2, 0, cx + l.perfW / 2, 0);
      hole.addColorStop(0, '#cdc4b0');
      hole.addColorStop(0.42, '#efe9dc');
      hole.addColorStop(1, '#bdb4a2');
      g.fillStyle = hole;
      g.fill();
      // the base is thicker at the punched edge and holds a little dye
      g.strokeStyle = 'rgba(20, 16, 12, 0.55)';
      g.lineWidth = Math.max(1, l.perfW * 0.035);
      g.stroke();

      // torn and worn sprocket holes on stock that has been run
      if (frame.wear > 0.02 && rnd() < frame.wear * 0.5) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(210, 196, 168, ${0.08 + frame.wear * 0.18})`;
        const tw = l.perfW * (0.2 + rnd() * 0.5);
        g.fillRect(cx - l.perfW / 2 - tw * 0.3, py + l.perfH * rnd(), tw, Math.max(1, l.perfH * 0.09));
        g.restore();
      }
    }
  }
  g.restore();

  /* ---- edge print, latent-image style: dim, uneven, upside of the strip ---- */
  if (gate.edgePrint) {
    g.save();
    const size = l.legendSize;
    g.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
    g.textBaseline = 'middle';
    // latent edge print: exposed at the factory, so it is thin and warm
    g.fillStyle = `rgba(222, 202, 160, ${0.26 + frame.wear * 0.14})`;
    g.translate(l.legendX, outH * 0.5);
    g.rotate(-Math.PI / 2);
    const legend = `${gate.edgePrint} · ${String(frame.index).padStart(5, '0')}`;
    const wtxt = g.measureText(legend).width;
    g.fillText(legend, -wtxt / 2, 0);
    g.restore();
  }

  /* ---- the lamp: light spilling round the aperture edges ---- */
  g.save();
  g.globalCompositeOperation = 'lighter';
  const spill = g.createRadialGradient(
    p.x + p.w / 2,
    p.y + p.h / 2,
    Math.min(p.w, p.h) * 0.42,
    p.x + p.w / 2,
    p.y + p.h / 2,
    Math.max(p.w, p.h) * 0.78,
  );
  spill.addColorStop(0, 'rgba(255, 236, 200, 0)');
  spill.addColorStop(1, `rgba(255, 232, 190, ${0.018 + frame.wear * 0.03})`);
  g.fillStyle = spill;
  g.fillRect(l.stockX, 0, l.stockW, outH);
  g.restore();
}
