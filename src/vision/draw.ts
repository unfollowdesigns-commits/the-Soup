import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** the package declares Connection internally but does not export it */
type Connection = { start: number; end: number };
import { CONNECTORS, type FaceRead, type HandRead, type VisionRead } from './vision';

/* ============================================================
   THE VECTOR LAYER
   Everything drawn here comes from the model. The labels print
   measured quantities — box size in frame units, pinch distance,
   the gesture the classifier actually returned and its score.
   No confidence is invented for anything that does not report one.
   ============================================================ */

export interface VisionStyle {
  /** squares around each face, with corner ticks */
  boxes: number;
  /** the 478-point mesh */
  mesh: number;
  /** eyes, lips, brows, oval — heavier than the mesh */
  contours: number;
  /** iris rings */
  iris: number;
  /** hand skeletons */
  hands: number;
  /** lines drawn between everything the model found */
  constellation: number;
  /** printed values beside each thing */
  labels: boolean;
  colour: string;
  accent: string;
  weight: number;
}

export const VISION_STYLE: VisionStyle = {
  boxes: 1,
  mesh: 0.35,
  contours: 0.9,
  iris: 1,
  hands: 1,
  constellation: 0.5,
  labels: true,
  colour: '#edeae3',
  accent: '#c6f031',
  weight: 1,
};

interface Rect { ox: number; oy: number; w: number; h: number; }

