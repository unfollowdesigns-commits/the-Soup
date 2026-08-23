import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderStats } from '../engine/renderer';
import { LabRenderer } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import {
  EFFECTS,
  GROUPS,
  activeEffects,
  searchEffects,
  type Effect,
  type EffectGroup,
} from '../lab/catalogue';
import { STAGE_LABEL } from '../lab/recipe';
import { useDispatch, useLab } from '../lab/store';
import { Wordmark } from '../brand/Mark';
import { DevelopExport } from './DevelopExport';
import { LookStrip } from './LookStrip';
import { ProcessPanel } from './ProcessPanel';
import { Range } from './Range';
import { SpecimenViewer } from './SpecimenViewer';

/* ============================================================
   THE WORKSPACE

   Every earlier version made you leave the picture to find an
   effect — first a drawer over it, then a screen instead of it.
   Both are the same mistake: the thing you are choosing between
   is a photograph, and choosing was hidden from seeing.

   So: three columns that are all true at once. The catalogue on
   the left, the photograph in the middle at whatever size is
   left over, and the whole of one effect on the right. Along the
   foot, the chain — what is actually on the picture, in the
   order the engine runs it, each one draggable where it sits.

   Nothing here opens over anything else.
   ============================================================ */

const TW = 210;
const TH = 140;

