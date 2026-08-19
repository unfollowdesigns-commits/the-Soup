import { useEffect, useRef, useState } from 'react';
import { LabRenderer } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { defaultRecipe, makeBurn } from '../lab/recipe';
import { makeHouseSpecimen } from '../lab/specimens';
import type { PhotoRecipe } from '../lab/types';

/* ============================================================
   CONTACT STRIP
   The same frame, put through three different materials, drawn by
   the real engine. Nothing here is a picture of the product.
   ============================================================ */

interface Frame {
  material: string;
  caption: string;
  tune: (r: PhotoRecipe) => void;
}

const FRAMES: Frame[] = [
  {
    material: 'kodak-tri-x',
    caption: 'Tri-X · Push +2',
    tune: (r) => {
      r.development.mode = 'push';
      r.development.pushPull = 2;
      r.development.developer = 'rodinal';
      r.grain.amount = 0.6;
      r.exposure.contrast = 0.12;
      r.optics.vignette = 0.3;
    },
  },
  {
    material: 'kodak-portra',
    caption: 'Portra 400 · Halation',
    tune: (r) => {
      r.exposure.ev = 0.5;
      r.grain.amount = 0.34;
      r.halation.intensity = 0.46;
      r.diffusion.bloom = 0.22;
      r.optics.vignette = 0.2;
    },
  },
  {
    material: 'kodak-ektachrome',
    caption: 'Ektachrome · Soup 0.4',
    tune: (r) => {
      r.development.mode = 'cross-process';
      r.grain.amount = 0.4;
      r.experimental.filmSoup = 0.4;
      r.experimental.soupChemical = 'wine';
      r.experimental.lightLeak = 0.22;
      r.burns = [makeBurn(0.78, 0.24)];
      r.optics.vignette = 0.34;
    },
  },
];

export function ContactStrip() {
  const [ready, setReady] = useState(false);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    const specimen = makeHouseSpecimen('window', 1000, 667);
    const renderers: LabRenderer[] = [];
    let cancelled = false;

    const run = async () => {
      // the damage plates arrive over the network; give them a moment so
      // the strip is drawn with the real material rather than the fallback
      await new Promise((r) => setTimeout(r, 420));
      if (cancelled) return;
      FRAMES.forEach((f, i) => {
        const canvas = refs.current[i];
        if (!canvas) return;
        try {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const w = canvas.clientWidth || 260;
          const h = canvas.clientHeight || 174;
          const r = new LabRenderer(canvas);
          renderers.push(r);
          r.setSource(specimen.canvas, specimen.width, specimen.height);
          r.resize(w, h, dpr);
          const recipe = defaultRecipe(f.material);
          f.tune(recipe);
          r.render(recipe, getMaterial(f.material), {
            zoom: 1, panX: 0, panY: 0, compare: 'single', split: 0.5, view: 'color',
          });
        } catch {
          /* no WebGL2: the strip simply stays empty rather than faking it */
        }
      });
      if (!cancelled) setReady(true);
    };
    void run();
    return () => {
      cancelled = true;
      renderers.forEach((r) => r.dispose());
    };
  }, []);

  return (
    <div className="strip" data-ready={ready}>
      <div className="strip__perf strip__perf--top" aria-hidden="true" />
      <div className="strip__frames">
        {FRAMES.map((f, i) => (
          <figure className="strip__frame" key={f.material}>
            <canvas
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="strip__canvas"
            />
            <figcaption className="mono">{f.caption}</figcaption>
          </figure>
        ))}
      </div>
      <div className="strip__perf strip__perf--bottom" aria-hidden="true" />
      <p className="strip__note mono mono--dim">
        One frame, three materials. Drawn by the engine, not illustrated.
      </p>
    </div>
  );
}
