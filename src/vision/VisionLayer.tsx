import { useEffect, useRef, useState } from 'react';
import { fitScale, type ViewState } from '../engine/renderer';
import { applyLook, LOOKS } from '../lab/looks';
import { mutateRecipe, newSeed } from '../lab/recipe';
import { DIALS } from '../lab/stageDial';
import { useDispatch, useLab } from '../lab/store';
import type { Specimen } from '../lab/types';
import { drawVision, type VisionStyle } from './draw';
import { GestureDriver, type GestureBinding } from './gestures';
import { Vision, type VisionRead, type VisionStatus } from './vision';
import './vision.css';

/* ============================================================
   VISION LAYER
   Runs only on a moving specimen — a clip or the camera — because
   a landmark model on a still frame is the same answer every
   frame. Draws over the light table and, when it is bound, lets a
   hand drive the cook.
   ============================================================ */

export function VisionLayer({
  specimen,
  view,
  size,
  style,
  binding,
  onStatus,
  onRead,
}: {
  specimen: Specimen | null;
  view: ViewState;
  size: { w: number; h: number };
  style: VisionStyle;
  binding: GestureBinding;
  onStatus: (s: VisionStatus) => void;
  onRead: (r: VisionRead, live: { target: string; value: number } | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visionRef = useRef<Vision | null>(null);
  const driverRef = useRef(new GestureDriver());
  const rafRef = useRef(0);
  const dispatch = useDispatch();
  const { recipe } = useLab();
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;
  const [ready, setReady] = useState(false);

  driverRef.current.binding = binding;

  const moving = specimen?.kind === 'moving' && !!specimen.video;

  /* ---- load the models once, and only when they are wanted ---- */
  useEffect(() => {
    if (!moving) return;
    let live = true;
    const v = new Vision();
    visionRef.current = v;
    void v.load({ face: true, hands: true }).then((s) => {
      if (!live) return;
      onStatus(s);
      setReady(s.state === 'ready');
    });
    return () => {
      live = false;
      v.close();
      visionRef.current = null;
      setReady(false);
      driverRef.current.reset();
    };
  }, [moving, onStatus]);

  /* ---- read and draw every frame ---- */
  useEffect(() => {
    if (!ready || !moving || !specimen?.video || !size.w) return;
    const video = specimen.video;
    const mirrored = specimen.source === 'camera';

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const v = visionRef.current;
      const canvas = canvasRef.current;
      if (!v || !canvas) return;

      const read = v.read(video, performance.now());

      /* --- gestures drive the recipe --- */
      const driver = driverRef.current;
      const next = driver.drive(read, recipeRef.current);
      if (next) dispatch({ type: 'edit', mutate: () => next });

      const pulse = driver.pulse(read, performance.now());
      if (pulse) {
        if (pulse.action === 'next-look' || pulse.action === 'prev-look') {
          const i = LOOKS.findIndex((l) => l.material === recipeRef.current.material);
          const j =
            (i + (pulse.action === 'next-look' ? 1 : LOOKS.length - 1) + LOOKS.length) %
            LOOKS.length;
          dispatch({
            type: 'edit',
            mutate: (r) => applyLook(r, LOOKS[j]),
            log: { kind: 'material', title: LOOKS[j].name, detail: `gesture · ${pulse.gesture}` },
          });
        } else if (pulse.action === 'random') {
          const s = newSeed();
          dispatch({
            type: 'edit',
            mutate: (r) => mutateRecipe(r, s, 0.3),
            log: { kind: 'experiment', title: 'Mutated', detail: `gesture · ${pulse.gesture}` },
          });
        } else if (pulse.action === 'keep') {
          dispatch({ type: 'archive:add' });
        } else if (pulse.action === 'reset-stage') {
          dispatch({
            type: 'edit',
            mutate: (r) => DIALS[binding.pinchTarget].set(r, 0),
            log: { kind: 'experiment', title: 'Stage off', detail: `gesture · ${pulse.gesture}` },
          });
        }
      }

      onRead(read, driver.live);

      /* --- draw --- */
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);

      // land the overlay exactly on the frame, at whatever zoom
      const fit = fitScale(size.w, size.h, specimen.width, specimen.height);
      const sc = fit * view.zoom;
      const dw = specimen.width * sc;
      const dh = specimen.height * sc;
      drawVision(
        g,
        read,
        style,
        {
          ox: (size.w - dw) / 2 - view.panX * dw,
          oy: (size.h - dh) / 2 + view.panY * dh,
          w: dw,
          h: dh,
        },
        mirrored,
      );
    };

    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, moving, specimen, size, view, style, binding, dispatch, onRead]);

  if (!moving) return null;
  return <canvas ref={canvasRef} className="visionlayer" aria-hidden="true" />;
}
