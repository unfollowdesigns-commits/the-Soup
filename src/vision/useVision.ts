import { useCallback, useSyncExternalStore } from 'react';
import { VISION_STYLE, type VisionStyle } from './draw';
import { GESTURE_DEFAULT, type GestureBinding } from './gestures';
import type { VisionRead, VisionStatus } from './vision';

/* ============================================================
   One store for the vision layer. The overlay writes what the
   model found; the module in the rail reads it. They are far
   apart in the tree and both need the same object, so this is a
   small external store rather than context — and the per-frame
   read never re-renders anything that is not looking at it.

   Deliberately outside the recipe: how the lab looks at a frame
   is not part of how the frame was cooked, and a recipe has to
   stay reproducible with no camera attached.
   ============================================================ */

interface Snapshot {
  style: VisionStyle;
  binding: GestureBinding;
  status: VisionStatus;
  read: VisionRead | null;
  live: { target: string; value: number } | null;
}

let snap: Snapshot = {
  style: { ...VISION_STYLE },
  binding: { ...GESTURE_DEFAULT },
  status: { state: 'idle' },
  read: null,
  live: null,
};

const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/* the per-frame read is throttled: the drawing does not go through
   React, so the panel only needs it often enough to read */
let lastPush = 0;

export interface VisionState extends Snapshot {
  setStyle: (s: Partial<VisionStyle>) => void;
  setBinding: (b: Partial<GestureBinding>) => void;
  setStatus: (s: VisionStatus) => void;
  setRead: (r: VisionRead, live: { target: string; value: number } | null) => void;
}

export function useVision(): VisionState {
  const s = useSyncExternalStore(subscribe, () => snap, () => snap);

  const setStyle = useCallback((v: Partial<VisionStyle>) => {
    snap = { ...snap, style: { ...snap.style, ...v } };
    emit();
  }, []);

  const setBinding = useCallback((v: Partial<GestureBinding>) => {
    snap = { ...snap, binding: { ...snap.binding, ...v } };
    emit();
  }, []);

  const setStatus = useCallback((v: VisionStatus) => {
    snap = { ...snap, status: v };
    emit();
  }, []);

  const setRead = useCallback(
    (r: VisionRead, live: { target: string; value: number } | null) => {
      const now = performance.now();
      if (now - lastPush < 120) return;
      lastPush = now;
      snap = { ...snap, read: r, live };
      emit();
    },
    [],
  );

  return { ...s, setStyle, setBinding, setStatus, setRead };
}
