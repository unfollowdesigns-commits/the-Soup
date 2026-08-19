import { FIDELITY_LABEL, FIDELITY_NOTE, FORMAT_LABEL, KIND_LABEL, getMaterial } from '../lab/materials';
import { DEV_LABEL, DEVELOPER_LABEL } from '../lab/recipe';
import { TraitBar } from './Instrument';

/* ============================================================
   MATERIAL DETAIL
   The record behind the specimen. Educational, but written the
   way a lab notebook is written, not a textbook.
   ============================================================ */

export function MaterialDetail({
  id,
  loaded,
  onLoad,
  onClose,
}: {
  id: string;
  loaded: boolean;
  onLoad: () => void;
  onClose: () => void;
}) {
  const m = getMaterial(id);

  return (
    <div className="mdetail" role="dialog" aria-label={`${m.name} record`}>
      <header className="mdetail__head">
        <div className="mdetail__id">
          <span className="mono mono--dim">{m.archiveNo}</span>
          <span className={`fidelity fidelity--${m.fidelity}`}>{FIDELITY_LABEL[m.fidelity]}</span>
        </div>
        <button className="icb" type="button" onClick={onClose} aria-label="Close record">
          <Cross />
        </button>
      </header>

      <div className="mdetail__scroll scroll-y">
        <div className="mdetail__title">
          <h2>{m.name}</h2>
          <p className="mono">{m.manufacturer}</p>
        </div>

        <span className="mdetail__swatch" aria-hidden="true">
          {m.swatch.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>

        <dl className="spec">
          <Row k="Era" v={m.era.replace('-', ' – ')} />
          <Row k="In production" v={`${m.yearFrom} → ${m.yearTo ?? 'Present'}`} />
          <Row k="Type" v={KIND_LABEL[m.kind]} />
          <Row k="Speed" v={m.isoLabel} />
          <Row k="Formats" v={m.formats.map((f) => FORMAT_LABEL[f]).join(', ')} />
          <Row k="Development" v={m.development.map((d) => DEV_LABEL[d]).join(', ')} />
          <Row k="Chemistry" v={m.developers.map((d) => DEVELOPER_LABEL[d]).join(', ')} />
        </dl>

        <section className="mdetail__block">
          <h3 className="lbl lbl--wide">Character</h3>
          <div className="mdetail__traits">
            <TraitBar label="Grain" value={m.traits.grain} />
            <TraitBar label="Contrast" value={m.traits.contrast} />
            <TraitBar label="Latitude" value={m.traits.latitude} />
            <TraitBar label="Sharpness" value={m.traits.sharpness} />
            <TraitBar label="Saturation" value={m.traits.saturation} />
          </div>
        </section>

        <Note title="Tonal response" body={m.notes.tonal} />
        <Note title="Grain" body={m.notes.grain} />
        <Note title="Colour response" body={m.notes.color} />
        <Note title="Highlight behaviour" body={m.notes.highlight} />
        <Note title="Shadow behaviour" body={m.notes.shadow} />

        <section className="mdetail__block">
          <h3 className="lbl lbl--wide">Historical note</h3>
          <p className="serif">{m.notes.history}</p>
        </section>

        <section className="mdetail__block mdetail__fidelity">
          <h3 className="lbl lbl--wide">Fidelity</h3>
          <p className="mdetail__fidelity-note">{FIDELITY_NOTE[m.fidelity]}</p>
          <p className="mdetail__caveat mono">
            This library is a demonstration set. No record here claims to
            reproduce a process chemically.
          </p>
        </section>
      </div>

      <footer className="mdetail__foot">
        <button
          className={`btn btn--lg btn--block ${loaded ? '' : 'btn--primary'}`}
          type="button"
          onClick={onLoad}
          disabled={loaded}
        >
          {loaded ? 'Loaded in the workstation' : 'Load this material'}
        </button>
      </footer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="spec__row">
      <dt className="lbl">{k}</dt>
      <dd className="mono mono--val">{v}</dd>
    </div>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <section className="mdetail__block">
      <h3 className="lbl lbl--wide">{title}</h3>
      <p className="mdetail__prose">{body}</p>
    </section>
  );
}

export function Cross() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}
