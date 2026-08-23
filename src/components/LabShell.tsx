import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderStats } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { applyMaterial } from '../lab/recipe';
import { timeOf, useDispatch, useLab } from '../lab/store';
import { Wordmark } from '../brand/Mark';
import { Deck, type DeckTab } from './Deck';
import { DevelopExport } from './DevelopExport';
import { MaterialArchive } from './MaterialArchive';
import { MaterialDetail } from './MaterialDetail';
import { ProcessPanel } from './ProcessPanel';
import { SpecimenViewer, type PlacementMode } from './SpecimenViewer';
import { LookStrip } from './LookStrip';
import { Dial } from './Dial';
import { EFFECTS } from '../lab/catalogue';
import { DepthAnalysis, ProcessingStatus } from './Status';

/* ============================================================
   THE RIG
   A darkroom, not a dashboard.

   The photograph is the room. Nothing is permanently parked
   beside it: the archive, the cook and the readings are benches
   you pull open over the picture and push shut again. The bench
   along the foot holds the looks and the recipe, because those
   are the two things you touch constantly.

   Everything has a key. Nothing has a card.
   ============================================================ */

type Bench = null | 'stock' | 'cook' | 'read';

const BENCHES: { id: Exclude<Bench, null>; label: string; key: string; hint: string }[] = [
  { id: 'stock', label: 'Stock', key: 's', hint: 'The material archive' },
  { id: 'cook', label: 'Cook', key: 'c', hint: 'Every stage, in the order it runs' },
  { id: 'read', label: 'Read', key: 'r', hint: 'What the engine is doing' },
];

