import { useEffect, useRef, useState } from 'react';
import { LabRenderer } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { DEV_LABEL, seedLabel, proposeRecipeCode } from '../lab/recipe';
import { useDispatch, useLab } from '../lab/store';
import { Cross } from './MaterialDetail';
import { Segmented } from './Instrument';
import { DevelopClip } from './DevelopClip';

/* ============================================================
   DEVELOP / EXPORT
   The last bench. The specimen is rendered once more at full
   size, with the recipe printed alongside so the result can be
   made again.
   ============================================================ */

type Fmt = 'png' | 'jpeg';
type Size = 'full' | 'half' | 'web';

export function DevelopExport() {
  const { recipe, specimen, archive } = useLab();
  const dispatch = useDispatch();
  const [fmt, setFmt] = useState<Fmt>('png');
  const [size, setSize] = useState<Size>('full');
  const [phase, setPhase] = useState<'idle' | 'processing' | 'developing' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const m = getMaterial(recipe.material);
  const scale = size === 'full' ? 1 : size === 'half' ? 0.5 : 0;
  const target = specimen
    ? size === 'web'
      ? fitLong(specimen.width, specimen.height, 2048)
      : { w: Math.round(specimen.width * scale), h: Math.round(specimen.height * scale) }
    : { w: 0, h: 0 };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dispatch({ type: 'export', open: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const develop = async () => {
    if (!specimen) return;
    setPhase('processing');
    setMsg('');
    await raf();
    let renderer: LabRenderer | null = null;
    try {
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = target.w;
      canvas.height = target.h;
      renderer = new LabRenderer(canvas);
      renderer.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
      renderer.resize(target.w, target.h, 1);
      // the plates are fetched once per context; give them a moment
      await sleep(260);
      setPhase('developing');
      await raf();
      renderer.render(recipe, m, {
        zoom: 1, panX: 0, panY: 0, compare: 'single', split: 0.5, view: 'color',
      });
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.94),
      );
      if (!blob) throw new Error('The browser refused to encode the frame.');
      const code = proposeRecipeCode(recipe, archive.length + 1)
        .replace(/[^\w]+/g, '-')
        .toLowerCase();
      download(blob, `pml-${code}.${fmt === 'png' ? 'png' : 'jpg'}`);
      setPhase('done');
      dispatch({
        type: 'log',
        spec: { kind: 'export', title: 'Specimen Developed', detail: `${target.w} × ${target.h} ${fmt.toUpperCase()}` },
      });
    } catch (e) {
      setPhase('error');
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      renderer?.dispose();
    }
  };

  const lines: [string, string][] = [
    ['Material', m.name],
    ['Archive no.', m.archiveNo],
    ['Exposure', `${recipe.exposure.ev >= 0 ? '+' : ''}${recipe.exposure.ev.toFixed(1)} EV`],
    ['Development', DEV_LABEL[recipe.development.mode]],
    ['Grain seed', seedLabel(recipe.grain.seed)],
    ['Soup seed', seedLabel(recipe.experimental.soupSeed)],
    ['Damage seed', seedLabel(recipe.experimental.seed)],
    ['Burn marks', String(recipe.burns.filter((b) => b.enabled).length)],
  ];

  const moving = specimen?.kind === 'moving';

  return (
    <div
      className="sheet"
      data-moving={moving}
      role="dialog"
      aria-modal="true"
      aria-label="Develop and export"
    >
      <div className="sheet__scrim" onClick={() => dispatch({ type: 'export', open: false })} />
      <div className="sheet__panel">
        <header className="sheet__head">
          <span className="lbl lbl--wide">{moving ? 'Develop the clip' : 'Develop'}</span>
          {moving ? (
            <span className="mono mono--dim sheet__sub">
              {specimen?.name} · {specimen?.width} × {specimen?.height}
              {specimen?.duration ? ` · ${specimen.duration.toFixed(1)}s` : ''}
            </span>
          ) : null}
          <span className="spacer" />
          <button className="icb" type="button" onClick={() => dispatch({ type: 'export', open: false })} aria-label="Close">
            <Cross />
          </button>
        </header>

        {moving ? (
          <DevelopClip />
        ) : (
        <div className="sheet__body">
          <div className="sheet__col">
            <Segmented<Fmt>
              label="Format"
              value={fmt}
              options={[
                { id: 'png', label: 'PNG' },
                { id: 'jpeg', label: 'JPEG' },
              ]}
              onChange={setFmt}
            />
            <Segmented<Size>
              label="Size"
              value={size}
              options={[
                { id: 'full', label: 'Full' },
                { id: 'half', label: 'Half' },
                { id: 'web', label: '2048' },
              ]}
              onChange={setSize}
            />
            <p className="mono mono--dim sheet__dims">
              {specimen ? `${target.w} × ${target.h}` : 'No specimen'}
            </p>

            <button
              className="btn btn--lg btn--primary btn--block"
              type="button"
              disabled={!specimen || phase === 'processing' || phase === 'developing'}
              onClick={develop}
            >
              {phase === 'processing'
                ? 'Processing specimen…'
                : phase === 'developing'
                  ? 'Developing…'
                  : 'Develop and save'}
            </button>

            <div className="sheet__phase" data-phase={phase}>
              <span className="lamp" data-state={phase === 'processing' || phase === 'developing' ? 'busy' : phase === 'done' ? 'on' : phase === 'error' ? 'warn' : 'off'} />
              <span className="mono">
                {phase === 'idle' && 'Ready'}
                {phase === 'processing' && 'Building the working buffer'}
                {phase === 'developing' && 'Running the process at full size'}
                {phase === 'done' && 'Specimen ready — saved to your downloads'}
                {phase === 'error' && msg}
              </span>
            </div>
          </div>

          <div className="sheet__col sheet__col--record">
            <h3 className="lbl lbl--wide">On the sleeve</h3>
            <dl className="spec">
              {lines.map(([k, v]) => (
                <div key={k} className="spec__row">
                  <dt className="lbl">{k}</dt>
                  <dd className="mono mono--val">{v}</dd>
                </div>
              ))}
            </dl>
            <button className="btn btn--block" type="button" onClick={() => dispatch({ type: 'archive:add' })}>
              Archive this recipe
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fitLong(w: number, h: number, long: number) {
  const k = Math.min(1, long / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
