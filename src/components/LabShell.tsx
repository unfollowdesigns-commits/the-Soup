import { useCallback, useEffect, useState } from 'react';
import type { RenderStats } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { applyMaterial } from '../lab/recipe';
import { timeOf, useDispatch, useLab } from '../lab/store';
import { Deck, type DeckTab } from './Deck';
import { DevelopExport } from './DevelopExport';
import { MaterialArchive } from './MaterialArchive';
import { MaterialDetail } from './MaterialDetail';
import { ProcessPanel } from './ProcessPanel';
import { SpecimenViewer, type PlacementMode } from './SpecimenViewer';
import { DepthAnalysis, ProcessingStatus } from './Status';

/* ============================================================
   LAB SHELL
   The room: archive on the left, the photograph in the middle,
   the workstation on the right, the bench in front of you.
   ============================================================ */

type Rail = 'process' | 'analysis';

export function LabShell() {
  const { recipe, specimen, inspecting, exportOpen, restoredFrom, sessionStart } = useLab();
  const dispatch = useDispatch();
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [rail, setRail] = useState<Rail>('process');
  const [deckTab, setDeckTab] = useState<DeckTab>('stack');
  const [deckClosed, setDeckClosed] = useState(false);
  const [placing, setPlacing] = useState<PlacementMode>('none');

  const onStats = useCallback((s: RenderStats | null) => setStats(s), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape' && placing !== 'none') setPlacing('none');
      if (e.key.toLowerCase() === 'e' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        dispatch({ type: 'export', open: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, dispatch]);

  return (
    <div className="lab">
      <header className="lab__bar">
        <div className="lab__ident">
          <span className="lab__mark" aria-hidden="true" />
          <h1 className="lab__title">
            Photographic <em>Material</em> Lab
          </h1>
        </div>

        <span className="spacer" />

        {restoredFrom ? (
          <span className="lab__restored mono">Returned to {restoredFrom}</span>
        ) : null}

        <div className="lab__session">
          <span className="lbl">Session</span>
          <span className="mono mono--val">{timeOf(sessionStart)}</span>
          <span className="lamp" data-state={specimen ? 'on' : 'off'} />
        </div>

        <button
          className="btn"
          type="button"
          onClick={() => dispatch({ type: 'screen', screen: 'import' })}
        >
          Change specimen
        </button>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => dispatch({ type: 'export', open: true })}
          disabled={!specimen}
        >
          Develop
        </button>
      </header>

      <div className="lab__main">
        <div className="lab__left">
          <MaterialArchive
            selected={recipe.material}
            onSelect={(m) =>
              dispatch({
                type: 'edit',
                mutate: (r) => applyMaterial(r, m),
                log: { kind: 'material', title: m.name, detail: `${m.manufacturer} · ${m.isoLabel}` },
              })
            }
            onInspect={(id) => dispatch({ type: 'inspect', id })}
          />
          {inspecting ? (
            <MaterialDetail
              id={inspecting}
              loaded={inspecting === recipe.material}
              onClose={() => dispatch({ type: 'inspect', id: null })}
              onLoad={() => {
                const m = getMaterial(inspecting);
                dispatch({
                  type: 'edit',
                  mutate: (r) => applyMaterial(r, m),
                  log: { kind: 'material', title: m.name, detail: `${m.manufacturer} · ${m.isoLabel}` },
                });
              }}
            />
          ) : null}
        </div>

        <div className="lab__centre">
          <SpecimenViewer onStats={onStats} placing={placing} onPlaced={() => setPlacing('none')} />
        </div>

        <div className="lab__right">
          <div className="rail__tabs">
            <button
              type="button"
              className="rail__tab"
              aria-pressed={rail === 'process'}
              onClick={() => setRail('process')}
            >
              <span className="lbl">Process</span>
            </button>
            <button
              type="button"
              className="rail__tab"
              aria-pressed={rail === 'analysis'}
              onClick={() => setRail('analysis')}
            >
              <span className="lbl">Analysis</span>
            </button>
          </div>
          {rail === 'process' ? (
            <ProcessPanel
              placing={placing}
              setPlacing={setPlacing}
              onInspect={(id) => dispatch({ type: 'inspect', id })}
            />
          ) : (
            <div className="rail__analysis scroll-y">
              <ProcessingStatus stats={stats} />
              <DepthAnalysis stats={stats} />
            </div>
          )}
        </div>
      </div>

      <Deck tab={deckTab} setTab={setDeckTab} collapsed={deckClosed} setCollapsed={setDeckClosed} />

      {placing !== 'none' ? (
        <div className="lab__hint" role="status">
          <span className="lbl lbl--amber">Placing a burn</span>
          <span className="mono">Click the specimen · Esc to stop</span>
        </div>
      ) : null}

      {exportOpen ? <DevelopExport /> : null}
    </div>
  );
}