export function Workspace() {
  const { recipe, specimen, exportOpen, look, strength } = useLab();
  const dispatch = useDispatch();

  const [q, setQ] = useState('');
  const [group, setGroup] = useState<EffectGroup | 'all' | 'on'>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [browse, setBrowse] = useState(true);
  const [looksOpen, setLooksOpen] = useState(false);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const onStats = useCallback((s: RenderStats | null) => setStats(s), []);
  const searchRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef(0);
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;

  const chain = useMemo(() => activeEffects(recipe), [recipe]);
  const liveIds = useMemo(() => new Set(chain.map((e) => e.id)), [chain]);

  const shown = useMemo(() => {
    const found = searchEffects(q);
    if (group === 'all') return found;
    if (group === 'on') return found.filter((e) => liveIds.has(e.id));
    return found.filter((e) => e.group === group);
  }, [q, group, liveIds]);
  const orderRef = useRef<Effect[]>(EFFECTS);
  orderRef.current = shown;

  const current = picked ? EFFECTS.find((e) => e.id === picked) ?? null : null;

  /* ---- keys ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setBrowse(true);
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (typing) (e.target as HTMLElement).blur();
        else if (looksOpen) setLooksOpen(false);
        else if (picked) setPicked(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); setBrowse((v) => !v); }
      if (k === 'k') { e.preventDefault(); setLooksOpen((v) => !v); }
      if (k === 'e' && specimen) { e.preventDefault(); dispatch({ type: 'export', open: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, looksOpen, specimen, dispatch]);

  /* ---- thumbnails: one context, the cards you are looking at first ---- */
  useEffect(() => {
    if (!specimen) return;
    const job = ++jobRef.current;
    let renderer: LabRenderer | null = null;
    void (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = TW;
      canvas.height = TH;
      try {
        renderer = new LabRenderer(canvas);
      } catch {
        return;
      }
      renderer.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
      renderer.resize(TW, TH, 1);
      await new Promise((r) => setTimeout(r, 300));

      const base = bare(recipeRef.current);
      const out: Record<string, string> = {};
      const seen = new Set<string>();
      const queue: Effect[] = [];
      for (const e of orderRef.current) { queue.push(e); seen.add(e.id); }
      for (const e of EFFECTS) if (!seen.has(e.id)) queue.push(e);

      for (const e of queue) {
        if (jobRef.current !== job) break;
        const rec = e.on(structuredClone(base));
        renderer.render(rec, getMaterial(rec.material), {
          zoom: 1, panX: 0, panY: 0, compare: 'single', split: 0.5, view: 'color',
        });
        out[e.id] = canvas.toDataURL('image/jpeg', 0.8);
        setThumbs({ ...out });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      renderer.dispose();
      renderer = null;
    })();
    return () => {
      jobRef.current++;
      renderer?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specimen]);

  const add = (e: Effect) => {
    dispatch({ type: 'edit', mutate: (r) => e.on(r), log: { kind: 'experiment', title: e.name, detail: 'on' } });
    setPicked(e.id);
  };
  const drop = (e: Effect) => {
    dispatch({ type: 'edit', mutate: (r) => e.off(r), log: { kind: 'experiment', title: e.name, detail: 'off' } });
    if (picked === e.id) setPicked(null);
  };
  const amount = (e: Effect, v: number) => dispatch({ type: 'edit', mutate: (r) => e.write(r, v) });

  return (
    <div className="ws" data-browse={browse} data-panel={!!current} data-looks={looksOpen}>
      <header className="ws__top">
        <button className="ws__mark" type="button" onClick={() => dispatch({ type: 'screen', screen: 'enter' })}>
          <Wordmark size={15} />
        </button>

        <button className="ws__toggle" type="button" aria-pressed={browse} onClick={() => setBrowse((v) => !v)}>
          <Bars />
          <span>Effects</span>
          <em className="mono">{EFFECTS.length}</em>
        </button>

        <span className="ws__file">
          <b>{specimen?.name ?? 'Nothing on the table'}</b>
          {specimen ? <i className="mono">{specimen.width} × {specimen.height}</i> : null}
        </span>

        <span className="spacer" />

        <button className="ws__toggle" type="button" aria-pressed={looksOpen} onClick={() => setLooksOpen((v) => !v)}>
          <span>Looks</span>
          <em className="mono">K</em>
        </button>
        <button className="btn btn--quiet" type="button" onClick={() => dispatch({ type: 'screen', screen: 'import' })}>
          Swap
        </button>
        <button
          className="btn btn--primary"
          type="button"
          disabled={!specimen}
          onClick={() => dispatch({ type: 'export', open: true })}
        >
          Export
        </button>
      </header>

      <aside className="ws__browse" aria-label="Effects">
        <div className="ws__search">
          <Mag />
          <input
            ref={searchRef}
            type="text"
            value={q}
            placeholder="Search — tunnel, 8mm, chroma…"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search effects"
          />
          {q ? <button type="button" className="ws__clear" onClick={() => setQ('')} aria-label="Clear">×</button> : null}
          <kbd className="mono">/</kbd>
        </div>

        <div className="ws__groups">
          <button type="button" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>All</button>
          <button type="button" className="is-on" aria-pressed={group === 'on'} onClick={() => setGroup('on')}>
            On<em className="mono">{chain.length}</em>
          </button>
          {GROUPS.map((gp) => (
            <button key={gp} type="button" aria-pressed={group === gp} onClick={() => setGroup(gp)}>
              {gp}
            </button>
          ))}
        </div>

        <div className="ws__cards scroll-y">
          {shown.length === 0 ? <p className="ws__none">Nothing matches that.</p> : null}
          {shown.map((e) => {
            const on = liveIds.has(e.id);
            return (
              <article key={e.id} className="card" data-on={on} data-picked={picked === e.id}>
                <button
                  type="button"
                  className="card__pic"
                  title={e.note}
                  onClick={() => (on ? setPicked(e.id) : add(e))}
                >
                  {thumbs[e.id] ? <img src={thumbs[e.id]} alt="" /> : <span className="card__wait" />}
                  <span className="card__verb">{on ? 'Adjust' : 'Add'}</span>
                </button>
                <div className="card__row">
                  <span className="card__name">{e.name}</span>
                  {on ? (
                    <button className="card__off" type="button" onClick={() => drop(e)} aria-label={`Remove ${e.name}`}>×</button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </aside>

      <main className="ws__stage">
        <SpecimenViewer onStats={onStats} placing="none" onPlaced={() => undefined} chrome="bleed" />
      </main>

      {current ? (
        <aside className="ws__panel" aria-label={current.name}>
          <header className="ws__panelhead">
            <div>
              <h2>{current.name}</h2>
              <span className="ws__panelgroup">{current.group} · {STAGE_LABEL[current.stage]}</span>
            </div>
            <button type="button" className="ws__shut" onClick={() => setPicked(null)} aria-label="Close">×</button>
          </header>

          <div className="ws__panelbody scroll-y">
            <p className="ws__panelnote">{current.note}</p>

            <Range
              value={current.read(recipe)}
              onChange={(v) => amount(current, v)}
              label="Amount"
              format={(v) => `${Math.round(v * 100)}`}
              ticks={11}
            />

            {current.presets ? (
              <div className="ws__presets">
                {current.presets.map((pr) => (
                  <button
                    key={pr.label}
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'edit',
                        mutate: (r) => pr.apply(r),
                        log: { kind: 'experiment', title: current.name, detail: pr.label },
                      })
                    }
                  >
                    {pr.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="ws__all">
              <span className="ws__allhead">Everything in {STAGE_LABEL[current.stage]}</span>
              <ProcessPanel
                placing="none"
                setPlacing={() => undefined}
                onInspect={() => undefined}
                only={[current.stage]}
                bare
              />
            </div>

            <button className="btn btn--danger btn--block" type="button" onClick={() => drop(current)}>
              Take {current.name} off
            </button>
          </div>
        </aside>
      ) : null}

      <footer className="ws__chain">
        <span className="ws__chainhead">
          Chain <em className="mono">{chain.length}</em>
        </span>
        <div className="ws__chainrail">
          {chain.length === 0 ? (
            <span className="ws__chainnone">
              Nothing on the picture. Add something from the left, or press <kbd className="mono">K</kbd> for a whole look.
            </span>
          ) : null}
          {chain.map((e) => (
            <div key={e.id} className="link" data-picked={picked === e.id}>
              <button type="button" className="link__name" onClick={() => setPicked(picked === e.id ? null : e.id)}>
                {e.name}
              </button>
              <Range
                value={e.read(recipe)}
                onChange={(v) => amount(e, v)}
                size="tight"
                format={(v) => `${Math.round(v * 100)}`}
              />
              <button type="button" className="link__off" onClick={() => drop(e)} aria-label={`Remove ${e.name}`}>×</button>
            </div>
          ))}
        </div>

        {look ? (
          <div className="ws__look">
            <span className="ws__lookname">{look.name}</span>
            <Range
              value={strength}
              onChange={(v) => dispatch({ type: 'strength', value: v })}
              size="tight"
              format={(v) => `${Math.round(v * 100)}`}
            />
          </div>
        ) : null}
      </footer>

      {looksOpen ? (
        <div className="ws__looks">
          <header>
            <h2>Looks</h2>
            <span className="mono">a whole recipe in one click</span>
            <span className="spacer" />
            <button type="button" onClick={() => setLooksOpen(false)} aria-label="Close">×</button>
          </header>
          <LookStrip big />
        </div>
      ) : null}

      {stats && stats.frameMs > 0 ? (
        <span className="ws__meter mono" title="What the engine is doing">
          {stats.passes} passes · {stats.frameMs.toFixed(1)}ms
          {stats.gpuMs != null ? ` · gpu ${stats.gpuMs.toFixed(1)}ms` : ''}
        </span>
      ) : null}

      {exportOpen ? <DevelopExport /> : null}
    </div>
  );
}

/** a copy of the recipe with every catalogue effect switched off */
function bare(r: import('../lab/types').PhotoRecipe) {
  let out = structuredClone(r);
  for (const e of EFFECTS) out = e.off(out);
  return out;
}

const Bars = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M1 2h10M1 6h10M1 10h6" stroke="currentColor" strokeWidth="1.4" fill="none" />
  </svg>
);

const Mag = () => (
  <svg className="ws__mag" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
    <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8.6 8.6 L12 12" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
