import type { RenderStats } from '../engine/renderer';
import { useLab } from '../lab/store';

/* ============================================================
   PROCESSING STATUS & DEPTH ANALYSIS
   Every number on this panel is measured. Where the lab does not
   have a real value, it says so rather than printing a plausible
   one.
   ============================================================ */

export function ProcessingStatus({ stats }: { stats: RenderStats | null }) {
  const { recipe } = useLab();
  const stages: [string, boolean][] = [
    ['Material response', true],
    ['Development', recipe.development.mode !== 'normal' || recipe.development.pushPull !== 0],
    ['Halation field', recipe.halation.intensity > 0],
    ['Diffusion', recipe.diffusion.softness > 0 || recipe.diffusion.bloom > 0],
    ['Grain field', recipe.grain.amount > 0],
    ['Experimental layer', recipe.experimental.filmSoup > 0 || recipe.burns.length > 0],
    ['Depth proxy', recipe.depth.enabled],
  ];

  return (
    <section className="status" aria-label="Processing status">
      <div className="sec-head">
        <span className="lbl lbl--wide">Specimen</span>
        <span className="sec-head__line" />
        <span className="lamp" data-state={stats ? 'on' : 'off'} />
      </div>

      <ul className="status__stages">
        {stages.map(([name, on]) => (
          <li key={name} data-on={on}>
            <span className="lbl">{name}</span>
            <span className="mono mono--dim">{on ? 'Applied' : 'Bypassed'}</span>
          </li>
        ))}
      </ul>

      <dl className="status__metrics">
        <Metric
          k="Frame"
          v={stats ? `${stats.frameMs.toFixed(1)} ms` : '—'}
          note="CPU-side, measured"
        />
        <Metric
          k="GPU"
          v={
            stats
              ? stats.gpuMs != null
                ? `${stats.gpuMs.toFixed(2)} ms`
                : stats.gpuTimerAvailable
                  ? 'awaiting query'
                  : 'not reported'
              : '—'
          }
          note={
            stats && !stats.gpuTimerAvailable
              ? 'The browser does not expose GPU timing'
              : 'EXT_disjoint_timer_query'
          }
        />
        <Metric k="Passes" v={stats ? String(stats.passes) : '—'} />
        <Metric k="Working buffer" v={stats ? `${stats.baseW} × ${stats.baseH}` : '—'} />
        <Metric k="Precision" v={stats ? (stats.floatBuffers ? 'half float' : '8-bit') : '—'} />
        <Metric
          k="Damage plates"
          v={stats ? (stats.damagePlates ? 'scanned' : 'procedural fallback') : '—'}
        />
      </dl>
    </section>
  );
}

function Metric({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="status__metric" title={note}>
      <dt className="lbl">{k}</dt>
      <dd className="mono mono--val">{v}</dd>
    </div>
  );
}

/* ============================================================
   DEPTH ANALYSIS
   ============================================================ */
export function DepthAnalysis({ stats }: { stats: RenderStats | null }) {
  const { recipe, specimen } = useLab();
  const proxyRes = stats ? `${stats.baseW >> 2} × ${stats.baseH >> 2}` : '—';

  return (
    <section className="depth" aria-label="Depth analysis">
      <div className="sec-head">
        <span className="lbl lbl--wide">Depth</span>
        <span className="sec-head__line" />
        <span className="lamp" data-state={recipe.depth.enabled ? 'warn' : 'off'} />
      </div>

      <div className="depth__banner">
        <p className="lbl lbl--amber">No model connected</p>
        <p className="depth__note">
          A monocular depth model will run here. Until it does, the lab derives a
          proxy from local detail, aerial perspective and frame geometry. It is
          an estimate made from the picture, not an inference about the scene.
        </p>
      </div>

      <dl className="status__metrics">
        <Metric k="Proxy field" v={proxyRes} />
        <Metric k="Source" v={specimen ? `${specimen.width} × ${specimen.height}` : '—'} />
        <Metric k="Inference" v="not run" note="No model is loaded, so there is no inference time to report" />
        <Metric k="GPU resident" v={stats ? 'yes' : 'no'} note="The proxy is computed on the GPU alongside the other passes" />
        <Metric k="Confidence" v="unavailable" note="A proxy has no confidence estimate" />
      </dl>

      <div className="depth__scale">
        <span className="lbl">Near</span>
        <span className="depth__ramp" aria-hidden="true" />
        <span className="lbl">Far</span>
      </div>

      <p className="instr__note">
        Switch the view above the specimen to Depth, Normals or Effect to see
        what the proxy is doing.
      </p>
    </section>
  );
}
