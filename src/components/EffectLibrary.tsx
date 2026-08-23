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

const TW = 156;
const TH = 104;

export function EffectLibrary() {
  const { recipe, specimen } = useLab();
  const dispatch = useDispatch();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<EffectGroup | 'all' | 'on'>('all');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
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
      <div className="lib__find">
        <input
          className="lib__search"
          type="search"
          value={q}
          placeholder={`Search ${EFFECTS.length} effects — try "tunnel", "8mm", "chroma"`}
          onChange={(ev) => setQ(ev.target.value)}
          aria-label="Search effects"
        />
        <span className="lib__count mono">
          {shown.length}/{EFFECTS.length}
        </span>
      </div>

      <div className="lib__groups">
        <button type="button" className="lib__group" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
          Everything
        </button>
        <button
          type="button"
          className="lib__group lib__group--on"
          aria-pressed={group === 'on'}
          onClick={() => setGroup('on')}
        >
          On the picture <span className="mono">{live.size}</span>
        </button>
        {GROUPS.map((gp) => (
          <button
            key={gp}
            type="button"
            className="lib__group"
            aria-pressed={group === gp}
            onClick={() => setGroup(gp)}
          >
            {gp}
          </button>
        ))}
      </div>

      <div className="lib__grid scroll-y">
        {shown.length === 0 ? (
          <p className="lib__none mono">Nothing here matches that.</p>
        ) : null}
        {shown.map((e) => {
          const amount = e.read(recipe);
          const isOn = amount > 0.001;
          const isOpen = open === e.id;
          return (
            <article key={e.id} className="fx" data-on={isOn} data-open={isOpen}>
              <button
                type="button"
                className="fx__frame"
                title={e.note}
                onClick={() => (isOn ? setOpen(isOpen ? null : e.id) : add(e))}
              >
                {thumbs[e.id] ? (
                  <img src={thumbs[e.id]} alt="" width={TW} height={TH} />
                ) : (
                  <span className="fx__pending" />
                )}
                {isOn ? <span className="fx__on mono">{Math.round(amount * 100)}</span> : null}
              </button>

              <div className="fx__head">
                <span className="fx__name">{e.name}</span>
                <span className="fx__group mono">{e.group}</span>
              </div>

              {isOn ? (
                <div className="fx__live">
                  <input
                    className="fx__slider"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={amount}
                    aria-label={`${e.name} amount`}
                    onChange={(ev) => setAmount(e, +ev.target.value)}
                  />
                  <button className="fx__out" type="button" onClick={() => remove(e)} aria-label={`Take ${e.name} off`}>
                    ×
                  </button>
                </div>
              ) : null}

              {isOpen ? (
                <div className="fx__more">
                  <p className="fx__note">{e.note}</p>
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
              ) : null}
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
