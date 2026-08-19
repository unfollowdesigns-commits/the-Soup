import { useEffect, useRef, useState } from 'react';
import { LabRenderer } from '../engine/renderer';
import { getMaterial } from '../lab/materials';
import { applyLook, LOOKS, type Look } from '../lab/looks';
import { useDispatch, useLab } from '../lab/store';

/* ============================================================
   LOOK STRIP
   Twelve whole processes, each rendered by the engine on the
   photograph actually on the table. Not swatches, not icons —
   the real result, small.

   One WebGL context renders all of them in turn and each frame is
   copied off to a 2D canvas, so the strip costs one context.
   ============================================================ */

const TW = 168;
const TH = 112;

export function LookStrip() {
  const { specimen, recipe } = useLab();
  const dispatch = useDispatch();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const jobRef = useRef(0);

  useEffect(() => {
    if (!specimen) return;
    const job = ++jobRef.current;
    let renderer: LabRenderer | null = null;

    void (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = TW;
      canvas.height = TH;
      try {
        renderer = new LabRenderer(canvas);
      } catch {
        return; // no WebGL2: the strip stays as labels only
      }
      renderer.setSource(specimen.bitmap as TexImageSource, specimen.width, specimen.height);
      renderer.resize(TW, TH, 1);
      // let the scanned damage plates land before the first thumbnail
      await new Promise((r) => setTimeout(r, 300));

      const out: Record<string, string> = {};
      for (const look of LOOKS) {
        if (jobRef.current !== job) break;
        const rec = applyLook(recipe, look);
        renderer.render(rec, getMaterial(look.material), {
          zoom: 1, panX: 0, panY: 0, compare: 'single', split: 0.5, view: 'color',
        });
        out[look.id] = canvas.toDataURL('image/jpeg', 0.82);
        setThumbs({ ...out });
        // yield so the workspace stays responsive while the strip fills in
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      renderer.dispose();
      renderer = null;
    })();

    return () => {
      jobRef.current++;
      renderer?.dispose();
    };
    // the strip is built from the specimen alone; it must not rebuild on
    // every slider move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specimen]);

  const load = (look: Look) => {
    setActive(look.id);
    dispatch({
      type: 'edit',
      mutate: (r) => applyLook(r, look),
      log: { kind: 'material', title: look.name, detail: getMaterial(look.material).name },
    });
  };

  return (
    <div className="looks" aria-label="Looks">
      <div className="looks__rail">
        {LOOKS.map((look) => (
          <button
            key={look.id}
            type="button"
            className="look"
            aria-pressed={active === look.id}
            title={look.note}
            onClick={() => load(look)}
          >
            <span className="look__frame">
              {thumbs[look.id] ? (
                <img src={thumbs[look.id]} alt="" width={TW} height={TH} />
              ) : (
                <span className="look__pending" />
              )}
            </span>
            <span className="look__name">{look.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
