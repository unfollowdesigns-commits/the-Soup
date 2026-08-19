/* ============================================================
   TRACE
   Contrast-and-motion tracking, done classically and named
   honestly. There is no object detection model here: the lab
   finds regions of high local energy — and, on a moving
   specimen, regions that changed — then follows them frame to
   frame by nearest centroid.

   Every number the overlay prints comes out of this file. None
   of them are decoration.
   ============================================================ */

export interface TraceBox {
  id: number;
  /** normalised image space */
  x: number;
  y: number;
  w: number;
  h: number;
  /** measured local energy, 0..1 */
  energy: number;
  /** measured frame-to-frame change, 0..1; always 0 on a still */
  motion: number;
  /** frames this track has survived */
  age: number;
  /** smoothed centroid velocity, normalised units per frame */
  vx: number;
  vy: number;
}

export interface TraceResult {
  boxes: TraceBox[];
  /** wall-clock cost of the analysis pass */
  ms: number;
  gridW: number;
  gridH: number;
  /** true once a second frame has been seen */
  motionAvailable: boolean;
}

const GRID = 48;

export class Tracker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = GRID;
  private h = GRID;
  private prev: Float32Array | null = null;
  private tracks: TraceBox[] = [];
  private nextId = 1;
  private seenFrames = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable for trace analysis');
    this.ctx = ctx;
  }

  reset() {
    this.prev = null;
    this.tracks = [];
    this.nextId = 1;
    this.seenFrames = 0;
  }

  analyse(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    opts: { count: number; sensitivity: number; motionWeight: number },
  ): TraceResult {
    const t0 = performance.now();
    const aspect = srcW / Math.max(srcH, 1);
    this.w = aspect >= 1 ? GRID : Math.max(8, Math.round(GRID * aspect));
    this.h = aspect >= 1 ? Math.max(8, Math.round(GRID / aspect)) : GRID;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.drawImage(source, 0, 0, this.w, this.h);

    const px = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const lum = new Float32Array(this.w * this.h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = (px[p] * 0.2126 + px[p + 1] * 0.7152 + px[p + 2] * 0.0722) / 255;
    }

    // local energy: gradient magnitude, the classic corner/edge measure
    const energy = new Float32Array(this.w * this.h);
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        const i = y * this.w + x;
        const gx = lum[i + 1] - lum[i - 1];
        const gy = lum[i + this.w] - lum[i - this.w];
        energy[i] = Math.min(1, Math.hypot(gx, gy) * 2.2);
      }
    }

    // motion: absolute frame difference, only once we have a previous frame
    const motion = new Float32Array(this.w * this.h);
    const motionAvailable = this.prev !== null;
    if (this.prev) {
      for (let i = 0; i < lum.length; i++) {
        motion[i] = Math.min(1, Math.abs(lum[i] - this.prev[i]) * 6);
      }
    }
    this.prev = lum;
    this.seenFrames++;

    // score, then take non-overlapping peaks
    const score = new Float32Array(this.w * this.h);
    const mw = motionAvailable ? opts.motionWeight : 0;
    for (let i = 0; i < score.length; i++) {
      score[i] = energy[i] * (1 - mw) + motion[i] * mw;
    }

    const found: TraceBox[] = [];
    const taken = new Uint8Array(this.w * this.h);
    const want = Math.max(0, Math.round(opts.count));
    const floor = 0.06 + (1 - opts.sensitivity) * 0.34;

    for (let n = 0; n < want; n++) {
      let best = -1;
      let bestV = floor;
      for (let i = 0; i < score.length; i++) {
        if (!taken[i] && score[i] > bestV) {
          bestV = score[i];
          best = i;
        }
      }
      if (best < 0) break;
      const bx = best % this.w;
      const by = (best - bx) / this.w;

      // grow the box outward while the neighbourhood keeps scoring
      let x0 = bx, x1 = bx, y0 = by, y1 = by;
      const thresh = bestV * 0.42;
      for (let step = 0; step < 6; step++) {
        if (x0 > 0 && rowMax(score, this.w, x0 - 1, y0, y1) > thresh) x0--;
        if (x1 < this.w - 1 && rowMax(score, this.w, x1 + 1, y0, y1) > thresh) x1++;
        if (y0 > 0 && colMax(score, this.w, y0 - 1, x0, x1) > thresh) y0--;
        if (y1 < this.h - 1 && colMax(score, this.w, y1 + 1, x0, x1) > thresh) y1++;
      }
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) taken[y * this.w + x] = 1;
      }

      let e = 0;
      let m = 0;
      let c = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * this.w + x;
          e += energy[i];
          m += motion[i];
          c++;
        }
      }
      found.push({
        id: 0,
        x: x0 / this.w,
        y: y0 / this.h,
        w: (x1 - x0 + 1) / this.w,
        h: (y1 - y0 + 1) / this.h,
        energy: c ? e / c : 0,
        motion: c ? m / c : 0,
        age: 1,
        vx: 0,
        vy: 0,
      });
    }

    this.tracks = this.associate(found);
    return {
      boxes: this.tracks,
      ms: performance.now() - t0,
      gridW: this.w,
      gridH: this.h,
      motionAvailable,
    };
  }

  /** nearest-centroid association, with a little smoothing so the boxes
   *  settle instead of twitching */
  private associate(found: TraceBox[]): TraceBox[] {
    const prev = this.tracks.slice();
    const out: TraceBox[] = [];
    const used = new Set<number>();

    for (const f of found) {
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      let match: TraceBox | null = null;
      let bestD = 0.14;
      for (const p of prev) {
        if (used.has(p.id)) continue;
        const d = Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy);
        if (d < bestD) {
          bestD = d;
          match = p;
        }
      }
      if (match) {
        used.add(match.id);
        const k = 0.45;
        const nx = match.x + (f.x - match.x) * k;
        const ny = match.y + (f.y - match.y) * k;
        out.push({
          ...f,
          id: match.id,
          x: nx,
          y: ny,
          w: match.w + (f.w - match.w) * k,
          h: match.h + (f.h - match.h) * k,
          age: match.age + 1,
          vx: (nx - match.x) * 0.6 + match.vx * 0.4,
          vy: (ny - match.y) * 0.6 + match.vy * 0.4,
        });
      } else {
        out.push({ ...f, id: this.nextId++ });
      }
    }
    return out;
  }
}

function rowMax(a: Float32Array, w: number, x: number, y0: number, y1: number) {
  let m = 0;
  for (let y = y0; y <= y1; y++) m = Math.max(m, a[y * w + x]);
  return m;
}
function colMax(a: Float32Array, w: number, y: number, x0: number, x1: number) {
  let m = 0;
  for (let x = x0; x <= x1; x++) m = Math.max(m, a[y * w + x]);
  return m;
}
