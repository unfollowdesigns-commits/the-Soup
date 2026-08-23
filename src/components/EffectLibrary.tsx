import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDispatch, useLab } from '../lab/store';
import { Range } from './Range';

/* ============================================================
   THE EFFECT LIBRARY

   The stages are how the engine is built. This is how you look
   for something: one flat, searchable catalogue where every
   effect is addressable by the words you would actually type.

   Each card renders that one effect on the photograph on the
   table — not a stock swatch, not an icon. One WebGL context
   renders every card in turn and copies each frame off to a
   still, so the whole library costs one context.
   ============================================================ */

const TW = 264;
const TH = 176;

export function EffectLibrary({ onClose }: { onClose: () => void }) {
  const { recipe, specimen } = useLab();
  const dispatch = useDispatch();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<EffectGroup | 'all' | 'on'>('all');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const jobRef = useRef(0);
  /* what the grid is showing, so the renderer can do those first */
  const orderRef = useRef<Effect[]>(EFFECTS);

  const live = useMemo(() => new Set(activeEffects(recipe).map((e) => e.id)), [recipe]);

  const shown = useMemo(() => {
    const found = searchEffects(q);
    if (group === 'all') return found;
    if (group === 'on') return found.filter((e) => live.has(e.id));
    return found.filter((e) => e.group === group);
  }, [q, group, live]);

  /* ---- one context, every card ----
     The thumbnails are built from the specimen alone. They must not
     rebuild while you drag a slider, or the library would fight the
     bench for the GPU. */
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
        return; // no WebGL2: the library still works, as a list
      }
      renderer.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
      renderer.resize(TW, TH, 1);
      await new Promise((r) => setTimeout(r, 300));

      const base = structuredClone(recipeSnapshot.current);
      const out: Record<string, string> = {};
      /* the cards you are looking at come first; the rest fill in behind.
         A software renderer takes a second a card, and nobody should be
         made to wait for a category they are not looking at. */
      const seen = new Set<string>();
      const queue: Effect[] = [];
      for (const e of orderRef.current) { queue.push(e); seen.add(e.id); }
      for (const e of EFFECTS) if (!seen.has(e.id)) queue.push(e);

      for (const e of queue) {
        if (jobRef.current !== job) break;
        // each card shows that effect alone, on a plain version of the
        // recipe, so what you see is what adding it will do
        const rec = e.on(plain(base));
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

  const recipeSnapshot = useRef(recipe);
  recipeSnapshot.current = recipe;
  orderRef.current = shown;

  const add = (e: Effect) =>
    dispatch({
      type: 'edit',
      mutate: (r) => e.on(r),
      log: { kind: 'experiment', title: e.name, detail: 'added' },
    });
  const remove = (e: Effect) =>
    dispatch({
      type: 'edit',
      mutate: (r) => e.off(r),
      log: { kind: 'experiment', title: e.name, detail: 'removed' },
    });
  const setAmount = (e: Effect, v: number) =>
    dispatch({ type: 'edit', mutate: (r) => e.write(r, v) });

  return (
    <div className="lib">
      <header className="lib__bar">
        <h1 className="lib__title">Effects</h1>
        <span className="lib__tally mono">
          <b>{shown.length}</b> of {EFFECTS.length}
          {live.size ? <><span className="lib__sep">·</span><em>{live.size} on</em></> : null}
        </span>
        <span className="spacer" />
        <div className="lib__searchwrap">
          <svg className="lib__mag" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8.6 8.6 L12 12" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <input
            className="lib__search"
            type="text"
            value={q}
            autoFocus
            placeholder={`tunnel · 8mm · chroma · countdown`}
            onChange={(ev) => setQ(ev.target.value)}
            aria-label="Search effects"
          />
          {q ? (
            <button className="lib__clear" type="button" onClick={() => setQ('')} aria-label="Clear">×</button>
          ) : null}
        </div>
        <button className="lib__done" type="button" onClick={onClose}>
          Back to the picture
          <span className="mono">esc</span>
        </button>
      </header>

      <nav className="lib__groups" aria-label="Categories">
        <button type="button" className="lib__group" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
          Everything
        </button>
        <button
          type="button"
          className="lib__group lib__group--on"
          aria-pressed={group === 'on'}
          onClick={() => setGroup('on')}
        >
          On the picture<span className="mono">{live.size}</span>
        </button>
        <span className="lib__gap" />
        {GROUPS.map((gp) => (
          <button
            key={gp}
            type="button"
            className="lib__group"
            aria-pressed={group === gp}
            onClick={() => setGroup(gp)}
          >
            {gp}
            <span className="mono">{EFFECTS.filter((e) => e.group === gp).length}</span>
          </button>
        ))}
      </nav>

      <div className="lib__grid scroll-y">
        {shown.length === 0 ? (
          <p className="lib__none mono">Nothing here matches that.</p>
        ) : null}
        {shown.map((e) => {
          const amount = e.read(recipe);
          const isOn = amount > 0.001;
          return (
            <article key={e.id} className="fx" data-on={isOn}>
              <button
                type="button"
                className="fx__frame"
                title={e.note}
                onClick={() => (isOn ? remove(e) : add(e))}
                aria-pressed={isOn}
              >
                {thumbs[e.id] ? (
                  <img src={thumbs[e.id]} alt="" width={TW} height={TH} />
                ) : (
                  <span className="fx__pending" />
                )}
                <span className="fx__verb">{isOn ? 'Take it off' : 'Put it on'}</span>
                {isOn ? <span className="fx__on mono">{Math.round(amount * 100)}</span> : null}
              </button>

              <div className="fx__body">
                <div className="fx__head">
                  <h2 className="fx__name">{e.name}</h2>
                  <span className="fx__group">{e.group}</span>
                </div>
                <p className="fx__note">{e.note}</p>

                {isOn ? (
                  <Range
                    value={amount}
                    onChange={(v) => setAmount(e, v)}
                    label="Amount"
                    format={(v) => `${Math.round(v * 100)}`}
                    size="tight"
                  />
                ) : null}

                {e.presets ? (
                  <div className="fx__presets">
                    {e.presets.map((pr) => (
                      <button
                        key={pr.label}
                        type="button"
                        className="fx__preset"
                        onClick={() =>
                          dispatch({
                            type: 'edit',
                            mutate: (r) => pr.apply(r),
                            log: { kind: 'experiment', title: e.name, detail: pr.label },
                          })
                        }
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* A copy of the recipe with every effect switched off, so a card shows
   its own effect and nothing else. */
function plain(r: import('../lab/types').PhotoRecipe) {
  let out = structuredClone(r);
  for (const e of EFFECTS) out = e.off(out);
  return out;
}
