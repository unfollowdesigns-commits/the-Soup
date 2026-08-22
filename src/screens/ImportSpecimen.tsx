import { useCallback, useRef, useState } from 'react';
import { INTAKE_ACCEPT, IntakeError, openFile, pickFile } from '../lab/intake';
import { AnalogSurface } from '../analog/AnalogSurface';
import { makeHouseSpecimen, type HouseSpecimen } from '../lab/specimens';
import { makeHouseMotion } from '../lab/motion';
import { openCamera } from '../lab/camera';
import { useDispatch, useLab } from '../lab/store';

/* ============================================================
   SCREEN 2 — IMPORT SPECIMEN
   The photograph goes on the table. Nothing leaves the machine:
   the file is read locally and handed straight to the engine.
   ============================================================ */

export function ImportSpecimen() {
  const dispatch = useDispatch();
  const { specimen } = useLab();
  const [over, setOver] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    async (file: File) => {
      setError(null);
      setOpening(true);
      try {
        dispatch({ type: 'specimen', specimen: await openFile(file) });
      } catch (e) {
        setError(e instanceof IntakeError ? e.message : 'The lab could not read that.');
      } finally {
        setOpening(false);
      }
    },
    [dispatch],
  );

  /* ---- the camera ----------------------------------------
     Live capture is just a moving specimen: the same engine runs
     on every frame, so every look, every cook and the trace layer
     work on it exactly as they do on a file. */
  const startCamera = useCallback(async () => {
    setError(null);
    setOpening(true);
    try {
      dispatch({ type: 'specimen', specimen: await openCamera() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }, [dispatch]);

  const motion = () => {
    const m = makeHouseMotion(1280, 854);
    dispatch({
      type: 'specimen',
      specimen: {
        id: 'house-motion',
        name: m.name,
        source: 'house',
        kind: 'moving',
        width: m.width,
        height: m.height,
        bitmap: m.canvas,
        tick: m.tick,
        duration: m.duration,
        importedAt: Date.now(),
        note: m.note,
      },
    });
  };

  const house = (kind: HouseSpecimen) => {
    const drawn = makeHouseSpecimen(kind, 1800, 1200);
    dispatch({
      type: 'specimen',
      specimen: {
        id: `house-${kind}`,
        name: drawn.name,
        source: 'house',
        kind: 'still',
        width: drawn.width,
        height: drawn.height,
        bitmap: drawn.canvas,
        importedAt: Date.now(),
        note: drawn.note,
      },
    });
  };

  return (
    <div className="import">
      <header className="import__head">
        <button
          className="btn btn--quiet"
          type="button"
          onClick={() => dispatch({ type: 'screen', screen: specimen ? 'lab' : 'enter' })}
        >
          ← {specimen ? 'Back' : 'Back'}
        </button>
        <span className="spacer" />
        <span className="lbl lbl--wide">Put something in</span>
      </header>

      <div className="import__body">
        <AnalogSurface
          preset="bench"
          seed={11}
          textureOpacity={0.1}
          className={`dropzone ${over ? 'dropzone--over' : ''}`}
          as="div"
        >
          <div
            className="dropzone__inner"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = pickFile(e.dataTransfer);
              if (f) void accept(f);
            }}
          >
            <span className="dropzone__corner dropzone__corner--tl" />
            <span className="dropzone__corner dropzone__corner--tr" />
            <span className="dropzone__corner dropzone__corner--bl" />
            <span className="dropzone__corner dropzone__corner--br" />

            <p className="dropzone__label">Drop it<br />here</p>
            <p className="serif dropzone__lead">
              A picture or a clip. It is read on this machine and handed straight
              to the engine — nothing leaves. Clips go through frame by frame.
            </p>
            <button className="btn btn--lg btn--primary" type="button" onClick={() => input.current?.click()}>
              Choose a file
            </button>
            <input
              ref={input}
              className="sr"
              type="file"
              accept={INTAKE_ACCEPT}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void accept(f);
                e.target.value = '';
              }}
            />
            {error ? <p className="dropzone__error mono">{error}</p> : null}
          </div>
        </AnalogSurface>

        <aside className="import__house">
          <button
            className="camcard"
            type="button"
            disabled={opening}
            onClick={() => void startCamera()}
          >
            <span className="camcard__eye" aria-hidden="true">
              <span />
            </span>
            <span>
              <span className="camcard__name">
                {opening ? 'Opening…' : 'Open the camera'}
              </span>
              <span className="mono mono--dim">
                Live. Cooks every frame as it comes in.
              </span>
            </span>
          </button>

          <hr className="hr" />

          <h2 className="lbl lbl--wide">Nothing to hand</h2>
          <p className="import__note">
            Two images the lab drew itself. Neither is a photograph and neither
            pretends to be — they are here so the bench is never empty.
          </p>
          <button className="housecard housecard--motion" type="button" onClick={motion}>
            <span className="housecard__thumb housecard__thumb--motion" aria-hidden="true">
              <i /><i /><i />
            </span>
            <span>
              <span className="housecard__name">Passing — moving</span>
              <span className="mono mono--dim">
                A drawn loop. Tracking, sequence and flicker have something to do.
              </span>
            </span>
          </button>

          <button className="housecard" type="button" onClick={() => house('window')}>
            <span className="housecard__thumb housecard__thumb--window" aria-hidden="true" />
            <span>
              <span className="housecard__name">Window</span>
              <span className="mono mono--dim">Glass and hard light. Good for halation.</span>
            </span>
          </button>
          <button className="housecard" type="button" onClick={() => house('target')}>
            <span className="housecard__thumb housecard__thumb--target" aria-hidden="true" />
            <span>
              <span className="housecard__name">Wedge</span>
              <span className="mono mono--dim">Steps and primaries. Good for grain and density.</span>
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}
