import { Fragment, useState } from 'react';
import { getMaterial, KIND_LABEL } from '../lab/materials';
import {
  DEV_LABEL,
  BLUR_MODES,
  ECHO_MODES,
  RD_STYLES,
  WARP_MODES,
  WARP_EDGES,
  GATE_FORMATS,
  PAPER_STOCKS,
  GLYPH_RAMPS,
  TRACE_COLOURS,
  TRACE_MODES,
  traceCount,
  DEV_NOTE,
  DEVELOPER_LABEL,
  DEVELOPER_NOTE,
  SOUP_CHEMICALS,
  describeAmount,
  makeBurn,
  newSeed,
  seedLabel,
  stageSummary,
} from '../lab/recipe';
import { useDispatch, useLab, useEdit } from '../lab/store';
import type {
  BlurMode,
  EchoMode,
  RDStyle,
  WarpEdge,
  PaperStock,
  BurnMark,
  TraceColour,
  TraceMode,
  DevelopmentMode,
  DeveloperStyle,
  LogKind,
  PhotoRecipe,
  SoupChemical,
  StageId,
} from '../lab/types';
import { ExposureScale, Instrument, Module, Segmented, SeedField } from './Instrument';
import { Switch } from './Dial';
import { useVision } from '../vision/useVision';
import { ACTION_LABEL, PINCH_TARGETS, type GestureAction } from '../vision/gestures';
import { STAGE_LABEL as SL } from '../lab/recipe';

/* ============================================================
   THE WORKSTATION
   Each module is one stage of the process. Order here follows the
   order in the tank, not the order of a settings screen.
   ============================================================ */

type Setter = (mutate: (r: PhotoRecipe) => PhotoRecipe, kind: LogKind, title: string, detail: string) => void;

function useProcess() {
  const { draft, edit, commit } = useEdit();
  const live: Setter = (mutate, kind, title, detail) =>
    draft(mutate, { kind, title, detail, coalesce: `${kind}:${title}` });
  const once: Setter = (mutate, kind, title, detail) => edit(mutate, { kind, title, detail });
  return { live, once, commit };
}

export function ProcessPanel({
  placing,
  setPlacing,
  onInspect,
  only,
  bare = false,
}: {
  placing: 'none' | 'burn';
  setPlacing: (p: 'none' | 'burn') => void;
  onInspect: (id: string) => void;
  /** render a subset — the mobile sheets show one stage at a time */
  only?: StageId[];
  bare?: boolean;
}) {
  const { recipe, stack } = useLab();
  const [open, setOpen] = useState<Record<string, boolean>>(() => only
    ? Object.fromEntries(only.map((id) => [id, true]))
    : {
    material: true,
    exposure: true,
    development: false,
    grain: true,
    halation: false,
    diffusion: false,
    optics: false,
    burn: false,
    soup: false,
    damage: false,
    depth: false,
    trace: false,
    sequence: false,
    raster: false,
    vision: false,
  });
  const dispatch = useDispatch();
  const show = (id: StageId) => !only || only.includes(id);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const enabled = (id: StageId) => stack.find((s) => s.id === id)?.enabled ?? true;
  const power = (id: StageId) => dispatch({ type: 'stack:toggle', id });

  const mod = (id: StageId) => ({
    open: open[id],
    onToggle: () => toggle(id),
    enabled: enabled(id),
    onEnabled: () => power(id),
    meta: stageSummary(id, recipe),
  });

  const body = (
    <>
      {show('material') && <MaterialModule mod={mod('material')} onInspect={onInspect} />}
      {show('exposure') && <ExposureModule mod={mod('exposure')} />}
      {show('development') && <DevelopmentModule mod={mod('development')} />}
      {show('grain') && <GrainModule mod={mod('grain')} />}
      {show('halation') && <HalationModule mod={mod('halation')} />}
      {show('diffusion') && <DiffusionModule mod={mod('diffusion')} />}
      {show('optics') && <OpticsModule mod={mod('optics')} />}
      {show('burn') && <BurnModule mod={mod('burn')} placing={placing} setPlacing={setPlacing} />}
      {show('soup') && <SoupModule mod={mod('soup')} />}
      {show('damage') && <DamageModule mod={mod('damage')} />}
      {show('depth') && <DepthModule mod={mod('depth')} />}
      {show('trace') && <TraceModule mod={mod('trace')} />}
      {show('time') && <TimeModule mod={mod('time')} />}
      {show('gate') && <GateModule mod={mod('gate')} />}
      {show('warp') && <WarpModule mod={mod('warp')} />}
      {show('signal') && <SignalModule mod={mod('signal')} />}
      {show('sequence') && <SequenceModule mod={mod('sequence')} />}
      {show('blur') && <BlurModule mod={mod('blur')} />}
      {show('screen') && <ScreenModule mod={mod('screen')} />}
      {show('paper') && <PaperModule mod={mod('paper')} />}
      {show('raster') && <RasterModule mod={mod('raster')} />}
      {show('vision') && <VisionModule mod={mod('vision')} />}
    </>
  );

  if (bare) return <div className="process process--bare">{body}</div>;

  return (
    <aside className="process" aria-label="Processing controls">
      <div className="sec-head">
        <span className="lbl lbl--wide">Cook</span>
        <span className="sec-head__line" />
        <span className="mono mono--dim">{getMaterial(recipe.material).archiveNo}</span>
      </div>
      <div className="process__scroll scroll-y">{body}</div>
    </aside>
  );
}

/** the shape every module header needs, assembled once per stage */
interface ModProps {
  open: boolean;
  onToggle: () => void;
  enabled: boolean;
  onEnabled: (() => void) | undefined;
  meta: string;
}

/* ---------------- MATERIAL ---------------- */
function MaterialModule({ mod, onInspect }: { mod: ModProps; onInspect: (id: string) => void }) {
  const { recipe } = useLab();
  const m = getMaterial(recipe.material);
  return (
    <Module title="Material" {...mod} onEnabled={undefined}>
      <div className="matcard">
        <span className="matcard__swatch" aria-hidden="true">
          {m.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
        </span>
        <div className="matcard__body">
          <p className="matcard__name">{m.name}</p>
          <p className="mono mono--dim">
            {KIND_LABEL[m.kind]} · {m.isoLabel}
          </p>
          <p className="mono mono--dim">
            {m.yearFrom} → {m.yearTo ?? 'Present'}
          </p>
        </div>
      </div>
      <button className="btn btn--sm btn--block" type="button" onClick={() => onInspect(m.id)}>
        Open record
      </button>
    </Module>
  );
}

/* ---------------- EXPOSURE ---------------- */
function ExposureModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, commit } = useProcess();
  const e = recipe.exposure;
  const p = (k: keyof typeof e, title: string) => ({
    onChange: (v: number) =>
      live((r) => ({ ...r, exposure: { ...r.exposure, [k]: v } }), 'exposure', title, v.toFixed(2)),
    onCommit: commit,
  });

  return (
    <Module title="Exposure" {...mod}>
      <ExposureScale
        value={e.ev}
        onChange={(v) =>
          live((r) => ({ ...r, exposure: { ...r.exposure, ev: v } }), 'exposure', 'Exposure',
            `${v > 0 ? '+' : ''}${v.toFixed(1)} EV`)
        }
        onCommit={commit}
      />
      <Instrument label="Contrast" value={e.contrast} min={-1} max={1} bipolar {...p('contrast', 'Contrast')} />
      <Instrument label="Highlights" value={e.highlights} min={-1} max={1} bipolar {...p('highlights', 'Highlights')} />
      <Instrument label="Shadows" value={e.shadows} min={-1} max={1} bipolar {...p('shadows', 'Shadows')} />
      <Instrument
        label="Latitude"
        value={e.latitude}
        note="How much the material forgives. Set by the stock; move it to see what a different emulsion would have held."
        {...p('latitude', 'Latitude')}
      />
    </Module>
  );
}

