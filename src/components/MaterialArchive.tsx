import { useMemo, useState } from 'react';
import {
  ERAS,
  FORMAT_LABEL,
  FORMATS,
  KIND_LABEL,
  KINDS,
  MANUFACTURERS,
  MATERIALS,
} from '../lab/materials';
import type { Material } from '../lab/types';
import { Chevron, TraitBar } from './Instrument';

/* ============================================================
   MATERIAL ARCHIVE
   A drawer of specimens, not a shop. Records are indexed,
   labelled and filed; selecting one pulls it from the drawer.
   ============================================================ */

interface Filters {
  era: Set<string>;
  kind: Set<string>;
  format: Set<string>;
  maker: Set<string>;
  q: string;
}

const empty = (): Filters => ({
  era: new Set(),
  kind: new Set(),
  format: new Set(),
  maker: new Set(),
  q: '',
});

export function MaterialArchive({
  selected,
  onSelect,
  onInspect,
}: {
  selected: string;
  onSelect: (m: Material) => void;
  onInspect: (id: string) => void;
}) {
  const [f, setF] = useState<Filters>(empty);
  const [open, setOpen] = useState<Record<string, boolean>>({
    era: true,
    kind: true,
    format: false,
    maker: false,
  });

  const toggle = (key: keyof Omit<Filters, 'q'>, id: string) =>
    setF((prev) => {
      const next = new Set(prev[key]);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...prev, [key]: next };
    });

  const results = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return MATERIALS.filter((m) => {
      if (f.era.size && !f.era.has(m.era)) return false;
      if (f.kind.size && !f.kind.has(m.kind)) return false;
      if (f.format.size && !m.formats.some((x) => f.format.has(x))) return false;
      if (f.maker.size && !f.maker.has(m.manufacturer)) return false;
      if (q) {
        const hay = `${m.name} ${m.manufacturer} ${m.archiveNo} ${m.isoLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [f]);

  const active =
    f.era.size + f.kind.size + f.format.size + f.maker.size + (f.q ? 1 : 0);

  return (
    <aside className="archive" aria-label="Material archive">
      <div className="sec-head">
        <span className="lbl lbl--wide">Stock</span>
        <span className="sec-head__line" />
        <span className="mono mono--dim">{results.length}/{MATERIALS.length}</span>
      </div>

      <div className="archive__search">
        <input
          className="archive__input"
          type="search"
          value={f.q}
          placeholder="Search stock"
          onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))}
          aria-label="Search materials"
        />
        {active > 0 ? (
          <button className="btn btn--sm btn--quiet" type="button" onClick={() => setF(empty())}>
            Clear
          </button>
        ) : null}
      </div>

      <div className="archive__body scroll-y">
        <Drawer
          label="Era"
          open={open.era}
          count={f.era.size}
          onToggle={() => setOpen((o) => ({ ...o, era: !o.era }))}
        >
          {ERAS.map((e) => (
            <FilterChip
              key={e.id}
              label={e.label}
              on={f.era.has(e.id)}
              onClick={() => toggle('era', e.id)}
            />
          ))}
        </Drawer>

        <Drawer
          label="Material"
          open={open.kind}
          count={f.kind.size}
          onToggle={() => setOpen((o) => ({ ...o, kind: !o.kind }))}
        >
          {KINDS.map((k) => (
            <FilterChip
              key={k.id}
              label={k.label}
              on={f.kind.has(k.id)}
              onClick={() => toggle('kind', k.id)}
            />
          ))}
        </Drawer>

        <Drawer
          label="Format"
          open={open.format}
          count={f.format.size}
          onToggle={() => setOpen((o) => ({ ...o, format: !o.format }))}
        >
          {FORMATS.map((k) => (
            <FilterChip
              key={k.id}
              label={k.label}
              on={f.format.has(k.id)}
              onClick={() => toggle('format', k.id)}
            />
          ))}
        </Drawer>

        <Drawer
          label="Manufacturer"
          open={open.maker}
          count={f.maker.size}
          onToggle={() => setOpen((o) => ({ ...o, maker: !o.maker }))}
        >
          {MANUFACTURERS.map((k) => (
            <FilterChip
              key={k}
              label={k}
              on={f.maker.has(k)}
              onClick={() => toggle('maker', k)}
            />
          ))}
        </Drawer>

        <div className="archive__list">
          {results.map((m) => (
            <MaterialRecord
              key={m.id}
              material={m}
              selected={m.id === selected}
              onSelect={() => onSelect(m)}
              onInspect={() => onInspect(m.id)}
            />
          ))}
          {!results.length ? (
            <p className="archive__none mono mono--dim">
              Nothing on the shelf under those terms.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function Drawer({
  label,
  open,
  count,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  count: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="drawer" data-open={open}>
      <button className="drawer__head" type="button" onClick={onToggle} aria-expanded={open}>
        <Chevron open={open} />
        <span className="lbl">{label}</span>
        {count ? <span className="drawer__count mono">{count}</span> : null}
      </button>
      {open ? <div className="drawer__body">{children}</div> : null}
    </section>
  );
}

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className="chip" type="button" aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

/* ============================================================
   MATERIAL RECORD — a specimen card, filed
   ============================================================ */
export function MaterialRecord({
  material: m,
  selected,
  onSelect,
  onInspect,
  compact = false,
}: {
  material: Material;
  selected: boolean;
  onSelect: () => void;
  onInspect: () => void;
  compact?: boolean;
}) {
  const years = `${m.yearFrom} → ${m.yearTo ?? 'Present'}`;
  return (
    <article className="mrec" data-selected={selected} data-compact={compact}>
      <button className="mrec__main" type="button" onClick={onSelect}>
        <span className="mrec__swatch" aria-hidden="true">
          {m.swatch.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="mrec__body">
          <span className="mrec__top">
            <span className="mrec__name">{m.name}</span>
            <span className="mono mono--dim mrec__no">{m.archiveNo}</span>
          </span>
          <span className="mrec__meta mono">
            {KIND_LABEL[m.kind]} · {m.isoLabel}
          </span>
          <span className="mrec__meta mono mono--dim">
            {m.formats.map((x) => FORMAT_LABEL[x]).join(' · ')}
          </span>
          <span className="mrec__years mono mono--dim">{years}</span>
          {!compact ? (
            <span className="mrec__traits">
              <TraitBar label="Grain" value={m.traits.grain} />
              <TraitBar label="Contrast" value={m.traits.contrast} />
              <TraitBar label="Latitude" value={m.traits.latitude} />
            </span>
          ) : null}
        </span>
      </button>
      <button className="mrec__inspect" type="button" onClick={onInspect} title="Open record">
        <span className="lbl">Record</span>
      </button>
      {selected ? <span className="mrec__loaded lbl lbl--amber">Loaded</span> : null}
    </article>
  );
}
