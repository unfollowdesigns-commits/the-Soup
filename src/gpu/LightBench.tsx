import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Instrument, Segmented } from '../components/Instrument';
import { Cross } from '../components/MaterialDetail';
import { useDispatch, useLab } from '../lab/store';
import { LightRig, type Light, type LightView, type RigReport } from './lightRig';
import './light.css';

/* ============================================================
   LIGHT
   Depth inference, lighting and draw, all recorded into one
   command encoder and submitted once. The depth texture never
   leaves the GPU.

   Everything on the overlay is measured. When there is no model
   loaded it says PROXY; when the browser will not give
   timestamp-query it says so instead of printing a number it
   does not have.
   ============================================================ */

const VIEWS: { id: LightView; label: string }[] = [
  { id: 'lit', label: 'Lit' },
  { id: 'rgb', label: 'RGB' },
  { id: 'depth', label: 'Depth' },
  { id: 'normals', label: 'Normals' },
];

export function LightBench() {
  const { specimen } = useLab();
  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<LightRig | null>(null);
  const [report, setReport] = useState<RigReport | null>(null);
  const [view, setView] = useState<LightView>('lit');
  const [lights, setLights] = useState<Light[]>([
    { x: 0.34, y: 0.36, z: 0.74, r: 1, g: 0.86, b: 0.6, intensity: 1.6, radius: 0.72 },
  ]);
  const [sel, setSel] = useState(0);
  const [params, setParams] = useState({
    ambient: 0.42, normalZ: 14, shadow: 0.5, parallax: 0, exposure: 1,
  });

  /* ---- start the rig ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rig = new LightRig();
    rigRef.current = rig;
    void rig.start(canvas);
    const t = window.setInterval(() => setReport(rig.report()), 250);
    return () => {
      window.clearInterval(t);
      rig.stop();
      rigRef.current = null;
    };
  }, []);

  /* ---- feed it whatever is on the table ---- */
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !specimen) return;
    const src = specimen.video ?? (specimen.bitmap as HTMLCanvasElement | ImageBitmap);
    rig.setSource(src, specimen.width, specimen.height);
  }, [specimen, report?.running]);

  useEffect(() => { rigRef.current?.setView(view); }, [view]);
  useEffect(() => { rigRef.current?.setLights(lights); }, [lights]);
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    (Object.keys(params) as (keyof typeof params)[]).forEach((k) => rig.setParam(k, params[k]));
  }, [params]);

  /* ---- drag the light on the frame ---- */
  const drag = useRef(false);
  const place = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setLights((ls) => ls.map((l, i) => (i === sel ? { ...l, x, y } : l)));
    },
    [sel],
  );

  const light = lights[Math.min(sel, lights.length - 1)];
  const setLight = (patch: Partial<Light>) =>
    setLights((ls) => ls.map((l, i) => (i === sel ? { ...l, ...patch } : l)));

  const dead = report && !report.running;

  return (
    <div className="light">
      <header className="light__bar">
        <button className="btn btn--quiet" type="button" onClick={() => dispatch({ type: 'screen', screen: 'lab' })}>
          ← Back
        </button>
        <span className="spacer" />
        <span className="lbl lbl--wide">Light</span>
        <span className="spacer" />
        <Segmented<LightView> value={view} options={VIEWS} onChange={setView} />
        <button className="icb" type="button" aria-label="Close" onClick={() => dispatch({ type: 'screen', screen: 'lab' })}>
          <Cross />
        </button>
      </header>

      <div className="light__body">
        <div
          className="light__stage"
          onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); place(e); }}
          onPointerMove={(e) => { if (drag.current) place(e); }}
          onPointerUp={(e) => { drag.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
        >
          <canvas ref={canvasRef} className="light__canvas" />

          {lights.map((l, i) => (
            <span
              key={i}
              className="light__pin"
              data-sel={i === sel}
              style={{
                left: `${l.x * 100}%`,
                top: `${l.y * 100}%`,
                background: `rgb(${l.r * 255 | 0},${l.g * 255 | 0},${l.b * 255 | 0})`,
              }}
              onPointerDown={(e) => { e.stopPropagation(); setSel(i); }}
            >
              <i>{i + 1}</i>
            </span>
          ))}

          {dead ? (
            <div className="light__dead">
              <p className="lbl lbl--amber">No WebGPU here</p>
              <p className="mono">{report?.reason}</p>
              <p className="mono mono--dim">
                The rest of SOUP runs on WebGL2 and is unaffected.
              </p>
            </div>
          ) : null}

          <Overlay report={report} />
        </div>

        <aside className="light__rail scroll-y">
          <div className="sec-head">
            <span className="lbl lbl--wide">Lamp {sel + 1}</span>
            <span className="sec-head__line" />
            <button
              className="btn btn--sm"
              type="button"
              disabled={lights.length >= 4}
              onClick={() => {
                setLights((ls) => [...ls, { ...ls[ls.length - 1], x: 0.6, y: 0.5 }]);
                setSel(lights.length);
              }}
            >
              Add
            </button>
          </div>

          <div className="light__lamps">
            {lights.map((l, i) => (
              <button
                key={i}
                type="button"
                className="light__lamp"
                aria-pressed={i === sel}
                style={{ borderColor: `rgb(${l.r * 255 | 0},${l.g * 255 | 0},${l.b * 255 | 0})` }}
                onClick={() => setSel(i)}
              >
                {i + 1}
              </button>
            ))}
            {lights.length > 1 ? (
              <button
                className="btn btn--sm btn--danger"
                type="button"
                onClick={() => { setLights((ls) => ls.filter((_, i) => i !== sel)); setSel(0); }}
              >
                Remove
              </button>
            ) : null}
          </div>

          {light ? (
            <div className="light__group">
              <Instrument label="Intensity" value={light.intensity} min={0} max={4} step={0.05}
                onChange={(v) => setLight({ intensity: v })} />
              <Instrument label="Reach" value={light.radius} min={0.05} max={2} step={0.01}
                onChange={(v) => setLight({ radius: v })} />
              <Instrument label="Depth" value={light.z} min={0} max={1}
                note="Where the lamp sits in the depth field. Push it behind the subject and the rim lights."
                onChange={(v) => setLight({ z: v })} />
              <Instrument label="Warmth" value={light.b} min={0.2} max={1}
                format={(v) => (v < 0.6 ? 'Tungsten' : v > 0.9 ? 'Daylight' : 'Warm')}
                onChange={(v) => setLight({ r: 1, g: 0.6 + v * 0.4, b: v })} />
            </div>
          ) : null}

          <div className="sec-head">
            <span className="lbl lbl--wide">Surface</span>
            <span className="sec-head__line" />
          </div>
          <div className="light__group">
            <Instrument label="Ambient" value={params.ambient}
              onChange={(v) => setParams((p) => ({ ...p, ambient: v }))} />
            <Instrument label="Relief" value={params.normalZ} min={1} max={40} step={0.5}
              note="How much slope the depth field is given before normals are taken from it."
              onChange={(v) => setParams((p) => ({ ...p, normalZ: v }))} />
            <Instrument label="Contact shadow" value={params.shadow}
              note="A short march toward the lamp through the depth field."
              onChange={(v) => setParams((p) => ({ ...p, shadow: v }))} />
            <Instrument label="Parallax" value={params.parallax}
              onChange={(v) => setParams((p) => ({ ...p, parallax: v }))} />
            <Instrument label="Exposure" value={params.exposure} min={0.2} max={3} step={0.01}
              onChange={(v) => setParams((p) => ({ ...p, exposure: v }))} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---- the overlay. Measured or absent, never invented. ---- */
function Overlay({ report }: { report: RigReport | null }) {
  if (!report?.running) return null;
  const r = report;
  return (
    <div className="light__hud">
      <div className="light__hud-row">
        <span className="mono mono--val">{r.fps.toFixed(0)} FPS</span>
        <span className="mono mono--dim">{r.totalDispatches} dispatches</span>
      </div>

      <div className="light__hud-src" data-proxy={r.depthSource === 'proxy'}>
        {r.depthSource === 'model' && r.depthModel ? (
          <>
            <span className="mono mono--val">{r.depthModel.name}</span>
            <span className="mono mono--dim">
              {r.depthModel.resolution}² · {r.depthModel.kind}
            </span>
          </>
        ) : (
          <>
            <span className="mono">PROXY — no model loaded</span>
            <span className="mono mono--dim">{r.depthResolution}² compute pass</span>
          </>
        )}
      </div>

      <ul className="light__hud-times">
        {r.timings.map((t) => (
          <li key={t.id}>
            <span className="mono mono--dim">{t.label}</span>
            <span className="mono mono--val">
              {t.gpuMs != null ? `${t.gpuMs.toFixed(2)} ms` : '—'}
            </span>
          </li>
        ))}
      </ul>

      <div className="light__hud-row">
        <span className="mono mono--dim">submit {r.cpuSubmitMs.toFixed(2)} ms</span>
        <span className="mono mono--dim">
          {r.timestampsAvailable ? 'timestamp-query' : 'no GPU timing'}
        </span>
      </div>
      <p className="light__hud-note mono">one encoder · no readback</p>
    </div>
  );
}
