import { useEffect, useRef } from 'react';
import { fitScale, type ViewState } from '../engine/renderer';
import { Tracker, type TraceBox, type TraceResult } from '../lab/tracker';
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

/* ---- boxes, swarms, points, links ---------------------------- */
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
  const lw = 0.5 + t.weight * 1.6;
  g.lineWidth = lw;
  g.strokeStyle = stroke;
  g.fillStyle = stroke;
  g.font = `${Math.max(7, 8 + t.weight * 3)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'top';

  const px = (b: TraceBox) => ({
    x: ox + b.x * dw,
    y: oy + b.y * dh,
    w: b.w * dw,
    h: b.h * dh,
  });

  // the overlay never sits perfectly still on a moving specimen
  const j = () => (moving ? (Math.random() - 0.5) * t.jitter * 2.2 : 0);

  if (t.links > 0 || t.mode === 'links') {
    const reach = 0.12 + (t.mode === 'links' ? 0.5 : t.links * 0.4);
    g.globalAlpha = 0.42;
    g.beginPath();
    for (let i = 0; i < result.boxes.length; i++) {
      const a = result.boxes[i];
      for (let k = i + 1; k < result.boxes.length; k++) {
        const b = result.boxes[k];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > reach) continue;
        g.moveTo(ox + (a.x + a.w / 2) * dw, oy + (a.y + a.h / 2) * dh);
        g.lineTo(ox + (b.x + b.w / 2) * dw, oy + (b.y + b.h / 2) * dh);
      }
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  for (const b of result.boxes) {
    const r = px(b);
    const dx = j();
    const dy = j();

    if (t.mode === 'points' || t.mode === 'links') {
      const cx = r.x + r.w / 2 + dx;
      const cy = r.y + r.h / 2 + dy;
      const s = 2 + b.energy * 4;
      g.beginPath();
      g.moveTo(cx - s, cy);
      g.lineTo(cx + s, cy);
      g.moveTo(cx, cy - s);
      g.lineTo(cx, cy + s);
      g.stroke();
    } else {
      g.strokeRect(r.x + dx, r.y + dy, r.w, r.h);
      // a mark that reads as a measured centroid, not a decoration
      g.fillRect(r.x + r.w / 2 + dx - 1, r.y + r.h / 2 + dy - 1, 2, 2);

      if (t.mode === 'swarm') {
        // subdivide by measured energy: busier regions carry more nesting
        const n = 1 + Math.round(b.energy * 5);
        for (let i = 1; i <= n; i++) {
          const k = i / (n + 1);
          const iw = r.w * (1 - k * 0.82);
          const ih = r.h * (1 - k * 0.82);
          g.globalAlpha = 0.28 + 0.5 * (1 - k);
          g.strokeRect(
            r.x + dx + (r.w - iw) * ((i * 0.37) % 1),
            r.y + dy + (r.h - ih) * ((i * 0.61) % 1),
            iw,
            ih,
          );
        }
        g.globalAlpha = 1;
      }
    }

    if (t.labels) {
      const label =
        t.mode === 'points' || t.mode === 'links'
          ? `${b.id}`
          : `${String(b.id).padStart(3, '0')} ${(b.energy * 1000).toFixed(0)}`;
      g.globalAlpha = 0.85;
      g.fillText(label, r.x + dx + 2, r.y + dy - 11);
      if (t.mode === 'boxes' && b.motion > 0.02) {
        g.globalAlpha = 0.6;
        g.fillText(`m${(b.motion * 100).toFixed(0)}`, r.x + dx + 2, r.y + dy + r.h + 2);
      }
      g.globalAlpha = 1;
    }
  }
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
