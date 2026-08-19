import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';
import { LabRenderer, fitScale, type CompareMode, type RenderStats, type ViewMode, type ViewState } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { makeBurn } from '../lab/recipe';
import { useDispatch, useLab } from '../lab/store';
import type { PhotoRecipe } from '../lab/types';

/* ============================================================
   SPECIMEN VIEWER
   The photograph sits on the light table. Everything else in the
   room is arranged around it.
   ============================================================ */

export type PlacementMode = 'none' | 'burn';

export function SpecimenViewer({
  onStats,
  placing,
  onPlaced,
}: {
  onStats: (s: RenderStats | null) => void;
  placing: PlacementMode;
  onPlaced: () => void;
}) {
  const { specimen, recipe } = useLab();
  const dispatch = useDispatch();

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const frameRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const [view, setView] = useState<ViewState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    compare: 'single',
    split: 0.5,
    view: 'color',
  });
  const [fitZoom, setFitZoom] = useState(1);
  const viewRef = useRef(view);
  viewRef.current = view;

  /* ---- engine lifecycle ---- */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new LabRenderer(canvas);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !specimen) return;
    r.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
    setView((v) => ({ ...v, zoom: 1, panX: 0, panY: 0 }));
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specimen]);

  /* ---- size ---- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!specimen || !size.w) return;
    setFitZoom(1);
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, specimen]);

  /* ---- draw ---- */
  const draw = useCallback(() => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas || !specimen || !size.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.resize(size.w, size.h, dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    try {
      onStats(r.render(recipe, getMaterial(recipe.material), viewRef.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [recipe, specimen, size.w, size.h, onStats]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => draw());
  }, [draw]);

  useEffect(() => {
    schedule();
    return () => cancelAnimationFrame(frameRef.current);
  }, [schedule, view]);

  /* ---- interaction: pan, zoom, split ---- */
  const drag = useRef<{ mode: 'pan' | 'split'; x: number; y: number; px: number; py: number } | null>(null);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!specimen) return;
    const stage = stageRef.current!;
    const rect = stage.getBoundingClientRect();

    if (placing === 'burn') {
      const p = screenToImage(e.clientX - rect.left, e.clientY - rect.top, rect, specimen, view);
      if (p) {
        dispatch({
          type: 'edit',
          mutate: (r) => ({ ...r, burns: [...r.burns, makeBurn(p.x, p.y)] }),
          log: { kind: 'burn', title: 'Film Burn Placed', detail: `${p.x.toFixed(2)}, ${p.y.toFixed(2)}` },
        });
        onPlaced();
      }
      return;
    }

    if (view.compare === 'split') {
      const sx = (e.clientX - rect.left) / rect.width;
      if (Math.abs(sx - view.split) < 0.03) {
        stage.setPointerCapture(e.pointerId);
        drag.current = { mode: 'split', x: e.clientX, y: e.clientY, px: view.split, py: 0 };
        return;
      }
    }
    stage.setPointerCapture(e.pointerId);
    drag.current = { mode: 'pan', x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    if (d.mode === 'split') {
      setView((v) => ({ ...v, split: clamp((e.clientX - rect.left) / rect.width, 0.02, 0.98) }));
      return;
    }
    // panning moves the image, so the map offset moves against the pointer
    const scale = 1 / (fitScale(rect.width, rect.height, specimen!.width, specimen!.height) * view.zoom);
    setView((v) => ({
      ...v,
      panX: d.px - ((e.clientX - d.x) * scale) / specimen!.width,
      panY: d.py + ((e.clientY - d.y) * scale) / specimen!.height,
    }));
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current) stageRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!specimen) return;
    e.preventDefault();
    setView((v) => ({ ...v, zoom: clamp(v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.15, 24) }));
  };

  const oneToOne = useCallback(() => {
    if (!specimen || !size.w) return 1;
    return 1 / fitScale(size.w, size.h, specimen.width, specimen.height);
  }, [specimen, size]);

  const setZoom = (z: number) => setView((v) => ({ ...v, zoom: clamp(z, 0.15, 24), panX: 0, panY: 0 }));

  const shownZoom = specimen && size.w
    ? view.zoom * fitScale(size.w, size.h, specimen.width, specimen.height) * 100
    : 100;

  return (
    <div className="viewer">
      <ViewerBar
        view={view}
        setView={setView}
        zoomPct={shownZoom}
        onFit={() => setZoom(1)}
        onActual={() => setZoom(oneToOne())}
        fitZoom={fitZoom}
        setFitZoom={setFitZoom}
        specimenName={specimen?.name ?? '—'}
        dims={specimen ? `${specimen.width} × ${specimen.height}` : '—'}
      />

      <div
        ref={stageRef}
        className="viewer__stage"
        data-placing={placing !== 'none'}
        data-compare={view.compare}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="viewer__canvas" />

        {view.compare !== 'single' ? (
          <div className="viewer__compare" aria-hidden="true">
            <span className="viewer__tag viewer__tag--control">Control</span>
            <span className="viewer__tag viewer__tag--specimen">Specimen</span>
            {view.compare === 'split' ? (
              <div className="viewer__split" style={{ left: `${view.split * 100}%` }}>
                <span className="viewer__split-grip" />
              </div>
            ) : (
              <div className="viewer__divider" />
            )}
          </div>
        ) : null}

        <BurnMarkers recipe={recipe} />

        {error ? (
          <div className="viewer__error">
            <p className="lbl lbl--amber">Engine unavailable</p>
            <p className="mono">{error}</p>
          </div>
        ) : null}
        {!specimen && !error ? (
          <div className="viewer__empty">
            <p className="lbl lbl--wide">No specimen on the table</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---- the bar above the table ---- */
function ViewerBar({
  view,
  setView,
  zoomPct,
  onFit,
  onActual,
  specimenName,
  dims,
}: {
  view: ViewState;
  setView: (fn: (v: ViewState) => ViewState) => void;
  zoomPct: number;
  onFit: () => void;
  onActual: () => void;
  fitZoom: number;
  setFitZoom: (n: number) => void;
  specimenName: string;
  dims: string;
}) {
  const compare: { id: CompareMode; label: string }[] = [
    { id: 'single', label: 'Specimen' },
    { id: 'split', label: 'Split' },
    { id: 'side-by-side', label: 'Side' },
  ];
  const modes: { id: ViewMode; label: string }[] = [
    { id: 'color', label: 'Colour' },
    { id: 'depth', label: 'Depth' },
    { id: 'normals', label: 'Normals' },
    { id: 'depth-effect', label: 'Effect' },
  ];
  return (
    <div className="viewer__bar">
      <span className="viewer__name lbl lbl--lit">{specimenName}</span>
      <span className="mono mono--dim">{dims}</span>

      <span className="spacer" />

      <div className="seg" role="group" aria-label="Comparison">
        {compare.map((c) => (
          <button
            key={c.id}
            type="button"
            className="seg__opt"
            aria-pressed={view.compare === c.id}
            onClick={() => setView((v) => ({ ...v, compare: c.id }))}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="seg" role="group" aria-label="View">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            className="seg__opt"
            aria-pressed={view.view === m.id}
            onClick={() => setView((v) => ({ ...v, view: m.id }))}
          >
            {m.label}
          </button>
        ))}
      </div>

      <span className="rule rule--v" />

      <button className="btn btn--sm btn--quiet" type="button" onClick={onFit}>Fit</button>
      <button className="btn btn--sm btn--quiet" type="button" onClick={onActual}>100%</button>
      <span className="mono mono--val viewer__zoom">{zoomPct.toFixed(0)}%</span>
    </div>
  );
}

function BurnMarkers({ recipe }: { recipe: PhotoRecipe }) {
  if (!recipe.burns.length) return null;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function screenToImage(
  x: number,
  y: number,
  rect: DOMRect,
  specimen: { width: number; height: number },
  view: ViewState,
) {
  const fit = fitScale(rect.width, rect.height, specimen.width, specimen.height);
  const s = fit * view.zoom;
  const dw = specimen.width * s;
  const dh = specimen.height * s;
  const u = (x - (rect.width - dw) / 2) / dw + view.panX;
  const v = (y - (rect.height - dh) / 2) / dh - view.panY;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: u, y: v };
}
