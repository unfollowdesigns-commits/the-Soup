import { DIALS } from '../lab/stageDial';
import type { PhotoRecipe, StageId } from '../lab/types';
import type { VisionRead } from './vision';

/* ============================================================
   GESTURE BINDING
   A hand is an input device. Pinch is a continuous value — the
   measured distance between thumb and index — so it drives a
   dial. The canned gestures are discrete, so they fire actions,
   once, on the edge.

   Everything is debounced and hysteretic, because a classifier
   that flickers between two labels would otherwise fire an
   action sixty times a second.
   ============================================================ */

export type GestureAction =
  | 'none'
  | 'next-look'
  | 'prev-look'
  | 'random'
  | 'keep'
  | 'reset-stage';

export interface GestureBinding {
  enabled: boolean;
  /** which dial the pinch drives */
  pinchTarget: StageId;
  /** the other hand's height drives a second dial */
  heightTarget: StageId;
  useHeight: boolean;
  /** canned gestures, by MediaPipe category name */
  actions: Record<string, GestureAction>;
}

export const GESTURE_DEFAULT: GestureBinding = {
  enabled: false,
  pinchTarget: 'soup',
  heightTarget: 'grain',
  useHeight: false,
  actions: {
    Open_Palm: 'next-look',
    Closed_Fist: 'reset-stage',
    Victory: 'random',
    Thumb_Up: 'keep',
    Pointing_Up: 'none',
    ILoveYou: 'none',
  },
};

export const PINCH_TARGETS: StageId[] = [
  'soup', 'grain', 'halation', 'burn', 'diffusion', 'optics', 'damage', 'raster', 'trace',
];

export const ACTION_LABEL: Record<GestureAction, string> = {
  none: 'Nothing',
  'next-look': 'Next look',
  'prev-look': 'Previous look',
  random: 'Roll the dice',
  keep: 'Keep the recipe',
  'reset-stage': 'Turn the stage off',
};

/* pinch travel: fingers together is 0, a comfortable spread is 1 */
const PINCH_MIN = 0.03;
const PINCH_MAX = 0.24;
const pinchToValue = (d: number) =>
  Math.min(1, Math.max(0, (d - PINCH_MIN) / (PINCH_MAX - PINCH_MIN)));

export interface GesturePulse {
  action: GestureAction;
  gesture: string;
  at: number;
}

export class GestureDriver {
  binding: GestureBinding = { ...GESTURE_DEFAULT };
  /** what the pinch is currently asking for, for the readout */
  live: { target: StageId; value: number } | null = null;

  private held: string | null = null;
  private heldSince = 0;
  private firedFor: string | null = null;
  private smoothed: number | null = null;

  /** returns a recipe mutation for the continuous channels, or null */
  drive(read: VisionRead, r: PhotoRecipe): PhotoRecipe | null {
    if (!this.binding.enabled || !read.hands.length) {
      this.live = null;
      return null;
    }
    // the right hand pinches; if there is only one hand, it is the one
    const primary =
      read.hands.find((h) => h.handedness === 'Right') ?? read.hands[0];
    const raw = pinchToValue(primary.pinch);
    // a light smoothing, or the value jitters with the landmarks
    this.smoothed = this.smoothed == null ? raw : this.smoothed + (raw - this.smoothed) * 0.3;
    const v = this.smoothed;

    let next = DIALS[this.binding.pinchTarget].set(r, v);
    this.live = { target: this.binding.pinchTarget, value: v };

    if (this.binding.useHeight) {
      const other = read.hands.find((h) => h !== primary);
      if (other) {
        // screen y is inverted: hand up means more
        next = DIALS[this.binding.heightTarget].set(next, 1 - other.wrist.y);
      }
    }
    return next === r ? null : next;
  }

  /** discrete actions, fired once when a gesture has been held briefly */
  pulse(read: VisionRead, now: number): GesturePulse | null {
    if (!this.binding.enabled) return null;
    const g = read.hands.map((h) => h.gesture).find(Boolean) ?? null;

    if (g !== this.held) {
      this.held = g;
      this.heldSince = now;
      this.firedFor = null;
      return null;
    }
    if (!g || this.firedFor === g) return null;
    // held for a beat, so it is a decision rather than a flicker
    if (now - this.heldSince < 380) return null;

    const action = this.binding.actions[g] ?? 'none';
    this.firedFor = g;
    return action === 'none' ? null : { action, gesture: g, at: now };
  }

  reset() {
    this.held = null;
    this.firedFor = null;
    this.smoothed = null;
    this.live = null;
  }
}
