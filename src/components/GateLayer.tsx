import { useEffect, useRef } from 'react';
import { fitScale, type ViewState } from '../engine/renderer';
import { getGate, layoutGate } from '../lab/gate';
import type { GateFormat, PhotoRecipe, Specimen } from '../lab/types';

/* ============================================================
   THE GATE, LIVE
   The film round the picture while you are working on it, not
   only when you export. The perforations, the frame line, the
   edge print, the weave — and the two things that only happen in
   a projector: the countdown before the picture starts, and what
   the lamp does to a frame that has stopped moving.

   Drawn on a 2D canvas over the specimen, so it stays crisp at
   any zoom and costs nothing when it is off. The same numbers
   that lab/gate.ts hands the exporter are used here, so what you
   see on the bench is what comes out of the file.
   ============================================================ */

const FORMAT_TO_GATE: Record<GateFormat, string> = {
  r8: 'r8', s8: 's8', m16: 'm16', s16: 's16', m35: 'm35',
};

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function GateLayer({
  recipe,
  specimen,
  view,
  size,
}: {
  recipe: PhotoRecipe;
  specimen: Specimen | null;
  view: ViewState;
  size: { w: number; h: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);

  const gt = recipe.gate;
  const active = gt.show || gt.leader || gt.burn > 0;

  useEffect(() => {
    if (!active || !specimen || !size.w) {
      const c = canvasRef.current;
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);

      // where the photograph sits on the table
      const fit = fitScale(size.w, size.h, specimen.width, specimen.height);
      const s = fit * view.zoom;
      const dw = specimen.width * s;
      const dh = specimen.height * s;
      const ox = (size.w - dw) / 2 - view.panX * dw;
      const oy = (size.h - dh) / 2 + view.panY * dh;

      const i = frameRef.current++;
      if (gt.show) drawStock(g, gt, ox, oy, dw, dh, i);
      if (gt.leader) drawLeader(g, gt, ox, oy, dw, dh, i);
      if (gt.burn > 0) drawBurnThrough(g, gt, ox, oy, dw, dh);
    };

    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    // anything with weave, a countdown or a lamp in it has to run
    const moves = gt.weave > 0 || gt.leader || gt.burn > 0 || specimen.kind === 'moving';
    if (moves) loop();
    else draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [gt, active, specimen, view, size]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="gatelayer" aria-hidden="true" />;
}

/* ------------------------------------------------------------
   THE STOCK
   The picture is already on screen. What this adds is everything
   around and over it: the frame line top and bottom, the
   perforated gutter down the side, the edge print, and the weave
   that comes of pulling film down with a claw.
   ------------------------------------------------------------ */
function drawStock(
  g: CanvasRenderingContext2D,
  gt: PhotoRecipe['gate'],
  ox: number,
  oy: number,
  dw: number,
  dh: number,
  frame: number,
) {
  const gate = getGate(FORMAT_TO_GATE[gt.format] as never);
  // lay the strip out at the size the picture is being shown
  const l = layoutGate(gate, dw, dh, 'gate');
  const r = mulberry32(gt.burnSeed + frame * 7919);
  const slow = Math.sin(frame * 0.11) * 0.55;
  const wx = (r() * 2 - 1 + slow * 0.4) * l.weaveX * gt.weave * 3;
  const wy = (r() * 2 - 1 + slow) * l.weaveY * gt.weave * 3;

  g.save();
  g.translate(ox + wx, oy + wy);

  /* the gutter: black stock either side of the picture, with the
     perforations punched through it */
  const gutterL = l.x;
  const gutterR = dw - (l.x + l.w);
  g.fillStyle = 'rgba(9, 8, 7, 0.97)';
  if (gutterL > 0.5) g.fillRect(-wx, -wy, gutterL, dh);
  if (gutterR > 0.5) g.fillRect(l.x + l.w, -wy, gutterR + Math.abs(wx) + 2, dh);

  /* the frame line, top and bottom */
  const fl = (dh - l.h) / 2 * gt.frameline;
  if (fl > 0.5) {
    g.fillStyle = 'rgba(9, 8, 7, 0.97)';
    g.fillRect(l.x, -wy, l.w, fl);
    g.fillRect(l.x, dh - fl, l.w, fl + Math.abs(wy) + 2);
    // the next frame, showing at the edge of this one
    g.fillStyle = 'rgba(255, 244, 224, 0.05)';
    g.fillRect(l.x, fl - 1.5, l.w, 1.5);
    g.fillRect(l.x, dh - fl, l.w, 1.5);
  }

  /* perforations — holes, so the lamp comes through them */
  if (l.pitch > 2) {
    const phase = (frame * 0.0) % l.pitch;
    for (const cx of l.cols) {
      for (let y = -l.pitch + phase; y < dh + l.pitch; y += l.pitch) {
        const rr = Math.min(l.perfW, l.perfH) * 0.16;
        roundRect(g, cx - l.perfW / 2, y, l.perfW, l.perfH, rr);
        const hole = g.createLinearGradient(cx - l.perfW / 2, 0, cx + l.perfW / 2, 0);
        hole.addColorStop(0, '#cdc4b0');
        hole.addColorStop(0.42, '#efe9dc');
        hole.addColorStop(1, '#bdb4a2');
        g.fillStyle = hole;
        g.fill();
        g.strokeStyle = 'rgba(20, 16, 12, 0.55)';
        g.lineWidth = Math.max(1, l.perfW * 0.035);
        g.stroke();

        if (gt.wear > 0.02 && r() < gt.wear * 0.5) {
          g.fillStyle = `rgba(210, 196, 168, ${0.08 + gt.wear * 0.18})`;
          const tw = l.perfW * (0.2 + r() * 0.5);
          g.fillRect(cx - l.perfW / 2 - tw * 0.3, y + l.perfH * r(), tw, Math.max(1, l.perfH * 0.09));
        }
      }
    }
  }

  /* the edge print, exposed at the factory */
  if (gate.edgePrint && l.legendSize > 5) {
    g.save();
    g.font = `600 ${l.legendSize}px "IBM Plex Mono", ui-monospace, monospace`;
    g.textBaseline = 'middle';
    g.fillStyle = `rgba(222, 202, 160, ${0.26 + gt.wear * 0.14})`;
    g.translate(l.legendX, dh * 0.5);
    g.rotate(-Math.PI / 2);
    const legend = `${gate.edgePrint} · ${String(frame).padStart(5, '0')}`;
    g.fillText(legend, -g.measureText(legend).width / 2, 0);
    g.restore();
  }

  /* the lamp, spilling round the aperture */
  if (gt.lamp > 0) {
    const spill = g.createRadialGradient(
      l.x + l.w / 2, dh / 2, Math.min(l.w, l.h) * 0.42,
      l.x + l.w / 2, dh / 2, Math.max(l.w, l.h) * 0.8,
    );
    spill.addColorStop(0, 'rgba(255, 236, 200, 0)');
    spill.addColorStop(1, `rgba(255, 232, 190, ${gt.lamp * 0.09})`);
    g.fillStyle = spill;
    g.fillRect(0, 0, dw, dh);
  }

  g.restore();
}

/* ------------------------------------------------------------
   THE LEADER
   The countdown before the picture starts: a hand sweeping once
   a second round a numbered circle, on a field that has been
   through a projector more than the film has.
   ------------------------------------------------------------ */
function drawLeader(
  g: CanvasRenderingContext2D,
  gt: PhotoRecipe['gate'],
  ox: number,
  oy: number,
  dw: number,
  dh: number,
  frame: number,
) {
  const at = gt.leaderAt;
  const from = Math.max(2, Math.round(gt.leaderFrom));
  const step = at * from;               /* how far through the count */
  const n = Math.max(1, Math.ceil(from - step));
  const within = step - Math.floor(step); /* 0..1 inside this second */
  const cx = ox + dw / 2;
  const cy = oy + dh / 2;
  const R = Math.min(dw, dh) * 0.42;

  g.save();
  g.beginPath();
  g.rect(ox, oy, dw, dh);
  g.clip();

  /* the field: leader stock is grey, dirty, and lit unevenly */
  g.fillStyle = '#3b3a36';
  g.fillRect(ox, oy, dw, dh);
  const lamp = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(dw, dh) * 0.7);
  lamp.addColorStop(0, 'rgba(255, 248, 230, 0.20)');
  lamp.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  g.fillStyle = lamp;
  g.fillRect(ox, oy, dw, dh);

  const r = mulberry32(gt.burnSeed + frame);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,250,238,${0.04 + r() * 0.1})`;
    g.fillRect(ox + r() * dw, oy + r() * dh, 1 + r() * 2, 1 + r() * 9);
  }

  g.strokeStyle = 'rgba(246, 242, 232, 0.9)';
  g.lineWidth = Math.max(1.4, R * 0.012);

  /* the rings */
  for (const k of [1, 0.72, 0.2]) {
    g.beginPath();
    g.arc(cx, cy, R * k, 0, Math.PI * 2);
    g.stroke();
  }

  /* the cross, full width and height */
  g.beginPath();
  g.moveTo(ox, cy); g.lineTo(ox + dw, cy);
  g.moveTo(cx, oy); g.lineTo(cx, oy + dh);
  g.stroke();

  /* the sweeping hand — one turn a second, and it wipes the circle */
  const a = -Math.PI / 2 + within * Math.PI * 2;
  g.save();
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, R, -Math.PI / 2, a);
  g.closePath();
  g.fillStyle = 'rgba(10, 10, 9, 0.42)';
  g.fill();
  g.restore();

  g.lineWidth = Math.max(2, R * 0.02);
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  g.stroke();

  /* the number */
  g.fillStyle = 'rgba(248, 245, 236, 0.96)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${R * 0.86}px "Archivo", "Helvetica Neue", Arial, sans-serif`;
  g.fillText(String(n), cx, cy + R * 0.02);

  /* what a leader actually says */
  g.font = `600 ${Math.max(8, R * 0.075)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillStyle = 'rgba(246, 242, 232, 0.75)';
  g.fillText('PICTURE  START', cx, oy + dh * 0.12);
  g.fillText('SOUP  ·  HEAD  ·  SOUND', cx, oy + dh * 0.88);

  /* the punch, on the last frame of the count */
  if (n <= 2 && within > 0.86) {
    g.beginPath();
    g.arc(cx, cy, R * 0.14, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 253, 246, 0.95)';
    g.fill();
  }

  g.restore();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}

/* ------------------------------------------------------------
   BURNING THROUGH
   The frame has stopped in front of the lamp. The emulsion goes
   first — a clear patch that spreads with a torn edge — then the
   base, and what is left is a hole with an ember round it.

   The shape is a domain-warped field rather than a circle, so it
   tears the way melting plastic tears.
   ------------------------------------------------------------ */
function drawBurnThrough(
  g: CanvasRenderingContext2D,
  gt: PhotoRecipe['gate'],
  ox: number,
  oy: number,
  dw: number,
  dh: number,
) {
  const p = Math.min(1, gt.burn);
  const cx = ox + gt.burnX * dw;
  const cy = oy + gt.burnY * dh;
  const maxR = Math.hypot(dw, dh) * 0.72;
  const R = maxR * Math.pow(p, 0.78);
  if (R < 1) return;

  const r = mulberry32(gt.burnSeed);
  const lobes = 13;
  const wob: number[] = [];
  for (let i = 0; i < lobes; i++) wob.push(0.72 + r() * 0.6);

  const edge = (a: number) => {
    const f = ((a / (Math.PI * 2)) % 1 + 1) % 1 * lobes;
    const i = Math.floor(f);
    const k = f - i;
    const s = k * k * (3 - 2 * k);
    return wob[i % lobes] * (1 - s) + wob[(i + 1) % lobes] * s;
  };

  const path = (scale: number) => {
    g.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const rr = R * scale * edge(a);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.94;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
  };

  g.save();
  g.beginPath();
  g.rect(ox, oy, dw, dh);
  g.clip();

  /* the emulsion bleaching out ahead of the burn */
  const wash = g.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.9);
  wash.addColorStop(0, 'rgba(255, 246, 226, 0.85)');
  wash.addColorStop(0.35, 'rgba(255, 226, 172, 0.34)');
  wash.addColorStop(1, 'rgba(255, 200, 130, 0)');
  g.fillStyle = wash;
  g.fillRect(ox, oy, dw, dh);

  /* the charred ring the heat leaves behind */
  path(1.34);
  g.fillStyle = 'rgba(48, 25, 10, 0.55)';
  g.fill();

  /* the ember: where it is going now */
  path(1.12);
  const ember = g.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.2);
  ember.addColorStop(0, 'rgba(255, 236, 150, 0.95)');
  ember.addColorStop(0.4, 'rgba(255, 118, 24, 0.9)');
  ember.addColorStop(1, 'rgba(120, 30, 4, 0)');
  g.fillStyle = ember;
  g.fill();

  /* the hole. Behind a burnt-through frame there is only the lamp. */
  path(1);
  g.fillStyle = p > 0.97 ? '#fffdf6' : '#0a0908';
  g.fill();
  if (p > 0.5) {
    // the lamp coming through what is left of the gate
    path(1);
    const lamp = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    lamp.addColorStop(0, `rgba(255, 252, 240, ${(p - 0.5) * 1.9})`);
    lamp.addColorStop(1, 'rgba(255, 240, 210, 0)');
    g.fillStyle = lamp;
    g.fill();
  }

  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number) {
  const c = Math.min(k, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w - c, y);
  g.quadraticCurveTo(x + w, y, x + w, y + c);
  g.lineTo(x + w, y + h - c);
  g.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  g.lineTo(x + c, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - c);
  g.lineTo(x, y + c);
  g.quadraticCurveTo(x, y, x + c, y);
  g.closePath();
}