export function LabShell() {
  const {
    recipe, specimen, inspecting, exportOpen, restoredFrom, sessionStart,
    look, strength, bench: benchOpen,
  } = useLab();
  const dispatch = useDispatch();
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [bench, setBench] = useState<Bench>('cook');
  const [deckTab, setDeckTab] = useState<DeckTab>('looks');
  const [deckClosed, setDeckClosed] = useState(false);
  const [bare, setBare] = useState(false);
  const [placing, setPlacing] = useState<PlacementMode>('none');
  const benchRef = useRef<HTMLDivElement>(null);

  const onStats = useCallback((s: RenderStats | null) => setStats(s), []);
  const material = getMaterial(recipe.material);

  const openBench = useCallback((id: Exclude<Bench, null>) => {
    setBare(false);
    setBench((b) => (b === id ? null : id));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'e') {
          e.preventDefault();
          dispatch({ type: 'export', open: true });
        }
        return;
      }
      if (e.altKey) return;
      const k = e.key.toLowerCase();

      if (e.key === 'Escape') {
        if (placing !== 'none') setPlacing('none');
        else if (bench) setBench(null);
        else if (bare) setBare(false);
        return;
      }
      const hit = BENCHES.find((b) => b.key === k);
      if (hit) {
        e.preventDefault();
        openBench(hit.id);
        return;
      }
      if (k === 'b') {
        e.preventDefault();
        dispatch({ type: 'bench', open: !benchOpen });
      } else if (k === 'd') {
        e.preventDefault();
        setDeckClosed((c) => !c);
      } else if (k === 'h') {
        e.preventDefault();
        setBare((v) => {
          if (!v) {
            setBench(null);
            setDeckClosed(true);
          } else {
            setDeckClosed(false);
          }
          return !v;
        });
      } else if (k === 'f' && specimen) {
        e.preventDefault();
        dispatch({ type: 'screen', screen: 'effects' });
      } else if (k === 'l' && specimen) {
        dispatch({ type: 'screen', screen: 'light' });
      } else if (k === 'p' && specimen) {
        dispatch({ type: 'screen', screen: 'press' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, bench, bare, specimen, dispatch, openBench, benchOpen]);

  /* ------------------------------------------------------------
     THE PLAIN LAB
     What the lab is when you have not asked for anything: the
     photograph, a strip of whole processes, and one dial that moves
     the chosen one between the bare stock and all of it.

     Everything else — eighteen stages, the archive, the readings,
     the log — is behind one door, because the count of things on
     screen is the thing that makes a tool feel hard.
     ------------------------------------------------------------ */
  if (!benchOpen) {
    return (
      <div className="plain" data-bare={bare}>
        <div className="plain__stage">
          <SpecimenViewer
            onStats={onStats}
            placing="none"
            onPlaced={() => undefined}
            chrome="bleed"
            bare
          />
        </div>

        <header className="plain__top">
          <button
            className="rig__ident"
            type="button"
            title="Back to the front"
            onClick={() => dispatch({ type: 'screen', screen: 'enter' })}
          >
            <Wordmark size={16} />
          </button>
          <span className="plain__name">{specimen?.name ?? 'Nothing on the table'}</span>
          <span className="spacer" />
          <button className="btn btn--quiet" type="button" onClick={() => dispatch({ type: 'screen', screen: 'import' })}>
            Swap
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => dispatch({ type: 'export', open: true })}
            disabled={!specimen}
          >
            Save
          </button>
        </header>

        <div className="plain__foot">
          <div className="plain__dial">
            <Dial
              value={strength}
              onChange={(v) => dispatch({ type: 'strength', value: v })}
              label={look?.name ?? 'No look'}
              caption="drag up · bare stock to all of it"
              disabled={!look}
              size={126}
            />
            <button
              className="plain__door"
              type="button"
              onClick={() => dispatch({ type: 'screen', screen: 'effects' })}
            >
              All {EFFECTS.length} effects
              <span className="plain__door-key mono">F</span>
            </button>
          </div>

          <LookStrip big />
        </div>

        {exportOpen ? <DevelopExport /> : null}
      </div>
    );
  }

  return (
    <div
      className="rig"
      data-bare={bare}
      data-bench={bench ?? 'none'}
      data-foot={deckClosed ? 'shut' : 'open'}
    >
      {/* ---- the photograph, edge to edge ---- */}
      <div className="rig__stage">
        <SpecimenViewer
          onStats={onStats}
          placing={placing}
          onPlaced={() => setPlacing('none')}
          chrome="bleed"
          bare={bare}
        />
      </div>

      {/* ---- chrome floating over it ---- */}
      <header className="rig__top">
        <button
          className="rig__ident"
          type="button"
          title="Back to the front"
          onClick={() => dispatch({ type: 'screen', screen: 'enter' })}
        >
          <Wordmark size={16} />
        </button>

        <span className="rig__loaded" title={material.notes.tonal}>
          <span className="rig__loaded-swatch" aria-hidden="true">
            {material.swatch.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span className="rig__loaded-name">{material.name}</span>
          <span className="mono mono--dim">{material.isoLabel}</span>
        </span>

        <span className="spacer" />

        {restoredFrom ? (
          <span className="rig__restored mono">← {restoredFrom}</span>
        ) : null}

        <span className="rig__session mono mono--dim" title="Session opened">
          {timeOf(sessionStart)}
        </span>

        <button className="btn btn--quiet" type="button" onClick={() => dispatch({ type: 'screen', screen: 'import' })}>
          Swap
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

      {/* ---- the spine: benches, not rails ---- */}
      <nav className="rig__spine" aria-label="Benches">
        {BENCHES.map((b) => (
          <button
            key={b.id}
            type="button"
            className="spine__key"
            aria-pressed={bench === b.id}
            title={`${b.hint} · ${b.key.toUpperCase()}`}
            onClick={() => openBench(b.id)}
          >
            <span className="spine__label">{b.label}</span>
            <span className="spine__hint mono">{b.key.toUpperCase()}</span>
          </button>
        ))}

        <span className="spine__gap" />

        <button
          type="button"
          className="spine__key spine__key--go"
          disabled={!specimen}
          title={`All ${EFFECTS.length} effects · F`}
          onClick={() => dispatch({ type: 'screen', screen: 'effects' })}
        >
          <span className="spine__label">Effects</span>
          <span className="spine__hint mono">F</span>
        </button>
        <button
          type="button"
          className="spine__key spine__key--go"
          disabled={!specimen}
          title="Depth-aware light injection, live · L"
          onClick={() => dispatch({ type: 'screen', screen: 'light' })}
        >
          <span className="spine__label">Light</span>
          <span className="spine__hint mono">L</span>
        </button>
        <button
          type="button"
          className="spine__key spine__key--go"
          disabled={!specimen}
          title="Lay it out as a poster · P"
          onClick={() => dispatch({ type: 'screen', screen: 'press' })}
        >
          <span className="spine__label">Press</span>
          <span className="spine__hint mono">P</span>
        </button>

        <span className="spine__gap" />

        <button
          type="button"
          className="spine__key spine__key--quiet"
          title="Back to the plain lab · B"
          onClick={() => dispatch({ type: 'bench', open: false })}
        >
          <span className="spine__label">Plain</span>
          <span className="spine__hint mono">B</span>
        </button>
        <button
          type="button"
          className="spine__key spine__key--quiet"
          aria-pressed={bare}
          title="Just the photograph · H"
          onClick={() => {
            setBench(null);
            setDeckClosed(!bare);
            setBare(!bare);
          }}
        >
          <span className="spine__label">{bare ? 'Show' : 'Bare'}</span>
          <span className="spine__hint mono">H</span>
        </button>
      </nav>

      {/* ---- a bench, pulled open over the picture ---- */}
      {bench ? (
        <aside className="benchpanel" ref={benchRef} data-id={bench}>
          <header className="benchpanel__head">
            <h2 className="benchpanel__title">
              {BENCHES.find((b) => b.id === bench)?.label}
            </h2>
            <span className="benchpanel__hint mono mono--dim">
              {BENCHES.find((b) => b.id === bench)?.hint}
            </span>
            <span className="spacer" />
            <button
              className="benchpanel__shut"
              type="button"
              onClick={() => setBench(null)}
              aria-label="Shut the bench"
            >
              <span className="mono">esc</span>
            </button>
          </header>

          <div className="benchpanel__body">
            {bench === 'stock' ? (
              <>
                <MaterialArchive
                  selected={recipe.material}
                  onSelect={(m) =>
                    dispatch({
                      type: 'edit',
                      mutate: (r) => applyMaterial(r, m),
                      log: {
                        kind: 'material',
                        title: m.name,
                        detail: `${m.manufacturer} · ${m.isoLabel}`,
                      },
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
                        log: {
                          kind: 'material',
                          title: m.name,
                          detail: `${m.manufacturer} · ${m.isoLabel}`,
                        },
                      });
                    }}
                  />
                ) : null}
              </>
            ) : null}

            {bench === 'cook' ? (
              <ProcessPanel
                placing={placing}
                setPlacing={setPlacing}
                onInspect={(id) => dispatch({ type: 'inspect', id })}
              />
            ) : null}

            {bench === 'read' ? (
              <div className="rail__analysis scroll-y">
                <ProcessingStatus stats={stats} />
                <DepthAnalysis stats={stats} />
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* ---- the bench along the foot ---- */}
      <div className="rig__foot">
        <Deck
          tab={deckTab}
          setTab={setDeckTab}
          collapsed={deckClosed}
          setCollapsed={setDeckClosed}
          float
        />
      </div>

      {placing !== 'none' ? (
        <div className="rig__say" role="status">
          <span className="lbl lbl--amber">Placing a burn</span>
          <span className="mono">Click the photograph · esc to stop</span>
        </div>
      ) : null}

      {exportOpen ? <DevelopExport /> : null}
    </div>
  );
}
