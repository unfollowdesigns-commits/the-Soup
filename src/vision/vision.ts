import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/* The MediaPipe bundle is most of a megabyte, so it is imported only when
   the vision layer is actually asked for. Nothing pays for it otherwise. */
type MP = typeof import('@mediapipe/tasks-vision');
/* the classes have private constructors, so the instance type comes from
   the factory rather than from InstanceType */
type FaceLandmarkerT = Awaited<ReturnType<MP['FaceLandmarker']['createFromOptions']>>;
type GestureRecognizerT = Awaited<ReturnType<MP['GestureRecognizer']['createFromOptions']>>;
let mp: MP | null = null;
const loadMp = async (): Promise<MP> => {
  mp ??= await import('@mediapipe/tasks-vision');
  return mp;
};

/* ============================================================
   VISION
   Real landmarks from a real model, not a heuristic. MediaPipe
   Tasks Vision, Apache-2.0: 478 face points with tesselation,
   contour and iris connectors, and 21 points per hand with a
   canned gesture classifier.

   Assets are self-hosted from public/vision. If they are not
   there the layer says so and nothing else in SOUP is affected.
   ============================================================ */

export type Handedness = 'Left' | 'Right';

export interface HandRead {
  index: number;
  handedness: Handedness;
  /** 21 landmarks, normalised to the frame */
  points: NormalizedLandmark[];
  /** the canned gesture, when the classifier is confident enough */
  gesture: string | null;
  gestureScore: number | null;
  /** thumb tip to index tip, in normalised frame units. Measured. */
  pinch: number;
  /** the point between thumb and index — what a pinch is "holding" */
  pinchAt: { x: number; y: number };
  /** wrist, for coarse position */
  wrist: { x: number; y: number };
  box: Box;
}

export interface FaceRead {
  index: number;
  points: NormalizedLandmark[];
  box: Box;
  /** iris centres when the model supplies them */
  leftIris: { x: number; y: number } | null;
  rightIris: { x: number; y: number } | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisionRead {
  faces: FaceRead[];
  hands: HandRead[];
  /** wall-clock cost of both inferences this frame */
  ms: number;
  at: number;
}

export type VisionStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; face: boolean; hands: boolean; backend: string }
  | { state: 'failed'; reason: string };

const BASE = () => `${import.meta.env.BASE_URL}vision`;

export class Vision {
  private face: FaceLandmarkerT | null = null;
  private hands: GestureRecognizerT | null = null;
  private lastVideoTime = -1;
  private last: VisionRead = { faces: [], hands: [], ms: 0, at: 0 };
  status: VisionStatus = { state: 'idle' };

  async load(opts: { face?: boolean; hands?: boolean } = {}): Promise<VisionStatus> {
    const wantFace = opts.face ?? true;
    const wantHands = opts.hands ?? true;
    this.status = { state: 'loading' };
    try {
      const { FaceLandmarker, FilesetResolver, GestureRecognizer } = await loadMp();
      const fileset = await FilesetResolver.forVisionTasks(`${BASE()}/wasm`);

      if (wantFace && !this.face) {
        this.face = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${BASE()}/models/face_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 4,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
      }

      if (wantHands && !this.hands) {
        this.hands = await GestureRecognizer.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${BASE()}/models/gesture_recognizer.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      }

      fillConnectors(await loadMp());
      this.status = {
        state: 'ready',
        face: !!this.face,
        hands: !!this.hands,
        backend: 'GPU',
      };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.status = {
        state: 'failed',
        reason: /fetch|404|Failed to load/i.test(reason)
          ? 'Vision assets are missing. Run: npm run vision:assets'
          : reason,
      };
    }
    return this.status;
  }

