import { useEffect, useRef } from 'react';
import { fitScale, type ViewState } from '../engine/renderer';
import { Tracker, type TraceResult } from '../lab/tracker';
import { traceCount } from '../lab/recipe';
import type { PhotoRecipe, Specimen, TraceColour } from '../lab/types';

/* ============================================================
   TRACE OVERLAY
   The vector layer. Drawn on a 2D canvas over the specimen so it
   stays crisp at any zoom and costs nothing when it is off.

   Everything it prints — box ids, energy, motion, age, centroid —
   is measured by the tracker. Nothing is invented to look
   technical.
   ============================================================ */

const COLOURS: Record<Exclude<TraceColour, 'source'>, string> = {
  paper: '#f4efe4',
  amber: '#d99a3f',
  ice: '#9fd4e8',
  ember: '#e2622c',
};

export function TraceOverlay({
  recipe,
  specimen,
  view,
  size,
  onResult,
}: {
  recipe: PhotoRecipe;
  specimen: Specimen | null;
  view: ViewState;
  size: { w: number; h: number };
  onResult: (r: TraceResult | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const rafRef = useRef(0);
  const sampleRef = useRef<HTMLCanvasElement | null>(null);

  const t = recipe.trace;
  const q = recipe.sequence;
  const stamping = q.enabled && q.stamp;
  const active = t.enabled || stamping;

  useEffect(() => {
    trackerRef.current?.reset();
    TRAILS.clear();
  }, [specimen]);

  useEffect(() => {
    if (!active || !specimen || !size.w) {
      onResult(null);
      const c = canvasRef.current;
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }
    if (!trackerRef.current) trackerRef.current = new Tracker();
    const tracker = trackerRef.current;
    const moving = specimen.kind === 'moving';

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

      const src = specimen.bitmap as CanvasImageSource;
      let result: TraceResult | null = null;
      if (t.enabled && t.mode !== 'type') {
        try {
          result = tracker.analyse(src, specimen.width, specimen.height, {
            count: traceCount(recipe),
            sensitivity: t.sensitivity,
            motionWeight: t.motion,
            mode: t.track,
          });
        } catch {
          result = null;
        }
      }
      onResult(result);

      // where the frame sits on the table
      const fit = fitScale(size.w, size.h, specimen.width, specimen.height);
      const s = fit * view.zoom;
      const dw = specimen.width * s;
      const dh = specimen.height * s;
      const ox = (size.w - dw) / 2 - view.panX * dw;
      const oy = (size.h - dh) / 2 + view.panY * dh;

      const stroke = t.colour === 'source' ? COLOURS.paper : COLOURS[t.colour];
      g.save();
      g.beginPath();
      g.rect(ox, oy, dw, dh);
      g.clip();

      if (t.enabled && t.mode === 'type') {
        drawType(g, specimen, sampleRef, t, ox, oy, dw, dh, stroke);
      } else if (result) {
        drawVectors(g, result, t, ox, oy, dw, dh, stroke, moving);
      }
      g.restore();

      if (stamping) drawSheetMarks(g, q, specimen, ox, oy, dw, dh);

      // what the tracker is actually doing, printed where it can be read
      if (t.enabled && t.mode !== 'type' && result) {
        g.save();
        g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
        g.textBaseline = 'top';
        // inside the picture, not in the room around it
        const rx = ox + 8;
        const ry = oy + 8;
        g.fillStyle = 'rgba(6,6,6,0.8)';
        g.fillRect(rx, ry, 186, 46);
        g.fillStyle = result.mode === 'blob' ? '#c6f031' : '#a8a49b';
        g.fillText(
          `${result.mode.toUpperCase()}  ${result.boxes.length} tracked`,
          rx + 6, ry + 6,
        );
        g.fillStyle = '#a8a49b';
        g.fillText(
          result.motionAvailable
            ? `moving ${(result.coverage * 100).toFixed(1)}%  ${result.ms.toFixed(1)}ms`
            : 'first frame — no motion yet',
          rx + 6, ry + 20,
        );
        g.fillText(`${result.gridW}x${result.gridH} grid`, rx + 6, ry + 32);
        g.restore();
      }
    };

    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    // a still specimen only needs one pass; a moving one needs every frame
    if (moving) loop();
    else draw();

    return () => cancelAnimationFrame(rafRef.current);
  }, [t, q, stamping, active, recipe, specimen, view, size, onResult]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="trace" aria-hidden="true" />;
}

/* ============================================================
   THE VECTOR LAYER
   Everything printed here is measured by the tracker — centroid,
   energy, motion, age, velocity, and the distance and bearing
   between one region and another. Nothing is invented to look
   technical, and nothing is decoration for its own sake.

   What was here before was a rectangle and a dot. This draws the
   thing a tracking overlay actually is: a graph.
   ============================================================ */

/** what each track looked like on the last few frames */
const TRAILS = new Map<number, { x: number; y: number }[]>();
const TRAIL_MAX = 22;

function pushTrail(id: number, x: number, y: number) {
  let t = TRAILS.get(id);
  if (!t) { t = []; TRAILS.set(id, t); }
  t.push({ x, y });
  if (t.length > TRAIL_MAX) t.shift();
  return t;
}

function corners(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number) {
  const c = Math.min(k, w * 0.45, h * 0.45);
  g.beginPath();
  g.moveTo(x, y + c); g.lineTo(x, y); g.lineTo(x + c, y);
  g.moveTo(x + w - c, y); g.lineTo(x + w, y); g.lineTo(x + w, y + c);
  g.moveTo(x + w, y + h - c); g.lineTo(x + w, y + h); g.lineTo(x + w - c, y + h);
  g.moveTo(x + c, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - c);
  g.stroke();
}

function drawVectors(
  g: CanvasRenderingContext2D,
  result: TraceResult,
  t: PhotoRecipe['trace'],
  ox: number,
  oy: number,
  dw: number,
  dh: number,
  stroke: string,
  moving: boolean,
) {
  const boxes = result.boxes;
  if (!boxes.length) return;

  const lw = 0.6 + t.weight * 1.8;
  const fs = Math.max(7, 7.5 + t.weight * 3.5);
  g.lineWidth = lw;
  g.strokeStyle = stroke;
  g.fillStyle = stroke;
  g.font = `${fs}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'top';
  g.lineJoin = 'round';

  // the overlay never sits perfectly still on a moving specimen
  const j = () => (moving ? (Math.random() - 0.5) * t.jitter * 2.2 : 0);

  /* centres, in screen space, once */
  const P = boxes.map((b) => ({
    b,
    x: ox + (b.x + b.w / 2) * dw,
    y: oy + (b.y + b.h / 2) * dh,
    rx: ox + b.x * dw,
    ry: oy + b.y * dh,
    rw: b.w * dw,
    rh: b.h * dh,
  }));

  /* the busiest region: everything else is drawn in relation to it */
  let hub = P[0];
  for (const p of P) if (p.b.energy * (1 + p.b.motion * 2) > hub.b.energy * (1 + hub.b.motion * 2)) hub = p;

  /* ---- 1. the graph ----
     Every pair inside reach, drawn at an opacity that falls off with
     distance, so the structure of the field is legible rather than a
     wall of lines. */
  if (t.links > 0 || t.mode === 'links' || t.mode === 'swarm') {
    const reach = (0.14 + (t.mode === 'links' ? 0.55 : t.links * 0.5)) * Math.max(dw, dh);
    const near: { a: typeof P[0]; b: typeof P[0]; d: number }[] = [];
    for (let i = 0; i < P.length; i++) {
      for (let k = i + 1; k < P.length; k++) {
        const d = Math.hypot(P[i].x - P[k].x, P[i].y - P[k].y);
        if (d < reach) near.push({ a: P[i], b: P[k], d });
      }
    }
    near.sort((m, n) => m.d - n.d);
    for (const e of near.slice(0, 260)) {
      const fall = 1 - e.d / reach;
      g.globalAlpha = 0.1 + fall * fall * 0.55;
      g.lineWidth = lw * (0.4 + fall * 0.8);
      g.beginPath();
      g.moveTo(e.a.x, e.a.y);
      g.lineTo(e.b.x, e.b.y);
      g.stroke();
    }

    /* the spine: every region joined back to the busiest one, heavier */
    g.globalAlpha = 0.7;
    g.lineWidth = lw * 1.15;
    for (const p of P) {
      if (p === hub) continue;
      const d = Math.hypot(p.x - hub.x, p.y - hub.y);
      if (d > reach * 1.5) continue;
      g.beginPath();
      g.moveTo(hub.x, hub.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      // the measurement the line stands for
      if (t.labels && d > 40) {
        const mx = (hub.x + p.x) / 2;
        const my = (hub.y + p.y) / 2;
        const ang = (Math.atan2(p.y - hub.y, p.x - hub.x) * 180) / Math.PI;
        g.globalAlpha = 0.5;
        g.font = `${fs * 0.82}px "IBM Plex Mono", ui-monospace, monospace`;
        g.fillText(`${Math.round(d)}px ${ang.toFixed(0)}°`, mx + 3, my + 3);
        g.font = `${fs}px "IBM Plex Mono", ui-monospace, monospace`;
        g.globalAlpha = 0.7;
      }
    }
    g.globalAlpha = 1;
    g.lineWidth = lw;
  }

  /* ---- 2. the envelope ----
     A hull round everything being tracked, so the field has an edge. */
  if (t.mode === 'links' || t.mode === 'swarm') {
    const pts = P.map((p) => [p.x, p.y] as [number, number]);
    const hull = convexHull(pts);
    if (hull.length > 2) {
      g.globalAlpha = 0.34;
      g.setLineDash([5, 5]);
      g.beginPath();
      g.moveTo(hull[0][0], hull[0][1]);
      for (const h of hull.slice(1)) g.lineTo(h[0], h[1]);
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  /* ---- 3. each region ---- */
  for (const p of P) {
    const b = p.b;
    const dx = j();
    const dy = j();
    const cx = p.x + dx;
    const cy = p.y + dy;

    /* the path it has taken, when it has taken one */
    if (moving && t.motion > 0) {
      const trail = pushTrail(b.id, p.x, p.y);
      if (trail.length > 2) {
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) g.lineTo(trail[i].x, trail[i].y);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    if (t.mode === 'points' || t.mode === 'links') {
      const s = 3 + b.energy * 6;
      g.beginPath();
      g.moveTo(cx - s, cy); g.lineTo(cx + s, cy);
      g.moveTo(cx, cy - s); g.lineTo(cx, cy + s);
      g.stroke();
      // a ring whose size is the measured energy
      g.globalAlpha = 0.55;
      g.beginPath();
      g.arc(cx, cy, s * 0.72, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    } else {
      // corner brackets read as a lock, a full rectangle reads as a table
      corners(g, p.rx + dx, p.ry + dy, p.rw, p.rh, Math.min(14, p.rw * 0.28));
      g.fillRect(cx - 1, cy - 1, 2, 2);

      // a bar down one edge, length = how long this track has survived
      const held = Math.min(1, b.age / 40);
      g.globalAlpha = 0.8;
      g.fillRect(p.rx + dx - lw - 2, p.ry + dy, lw + 1, p.rh * held);
      g.globalAlpha = 1;

      if (t.mode === 'swarm') {
        const n = 1 + Math.round(b.energy * 5);
        for (let i = 1; i <= n; i++) {
          const k = i / (n + 1);
          const iw = p.rw * (1 - k * 0.82);
          const ih = p.rh * (1 - k * 0.82);
          g.globalAlpha = 0.24 + 0.46 * (1 - k);
          g.strokeRect(
            p.rx + dx + (p.rw - iw) * ((i * 0.37) % 1),
            p.ry + dy + (p.rh - ih) * ((i * 0.61) % 1),
            iw, ih,
          );
        }
        g.globalAlpha = 1;
      }
    }

    /* where it is going, when it is going anywhere */
    if (moving && (Math.abs(b.vx) > 1e-4 || Math.abs(b.vy) > 1e-4)) {
      const k = 26;
      const ex = cx + b.vx * dw * k;
      const ey = cy + b.vy * dh * k;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.moveTo(cx, cy); g.lineTo(ex, ey);
      g.stroke();
      const a = Math.atan2(ey - cy, ex - cx);
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex - Math.cos(a - 0.4) * 6, ey - Math.sin(a - 0.4) * 6);
      g.lineTo(ex - Math.cos(a + 0.4) * 6, ey - Math.sin(a + 0.4) * 6);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }

    if (t.labels) {
      const label =
        t.mode === 'points' || t.mode === 'links'
          ? `${b.id}`
          : `${String(b.id).padStart(3, '0')} ${(b.energy * 1000).toFixed(0)}`;
      g.globalAlpha = 0.9;
      g.fillText(label, p.rx + dx + 2, p.ry + dy - fs - 3);
      if (t.mode === 'boxes' && b.motion > 0.02) {
        g.globalAlpha = 0.62;
        g.fillText(`m${(b.motion * 100).toFixed(0)}`, p.rx + dx + 2, p.ry + dy + p.rh + 2);
      }
      g.globalAlpha = 1;
    }
  }

  /* ---- 4. the lock on the busiest region ----
     A crosshair that runs to the frame edge with the measurement
     called out where it meets it. This is the line that makes the
     layer read as instrumentation instead of ornament. */
  if (t.mode !== 'type') {
    g.globalAlpha = 0.42;
    g.setLineDash([2, 6]);
    g.beginPath();
    g.moveTo(ox, hub.y); g.lineTo(ox + dw, hub.y);
    g.moveTo(hub.x, oy); g.lineTo(hub.x, oy + dh);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;

    // ticks up the edges where the crosshair leaves the frame
    g.beginPath();
    g.moveTo(ox, hub.y); g.lineTo(ox + 9, hub.y);
    g.moveTo(ox + dw - 9, hub.y); g.lineTo(ox + dw, hub.y);
    g.moveTo(hub.x, oy); g.lineTo(hub.x, oy + 9);
    g.moveTo(hub.x, oy + dh - 9); g.lineTo(hub.x, oy + dh);
    g.stroke();

    if (t.labels) {
      const nx = ((hub.x - ox) / dw).toFixed(3);
      const ny = ((hub.y - oy) / dh).toFixed(3);
      g.globalAlpha = 0.8;
      g.font = `${fs * 0.9}px "IBM Plex Mono", ui-monospace, monospace`;
      g.fillText(`${nx}`, hub.x + 4, oy + 3);
      g.fillText(`${ny}`, ox + 4, hub.y + 3);
      g.globalAlpha = 1;
    }
  }
}

/** Andrew's monotone chain — the edge of the field being tracked. */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/* ---- edge markings on a contact sheet -------------------------
   Frame numbers and a date run along the bottom of each cell, the
   way a lab prints them down the edge of a proof sheet. ---------- */
function drawSheetMarks(
  g: CanvasRenderingContext2D,
  q: PhotoRecipe['sequence'],
  specimen: Specimen,
  ox: number,
  oy: number,
  dw: number,
  dh: number,
) {
  const cw = dw / q.cols;
  const chh = dh / q.rows;
  const fs = Math.max(6, Math.min(11, chh * 0.07));
  if (fs < 6.5) return;
  const stamp = new Date(specimen.importedAt);
  const yy = String(stamp.getFullYear());
  const mm = String(stamp.getMonth() + 1).padStart(2, '0');
  g.save();
  g.font = `${fs}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(244,239,228,0.62)';
  for (let r = 0; r < q.rows; r++) {
    for (let c = 0; c < q.cols; c++) {
      const n = r * q.cols + c + 1;
      const x = ox + c * cw;
      const y = oy + r * chh;
      const pad = fs * 0.6;
      g.fillText(`${String(n).padStart(2, '0')} ${mm}${yy.slice(2)}`, x + pad, y + chh - pad);
      g.globalAlpha = 0.4;
      g.fillText(`${yy}`, x + cw - fs * 2.6, y + fs * 1.5);
      g.globalAlpha = 1;
    }
  }
  g.restore();
}

/* ---- the frame re-set in characters --------------------------- */
function drawType(
  g: CanvasRenderingContext2D,
  specimen: Specimen,
  sampleRef: React.MutableRefObject<HTMLCanvasElement | null>,
  t: PhotoRecipe['trace'],
  ox: number,
  oy: number,
  dw: number,
  dh: number,
  stroke: string,
) {
  const ramp = t.glyphs.length > 1 ? t.glyphs : ' .:-=+*#%@';
  const cell = 4 + (1 - t.cell) * 16;
  const cols = Math.max(4, Math.floor(dw / cell));
  const rows = Math.max(4, Math.floor(dh / (cell * 1.62)));

  let sample = sampleRef.current;
  if (!sample) {
    sample = document.createElement('canvas');
    sampleRef.current = sample;
  }
  sample.width = cols;
  sample.height = rows;
  const sg = sample.getContext('2d', { willReadFrequently: true })!;
  try {
    sg.drawImage(specimen.bitmap as CanvasImageSource, 0, 0, cols, rows);
  } catch {
    return;
  }
  const data = sg.getImageData(0, 0, cols, rows).data;

  const cw = dw / cols;
  const ch = dh / rows;
  g.font = `${Math.max(6, cell * 1.02)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'top';
  g.textAlign = 'left';

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const l = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      const idx = Math.min(ramp.length - 1, Math.floor(l * ramp.length));
      const ch0 = ramp[idx];
      if (ch0 === ' ') continue;
      g.fillStyle =
        t.colour === 'source'
          ? `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`
          : stroke;
      g.globalAlpha = 0.35 + l * 0.65;
      g.fillText(ch0, ox + x * cw, oy + y * ch);
    }
  }
  g.globalAlpha = 1;
}