export function drawVision(
  g: CanvasRenderingContext2D,
  read: VisionRead,
  s: VisionStyle,
  r: Rect,
  mirrored: boolean,
) {
  const P = (p: NormalizedLandmark) => ({
    x: r.ox + (mirrored ? 1 - p.x : p.x) * r.w,
    y: r.oy + p.y * r.h,
  });

  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.font = `${Math.max(8, 9 * s.weight)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'alphabetic';

  /* ---- the mesh, first and faintest ---- */
  if (s.mesh > 0) {
    g.strokeStyle = s.colour;
    g.globalAlpha = s.mesh * 0.3;
    g.lineWidth = 0.5 * s.weight;
    for (const f of read.faces) strokeConnections(g, f.points, CONNECTORS.tesselation, P);
  }

  /* ---- contours: the features the eye actually reads ---- */
  if (s.contours > 0) {
    g.globalAlpha = s.contours;
    g.lineWidth = 1.1 * s.weight;
    g.strokeStyle = s.colour;
    for (const f of read.faces) {
      strokeConnections(g, f.points, CONNECTORS.contours, P);
      g.strokeStyle = s.accent;
      strokeConnections(g, f.points, CONNECTORS.lips, P);
      g.strokeStyle = s.colour;
      strokeConnections(g, f.points, CONNECTORS.oval, P);
    }
  }

  /* ---- iris ---- */
  if (s.iris > 0) {
    g.globalAlpha = s.iris;
    g.lineWidth = 1.2 * s.weight;
    g.strokeStyle = s.accent;
    for (const f of read.faces) {
      strokeConnections(g, f.points, CONNECTORS.leftIris, P);
      strokeConnections(g, f.points, CONNECTORS.rightIris, P);
      for (const c of [f.leftIris, f.rightIris]) {
        if (!c) continue;
        const q = P(c as NormalizedLandmark);
        g.beginPath();
        g.arc(q.x, q.y, 1.6 * s.weight, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  /* ---- the squares ---- */
  if (s.boxes > 0) {
    g.globalAlpha = s.boxes;
    for (const f of read.faces) drawFaceBox(g, f, s, r, mirrored);
  }

  /* ---- hands ---- */
  if (s.hands > 0) {
    g.globalAlpha = s.hands;
    for (const h of read.hands) drawHand(g, h, s, P);
  }

  /* ---- lines between everything found ---- */
  if (s.constellation > 0) {
    const nodes: { x: number; y: number }[] = [
      ...read.faces.map((f) => ({ x: f.box.x + f.box.w / 2, y: f.box.y + f.box.h / 2 })),
      ...read.hands.map((h) => h.wrist),
      ...read.hands.map((h) => h.pinchAt),
    ];
    g.globalAlpha = s.constellation * 0.55;
    g.strokeStyle = s.accent;
    g.lineWidth = 0.7 * s.weight;
    g.beginPath();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = P(nodes[i] as NormalizedLandmark);
        const b = P(nodes[j] as NormalizedLandmark);
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
    }
    g.stroke();
    // a tick at each node so the line has somewhere to arrive
    g.fillStyle = s.accent;
    for (const n of nodes) {
      const q = P(n as NormalizedLandmark);
      g.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
  }

  g.restore();
}

/* ---- a square with corner ticks, and only measured labels ---- */
function drawFaceBox(
  g: CanvasRenderingContext2D,
  f: FaceRead,
  s: VisionStyle,
  r: Rect,
  mirrored: boolean,
) {
  const bx = mirrored ? 1 - (f.box.x + f.box.w) : f.box.x;
  const x = r.ox + bx * r.w;
  const y = r.oy + f.box.y * r.h;
  const w = f.box.w * r.w;
  const h = f.box.h * r.h;
  const t = Math.min(w, h) * 0.16;

  g.strokeStyle = s.colour;
  g.lineWidth = 1 * s.weight;
  g.globalAlpha = s.boxes * 0.35;
  g.strokeRect(x, y, w, h);

  // corner ticks: the part that reads as a tracker rather than a border
  g.globalAlpha = s.boxes;
  g.lineWidth = 1.8 * s.weight;
  g.strokeStyle = s.accent;
  g.beginPath();
  g.moveTo(x, y + t); g.lineTo(x, y); g.lineTo(x + t, y);
  g.moveTo(x + w - t, y); g.lineTo(x + w, y); g.lineTo(x + w, y + t);
  g.moveTo(x + w, y + h - t); g.lineTo(x + w, y + h); g.lineTo(x + w - t, y + h);
  g.moveTo(x + t, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - t);
  g.stroke();

  if (!s.labels) return;
  g.fillStyle = s.accent;
  g.globalAlpha = 0.95;
  g.fillText(`FACE ${String(f.index + 1).padStart(2, '0')}`, x, y - 6);
  g.fillStyle = s.colour;
  g.globalAlpha = 0.6;
  g.fillText(
    `${f.box.w.toFixed(3)} × ${f.box.h.toFixed(3)}   ${f.points.length} pts`,
    x,
    y + h + 11,
  );
}

function drawHand(
  g: CanvasRenderingContext2D,
  h: HandRead,
  s: VisionStyle,
  P: (p: NormalizedLandmark) => { x: number; y: number },
) {
  g.strokeStyle = s.colour;
  g.lineWidth = 1.6 * s.weight;
  g.globalAlpha = s.hands * 0.9;
  strokeConnections(g, h.points, CONNECTORS.hand, P);

  g.fillStyle = s.accent;
  for (const p of h.points) {
    const q = P(p);
    g.fillRect(q.x - 1.5 * s.weight, q.y - 1.5 * s.weight, 3 * s.weight, 3 * s.weight);
  }

  // the pinch, drawn as the measurement it is
  const a = P(h.points[4]);
  const b = P(h.points[8]);
  g.strokeStyle = s.accent;
  g.globalAlpha = s.hands;
  g.lineWidth = 1 * s.weight;
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
  g.setLineDash([]);

  const m = P(h.pinchAt as NormalizedLandmark);
  g.beginPath();
  g.arc(m.x, m.y, 3 + (1 - Math.min(1, h.pinch * 5)) * 7, 0, Math.PI * 2);
  g.stroke();

  if (!s.labels) return;
  const wrist = P(h.points[0]);
  g.fillStyle = s.accent;
  g.globalAlpha = 0.95;
  g.fillText(h.handedness.toUpperCase(), wrist.x + 8, wrist.y + 4);
  g.fillStyle = s.colour;
  g.globalAlpha = 0.6;
  g.fillText(`pinch ${h.pinch.toFixed(3)}`, wrist.x + 8, wrist.y + 16);
  if (h.gesture) {
    g.fillStyle = s.accent;
    g.globalAlpha = 0.95;
    g.fillText(
      `${h.gesture} ${h.gestureScore != null ? h.gestureScore.toFixed(2) : ''}`,
      wrist.x + 8,
      wrist.y + 28,
    );
  }
}

function strokeConnections(
  g: CanvasRenderingContext2D,
  pts: NormalizedLandmark[],
  conns: Connection[],
  P: (p: NormalizedLandmark) => { x: number; y: number },
) {
  g.beginPath();
  for (const c of conns) {
    const a = pts[c.start];
    const b = pts[c.end];
    if (!a || !b) continue;
    const p = P(a);
    const q = P(b);
    g.moveTo(p.x, p.y);
    g.lineTo(q.x, q.y);
  }
  g.stroke();
}