  /** run both models on one video frame. Cheap to call every frame:
   *  MediaPipe skips work when the timestamp has not advanced. */
  read(video: HTMLVideoElement, nowMs: number): VisionRead {
    if (this.status.state !== 'ready' || video.readyState < 2) return this.last;
    if (video.currentTime === this.lastVideoTime) return this.last;
    this.lastVideoTime = video.currentTime;

    const t0 = performance.now();
    const faces: FaceRead[] = [];
    const hands: HandRead[] = [];

    try {
      if (this.face) {
        const r = this.face.detectForVideo(video, nowMs);
        r.faceLandmarks?.forEach((points: NormalizedLandmark[], index: number) => {
          faces.push({
            index,
            points,
            box: boxOf(points),
            leftIris: centreOf(points, LEFT_IRIS),
            rightIris: centreOf(points, RIGHT_IRIS),
          });
        });
      }

      if (this.hands) {
        const r = this.hands.recognizeForVideo(video, nowMs);
        r.landmarks?.forEach((points: NormalizedLandmark[], index: number) => {
          const g = r.gestures?.[index]?.[0];
          const side = (r.handedness?.[index]?.[0]?.categoryName ?? 'Right') as Handedness;
          const thumb = points[4];
          const idx = points[8];
          hands.push({
            index,
            handedness: side,
            points,
            gesture: g && g.categoryName !== 'None' ? g.categoryName : null,
            gestureScore: g ? g.score : null,
            pinch: Math.hypot(thumb.x - idx.x, thumb.y - idx.y),
            pinchAt: { x: (thumb.x + idx.x) / 2, y: (thumb.y + idx.y) / 2 },
            wrist: { x: points[0].x, y: points[0].y },
            box: boxOf(points),
          });
        });
      }
    } catch {
      /* a dropped frame is not worth tearing the layer down for */
    }

    this.last = { faces, hands, ms: performance.now() - t0, at: nowMs };
    return this.last;
  }

  get latest() {
    return this.last;
  }

  close() {
    this.face?.close();
    this.hands?.close();
    this.face = null;
    this.hands = null;
    this.status = { state: 'idle' };
  }
}

/* ---- the connectors used to draw the art lines ----
   Filled in once the module has loaded; empty before that, which simply
   means the overlay draws nothing rather than throwing. */
export interface Connectors {
  tesselation: { start: number; end: number }[];
  contours: { start: number; end: number }[];
  oval: { start: number; end: number }[];
  leftIris: { start: number; end: number }[];
  rightIris: { start: number; end: number }[];
  lips: { start: number; end: number }[];
  hand: { start: number; end: number }[];
}

export const CONNECTORS: Connectors = {
  tesselation: [], contours: [], oval: [],
  leftIris: [], rightIris: [], lips: [], hand: [],
};

function fillConnectors(m: MP) {
  const F = m.FaceLandmarker;
  const G = m.GestureRecognizer;
  CONNECTORS.tesselation = F.FACE_LANDMARKS_TESSELATION;
  CONNECTORS.contours = F.FACE_LANDMARKS_CONTOURS;
  CONNECTORS.oval = F.FACE_LANDMARKS_FACE_OVAL;
  CONNECTORS.leftIris = F.FACE_LANDMARKS_LEFT_IRIS;
  CONNECTORS.rightIris = F.FACE_LANDMARKS_RIGHT_IRIS;
  CONNECTORS.lips = F.FACE_LANDMARKS_LIPS;
  CONNECTORS.hand = G.HAND_CONNECTIONS;
}

const LEFT_IRIS = [474, 475, 476, 477];
const RIGHT_IRIS = [469, 470, 471, 472];

function boxOf(p: NormalizedLandmark[]): Box {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const q of p) {
    if (q.x < x0) x0 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.x > x1) x1 = q.x;
    if (q.y > y1) y1 = q.y;
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function centreOf(p: NormalizedLandmark[], idx: number[]) {
  if (p.length <= Math.max(...idx)) return null;
  let x = 0, y = 0;
  for (const i of idx) {
    x += p[i].x;
    y += p[i].y;
  }
  return { x: x / idx.length, y: y / idx.length };
}
