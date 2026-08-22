import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { getMaterial } from '../lab/materials';
import {
  STAGE_LABEL,
  STAGE_ORDER,
  mutateRecipe,
  newSeed,
  proposeRecipeCode,
  randomExperiment,
  seedLabel,
  stageActive,
  stageSummary,
} from '../lab/recipe';
import { timeOf, timeOfSec, useDispatch, useLab } from '../lab/store';
import type { LogEntry, PhotoRecipe, StageId } from '../lab/types';
import { DIALS, toggleStage } from '../lab/stageDial';
import { Cross } from './MaterialDetail';
import { LookStrip } from './LookStrip';
import { LOOKS } from '../lab/looks';

/* ============================================================
   THE DECK
   The bench in front of the workstation: the process stack, the
   experiment log, and the archived recipes.
   ============================================================ */

export type DeckTab = 'looks' | 'stack' | 'log' | 'recipes' | 'random';

export const DECK_TABS: DeckTab[] = ['looks', 'stack', 'random', 'log', 'recipes'];

export function Deck({
  tab,
  setTab,
  collapsed,
  setCollapsed,
  float = false,
}: {
  tab: DeckTab;
  setTab: (t: DeckTab) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  /** the rig floats the bench over the photograph instead of docking it */
  float?: boolean;
}) {
  const { log, archive } = useLab();
  const tabs: { id: DeckTab; label: string; count?: number }[] = [
    { id: 'looks', label: 'Looks', count: LOOKS.length },
    { id: 'stack', label: 'Recipe' },
    { id: 'random', label: 'Roll the dice' },
    { id: 'log', label: 'Log', count: log.length },
    { id: 'recipes', label: 'Book', count: archive.length },
  ];

  return (
    <section
      className={float ? 'deck deck--float' : 'deck tooth'}
      data-collapsed={collapsed}
      aria-label="Bench"
    >
      <header className="deck__bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="deck__tab"
            aria-pressed={!collapsed && tab === t.id}
            onClick={() => {
              if (collapsed) setCollapsed(false);
              setTab(t.id);
            }}
          >
            <span className="lbl">{t.label}</span>
            {t.count ? <span className="deck__count mono">{t.count}</span> : null}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="icb"
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Open the bench' : 'Close the bench'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d={collapsed ? 'M1.5 6.5 L5 3 L8.5 6.5' : 'M1.5 3.5 L5 7 L8.5 3.5'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
            />
          </svg>
        </button>
      </header>

      {!collapsed ? (
        <div className="deck__body">
          {tab === 'looks' ? <LookStrip /> : null}
          {tab === 'stack' ? <ExperimentStack /> : null}
          {tab === 'random' ? <RandomExperiment /> : null}
          {tab === 'log' ? <ExperimentLog /> : null}
          {tab === 'recipes' ? <RecipeArchive /> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ============================================================
   PROCESS STACK — the recipe, made editable
   ============================================================ */
export function ExperimentStack() {
  const { stack, recipe } = useLab();
  const dispatch = useDispatch();
  const missing = STAGE_ORDER.filter((id) => !stack.some((s) => s.id === id));

  return (
    <div className="stack">
      <ol className="stack__row">
        {stack.map((s, i) => (
          <StageCard
            key={s.id}
            id={s.id}
            index={i}
            enabled={s.enabled}
            first={i === 0}
            last={i === stack.length - 1}
            recipe={recipe}
          />
        ))}
      </ol>

      {missing.length ? (
        <div className="stack__missing">
          <span className="lbl">Off the strip</span>
          {missing.map((id) => (
            <button
              key={id}
              className="btn btn--sm"
              type="button"
              onClick={() => dispatch({ type: 'stack:restore', id: id as StageId })}
            >
              + {STAGE_LABEL[id]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------
   A STAGE CARD IS AN INSTRUMENT
   Drag it sideways to cook. Click a sleeping one to wake it. A
   card that only ever said "None" told you a thing existed and
   gave you no way to reach it.
   ------------------------------------------------------------ */
function StageCard({
  id,
  index,
  enabled,
  first,
  last,
  recipe,
}: {
  id: StageId;
  index: number;
  enabled: boolean;
  first: boolean;
  last: boolean;
  recipe: PhotoRecipe;
}) {
  const dispatch = useDispatch();
  const dial = DIALS[id];
  const value = dial.get(recipe);
  const live = stageActive(id, recipe) && enabled;
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const commit = (v: number) =>
    dispatch({ type: 'edit', mutate: (r) => dial.set(r, v) });

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (dial.chooseOnly) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, moved: false };
    setDragging(true);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    commit(Math.min(1, Math.max(0, d.v + dx / 150)));
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragging(false);
    if (!d.moved) {
      // a tap wakes a sleeping stage, or puts a running one to sleep
      dispatch({
        type: 'edit',
        mutate: (r) => toggleStage(r, id),
        log: {
          kind: 'experiment',
          title: `${STAGE_LABEL[id]} ${live ? 'off' : 'on'}`,
          detail: stageSummary(id, recipe),
        },
      });
    } else {
      dispatch({
        type: 'log',
        spec: { kind: 'experiment', title: STAGE_LABEL[id], detail: stageSummary(id, recipe) },
      });
    }
  };

  return (
    <li
      className="stagecard"
      data-on={enabled}
      data-live={live}
      data-dragging={dragging}
      data-choose={!!dial.chooseOnly}
    >
      <div
        className="stagecard__grip"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role={dial.chooseOnly ? undefined : 'slider'}
        aria-valuenow={dial.chooseOnly ? undefined : Math.round(value * 100)}
        aria-label={STAGE_LABEL[id]}
        tabIndex={dial.chooseOnly ? -1 : 0}
        onKeyDown={(e) => {
          if (dial.chooseOnly) return;
          if (e.key === 'ArrowRight') commit(Math.min(1, value + 0.05));
          else if (e.key === 'ArrowLeft') commit(Math.max(0, value - 0.05));
          else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dispatch({ type: 'edit', mutate: (r) => toggleStage(r, id) });
          } else return;
          e.preventDefault();
        }}
      >
        <div className="stagecard__head">
          <span className="mono stagecard__idx">{String(index + 1).padStart(2, '0')}</span>
          <span className="spacer" />
          <span className="stagecard__tools">
            <button
              className="icb icb--xs"
              type="button"
              title="Earlier"
              disabled={first}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dispatch({ type: 'stack:move', id, dir: -1 })}
            >
              <Arrow dir="left" />
            </button>
            <button
              className="icb icb--xs"
              type="button"
              title="Later"
              disabled={last}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dispatch({ type: 'stack:move', id, dir: 1 })}
            >
              <Arrow dir="right" />
            </button>
            <button
              className="icb icb--xs"
              type="button"
              title="Take it off the strip"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dispatch({ type: 'stack:remove', id })}
            >
              <Cross />
            </button>
          </span>
        </div>

        <p className="stagecard__name">{STAGE_LABEL[id]}</p>
        <p className="stagecard__value mono">
          {live ? stageSummary(id, recipe) : dial.chooseOnly ? stageSummary(id, recipe) : 'OFF'}
        </p>

        {!dial.chooseOnly ? (
          <span className="stagecard__bar" aria-hidden="true">
            <i style={{ width: `${Math.round(value * 100)}%` }} />
          </span>
        ) : null}

        {!live && !dial.chooseOnly ? (
          <span className="stagecard__hint">tap to cook · drag to set</span>
        ) : null}
      </div>
    </li>
  );
}

/* ============================================================
   RANDOM EXPERIMENT
   ============================================================ */
function RandomExperiment() {
  const { recipe } = useLab();
  const dispatch = useDispatch();
  const [seed, setSeed] = useState(() => newSeed());
  const m = getMaterial(recipe.material);

  const run = (s: number) => {
    setSeed(s);
    dispatch({
      type: 'edit',
      mutate: () => randomExperiment(s),
      log: { kind: 'experiment', title: 'Random Experiment', detail: `Seed ${seedLabel(s)}` },
    });
  };

  return (
    <div className="random">
      <div className="random__head">
        <p className="serif random__lead">
          The lab picks a combination. Run it, push it further, or keep it.
        </p>
        <div className="random__actions">
          <button className="btn btn--primary" type="button" onClick={() => run(newSeed())}>
            Run
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const s = newSeed();
              setSeed(s);
              dispatch({
                type: 'edit',
                mutate: (r) => mutateRecipe(r, s, 0.22),
                log: { kind: 'experiment', title: 'Mutated', detail: `Seed ${seedLabel(s)}` },
              });
            }}
          >
            Mutate
          </button>
          <button className="btn" type="button" onClick={() => dispatch({ type: 'archive:add' })}>
            Archive
          </button>
          <span className="spacer" />
          <span className="mono mono--dim">Seed {seedLabel(seed)}</span>
        </div>
      </div>

      <ul className="random__grid">
        {(
          [
            ['Material', m.name],
            ['Development', stageSummary('development', recipe)],
            ['Exposure', stageSummary('exposure', recipe)],
            ['Grain', stageSummary('grain', recipe)],
            ['Halation', stageSummary('halation', recipe)],
            ['Diffusion', stageSummary('diffusion', recipe)],
            ['Optics', stageSummary('optics', recipe)],
            ['Burn', stageSummary('burn', recipe)],
            ['Film Soup', stageSummary('soup', recipe)],
            ['Damage', stageSummary('damage', recipe)],
          ] as const
        ).map(([k, v]) => (
          <li key={k}>
            <span className="lbl">{k}</span>
            <span className="mono mono--val">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================
   EXPERIMENT LOG
   ============================================================ */
export function ExperimentLog() {
  const { log } = useLab();
  const dispatch = useDispatch();

  if (!log.length) {
    return <p className="deck__none mono mono--dim">Nothing logged yet. Every change you commit lands here.</p>;
  }

  return (
    <div className="loglist">
      <div className="loglist__tools">
        <button className="btn btn--sm btn--quiet" type="button" onClick={() => dispatch({ type: 'log:clear' })}>
          Clear log
        </button>
      </div>
      <ol className="loglist__items scroll-y">
        {log.map((e) => (
          <LogRow key={e.id} entry={e} onRestore={() => dispatch({ type: 'log:restore', id: e.id })} />
        ))}
      </ol>
    </div>
  );
}

function LogRow({ entry, onRestore }: { entry: LogEntry; onRestore: () => void }) {
  return (
    <li className="logrow" data-kind={entry.kind}>
      <span className="mono mono--dim logrow__time">{timeOfSec(entry.at)}</span>
      <span className="logrow__body">
        <span className="logrow__title lbl lbl--lit">{entry.title}</span>
        <span className="mono logrow__detail">{entry.detail}</span>
      </span>
      <button className="btn btn--sm btn--quiet" type="button" onClick={onRestore}>
        Return
      </button>
    </li>
  );
}

/* ============================================================
   RECIPE ARCHIVE
   ============================================================ */
export function RecipeArchive() {
  const { archive, recipe } = useLab();
  const dispatch = useDispatch();
  const proposed = proposeRecipeCode(recipe, archive.length + 1);

  return (
    <div className="recipes">
      <div className="recipes__tools">
        <span className="lbl">Keep this cook as</span>
        <span className="mono mono--val recipes__proposed">{proposed}</span>
        <button className="btn btn--sm btn--primary" type="button" onClick={() => dispatch({ type: 'archive:add' })}>
          Keep it
        </button>
      </div>

      {archive.length ? (
        <ul className="recipes__grid">
          {archive.map((r) => (
            <li key={r.id}>
              <RecipeCard
                code={r.code}
                material={getMaterial(r.materialId).name}
                at={r.createdAt}
                onLoad={() => dispatch({ type: 'archive:load', id: r.id })}
                onRemove={() => dispatch({ type: 'archive:remove', id: r.id })}
                seeds={[r.recipe.grain.seed, r.recipe.experimental.soupSeed, r.recipe.experimental.seed]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="deck__none mono mono--dim">
          Nothing kept yet. A recipe stores every value and every seed, so it
          cooks the same way twice.
        </p>
      )}
    </div>
  );
}

export function RecipeCard({
  code,
  material,
  at,
  seeds,
  onLoad,
  onRemove,
}: {
  code: string;
  material: string;
  at: number;
  seeds: number[];
  onLoad: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="rcard">
      <div className="rcard__label">
        <span className="rcard__code">{code}</span>
        <span className="mono mono--dim">{material}</span>
      </div>
      <div className="rcard__seeds mono mono--dim">
        {seeds.map((s, i) => (
          <span key={i}>{seedLabel(s)}</span>
        ))}
      </div>
      <div className="rcard__foot">
        <span className="mono mono--dim">{timeOf(at)}</span>
        <span className="spacer" />
        <button className="btn btn--sm" type="button" onClick={onLoad}>Load</button>
        <button className="btn btn--sm btn--quiet btn--danger" type="button" onClick={onRemove}>
          Discard
        </button>
      </div>
    </article>
  );
}

function Arrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M5.4 1.2 L2.2 4 L5.4 6.8' : 'M2.6 1.2 L5.8 4 L2.6 6.8'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

