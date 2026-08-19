# Photographic Material Lab

A digital photographic laboratory. You bring in a photograph or a clip,
decide what material it was made on, how it was developed, what happened to
the film afterwards — and how far you want to take the experiment. Then you
archive the recipe so it can be made again, and put it on a page.

Not a filter app. Not a preset marketplace.

```
ENTER → BRING IN A SPECIMEN → EXAMINE → CHOOSE A MATERIAL →
EXPOSE → DEVELOP → GRAIN / HALATION / OPTICS →
BURN / SOUP / DAMAGE → TRACE → COMPARE WITH THE CONTROL →
ARCHIVE THE RECIPE → DEVELOP · PRESS
```

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
```

WebGL2 is required for the processing engine. Without it the interface
still works and says plainly that the engine is unavailable.

## How it is put together

The governing rule is that **the UI edits a recipe and the engine consumes
one**. No component knows what a shader is, and the engine imports nothing
from React.

```
src/
  lab/            the domain: PhotoRecipe, materials, tracker, session state
  engine/         WebGL2 multi-pass pipeline + shader source
  analog/         reusable analog material layer for interface surfaces
  components/     the workspace: viewer, archive, workstation, bench
  poster/         the press: composition engine and bench
  mobile/         the phone composition, written separately
  screens/        enter, import
  styles/         design tokens and stylesheets
```

### The engine

`INPUT → EXPOSURE → MATERIAL RESPONSE → DEVELOPMENT → COLOUR → SEQUENCE →
OPTICS → HALATION → DIFFUSION → GRAIN → EXPERIMENTAL DAMAGE → DEPTH →
RASTER → OUTPUT`

Fifteen passes at full recipe. Half-float working buffers where the browser
allows it.

- **Grain** is procedural and multi-scale, computed in film space so it
  magnifies with the loupe instead of dissolving into screen noise.
  Granularity follows density, size and clumping — not opacity. It was
  tuned against measurements, not by eye: at the same setting Tri-X gives
  5.9% RMS with a 6px correlation length, Ektar 1.3% at 2px, Fomapan 12.3%
  at 12px.
- **Halation** is a threshold extraction blurred over two passes and put
  back with an edge response, so it appears where a highlight meets
  something dark rather than as a glow everywhere.
- **Film burns** are domain-warped fields with a cleared centre, an ember
  rim and a scorched edge. A radial falloff reads as a lens flare, which is
  why there isn't one.
- **Film soup** is a procedural chemical front with real scanned staining
  underneath it.
- **Dust, hair and scratches** are real artefacts traced from 35mm scans —
  see `docs/ANALOG_SYSTEM.md`.
- **Depth** is a labelled proxy. No monocular model is connected yet, and
  the interface says so wherever depth appears rather than printing an
  inference time it does not have.

### The trace layer

A vector overlay driven by classical tracking: local gradient energy finds
regions, frame difference weighs motion on a moving specimen, and regions
are followed by nearest centroid with smoothing. Boxes, swarm, points,
links, and a typographic mode that re-sets the frame in characters.

Every number it prints is measured in `src/lab/tracker.ts`. There is no
detection model, and the interface never implies one.

### The press

The lab makes an image; the press puts it on a page. Four layouts, five
grounds, four formats, and an ordered screen applied at press time. The
specification block is set from the recipe, so a poster carries the process
that made it.

### Moving specimens

A video import runs the whole pipeline per frame. The engine re-uploads only
the current frame, so a clip costs the same as a still.

## Honesty rules this project keeps

- No measurement is invented. GPU time appears only when the browser exposes
  a timer query; otherwise the panel says so.
- Every material record carries a fidelity marking — documented,
  reconstructed, or artistic interpretation. Nothing claims chemical
  reproduction.
- The material library is a demonstration set and says so.
- Redistributed assets carry their licences. See `docs/ANALOG_SYSTEM.md`.

## Verification

`tools/verify/` runs the engine in headless Chromium and measures the
output rather than trusting it.

```bash
node tools/verify/run.mjs http://localhost:5173/tools/verify/grain-metrics.html out.png
node tools/verify/shots.mjs ./shots      # every screen, desktop and phone
node tools/verify/trace-ui.mjs ./shots   # each trace mode through the real UI
node tools/verify/press-ui.mjs ./shots   # each poster layout
```

## Rebuilding the analog library

```bash
git clone --depth 1 https://github.com/daniela997/FilmDamageSimulator /tmp/fds
python3 tools/build_analog_assets.py --fds /tmp/fds
```

## Not built yet

- The historical material database. The 26 records here are demonstrations.
- A real monocular depth model behind the depth panel.
- Video *export*. Video input and live processing work; writing a clip back
  out needs WebCodecs and an encoder, which is a separate piece of work.
- Realtime camera. The architecture is ready for it — the engine already
  takes a new frame every tick — but the capture path is not written.
