import { useCallback, useState } from 'react';
import { Deck } from '../components/Deck';
import { DevelopExport } from '../components/DevelopExport';
import { MaterialDetail } from '../components/MaterialDetail';
import { MaterialRecord } from '../components/MaterialArchive';
import { ProcessPanel } from '../components/ProcessPanel';
import { SpecimenViewer, type PlacementMode } from '../components/SpecimenViewer';
import { DepthAnalysis, ProcessingStatus } from '../components/Status';
import type { RenderStats } from '../engine/renderer';
import { ERAS, KIND_LABEL, MATERIALS, getMaterial } from '../lab/materials';
import { applyMaterial, describeAmount, stageSummary } from '../lab/recipe';
import { useDispatch, useLab } from '../lab/store';
import type { StageId } from '../lab/types';

/* ============================================================
   MOBILE — a portable darkroom, not a folded desktop.
   The photograph keeps the screen. Everything else arrives as a
   sheet, and leaves again.
   ============================================================ */

type Tab = 'lab' | 'materials' | 'experiment' | 'recipes' | 'analysis';

export function MobileLab() {
  const { recipe, specimen, inspecting, exportOpen } = useLab();
  const dispatch = useDispatch();
  const [tab, setTab] = useState<Tab>('lab');
  const [sheet, setSheet] = useState<StageId[] | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [placing, setPlacing] = useState<PlacementMode>('none');
  const onStats = useCallback((s: RenderStats | null) => setStats(s), []);
  const m = getMaterial(recipe.material);

  return (
    <div className="mob">
      <header className="mob__bar">
        <span className="mob__title">Lab</span>
        <span className="spacer" />
        <button className="btn btn--sm" type="button" onClick={() => dispatch({ type: 'screen', screen: 'import' })}>
          Specimen
        </button>
        <button
          className="btn btn--sm btn--primary"
          type="button"
          disabled={!specimen}
          onClick={() => dispatch({ type: 'export', open: true })}
        >
          Develop
        </button>
      </header>

      <div className="mob__viewer">
        <SpecimenViewer onStats={onStats} placing={placing} onPlaced={() => setPlacing('none')} />
      </div>

      <div className="mob__panel">
        {tab === 'lab' ? (
          <LabTab onOpen={(ids) => setSheet(ids)} />
        ) : null}
        {tab === 'materials' ? <MaterialsTab /> : null}
        {tab === 'experiment' ? <ExperimentTab onOpen={(ids) => setSheet(ids)} /> : null}
        {tab === 'recipes' ? <RecipesTab /> : null}
        {tab === 'analysis' ? (
          <div className="mob__scroll scroll-y">
            <ProcessingStatus stats={stats} />
            <DepthAnalysis stats={stats} />
          </div>
        ) : null}
      </div>

      <nav className="mob__nav" aria-label="Sections">
        {(
          [
            ['lab', 'Lab'],
            ['materials', 'Materials'],
            ['experiment', 'Experiment'],
            ['recipes', 'Recipes'],
            ['analysis', 'Analysis'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="mob__navbtn"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            <span className="lbl">{label}</span>
          </button>
        ))}
      </nav>

      {sheet ? (
        <Sheet title={sheetTitle(sheet)} onClose={() => setSheet(null)}>
          <ProcessPanel
            bare
            only={sheet}
            placing={placing}
            setPlacing={setPlacing}
            onInspect={(id) => dispatch({ type: 'inspect', id })}
          />
        </Sheet>
      ) : null}

      {inspecting ? (
        <Sheet title="Record" onClose={() => dispatch({ type: 'inspect', id: null })} tall>
          <MaterialDetail
            id={inspecting}
            loaded={inspecting === m.id}
            onClose={() => dispatch({ type: 'inspect', id: null })}
            onLoad={() => {
              const mat = getMaterial(inspecting);
              dispatch({
                type: 'edit',
                mutate: (r) => applyMaterial(r, mat),
                log: { kind: 'material', title: mat.name, detail: mat.manufacturer },
              });
            }}
          />
        </Sheet>
      ) : null}

      {exportOpen ? <DevelopExport /> : null}
    </div>
  );
}

/* ---- LAB: the photograph and the four values you actually reach for ---- */
function LabTab({ onOpen }: { onOpen: (ids: StageId[]) => void }) {
  const { recipe } = useLab();
  const m = getMaterial(recipe.material);
  const meters: [string, string, StageId[]][] = [
    ['Grain', describeAmount(recipe.grain.amount), ['grain']],
    ['Halation', recipe.halation.intensity.toFixed(2), ['halation']],
    ['Exposure', stageSummary('exposure', recipe), ['exposure']],
    ['Development', stageSummary('development', recipe), ['development']],
    ['Burn', stageSummary('burn', recipe), ['burn']],
    ['Soup', stageSummary('soup', recipe), ['soup']],
  ];
  return (
    <div className="mob__lab">
      <button className="mob__matbar" type="button" onClick={() => onOpen(['material', 'exposure'])}>
        <span className="mob__matswatch" aria-hidden="true">
          {m.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
        </span>
        <span className="mob__matbody">
          <span className="mob__matname">{m.name}</span>
          <span className="mono mono--dim">{KIND_LABEL[m.kind]} · {m.isoLabel}</span>
        </span>
      </button>
      <ul className="mob__meters">
        {meters.map(([k, v, ids]) => (
          <li key={k}>
            <button type="button" onClick={() => onOpen(ids)}>
              <span className="lbl">{k}</span>
              <span className="mono mono--val">{v}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn--block" type="button" onClick={() => onOpen(['diffusion', 'optics', 'damage', 'depth'])}>
        All controls
      </button>
    </div>
  );
}

/* ---- MATERIALS: an archive you swipe through ---- */
function MaterialsTab() {
  const { recipe } = useLab();
  const dispatch = useDispatch();
  const [era, setEra] = useState<string | null>(null);
  const list = era ? MATERIALS.filter((m) => m.era === era) : MATERIALS;

  return (
    <div className="mob__materials">
      <div className="mob__eras">
        <button type="button" className="chip" aria-pressed={!era} onClick={() => setEra(null)}>
          All
        </button>
        {ERAS.map((e) => (
          <button
            key={e.id}
            type="button"
            className="chip"
            aria-pressed={era === e.id}
            onClick={() => setEra(e.id)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <div className="mob__strip">
        {list.map((m) => (
          <button
            key={m.id}
            type="button"
            className="mob__spec"
            aria-pressed={m.id === recipe.material}
            onClick={() =>
              dispatch({
                type: 'edit',
                mutate: (r) => applyMaterial(r, m),
                log: { kind: 'material', title: m.name, detail: m.manufacturer },
              })
            }
          >
            <span className="mob__spec-swatch" aria-hidden="true">
              {m.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
            </span>
            <span className="mob__spec-name">{m.name}</span>
            <span className="mono mono--dim">{m.isoLabel}</span>
          </button>
        ))}
      </div>
      <div className="mob__list scroll-y">
        {list.map((m) => (
          <MaterialRecord
            key={m.id}
            material={m}
            compact
            selected={m.id === recipe.material}
            onSelect={() =>
              dispatch({
                type: 'edit',
                mutate: (r) => applyMaterial(r, m),
                log: { kind: 'material', title: m.name, detail: m.manufacturer },
              })
            }
            onInspect={() => dispatch({ type: 'inspect', id: m.id })}
          />
        ))}
      </div>
    </div>
  );
}

function ExperimentTab({ onOpen }: { onOpen: (ids: StageId[]) => void }) {
  return (
    <div className="mob__scroll scroll-y">
      <div className="mob__exp">
        <button className="btn btn--block btn--lg" type="button" onClick={() => onOpen(['soup'])}>
          Film Soup
        </button>
        <button className="btn btn--block btn--lg" type="button" onClick={() => onOpen(['burn'])}>
          Film Burn
        </button>
        <button className="btn btn--block btn--lg" type="button" onClick={() => onOpen(['damage'])}>
          Damage & Age
        </button>
        <button className="btn btn--block btn--lg" type="button" onClick={() => onOpen(['depth'])}>
          Depth
        </button>
      </div>
      <Deck tab="random" setTab={() => {}} collapsed={false} setCollapsed={() => {}} />
    </div>
  );
}

function RecipesTab() {
  const [tab, setTab] = useState<'recipes' | 'log' | 'stack'>('recipes');
  return (
    <div className="mob__scroll scroll-y">
      <Deck tab={tab} setTab={(t) => setTab(t as 'recipes' | 'log' | 'stack')} collapsed={false} setCollapsed={() => {}} />
    </div>
  );
}

/* ---- the sheet ---- */
function Sheet({
  title,
  children,
  onClose,
  tall = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  tall?: boolean;
}) {
  return (
    <div className="msheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="msheet__scrim" onClick={onClose} />
      <div className="msheet__panel" data-tall={tall}>
        <div className="msheet__grip" onClick={onClose} role="presentation">
          <span />
        </div>
        <header className="msheet__head">
          <span className="lbl lbl--wide">{title}</span>
          <span className="spacer" />
          <button className="btn btn--sm btn--quiet" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="msheet__body scroll-y">{children}</div>
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  material: 'Material',
  exposure: 'Exposure',
  development: 'Development',
  grain: 'Grain',
  halation: 'Halation',
  diffusion: 'Diffusion',
  optics: 'Optics',
  burn: 'Film Burn',
  soup: 'Film Soup',
  damage: 'Damage',
  depth: 'Depth',
};

function sheetTitle(ids: StageId[]) {
  return ids.length === 1 ? TITLES[ids[0]] : 'Controls';
}
