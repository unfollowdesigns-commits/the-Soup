import { useEffect, useState } from 'react';
import { MATERIALS } from '../lab/materials';
import { useDispatch } from '../lab/store';
import { ContactStrip } from './ContactStrip';

/* ============================================================
   SCREEN 1 — ENTER THE LAB
   Five seconds to establish that this is a place, not a tool.
   ============================================================ */

export function EnterLab() {
  const dispatch = useDispatch();
  const [lit, setLit] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLit(true), 60);
    return () => clearTimeout(t);
  }, []);

  const shelf = MATERIALS.slice(4, 16);

  return (
    <div className="enter" data-lit={lit}>
      <div className="enter__light" aria-hidden="true" />

      <header className="enter__head">
        <span className="enter__mark" aria-hidden="true" />
        <span className="lbl lbl--wide">Est. in a converted loft</span>
      </header>

      <div className="enter__centre">
        <div className="enter__plate">
          <p className="lbl lbl--wide enter__eyebrow">Photographic</p>
          <h1 className="enter__title">
            Material<br />
            <em>Lab</em>
          </h1>
          <p className="serif enter__lead">
            Bring in a photograph. Decide what it was made on, how it was
            developed, what happened to the film afterwards — and how far you
            want to take the experiment.
          </p>

          <div className="enter__actions">
            <button
              className="btn btn--lg btn--primary"
              type="button"
              onClick={() => dispatch({ type: 'screen', screen: 'import' })}
            >
              Enter the lab
            </button>
          </div>

          <dl className="enter__facts">
            <div>
              <dt className="lbl">Materials on file</dt>
              <dd className="mono mono--val">{MATERIALS.length}</dd>
            </div>
            <div>
              <dt className="lbl">Processing</dt>
              <dd className="mono mono--val">WebGL2 · multi-pass</dd>
            </div>
            <div>
              <dt className="lbl">Grain</dt>
              <dd className="mono mono--val">procedural</dd>
            </div>
            <div>
              <dt className="lbl">Recipes</dt>
              <dd className="mono mono--val">reproducible</dd>
            </div>
          </dl>
        </div>

        <div className="enter__strip-holder">
          <ContactStrip />
        </div>
      </div>

      <footer className="enter__shelf" aria-hidden="true">
        <div className="enter__strip">
          {shelf.map((m) => (
            <span className="enter__can" key={m.id}>
              <span className="enter__can-swatch">
                {m.swatch.map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              <span className="enter__can-name mono">{m.name}</span>
              <span className="enter__can-iso mono mono--dim">{m.isoLabel}</span>
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
