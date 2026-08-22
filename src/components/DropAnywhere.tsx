import { useCallback, useEffect, useRef, useState } from 'react';
import { IntakeError, dragHasFiles, openFile, pickFile } from '../lab/intake';
import { useDispatch } from '../lab/store';

/* ============================================================
   DROP ANYWHERE
   The whole window is the dropzone. You should never have to
   find a screen to put a picture on the table.
   ============================================================ */

export function DropAnywhere() {
  const dispatch = useDispatch();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dragenter/dragleave fire for every element crossed; count them
  const depth = useRef(0);

  const take = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        dispatch({ type: 'specimen', specimen: await openFile(file) });
      } catch (e) {
        setError(e instanceof IntakeError ? e.message : 'The lab could not read that.');
        window.setTimeout(() => setError(null), 5200);
      } finally {
        setBusy(false);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current += 1;
      setOver(true);
    };
    const over_ = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      // without this the browser navigates to the file instead
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setOver(false);
      const file = pickFile(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      void take(file);
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over_);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over_);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [take]);

  if (!over && !busy && !error) return null;

  return (
    <div className="anydrop" data-state={over ? 'over' : busy ? 'busy' : 'error'} role="status">
      {over ? (
        <div className="anydrop__field">
          <span className="anydrop__corner anydrop__corner--tl" />
          <span className="anydrop__corner anydrop__corner--tr" />
          <span className="anydrop__corner anydrop__corner--bl" />
          <span className="anydrop__corner anydrop__corner--br" />
          <p className="anydrop__shout">Let go</p>
          <p className="mono anydrop__sub">
            Picture or clip · read on this machine · nothing is uploaded
          </p>
        </div>
      ) : null}

      {busy || error ? (
        <div className="anydrop__toast">
          <span className="lamp" data-state={error ? 'warn' : 'busy'} />
          <span className="mono">{error ?? 'reading'}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------
   The same intake behind a button, for the places that want one.
   ------------------------------------------------------------ */
export function useIntake() {
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        dispatch({ type: 'specimen', specimen: await openFile(file) });
      } catch (e) {
        setError(e instanceof IntakeError ? e.message : 'The lab could not read that.');
      } finally {
        setBusy(false);
      }
    },
    [dispatch],
  );

  return { accept, busy, error, setError };
}
