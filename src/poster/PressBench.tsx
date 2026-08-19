import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Instrument, Segmented } from '../components/Instrument';
import { Cross } from '../components/MaterialDetail';
import { LabRenderer } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { proposeRecipeCode } from '../lab/recipe';
import { useDispatch, useLab } from '../lab/store';
import {
  drawPoster,
  FORMATS,
  GROUNDS,
  POSTER_DEFAULT,
  posterSize,
  TEMPLATES,
  type PosterFormat,
  type PosterGround,
  type PosterSpec,
  type PosterTemplate,
} from './poster';
import './press.css';

/* ============================================================
   PRESS
   The image comes off the light table and goes on a page. The
   specification is set from the recipe, so a poster carries the
   process that made it rather than invented copy.
   ============================================================ */

const PREVIEW_LONG = 1400;

export function PressBench() {
  const { recipe, specimen, archive } = useLab();
  const dispatch = useDispatch();
  const [spec, setSpec] = useState<PosterSpec>(() => ({
    ...POSTER_DEFAULT,
    title: getMaterial(recipe.material).name.toUpperCase(),
  }));
  const [busy, setBusy] = useState<'idle' | 'rendering' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const previewRef = useRef<HTMLCanvasElement>(null);
  const plateRef = useRef<HTMLCanvasElement | null>(null);

  const material = getMaterial(recipe.material);
  const aspect = specimen ? specimen.width / specimen.height : 3 / 2;
  const { w: pw, h: ph } = useMemo(() => posterSize(spec.format, PREVIEW_LONG), [spec.format]);

  /* ---- render the processed specimen once, off screen ---- */
  const makePlate = useCallback(
    async (long: number) => {
      if (!specimen) return null;
      const k = Math.min(1, long / Math.max(specimen.width, specimen.height));
      const w = Math.max(2, Math.round(specimen.width * k));
      const h = Math.max(2, Math.round(specimen.height * k));
      const canvas = plateRef.current ?? document.createElement('canvas');
      plateRef.current = canvas;
      canvas.width = w;
      canvas.height = h;
      const r = new LabRenderer(canvas);
      try {
        r.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
        r.resize(w, h, 1);
        await new Promise((res) => setTimeout(res, 220));
        r.render(recipe, material, {
          zoom: 1, panX: 0, panY: 0, compare: 'single', split: 0.5, view: 'color',
        });
        // copy off the WebGL canvas before its context is released
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const og = out.getContext('2d')!;
        og.drawImage(canvas, 0, 0);
        if (spec.screen > 0) screenPlate(og, w, h, spec.screen, spec.screenLevels);
        return out;
      } finally {
        r.dispose();
      }
    },
    [specimen, recipe, material, spec.screen, spec.screenLevels],
  );

  /* ---- preview ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const plate = await makePlate(1200);
      if (cancelled) return;
      const canvas = previewRef.current;
      if (!canvas) return;
      canvas.width = pw;
      canvas.height = ph;
      const g = canvas.getContext('2d')!;
      drawPoster(g, pw, ph, spec, plate, aspect, {
        material,
        recipe,
        date: new Date(specimen?.importedAt ?? Date.now()),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, pw, ph, aspect, makePlate, material, recipe, specimen]);

  const press = async () => {
    if (!specimen) return;
    setBusy('rendering');
    setMsg('');
    try {
      const long = 4200; // ~180 dpi at A2
      const { w, h } = posterSize(spec.format, long);
      const plate = await makePlate(2600);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      drawPoster(canvas.getContext('2d')!, w, h, spec, plate, aspect, {
        material,
        recipe,
        date: new Date(specimen.importedAt),
      });
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('The browser refused to encode the page.');
      const name = `pml-poster-${proposeRecipeCode(recipe, archive.length + 1)
        .replace(/[^\w]+/g, '-')
        .toLowerCase()}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setBusy('saved');
      dispatch({
        type: 'log',
        spec: { kind: 'export', title: 'Poster Pressed', detail: `${w} × ${h}` },
      });
    } catch (e) {
      setBusy('error');
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const set = <K extends keyof PosterSpec>(k: K, v: PosterSpec[K]) =>
    setSpec((s) => ({ ...s, [k]: v }));

  return (
    <div className="press">
      <header className="press__bar">
        <button className="btn btn--quiet" type="button" onClick={() => dispatch({ type: 'screen', screen: 'lab' })}>
          ← Back to the lab
        </button>
        <span className="spacer" />
        <span className="lbl lbl--wide">Press</span>
        <span className="spacer" />
        <button className="btn btn--primary" type="button" disabled={!specimen || busy === 'rendering'} onClick={press}>
          {busy === 'rendering' ? 'Pressing…' : 'Press and save'}
        </button>
        <button className="icb" type="button" aria-label="Close" onClick={() => dispatch({ type: 'screen', screen: 'lab' })}>
          <Cross />
        </button>
      </header>

      <div className="press__body">
        <div className="press__stage">
          <div className="press__sheet" style={{ aspectRatio: `${pw} / ${ph}` }}>
            <canvas ref={previewRef} className="press__canvas" />
          </div>
          <p className="mono mono--dim press__note">
            {FORMATS.find((f) => f.id === spec.format)!.note} · pressed at{' '}
            {posterSize(spec.format, 4200).w} × 4200
          </p>
        </div>

        <aside className="press__controls scroll-y">
          <div className="sec-head">
            <span className="lbl lbl--wide">Composition</span>
            <span className="sec-head__line" />
          </div>

          <div className="press__group">
            <Segmented<PosterTemplate>
              label="Layout"
              value={spec.template}
              options={TEMPLATES.map((t) => ({ id: t.id, label: t.label, title: t.note }))}
              onChange={(v) => set('template', v)}
            />
            <p className="instr__note">{TEMPLATES.find((t) => t.id === spec.template)!.note}</p>

            <Segmented<PosterFormat>
              label="Format"
              value={spec.format}
              options={FORMATS.map((f) => ({ id: f.id, label: f.label, title: f.note }))}
              onChange={(v) => set('format', v)}
            />

            <div className="press__grounds">
              {(Object.keys(GROUNDS) as PosterGround[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="ground"
                  aria-pressed={spec.ground === k}
                  title={GROUNDS[k].label}
                  onClick={() => set('ground', k)}
                >
                  <span style={{ background: GROUNDS[k].bg }} />
                  <span style={{ background: GROUNDS[k].accent }} />
                  <em>{GROUNDS[k].label}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="sec-head">
            <span className="lbl lbl--wide">Type</span>
            <span className="sec-head__line" />
          </div>
          <div className="press__group">
            <Field label="Title" value={spec.title} onChange={(v) => set('title', v)} />
            <Field label="Subtitle" value={spec.subtitle} onChange={(v) => set('subtitle', v)} />
            <Field label="Credit" value={spec.credit} onChange={(v) => set('credit', v)} />
            {spec.template === 'index' ? (
              <label className="field">
                <span className="instr__label">Index — one entry per line</span>
                <textarea
                  className="field__area"
                  rows={7}
                  value={spec.index}
                  placeholder="Left empty, the lab sets the index from the recipe."
                  onChange={(e) => set('index', e.target.value)}
                />
              </label>
            ) : null}
            <div className="row row--gap">
              <span className="instr__label">Specification block</span>
              <span className="spacer" />
              <button
                className="btn btn--sm"
                type="button"
                aria-pressed={spec.showSpec}
                onClick={() => set('showSpec', !spec.showSpec)}
              >
                {spec.showSpec ? 'Printed' : 'Omitted'}
              </button>
            </div>
          </div>

          <div className="sec-head">
            <span className="lbl lbl--wide">Grid</span>
            <span className="sec-head__line" />
          </div>
          <div className="press__group">
            <Instrument label="Margin" value={spec.margin} onChange={(v) => set('margin', v)} />
            <Instrument label="Image scale" value={spec.scaleImage} onChange={(v) => set('scaleImage', v)} />
            <Instrument label="Rule work" value={spec.rules} onChange={(v) => set('rules', v)} />
            <Instrument
              label="Screen"
              value={spec.screen}
              note="Screening happens at the press, not in the emulsion: an ordered dither laid over the plate as it goes down."
              onChange={(v) => set('screen', v)}
            />
            <Instrument
              label="Screen levels"
              value={spec.screenLevels}
              disabled={spec.screen === 0}
              format={(v) => String(Math.max(2, Math.round(18 - v * 16)))}
              onChange={(v) => set('screenLevels', v)}
            />
          </div>

          <div className="press__status">
            <span
              className="lamp"
              data-state={busy === 'rendering' ? 'busy' : busy === 'saved' ? 'on' : busy === 'error' ? 'warn' : 'off'}
            />
            <span className="mono">
              {busy === 'idle' && (specimen ? 'Ready' : 'No specimen on the table')}
              {busy === 'rendering' && 'Running the process at press size'}
              {busy === 'saved' && 'Pressed — saved to your downloads'}
              {busy === 'error' && msg}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   PRESS SCREENING
   A 4 x 4 ordered matrix over the plate. Ordered rather than
   random, because a random dither reads as noise and this is
   meant to read as print.
   ------------------------------------------------------------ */
function screenPlate(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  levelsCtl: number,
) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const steps = Math.max(2, Math.round(18 - levelsCtl * 16));
  const mono = 1 - Math.min(1, (steps - 2) / 7);
  const M = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const bias = (M[y & 3][x & 3] / 16 - 0.5) * (255 / steps) * amount * 1.4;
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      for (let k = 0; k < 3; k++) {
        const base = d[i + k] * (1 - mono) + lum * mono;
        const v = base + bias;
        const q = Math.round((v / 255) * steps) / steps * 255;
        d[i + k] = Math.max(0, Math.min(255, d[i + k] + (q - d[i + k]) * amount));
      }
    }
  }
  g.putImageData(img, 0, 0);
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span className="instr__label">{label}</span>
      <input className="field__input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
