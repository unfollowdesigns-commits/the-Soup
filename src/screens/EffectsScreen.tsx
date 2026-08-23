import { useEffect } from 'react';
import { EffectLibrary } from '../components/EffectLibrary';
import { useDispatch } from '../lab/store';

/* ============================================================
   THE EFFECTS SCREEN
   Browsing effects used to mean covering the photograph with a
   drawer, which is exactly backwards: the thing you are choosing
   between is a picture, and it was hidden behind the chooser.

   So it is a screen of its own. The whole window is the
   catalogue while you are looking, and the whole window is the
   photograph when you are not. Esc, or the button, goes back.
   ============================================================ */

export function EffectsScreen() {
  const dispatch = useDispatch();
  const back = () => dispatch({ type: 'screen', screen: 'lab' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fxscreen">
      <EffectLibrary onClose={back} />
    </div>
  );
}
