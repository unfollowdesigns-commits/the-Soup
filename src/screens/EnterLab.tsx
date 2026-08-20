import { useEffect, useState } from 'react';
import { BRAND, COLOPHON } from '../brand/brand';
import { Mark, Wordmark } from '../brand/Mark';
import { LOOKS } from '../lab/looks';
import { MATERIALS } from '../lab/materials';
import { useDispatch } from '../lab/store';
import { ContactStrip } from './ContactStrip';

/* ============================================================
   THE WAY IN
   A page, not a hero card. The name is the biggest thing on it,
   the list of what the lab can ruin is the second biggest, and
   the engine is already running underneath.
   ============================================================ */

export function EnterLab() {
  const dispatch = useDispatch();
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLit(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="way" data-lit={lit}>
      <header className="way__top">
        <Wordmark size={18} />
        <span className="spacer" />
        <span className="mono mono--dim">{MATERIALS.length} STOCKS</span>
        <span className="mono mono--dim">{LOOKS.length} COOKS</span>
      </header>

      <main className="way__body">
        <div className="way__left">
          <h1 className="way__name">
            <span>SOUP</span>
          </h1>
          <p className="way__line">{BRAND.line}</p>
          <hr className="hr hr--acid way__rule" />
          <p className="way__blurb serif">{BRAND.blurb}</p>

          <button
            className="way__go"
            type="button"
            onClick={() => dispatch({ type: 'screen', screen: 'import' })}
          >
            <Mark size={18} />
            <span>PUT SOMETHING IN</span>
            <span className="way__go-arrow" aria-hidden="true">→</span>
          </button>
        </div>

        <div className="way__right">
          <ContactStrip />
        </div>
      </main>

      <section className="way__ways" aria-label="What it does">
        <ol>
          {[
            ['01', 'PICK A STOCK', 'Tri-X, Portra, Kodachrome, wet plate, expired junk.'],
            ['02', 'DEVELOP IT WRONG', 'Push, pull, cross process, bleach bypass, stand.'],
            ['03', 'RUIN IT', 'Chemistry, heat, burns, dirt, light that got in.'],
            ['04', 'KEEP THE RECIPE', 'Every seed stored. It cooks the same way twice.'],
          ].map(([n, t, d]) => (
            <li key={n}>
              <span className="mono way__n">{n}</span>
              <span className="way__t">{t}</span>
              <span className="way__d">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="way__foot">
        <span className="mono mono--dim">{COLOPHON}</span>
        <span className="spacer" />
        <span className="mono mono--dim">NOTHING IS UPLOADED</span>
      </footer>
    </div>
  );
}
