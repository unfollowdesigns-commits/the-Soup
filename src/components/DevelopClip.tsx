import { useEffect, useMemo, useRef, useState } from 'react';
import { GATES, SIZES, getGate, getSize, type FrameFit, type GateId } from '../lab/gate';
import { getMaterial } from '../lab/materials';
import { proposeRecipeCode } from '../lab/recipe';
import { useDispatch, useLab } from '../lab/store';
import { ClipFrames, exportClip, pickCodec, type ExportProgress, type ExportSettings } from '../video/export';
import { Instrument, Segmented } from './Instrument';

/* ============================================================
   DEVELOP — MOVING
   The clip goes through the gate. Pick the format, pick how much
   of the film you want to see, and the lab runs every frame
   through the same process the bench is showing.

   Nothing here is realtime and nothing is dropped: the export
   takes as long as it takes and every frame is the full recipe.
   ============================================================ */

const PREVIEW_W = 560;

export function DevelopClip() {
  const { recipe, specimen, archive } = useLab();
  const dispatch = useDispatch();
  const material = getMaterial(recipe.material);

  const clipLength = specimen?.duration ?? 6;

  const [gate, setGate] = useState<GateId>('s8');
  const [fit, setFit] = useState<FrameFit>('gate');
  const [size, setSize] = useState('uhd');
  const [rate, setRate] = useState(0);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.min(clipLength, 8));
  const [bitrate, setBitrate] = useState(40);
  const [wear, setWear] = useState(0.28);
  const [liveGrain, setLiveGrain] = useState(true);
  const [scrub, setScrub] = useState(0);

  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codec, setCodec] = useState<string | null>(null);
  const cancel = useRef({ cancelled: false });

  const g = getGate(gate);
  const out = getSize(size);
  const fps = rate || g.fps || 24;
  const frames = Math.max(1, Math.round(Math.max(1 / fps, to - from) * fps));
  const running = !!progress && progress.phase !== 'done' && progress.phase !== 'error';

  const settings: ExportSettings = useMemo(
    () => ({ gate, fit, size, fps: rate, from, to, bitrate, wear, liveGrain }),
    [gate, fit, size, rate, from, to, bitrate, wear, liveGrain],
  );

  /* ---- what the encoder in this browser will actually do ---- */
  useEffect(() => {
    let live = true;
    void pickCodec(out.w, out.h, bitrate * 1e6, fps).then((c) => live && setCodec(c));
    return () => {
      live = false;
    };
  }, [out.w, out.h, bitrate, fps]);

  /* ---- the preview: the same code path as the export ---- */
  const preview = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<ClipFrames | null>(null);
  const job = useRef(0);

  useEffect(() => {
    if (!specimen) return;
    const src = new ClipFrames(specimen);
    framesRef.current = src;
    return () => {
      framesRef.current = null;
      src.dispose();
    };
  }, [specimen]);

  useEffect(() => {
    const canvas = preview.current;
    const src = framesRef.current;
    if (!canvas || !src || running) return;
    const mine = ++job.current;
    const ph = Math.round((PREVIEW_W * out.h) / out.w);
    canvas.width = PREVIEW_W;
    canvas.height = ph;
    void (async () => {
      await src.ready();
      if (job.current !== mine) return;
      await src.draw(canvas, recipe, material, settings, Math.round(scrub * (frames - 1)), fps);
    })();
  }, [settings, recipe, material, scrub, frames, fps, out.w, out.h, running]);

  const run = async () => {
    if (!specimen) return;
    cancel.current = { cancelled: false };
    setError(null);
    setProgress({ phase: 'preparing', frame: 0, frames, rate: 0, codec: '', container: '' });
    try {
      const res = await exportClip(specimen, recipe, material, settings, setProgress, cancel.current);
      const code = proposeRecipeCode(recipe, archive.length + 1).replace(/[^\w]+/g, '-').toLowerCase();
      download(res.blob, `soup-${g.id}-${code}.${res.container === 'mp4' ? 'mp4' : 'webm'}`);
      dispatch({
        type: 'log',
        spec: {
          kind: 'export',
          title: 'Clip Developed',
          detail: `${res.frames} frames · ${res.width} × ${res.height} · ${res.codec}`,
        },
      });
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const secs = frames / fps;

  return (
    <div className="clip">
      <div className="clip__view">
        <canvas ref={preview} className="clip__preview" />
        <div className="clip__scrub">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={scrub}
            disabled={running}
            onChange={(e) => setScrub(+e.target.value)}
            aria-label="Preview frame"
          />
          <span className="mono mono--dim">
            frame {Math.round(scrub * (frames - 1)) + 1} / {frames}
          </span>
        </div>
        <p className="clip__gatenote serif">{g.note}</p>
      </div>

      <div className="clip__set scroll-y">
        <div className="clip__field">
          <span className="lbl">Gate</span>
          <div className="clip__gates">
            {GATES.map((x) => (
              <button
                key={x.id}
                type="button"
                className="clip__gate"
                aria-pressed={gate === x.id}
                disabled={running}
                onClick={() => {
                  setGate(x.id);
                  setRate(0);
                }}
              >
                <span className="clip__gate-name">{x.name}</span>
                <span className="mono mono--dim">
                  {x.fps ? `${x.apertureW} × ${x.apertureH} mm` : 'source'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Segmented<FrameFit>
          label="Frame"
          value={fit}
          options={[
            { id: 'gate', label: 'Show the film', title: 'Perforations, edge print and all' },
            { id: 'clean', label: 'Picture only', title: 'Just what came through the gate' },
          ]}
          onChange={setFit}
        />

        <Segmented
          label="Size"
          value={size}
          options={SIZES.map((s) => ({ id: s.id, label: s.name, title: s.note }))}
          onChange={setSize}
        />

        <Segmented
          label="Rate"
          value={String(rate)}
          options={[
            { id: '0', label: g.fps ? `${g.fps} · gate` : 'Source' },
            { id: '24', label: '24' },
            { id: '25', label: '25' },
            { id: '30', label: '30' },
          ]}
          onChange={(v) => setRate(+v)}
        />

        <div className="clip__field">
          <span className="lbl">In and out</span>
          <div className="clip__range">
            <label className="clip__time">
              <span className="lbl">From</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, clipLength - 0.1)}
                step={0.1}
                value={from.toFixed(1)}
                disabled={running}
                onChange={(e) => setFrom(Math.min(+e.target.value, to - 0.1))}
              />
            </label>
            <label className="clip__time">
              <span className="lbl">To</span>
              <input
                type="number"
                min={0.1}
                max={clipLength}
                step={0.1}
                value={to.toFixed(1)}
                disabled={running}
                onChange={(e) => setTo(Math.max(+e.target.value, from + 0.1))}
              />
            </label>
            <span className="mono mono--val clip__count">
              {frames} frames · {secs.toFixed(1)}s
            </span>
          </div>
        </div>

        <Instrument
          label="Data rate"
          value={bitrate}
          min={4}
          max={120}
          step={1}
          unit="Mb/s"
          format={(v) => v.toFixed(0)}
          onChange={setBitrate}
          disabled={running}
          note="Grain is expensive to encode. Below about 30 Mb/s at 4K it starts to smear."
        />

        <Instrument
          label="Print wear"
          value={wear}
          min={0}
          max={1}
          step={0.01}
          onChange={setWear}
          disabled={running}
          note="How many times this print has been through a projector."
        />

        <label className="clip__check">
          <input
            type="checkbox"
            checked={liveGrain}
            disabled={running}
            onChange={(e) => setLiveGrain(e.target.checked)}
          />
          <span>
            <span className="clip__check-name">Grain moves</span>
            <span className="mono mono--dim">
              Every frame gets its own crystals, the way stock does.
            </span>
          </span>
        </label>

        <hr className="hr" />

        <div className="clip__out">
          <div className="spec__row">
            <dt className="lbl">Output</dt>
            <dd className="mono mono--val">{out.w} × {out.h}</dd>
          </div>
          <div className="spec__row">
            <dt className="lbl">Encoder</dt>
            <dd className="mono mono--val">
              {codec === null ? 'none in this browser' : codec}
            </dd>
          </div>
          <div className="spec__row">
            <dt className="lbl">Container</dt>
            <dd className="mono mono--val">
              {codec === null ? '—' : codec.startsWith('avc') ? 'MP4 / H.264' : 'WebM'}
            </dd>
          </div>
        </div>

        {running ? (
          <>
            <div className="clip__bar" role="progressbar" aria-valuenow={progress.frame} aria-valuemax={progress.frames}>
              <i style={{ width: `${(progress.frame / progress.frames) * 100}%` }} />
            </div>
            <div className="clip__phase">
              <span className="lamp" data-state="busy" />
              <span className="mono">
                {progress.phase === 'preparing' && 'Loading the gate'}
                {progress.phase === 'rendering' &&
                  `frame ${progress.frame} of ${progress.frames} · ${progress.rate.toFixed(1)} fps`}
                {progress.phase === 'encoding' && 'Flushing the encoder'}
                {progress.phase === 'writing' && 'Writing the file'}
              </span>
              <span className="spacer" />
              <button
                className="btn btn--sm btn--danger"
                type="button"
                onClick={() => {
                  cancel.current.cancelled = true;
                }}
              >
                Stop
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn btn--lg btn--primary btn--block"
            type="button"
            disabled={!specimen || codec === null}
            onClick={() => void run()}
          >
            Run the clip through
          </button>
        )}

        {progress?.phase === 'done' ? (
          <p className="mono clip__done">
            {progress.frames} frames · {((progress.bytes ?? 0) / 1048576).toFixed(1)} MB · saved to your downloads
          </p>
        ) : null}
        {error ? <p className="mono clip__error">{error}</p> : null}
      </div>
    </div>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