/* ---------------- DEVELOPMENT ---------------- */
function DevelopmentModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const m = getMaterial(recipe.material);
  const d = recipe.development;
  const pushable = d.mode === 'push' || d.mode === 'pull';

  return (
    <Module title="Development" {...mod}>
      <Segmented<DevelopmentMode>
        value={d.mode}
        options={m.development.map((x) => ({ id: x, label: DEV_LABEL[x], title: DEV_NOTE[x] }))}
        onChange={(v) =>
          once((r) => ({
            ...r,
            development: { ...r.development, mode: v, pushPull: v === 'push' ? Math.max(1, r.development.pushPull) : v === 'pull' ? Math.min(-1, r.development.pushPull) : 0 },
          }), 'development', 'Development', DEV_LABEL[v])
        }
      />
      <p className="instr__note">{DEV_NOTE[d.mode]}</p>

      <Instrument
        label="Push / Pull"
        value={d.pushPull}
        min={-3}
        max={3}
        step={0.5}
        bipolar
        ticks={13}
        disabled={!pushable}
        unit=" stops"
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
        onChange={(v) =>
          live((r) => ({ ...r, development: { ...r.development, pushPull: v } }), 'development', 'Push / Pull',
            `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
        }
        onCommit={commit}
      />

      <Segmented<DeveloperStyle>
        label="Chemistry"
        value={d.developer}
        options={m.developers.map((x) => ({ id: x, label: DEVELOPER_LABEL[x], title: DEVELOPER_NOTE[x] }))}
        onChange={(v) =>
          once((r) => ({ ...r, development: { ...r.development, developer: v } }), 'development', 'Developer', DEVELOPER_LABEL[v])
        }
      />
      <p className="instr__note">{DEVELOPER_NOTE[d.developer]}</p>

      <Instrument
        label="Agitation"
        value={d.agitation}
        note="Less agitation exhausts the developer locally: edge effects climb, overall contrast falls."
        onChange={(v) =>
          live((r) => ({ ...r, development: { ...r.development, agitation: v } }), 'development', 'Agitation', v.toFixed(2))
        }
        onCommit={commit}
      />
    </Module>
  );
}

/* ---------------- GRAIN ---------------- */
function GrainModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const g = recipe.grain;
  const mono = getMaterial(recipe.material).profile.monochrome;
  const p = (k: keyof typeof g, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, grain: { ...r.grain, [k]: v } }), 'grain', title, v.toFixed(2)),
    onCommit: commit,
  });

  return (
    <Module title="Grain" {...mod}>
      <Instrument
        label="Amount"
        value={g.amount}
        format={(v) => `${describeAmount(v)} ${v.toFixed(2)}`}
        {...p('amount', 'Grain Amount')}
      />
      <Instrument label="Size" value={g.size} {...p('size', 'Grain Size')} />
      <Instrument label="Density" value={g.density} {...p('density', 'Grain Density')} />
      <Instrument label="Clumping" value={g.clumping} {...p('clumping', 'Grain Clumping')} />
      <Instrument
        label="Luminance response"
        value={g.luminance}
        note="At 1.00 the grain follows density the way silver does — strongest in the mid-tones, quiet at both ends."
        {...p('luminance', 'Grain Luminance')}
      />
      <Instrument
        label="Colour response"
        value={g.chroma}
        disabled={mono}
        note={mono ? 'Monochrome material: the dye layers do not apply.' : undefined}
        {...p('chroma', 'Grain Colour')}
      />
      <Instrument label="Randomness" value={g.randomness} {...p('randomness', 'Grain Randomness')} />
      <SeedField
        seed={g.seed}
        onSeed={(s) => once((r) => ({ ...r, grain: { ...r.grain, seed: s } }), 'grain', 'Grain Seed', seedLabel(s))}
      />
    </Module>
  );
}

/* ---------------- HALATION ---------------- */
function HalationModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, commit } = useProcess();
  const h = recipe.halation;
  const p = (k: keyof typeof h, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, halation: { ...r.halation, [k]: v } }), 'halation', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Halation" {...mod}>
      <Instrument label="Intensity" value={h.intensity} {...p('intensity', 'Halation')} />
      <Instrument label="Threshold" value={h.threshold} {...p('threshold', 'Halation Threshold')} />
      <Instrument label="Radius" value={h.radius} {...p('radius', 'Halation Radius')} />
      <Instrument
        label="Colour"
        value={h.hue}
        format={(v) => (v < 0.42 ? 'Cold' : v > 0.58 ? 'Ember' : 'Native')}
        note="Native follows the material. The extremes move toward scattered blue or bare ember red."
        {...p('hue', 'Halation Colour')}
      />
      <Instrument
        label="Edge response"
        value={h.edge}
        note="At the top the scatter only shows where a highlight meets something dark, which is where it actually happens."
        {...p('edge', 'Halation Edge')}
      />
    </Module>
  );
}

/* ---------------- DIFFUSION ---------------- */
function DiffusionModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, commit } = useProcess();
  const d = recipe.diffusion;
  const p = (k: keyof typeof d, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, diffusion: { ...r.diffusion, [k]: v } }), 'diffusion', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Diffusion" {...mod}>
      <Instrument label="Softness" value={d.softness} {...p('softness', 'Softness')} />
      <Instrument label="Bloom" value={d.bloom} {...p('bloom', 'Bloom')} />
      <Instrument label="Highlight spread" value={d.spread} {...p('spread', 'Highlight Spread')} />
    </Module>
  );
}

/* ---------------- OPTICS ---------------- */
function OpticsModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, commit } = useProcess();
  const o = recipe.optics;
  const p = (k: keyof typeof o, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, optics: { ...r.optics, [k]: v } }), 'optics', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Optics" {...mod}>
      <Instrument label="Distortion" value={o.distortion} min={-1} max={1} bipolar {...p('distortion', 'Distortion')} />
      <Instrument label="Chromatic aberration" value={o.chromatic} {...p('chromatic', 'Chromatic Aberration')} />
      <Instrument label="Vignette" value={o.vignette} {...p('vignette', 'Vignette')} />
      <Instrument label="Edge softness" value={o.edgeSoftness} {...p('edgeSoftness', 'Edge Softness')} />
    </Module>
  );
}

/* ---------------- FILM BURN ---------------- */
function BurnModule({
  mod,
  placing,
  setPlacing,
}: {
  mod: ModProps;
  placing: 'none' | 'burn';
  setPlacing: (p: 'none' | 'burn') => void;
}) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const [sel, setSel] = useState(0);
  const burns = recipe.burns;
  const b: BurnMark | undefined = burns[Math.min(sel, burns.length - 1)];

  const setB = (patch: Partial<BurnMark>, title: string, detail: string, immediate = false) => {
    const idx = Math.min(sel, burns.length - 1);
    const fn = (r: PhotoRecipe) => ({
      ...r,
      burns: r.burns.map((x, i) => (i === idx ? { ...x, ...patch } : x)),
    });
    (immediate ? once : live)(fn, 'burn', title, detail);
  };

  return (
    <Module title="Film Burn" {...mod} accent="red">
      <div className="burnlist">
        {burns.map((x, i) => (
          <button
            key={x.id}
            type="button"
            className="burnlist__item"
            aria-pressed={i === Math.min(sel, burns.length - 1)}
            onClick={() => setSel(i)}
          >
            <span className="lamp" data-state={x.enabled ? 'warn' : 'off'} />
            <span className="mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="mono mono--dim">{x.amount.toFixed(2)}</span>
          </button>
        ))}
        <button
          className="btn btn--sm"
          type="button"
          onClick={() =>
            once((r) => ({ ...r, burns: [...r.burns, makeBurn(0.35 + Math.random() * 0.3, 0.35 + Math.random() * 0.3)] }),
              'burn', 'Film Burn Added', `Mark ${burns.length + 1}`)
          }
        >
          Add
        </button>
        <button
          className={`btn btn--sm ${placing === 'burn' ? 'btn--primary' : ''}`}
          type="button"
          onClick={() => setPlacing(placing === 'burn' ? 'none' : 'burn')}
        >
          {placing === 'burn' ? 'Click the specimen' : 'Place'}
        </button>
      </div>

      {b ? (
        <>
          <Instrument
            label="Amount"
            value={b.amount}
            onChange={(v) => setB({ amount: v }, 'Burn Amount', v.toFixed(2))}
            onCommit={commit}
          />
          <Instrument
            label="Spread"
            value={b.spread}
            onChange={(v) => setB({ spread: v }, 'Burn Spread', v.toFixed(2))}
            onCommit={commit}
          />
          <Instrument
            label="Density"
            value={b.density}
            onChange={(v) => setB({ density: v }, 'Burn Density', v.toFixed(2))}
            onCommit={commit}
          />
          <Instrument
            label="Colour"
            value={b.hue}
            format={(v) => (v < 0.35 ? 'Deep ember' : v > 0.7 ? 'Bright' : 'Ember')}
            onChange={(v) => setB({ hue: v }, 'Burn Colour', v.toFixed(2))}
            onCommit={commit}
          />
          <Instrument
            label="Edge softness"
            value={b.edge}
            onChange={(v) => setB({ edge: v }, 'Burn Edge', v.toFixed(2))}
            onCommit={commit}
          />
          <Instrument
            label="Randomness"
            value={b.randomness}
            note="Raises the irregularity of the perimeter and the structure inside the mark."
            onChange={(v) => setB({ randomness: v }, 'Burn Randomness', v.toFixed(2))}
            onCommit={commit}
          />
          <SeedField seed={b.seed} onSeed={(s) => setB({ seed: s }, 'Burn Seed', seedLabel(s), true)} />
          <div className="row row--gap">
            <button
              className="btn btn--sm"
              type="button"
              onClick={() => setB({ enabled: !b.enabled }, b.enabled ? 'Burn Disabled' : 'Burn Enabled', `Mark ${sel + 1}`, true)}
            >
              {b.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              className="btn btn--sm"
              type="button"
              onClick={() =>
                once((r) => ({ ...r, burns: [...r.burns, { ...b, id: `burn-${Math.random().toString(16).slice(2, 8)}`, seed: newSeed(), x: Math.min(0.92, b.x + 0.12) }] }),
                  'burn', 'Burn Duplicated', `Mark ${burns.length + 1}`)
              }
            >
              Duplicate
            </button>
            <span className="spacer" />
            <button
              className="btn btn--sm btn--danger"
              type="button"
              onClick={() => {
                once((r) => ({ ...r, burns: r.burns.filter((x) => x.id !== b.id) }), 'burn', 'Burn Removed', `Mark ${sel + 1}`);
                setSel(0);
              }}
            >
              Remove
            </button>
          </div>
        </>
      ) : (
        <p className="instr__note">
          No marks on this frame. Add one, or place it on the specimen directly.
        </p>
      )}
    </Module>
  );
}

/* ---------------- FILM SOUP ---------------- */
function SoupModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const x = recipe.experimental;
  const p = (k: keyof typeof x, title: string) => ({
    onChange: (v: number) =>
      live((r) => ({ ...r, experimental: { ...r.experimental, [k]: v } }), 'soup', title, v.toFixed(2)),
    onCommit: commit,
  });
  const chem = SOUP_CHEMICALS.find((c) => c.id === x.soupChemical)!;

  return (
    <Module title="Film Soup" {...mod} accent="chem">
      <div className="chemgrid">
        {SOUP_CHEMICALS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chem"
            aria-pressed={c.id === x.soupChemical}
            title={c.note}
            onClick={() =>
              once((r) => ({ ...r, experimental: { ...r.experimental, soupChemical: c.id as SoupChemical } }),
                'soup', 'Chemistry', c.label)
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="instr__note">{chem.note}</p>

      <Instrument label="Amount" value={x.filmSoup} {...p('filmSoup', 'Film Soup')} />
      <Instrument
        label="Temperature"
        value={x.soupTemperature}
        format={(v) => `${Math.round(4 + v * 56)}°C`}
        {...p('soupTemperature', 'Temperature')}
      />
      <Instrument label="Contamination" value={x.contamination} {...p('contamination', 'Contamination')} />
      <Instrument label="Fog" value={x.fog} {...p('fog', 'Fog')} />
      <Instrument label="Bleed" value={x.bleed} {...p('bleed', 'Bleed')} />
      <Instrument label="Density" value={x.soupDensity} {...p('soupDensity', 'Soup Density')} />
      <Instrument label="Randomness" value={x.soupRandomness} {...p('soupRandomness', 'Soup Randomness')} />
      <SeedField
        seed={x.soupSeed}
        onSeed={(s) => once((r) => ({ ...r, experimental: { ...r.experimental, soupSeed: s } }), 'soup', 'Soup Seed', seedLabel(s))}
      />
      <button
        className="btn btn--block"
        type="button"
        onClick={() =>
          once((r) => ({
            ...r,
            experimental: {
              ...r.experimental,
              soupSeed: newSeed(),
              filmSoup: r.experimental.filmSoup > 0 ? r.experimental.filmSoup : 0.3,
            },
          }), 'soup', 'Experiment Run', seedLabel(x.soupSeed))
        }
      >
        Run experiment
      </button>
    </Module>
  );
}

/* ---------------- DAMAGE ---------------- */
function DamageModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const x = recipe.experimental;
  const p = (k: keyof typeof x, title: string) => ({
    onChange: (v: number) =>
      live((r) => ({ ...r, experimental: { ...r.experimental, [k]: v } }), 'experiment', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Damage & Age" {...mod} accent="red">
      <Instrument label="Expired" value={x.expired} note="Base fog rises, speed falls, the dyes drift apart." {...p('expired', 'Expired')} />
      <Instrument label="Redscale" value={x.redscale} note="Exposed through the base rather than the emulsion." {...p('redscale', 'Redscale')} />
      <Instrument label="Solarisation" value={x.solarization} {...p('solarization', 'Solarisation')} />
      <Instrument label="Light leak" value={x.lightLeak} {...p('lightLeak', 'Light Leak')} />
      <Instrument label="Scratches" value={x.scratches} note="Traced from real 35mm scans, not drawn." {...p('scratches', 'Scratches')} />
      <Instrument label="Dust & hair" value={x.dust} note="Also real: dirt and lint from scanned frames." {...p('dust', 'Dust')} />
      <SeedField
        seed={x.seed}
        onSeed={(s) => once((r) => ({ ...r, experimental: { ...r.experimental, seed: s } }), 'experiment', 'Damage Seed', seedLabel(s))}
      />
    </Module>
  );
}

/* ---------------- DEPTH ---------------- */
function DepthModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const d = recipe.depth;
  const targets = [
    { id: 'grain', label: 'Grain' },
    { id: 'halation', label: 'Halation' },
    { id: 'diffusion', label: 'Diffusion' },
    { id: 'burn', label: 'Burn' },
    { id: 'haze', label: 'Haze' },
  ] as const;

  return (
    <Module title="Depth" {...mod} accent="blue">
      <div className="row row--gap depth__switch">
        <span className="instr__label">Depth influence</span>
        <span className="spacer" />
        <button
          className="btn btn--sm"
          type="button"
          aria-pressed={d.enabled}
          onClick={() =>
            once((r) => ({ ...r, depth: { ...r.depth, enabled: !r.depth.enabled } }), 'depth', d.enabled ? 'Depth Off' : 'Depth On',
              d.enabled ? 'disabled' : `influence ${d.influence.toFixed(2)}`)
          }
        >
          {d.enabled ? 'On' : 'Off'}
        </button>
      </div>
      <Instrument
        label="Influence"
        value={d.influence}
        disabled={!d.enabled}
        onChange={(v) => live((r) => ({ ...r, depth: { ...r.depth, influence: v } }), 'depth', 'Depth Influence', v.toFixed(2))}
        onCommit={commit}
      />
      <div className="chemgrid">
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            className="chem"
            aria-pressed={d.target.includes(t.id)}
            disabled={!d.enabled}
            onClick={() =>
              once((r) => ({
                ...r,
                depth: {
                  ...r.depth,
                  target: r.depth.target.includes(t.id)
                    ? r.depth.target.filter((z) => z !== t.id)
                    : [...r.depth.target, t.id],
                },
              }), 'depth', 'Depth Target', t.label)
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="instr__note">
        No monocular depth model is connected. The lab is running a proxy
        estimate derived from the image itself, and labels it as such.
      </p>
    </Module>
  );
}

/* ---------------- TRACE ----------------
   The vector layer. It reports what the tracker measured; it does
   not decorate the frame with numbers that mean nothing. */
function TraceModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const t = recipe.trace;
  const p = (k: keyof typeof t, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, trace: { ...r.trace, [k]: v } }), 'trace', title, v.toFixed(2)),
    onCommit: commit,
  });
  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K], title: string, detail: string) =>
    once((r) => ({ ...r, trace: { ...r.trace, [k]: v } }), 'trace', title, detail);

  const typographic = t.mode === 'type';

  return (
    <Module title="Trace" {...mod} accent="blue">
      <div className="row row--gap depth__switch">
        <span className="instr__label">Vector layer</span>
        <span className="spacer" />
        <button
          className="btn btn--sm"
          type="button"
          aria-pressed={t.enabled}
          onClick={() => set('enabled', !t.enabled, t.enabled ? 'Trace Off' : 'Trace On', TRACE_MODES.find((m) => m.id === t.mode)!.label)}
        >
          {t.enabled ? 'On' : 'Off'}
        </button>
      </div>

      <Segmented<'energy' | 'blob'>
        label="Find"
        value={t.track}
        options={[
          { id: 'blob', label: 'Movers', title: 'Segment what is moving against a background model and follow it.' },
          { id: 'energy', label: 'Edges', title: 'Lock onto local contrast. Works on a still, but finds the window rather than the person.' },
        ]}
        onChange={(v) => set('track', v, 'Trace Find', v === 'blob' ? 'movers' : 'edges')}
      />

      <Segmented<TraceMode>
        value={t.mode}
        options={TRACE_MODES.map((m) => ({ id: m.id, label: m.label, title: m.note }))}
        onChange={(v) => set('mode', v, 'Trace Mode', TRACE_MODES.find((m) => m.id === v)!.label)}
      />
      <p className="instr__note">{TRACE_MODES.find((m) => m.id === t.mode)!.note}</p>

      {!typographic ? (
        <>
          <Instrument
            label="Regions"
            value={t.density}
            disabled={!t.enabled}
            format={() => String(traceCount(recipe))}
            {...p('density', 'Trace Regions')}
          />
          <Instrument label="Sensitivity" value={t.sensitivity} disabled={!t.enabled} {...p('sensitivity', 'Trace Sensitivity')} />
          <Instrument
            label="Motion weight"
            value={t.motion}
            disabled={!t.enabled}
            note="How much frame-to-frame change counts against local contrast. On a still specimen there is no motion to weigh, and the tracker says so."
            {...p('motion', 'Trace Motion')}
          />
          <Instrument label="Links" value={t.links} disabled={!t.enabled} {...p('links', 'Trace Links')} />
          <Instrument label="Stroke" value={t.weight} disabled={!t.enabled} {...p('weight', 'Trace Stroke')} />
          <Instrument label="Instability" value={t.jitter} disabled={!t.enabled} {...p('jitter', 'Trace Jitter')} />
          <div className="row row--gap depth__switch">
            <span className="instr__label">Labels</span>
            <span className="spacer" />
            <button
              className="btn btn--sm"
              type="button"
              aria-pressed={t.labels}
              disabled={!t.enabled}
              onClick={() => set('labels', !t.labels, 'Trace Labels', t.labels ? 'off' : 'on')}
            >
              {t.labels ? 'Shown' : 'Hidden'}
            </button>
          </div>
        </>
      ) : (
        <>
          <Instrument
            label="Cell size"
            value={t.cell}
            disabled={!t.enabled}
            note="Smaller cells resolve more of the picture and read less as type."
            {...p('cell', 'Type Cell')}
          />
          <div className="chemgrid">
            {GLYPH_RAMPS.map((g) => (
              <button
                key={g.label}
                type="button"
                className="chem"
                aria-pressed={t.glyphs === g.id}
                disabled={!t.enabled}
                onClick={() => set('glyphs', g.id, 'Glyph Ramp', g.label)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="chemgrid">
        {TRACE_COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chem"
            aria-pressed={t.colour === c.id}
            disabled={!t.enabled}
            onClick={() => set('colour', c.id as TraceColour, 'Trace Colour', c.label)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </Module>
  );
}

/* ---------------- SEQUENCE ---------------- */
function SequenceModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const q = recipe.sequence;
  const p = (k: keyof typeof q, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, sequence: { ...r.sequence, [k]: v } }), 'sequence', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Sequence" {...mod}>
      <div className="row row--gap depth__switch">
        <span className="instr__label">Contact sheet</span>
        <span className="spacer" />
        <button
          className="btn btn--sm"
          type="button"
          aria-pressed={q.enabled}
          onClick={() =>
            once((r) => ({ ...r, sequence: { ...r.sequence, enabled: !r.sequence.enabled } }), 'sequence',
              q.enabled ? 'Sequence Off' : 'Sequence On', `${q.rows} × ${q.cols}`)
          }
        >
          {q.enabled ? 'On' : 'Off'}
        </button>
      </div>
      <Instrument
        label="Rows"
        value={q.rows}
        min={1}
        max={8}
        step={1}
        ticks={8}
        disabled={!q.enabled}
        format={(v) => v.toFixed(0)}
        {...p('rows', 'Sequence Rows')}
      />
      <Instrument
        label="Columns"
        value={q.cols}
        min={1}
        max={8}
        step={1}
        ticks={8}
        disabled={!q.enabled}
        format={(v) => v.toFixed(0)}
        {...p('cols', 'Sequence Columns')}
      />
      <Instrument
        label="Exposure drift"
        value={q.drift}
        disabled={!q.enabled}
        note="Each frame on the sheet drifts from the recipe, the way a roll drifts across a shoot."
        {...p('drift', 'Sequence Drift')}
      />
      <Instrument label="Gutter" value={q.gutter} disabled={!q.enabled} {...p('gutter', 'Sequence Gutter')} />
      <div className="row row--gap depth__switch">
        <span className="instr__label">Edge markings</span>
        <span className="spacer" />
        <button
          className="btn btn--sm"
          type="button"
          aria-pressed={q.stamp}
          disabled={!q.enabled}
          onClick={() =>
            once((r) => ({ ...r, sequence: { ...r.sequence, stamp: !r.sequence.stamp } }), 'sequence', 'Edge Markings', q.stamp ? 'off' : 'on')
          }
        >
          {q.stamp ? 'Printed' : 'Bare'}
        </button>
      </div>
    </Module>
  );
}

/* ---------------- RASTER ---------------- */
function RasterModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, commit } = useProcess();
  const ra = recipe.raster;
  const p = (k: keyof typeof ra, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, raster: { ...r.raster, [k]: v } }), 'raster', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Raster" {...mod}>
      <Instrument
        label="Dither"
        value={ra.dither}
        note="An ordered matrix, not random noise — a random dither reads as grain, an ordered one reads as print."
        {...p('dither', 'Dither')}
      />
      <Instrument
        label="Levels"
        value={ra.levels}
        format={(v) => String(Math.max(2, Math.floor(24 - v * 22)))}
        {...p('levels', 'Dither Levels')}
      />
      <Instrument label="Scan comb" value={ra.comb} {...p('comb', 'Scan Comb')} />
      <Instrument label="Scanline" value={ra.scanline} {...p('scanline', 'Scanline')} />
      <Instrument label="Line thickness" value={ra.scanThick} {...p('scanThick', 'Scan Thickness')} />
      <Instrument
        label="Roll bar"
        value={ra.scanRoll}
        note="The band that crawls up a screen when a camera is pointed at it."
        {...p('scanRoll', 'Roll Bar')}
      />
    </Module>
  );
}

/* ---------------- VISION ----------------
   Face and hand landmarks from a real model, and a hand bound to
   the cook. Only useful on something that moves, and it says so
   rather than pretending otherwise. */
function VisionModule({ mod }: { mod: ModProps }) {
  const { specimen } = useLab();
  const v = useVision();
  const moving = specimen?.kind === 'moving';
  const s = v.style;
  const b = v.binding;
  const st = v.status;

  return (
    <Module title="Vision" {...mod} accent="blue">
      <div className="vis__state">
        <span
          className="lamp"
          data-state={
            st.state === 'ready' ? 'on' : st.state === 'loading' ? 'busy' : st.state === 'failed' ? 'warn' : 'off'
          }
        />
        <span className="mono">
          {!moving
            ? 'Needs a clip or the camera'
            : st.state === 'idle'
              ? 'Not started'
              : st.state === 'loading'
                ? 'Loading models'
                : st.state === 'ready'
                  ? `Face + hands · ${st.backend}`
                  : st.reason}
        </span>
      </div>

      {v.read ? (
        <div className="vis__counts">
          <div>
            <span className="lbl">Faces</span>
            <span className="mono mono--val">{v.read.faces.length}</span>
          </div>
          <div>
            <span className="lbl">Hands</span>
            <span className="mono mono--val">{v.read.hands.length}</span>
          </div>
          <div>
            <span className="lbl">Inference</span>
            <span className="mono mono--val">{v.read.ms.toFixed(1)} ms</span>
          </div>
        </div>
      ) : null}

      <Instrument label="Squares" value={s.boxes} onChange={(x) => v.setStyle({ boxes: x })} />
      <Instrument label="Mesh" value={s.mesh} onChange={(x) => v.setStyle({ mesh: x })} />
      <Instrument label="Contours" value={s.contours} onChange={(x) => v.setStyle({ contours: x })} />
      <Instrument label="Iris" value={s.iris} onChange={(x) => v.setStyle({ iris: x })} />
      <Instrument label="Hands" value={s.hands} onChange={(x) => v.setStyle({ hands: x })} />
      <Instrument
        label="Connecting lines"
        value={s.constellation}
        note="Every face and hand the model found, joined."
        onChange={(x) => v.setStyle({ constellation: x })}
      />
      <Instrument label="Stroke" value={s.weight} min={0.5} max={3} step={0.1}
        onChange={(x) => v.setStyle({ weight: x })} />

      <div className="row row--gap depth__switch">
        <span className="instr__label">Labels</span>
        <span className="spacer" />
        <button className="btn btn--sm" type="button" aria-pressed={s.labels}
          onClick={() => v.setStyle({ labels: !s.labels })}>
          {s.labels ? 'Shown' : 'Hidden'}
        </button>
      </div>

      <div className="row row--gap depth__switch">
        <span className="instr__label">Hand drives the cook</span>
        <span className="spacer" />
        <button className="btn btn--sm" type="button" aria-pressed={b.enabled}
          onClick={() => v.setBinding({ enabled: !b.enabled })}>
          {b.enabled ? 'On' : 'Off'}
        </button>
      </div>

      {b.enabled ? (
        <>
          <div className="vis__pinch">
            <span className="instr__label">Pinch</span>
            <span className="vis__pinch-bar">
              <i style={{ width: `${Math.round((v.live?.value ?? 0) * 100)}%` }} />
            </span>
            <span className="mono mono--val">{((v.live?.value ?? 0)).toFixed(2)}</span>
          </div>

          <div className="chemgrid">
            {PINCH_TARGETS.map((t) => (
              <button key={t} type="button" className="chem"
                aria-pressed={b.pinchTarget === t}
                onClick={() => v.setBinding({ pinchTarget: t })}>
                {SL[t]}
              </button>
            ))}
          </div>

          <div className="vis__actions">
            {Object.keys(b.actions).map((g) => (
              <Fragment key={g}>
                <span className="mono mono--dim">{g.replace(/_/g, ' ')}</span>
                <select
                  value={b.actions[g]}
                  onChange={(e) =>
                    v.setBinding({ actions: { ...b.actions, [g]: e.target.value as GestureAction } })
                  }
                >
                  {(Object.keys(ACTION_LABEL) as GestureAction[]).map((a) => (
                    <option key={a} value={a}>{ACTION_LABEL[a]}</option>
                  ))}
                </select>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}
    </Module>
  );
}

/* ---------------- BLUR ----------------
   A camera move, not a soft focus. */
function BlurModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const b = recipe.blur;
  const p = (k: keyof typeof b, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, blur: { ...r.blur, [k]: v } }), 'optics', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Blur" {...mod}>
      <Segmented<BlurMode>
        value={b.mode}
        options={BLUR_MODES.map((m) => ({ id: m.id, label: m.label, title: m.note }))}
        onChange={(v) => once((r) => ({ ...r, blur: { ...r.blur, mode: v } }), 'optics', 'Blur', BLUR_MODES.find((m) => m.id === v)!.label)}
      />
      <p className="instr__note">{BLUR_MODES.find((m) => m.id === b.mode)!.note}</p>
      <Instrument label="Amount" value={b.amount} {...p('amount', 'Blur')} />
      {b.mode === 'motion' ? (
        <Instrument
          label="Direction"
          value={b.angle}
          min={0}
          max={Math.PI}
          step={0.01}
          format={(v) => `${Math.round((v * 180) / Math.PI)}°`}
          {...p('angle', 'Blur Direction')}
        />
      ) : (
        <>
          <Instrument label="Centre across" value={b.cx} {...p('cx', 'Blur Centre X')} />
          <Instrument label="Centre down" value={b.cy} {...p('cy', 'Blur Centre Y')} />
        </>
      )}
      <Instrument
        label="Edge taper"
        value={b.taper}
        note="Holds the middle still and streaks the frame edge, the way a real pan does."
        {...p('taper', 'Blur Taper')}
      />
    </Module>
  );
}

/* ---------------- TIME ----------------
   The engine's memory. Everything else here computes one frame from
   nothing; these four run on what was on screen a moment ago. */
function TimeModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const t = recipe.time;
  const p = (k: keyof typeof t, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, time: { ...r.time, [k]: v } }), 'time', title, v.toFixed(2)),
    onCommit: commit,
  });
  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K], title: string, detail: string) =>
    once((r) => ({ ...r, time: { ...r.time, [k]: v } }), 'time', title, detail);

  return (
    <Module title="Time" {...mod} accent="blue">
      <p className="instr__note">
        The only stage that knows what the last frame looked like. It runs on a
        still as well as a clip — feedback builds up while you watch.
      </p>

      <h4 className="sec-head sec-head--sub"><span className="lbl">Echo</span><span className="sec-head__line" /></h4>
      <Segmented<EchoMode>
        value={t.mode}
        options={ECHO_MODES.map((m) => ({ id: m.id, label: m.label, title: m.note }))}
        onChange={(v) => set('mode', v, 'Echo', ECHO_MODES.find((m) => m.id === v)!.label)}
      />
      <p className="instr__note">{ECHO_MODES.find((m) => m.id === t.mode)!.note}</p>
      <Instrument label="Amount" value={t.echo} {...p('echo', 'Echo')} />
      <Instrument
        label="Give up"
        value={t.decay}
        max={0.4}
        step={0.005}
        note="How fast the trail lets go. At zero it never does."
        {...p('decay', 'Echo Decay')}
      />

      <h4 className="sec-head sec-head--sub"><span className="lbl">The loop</span><span className="sec-head__line" /></h4>
      <p className="instr__note">
        The past is read back through a transform. A fraction of a zoom and a
        fraction of a degree is the whole of video feedback — it is why a camera
        pointed at its own monitor makes tunnels.
      </p>
      <Instrument label="Zoom per trip" value={t.feedZoom} min={-0.08} max={0.08} step={0.001} bipolar format={(v) => v.toFixed(3)} {...p('feedZoom', 'Feedback Zoom')} />
      <Instrument label="Turn per trip" value={t.feedRot} min={-0.06} max={0.06} step={0.001} bipolar format={(v) => `${((v * 180) / Math.PI).toFixed(1)}°`} {...p('feedRot', 'Feedback Turn')} />
      <Instrument label="Drift across" value={t.feedShiftX} min={-0.02} max={0.02} step={0.0005} bipolar format={(v) => v.toFixed(4)} {...p('feedShiftX', 'Feedback Drift X')} />
      <Instrument label="Drift down" value={t.feedShiftY} min={-0.02} max={0.02} step={0.0005} bipolar format={(v) => v.toFixed(4)} {...p('feedShiftY', 'Feedback Drift Y')} />
      <Instrument label="Push" value={t.feedGain} min={-0.1} max={0.4} step={0.005} bipolar note="Contrast put back on every trip. Without it the loop blurs itself into fog; too much and it burns out." {...p('feedGain', 'Feedback Push')} />
      <Instrument label="Colour turn" value={t.feedHue} min={-0.3} max={0.3} step={0.005} bipolar note="Rotates the hue a little on every trip round the loop." {...p('feedHue', 'Feedback Hue')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Slit-scan</span><span className="sec-head__line" /></h4>
      <p className="instr__note">
        A band crosses the frame. Behind it you see the moment it went past, so
        the picture stops being one instant and becomes time drawn across space.
      </p>
      <Instrument label="Amount" value={t.slit} {...p('slit', 'Slit-scan')} />
      <Instrument label="Angle" value={t.slitAngle} min={0} max={Math.PI} step={0.01} format={(v) => `${Math.round((v * 180) / Math.PI)}°`} {...p('slitAngle', 'Slit Angle')} />
      <Instrument label="Speed" value={t.slitSpeed} min={0.05} max={4} step={0.05} format={(v) => v.toFixed(2)} {...p('slitSpeed', 'Slit Speed')} />
      <Instrument label="Band width" value={t.slitWidth} min={0.005} max={0.4} step={0.005} format={(v) => v.toFixed(3)} {...p('slitWidth', 'Slit Width')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Time displacement</span><span className="sec-head__line" /></h4>
      <Instrument
        label="Amount"
        value={t.displace}
        note="Each pixel reads a different distance into the past, set by its own brightness. Highlights lag; shadows keep up."
        {...p('displace', 'Time Displacement')}
      />
      <Instrument label="Which way" value={t.displaceBias} note="Move it past the middle to swap which end of the scale lags." {...p('displaceBias', 'Displacement Bias')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Chemistry</span><span className="sec-head__line" /></h4>
      <p className="instr__note">
        Gray-Scott reaction-diffusion, fed by the photograph itself: the feed and
        kill rates are pushed around by the picture's own brightness, so the
        pattern grows out of the image rather than sitting on top of it.
      </p>
      <Segmented<RDStyle>
        value={t.rdStyle}
        options={RD_STYLES.map((m) => ({ id: m.id, label: m.label, title: m.note }))}
        onChange={(v) => set('rdStyle', v, 'Chemistry', RD_STYLES.find((m) => m.id === v)!.label)}
      />
      <Instrument label="Amount" value={t.rd} {...p('rd', 'Chemistry')} />
      <Instrument label="Feed" value={t.rdFeed} min={0.01} max={0.09} step={0.001} format={(v) => v.toFixed(3)} note="Below about 0.03 it starves; above 0.07 it floods." {...p('rdFeed', 'Feed Rate')} />
      <Instrument label="Kill" value={t.rdKill} min={0.03} max={0.075} step={0.0005} format={(v) => v.toFixed(4)} {...p('rdKill', 'Kill Rate')} />
      <Instrument label="Growth" value={t.rdSteps} min={1} max={60} step={1} format={(v) => `${v.toFixed(0)} / frame`} {...p('rdSteps', 'Growth')} />
      <Instrument label="Led by the picture" value={t.rdSeed} note="How hard the photograph drives the chemistry. At zero it grows on its own." {...p('rdSeed', 'Chemistry Seed')} />
    </Module>
  );
}

/* ---------------- THE GATE ----------------
   The film round the picture while you work, not only on export. */
function GateModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const gt = recipe.gate;
  const p = (k: keyof typeof gt, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, gate: { ...r.gate, [k]: v } }), 'gate', title, v.toFixed(2)),
    onCommit: commit,
  });
  const set = <K extends keyof typeof gt>(k: K, v: (typeof gt)[K], title: string, detail: string) =>
    once((r) => ({ ...r, gate: { ...r.gate, [k]: v } }), 'gate', title, detail);
  const fmt = GATE_FORMATS.find((f) => f.id === gt.format)!;

  return (
    <Module title="The Gate" {...mod} accent="red">
      <p className="instr__note">
        The same numbers the exporter uses, drawn live over the picture, so
        the bench shows what will come out of the file.
      </p>

      <div className="modegrid">
        {GATE_FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="modegrid__opt"
            aria-pressed={gt.format === f.id}
            title={f.note}
            onClick={() => set('format', f.id, 'Gate', f.label)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="instr__note">{fmt.note}</p>

      <Switch
        on={gt.show}
        onChange={(v) => set('show', v, 'Gate', v ? 'On' : 'Off')}
        label="Show the film"
        note="Perforations, frame line and edge print, over the picture."
      />

      <Instrument label="Weave" value={gt.weave} note="How much the frame moves in the gate. Regular 8 wanders; 35 on pilot pins does not." {...p('weave', 'Weave')} />
      <Instrument label="Frame line" value={gt.frameline} note="How far the gap between frames comes into the picture." {...p('frameline', 'Frame Line')} />
      <Instrument label="Lamp" value={gt.lamp} note="Light spilling round the aperture." {...p('lamp', 'Lamp')} />
      <Instrument label="Print wear" value={gt.wear} note="How many times this print has been through a projector." {...p('wear', 'Print Wear')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Burning through</span><span className="sec-head__line" /></h4>
      <p className="instr__note">
        The frame has stopped in front of the lamp. The emulsion goes first —
        a clear patch spreading with a torn edge — then the base, and what is
        left is a hole with an ember round it. At 100 there is only the lamp.
      </p>
      <Instrument label="How far gone" value={gt.burn} {...p('burn', 'Burn Through')} />
      <Instrument label="Where across" value={gt.burnX} {...p('burnX', 'Burn X')} />
      <Instrument label="Where down" value={gt.burnY} {...p('burnY', 'Burn Y')} />
      <SeedField
        label="Tear"
        seed={gt.burnSeed}
        onSeed={(v) => set('burnSeed', v, 'Burn Tear', seedLabel(v))}
      />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Leader</span><span className="sec-head__line" /></h4>
      <Switch
        on={gt.leader}
        onChange={(v) => set('leader', v, 'Leader', v ? 'On' : 'Off')}
        label="Countdown"
        note="A hand sweeping once a second round a numbered circle."
      />
      <Instrument label="How far through" value={gt.leaderAt} {...p('leaderAt', 'Leader Position')} />
      <Instrument label="Counts from" value={gt.leaderFrom} min={3} max={12} step={1} format={(v) => v.toFixed(0)} {...p('leaderFrom', 'Leader Count')} />
    </Module>
  );
}

/* ---------------- WARP ----------------
   Eleven ways of moving the picture around inside its own frame.
   None of it touches how the emulsion was rendered — this is what
   happens to the print afterwards. */
function WarpModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const w = recipe.warp;
  const p = (k: keyof typeof w, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, warp: { ...r.warp, [k]: v } }), 'warp', title, v.toFixed(2)),
    onCommit: commit,
  });
  const here = WARP_MODES.find((m) => m.id === w.mode)!;
  const round = ['ripple', 'twirl', 'pinch', 'kaleidoscope', 'polar', 'fisheye'].includes(w.mode);

  return (
    <Module title="Warp" {...mod}>
      <div className="modegrid">
        {WARP_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="modegrid__opt"
            aria-pressed={w.mode === m.id}
            title={m.note}
            onClick={() => once((r) => ({ ...r, warp: { ...r.warp, mode: m.id } }), 'warp', 'Warp', m.label)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="instr__note">{here.note}</p>

      <Instrument label="Amount" value={w.amount} {...p('amount', 'Warp')} />
      <Instrument
        label={w.mode === 'kaleidoscope' ? 'Segments' : w.mode === 'tile' ? 'Tiles' : 'Scale'}
        value={w.scale}
        min={0.25}
        max={4}
        step={0.05}
        format={(v) => v.toFixed(2)}
        {...p('scale', 'Warp Scale')}
      />
      <Instrument label="Phase" value={w.phase} min={0} max={6.283} step={0.02} format={(v) => `${Math.round((v * 180) / Math.PI)}°`} {...p('phase', 'Warp Phase')} />
      <Instrument label="Drift" value={w.drift} min={0} max={2} step={0.02} note="How fast it moves on its own. At zero it holds still." {...p('drift', 'Warp Drift')} />
      {round ? (
        <>
          <Instrument label="Centre across" value={w.cx} {...p('cx', 'Warp Centre X')} />
          <Instrument label="Centre down" value={w.cy} {...p('cy', 'Warp Centre Y')} />
        </>
      ) : null}

      <Segmented<WarpEdge>
        label="At the edge"
        value={w.edge}
        options={WARP_EDGES.map((e) => ({ id: e.id, label: e.label, title: e.note }))}
        onChange={(v) => once((r) => ({ ...r, warp: { ...r.warp, edge: v } }), 'warp', 'Warp Edge', WARP_EDGES.find((e) => e.id === v)!.label)}
      />
      <p className="instr__note">{WARP_EDGES.find((e) => e.id === w.edge)!.note}</p>
    </Module>
  );
}

/* ---------------- SIGNAL ----------------
   The grade, and then whatever the picture ends up being shown on. */
function SignalModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const g = recipe.signal;
  const p = (k: keyof typeof g, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, signal: { ...r.signal, [k]: v } }), 'signal', title, v.toFixed(2)),
    onCommit: commit,
  });

  return (
    <Module title="Signal" {...mod} accent="blue">
      <h4 className="sec-head sec-head--sub"><span className="lbl">Grade</span><span className="sec-head__line" /></h4>
      <Instrument label="Temperature" value={g.temperature} min={-1} max={1} step={0.01} bipolar note="Cold one way, warm the other. Before anything else touches the colour." {...p('temperature', 'Temperature')} />
      <Instrument label="Tint" value={g.tint} min={-1} max={1} step={0.01} bipolar note="Green through magenta — the axis a colour head has and a slider usually does not." {...p('tint', 'Tint')} />
      <Instrument label="Vibrance" value={g.vibrance} min={-1} max={1} step={0.01} bipolar note="Lifts what is already dull and leaves what is already loud." {...p('vibrance', 'Vibrance')} />
      <Instrument label="Hue turn" value={g.hue} min={-3.14} max={3.14} step={0.02} bipolar format={(v) => `${Math.round((v * 180) / Math.PI)}°`} {...p('hue', 'Hue')} />
      <Instrument label="Clarity" value={g.clarity} min={-1} max={1} step={0.01} bipolar note="Local contrast. Negative is the old soft-focus filter; positive is the print dodged and burned." {...p('clarity', 'Clarity')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Keep one colour</span><span className="sec-head__line" /></h4>
      <Instrument label="Amount" value={g.isolate} note="Everything but one hue is drained to grey." {...p('isolate', 'Colour Isolate')} />
      <Instrument label="Which" value={g.isolateHue} format={(v) => `${Math.round(v * 360)}°`} {...p('isolateHue', 'Isolate Hue')} />
      <Instrument label="How wide" value={g.isolateWidth} min={0.02} max={0.5} step={0.005} {...p('isolateWidth', 'Isolate Width')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Split tone</span><span className="sec-head__line" /></h4>
      <Instrument label="Amount" value={g.splitAmount} note="One colour into the shadows, another into the highlights — how a print is toned." {...p('splitAmount', 'Split Tone')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Tilt-shift</span><span className="sec-head__line" /></h4>
      <Instrument label="Amount" value={g.tilt} note="One band stays sharp and the rest is let go, the way a swung lens does it." {...p('tilt', 'Tilt-shift')} />
      <Instrument label="Angle" value={g.tiltAngle} min={0} max={3.14} step={0.02} format={(v) => `${Math.round((v * 180) / Math.PI)}°`} {...p('tiltAngle', 'Tilt Angle')} />
      <Instrument label="Band width" value={g.tiltWidth} min={0.02} max={0.5} step={0.005} {...p('tiltWidth', 'Tilt Width')} />
      <Instrument label="Where" value={g.tiltCentre} {...p('tiltCentre', 'Tilt Centre')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">The tube</span><span className="sec-head__line" /></h4>
      <Instrument label="Phosphor mask" value={g.crt} note="Three stripes to a pixel and a scan line between them." {...p('crt', 'CRT')} />
      <Instrument label="Pitch" value={g.crtPitch} min={0.1} max={2} step={0.02} {...p('crtPitch', 'CRT Pitch')} />
      <Instrument label="Bend" value={g.crtBend} note="A tube is not flat." {...p('crtBend', 'CRT Bend')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">The tape</span><span className="sec-head__line" /></h4>
      <Instrument label="Chroma slip" value={g.vhs} note="Colour smeared sideways off the luma, which is what a worn tape actually does." {...p('vhs', 'Chroma Slip')} />
      <Instrument label="Tracking" value={g.tracking} note="Bands that tear and creep up the picture." {...p('tracking', 'Tracking')} />
      <Instrument label="Dropout" value={g.dropout} note="The white dashes where the oxide has gone." {...p('dropout', 'Dropout')} />

      <h4 className="sec-head sec-head--sub"><span className="lbl">Broken</span><span className="sec-head__line" /></h4>
      <Instrument label="Block shift" value={g.glitch} note="Whole blocks in the wrong place." {...p('glitch', 'Glitch')} />
      <Instrument label="Block size" value={g.block} {...p('block', 'Block Size')} />
      <Instrument label="Sort" value={g.sort} note="Bright pixels dragged up their own column. Not a true sort — that needs the whole run at once — but it is what the artefact looks like." {...p('sort', 'Pixel Sort')} />
      <Instrument label="Sort above" value={g.sortThreshold} {...p('sortThreshold', 'Sort Threshold')} />
      <Instrument label="Palette" value={g.quantise} note="Down to a handful of levels per channel." {...p('quantise', 'Quantise')} />

      <SeedField
        label="Seed"
        seed={g.seed}
        onSeed={(v) => once((r) => ({ ...r, signal: { ...r.signal, seed: v } }), 'signal', 'Signal Seed', seedLabel(v))}
      />
    </Module>
  );
}

/* ---------------- SCREEN ---------------- */
function ScreenModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const c = recipe.screen;
  const p = (k: keyof typeof c, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, screen: { ...r.screen, [k]: v } }), 'raster', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Screen" {...mod}>
      <Instrument label="Halftone" value={c.halftone} {...p('halftone', 'Halftone')} />
      <Instrument
        label="Ruling"
        value={c.halfSize}
        min={2}
        max={22}
        step={0.5}
        format={(v) => `${v.toFixed(1)} px`}
        {...p('halfSize', 'Halftone Ruling')}
      />
      <Instrument
        label="Angle"
        value={c.halfAngle}
        min={0}
        max={Math.PI / 2}
        step={0.01}
        format={(v) => `${Math.round((v * 180) / Math.PI)}°`}
        {...p('halfAngle', 'Halftone Angle')}
      />
      <div className="row row--gap depth__switch">
        <span className="instr__label">Screens</span>
        <span className="spacer" />
        <button
          className="btn btn--sm"
          type="button"
          aria-pressed={c.halfColour}
          onClick={() => once((r) => ({ ...r, screen: { ...r.screen, halfColour: !r.screen.halfColour } }), 'raster', 'Halftone Screens', c.halfColour ? 'one' : 'three')}
        >
          {c.halfColour ? 'Three, at press angles' : 'One, on luminance'}
        </button>
      </div>
      <Instrument
        label="Duotone"
        value={c.duotone}
        note="The whole scale remapped between two inks."
        {...p('duotone', 'Duotone')}
      />
    </Module>
  );
}

/* ---------------- PAPER ---------------- */
function PaperModule({ mod }: { mod: ModProps }) {
  const { recipe } = useLab();
  const { live, once, commit } = useProcess();
  const pa = recipe.paper;
  const p = (k: keyof typeof pa, title: string) => ({
    onChange: (v: number) => live((r) => ({ ...r, paper: { ...r.paper, [k]: v } }), 'raster', title, v.toFixed(2)),
    onCommit: commit,
  });
  return (
    <Module title="Paper" {...mod}>
      <div className="chemgrid">
        {PAPER_STOCKS.map((st) => (
          <button
            key={st.id}
            type="button"
            className="chem"
            aria-pressed={pa.stock === st.id}
            onClick={() =>
              once((r) => ({ ...r, paper: { ...r.paper, stock: st.id as PaperStock, tint: st.tint } }), 'raster', 'Stock', st.label)
            }
          >
            {st.label}
          </button>
        ))}
      </div>
      <Instrument label="Amount" value={pa.amount} {...p('amount', 'Paper')} />
      <Instrument
        label="Grain of the sheet"
        value={pa.scale}
        min={120}
        max={900}
        step={10}
        format={(v) => `${v.toFixed(0)} px`}
        {...p('scale', 'Paper Scale')}
      />
      <Instrument
        label="Relief"
        value={pa.relief}
        note="Light raking across the fibre, taken from the plate's own slope."
        {...p('relief', 'Paper Relief')}
      />
      <Instrument label="Ink in the tooth" value={pa.bleed} {...p('bleed', 'Ink Bleed')} />
      <Instrument label="Deckle" value={pa.deckle} note="A torn edge, because a sheet has one." {...p('deckle', 'Deckle')} />
    </Module>
  );
}
