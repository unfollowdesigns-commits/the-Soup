# What the lab can do to a picture

Every one of these is a control you can find in the cook, not a preset.
The count at the bottom is what it is — where something is missing, this
file says so rather than padding the list.

## Material and development
Material (26 stocks) · exposure · contrast · highlights · shadows ·
latitude · push/pull · six development modes (normal, push, pull,
cross-process, bleach bypass, stand) · seven developers (stock, D-76,
Rodinal, HC-110, XTOL, C-41, E-6) · agitation

## Emulsion
Procedural grain (amount, size, density, clumping, luminance following,
chroma, randomness, seed) · halation (intensity, radius, threshold, hue,
edge) · diffusion (softness, bloom, spread)

## Optics
Distortion · chromatic aberration · vignette · edge softness · focus
plane · depth of field · directional blur in three modes (motion, zoom,
spin) with taper and centre

## Damage and chemistry
Film burns (placed by hand: amount, spread, density, hue, edge,
randomness) · film soup in eight chemicals (water, salt, vinegar,
coffee, wine, bleach, dish soap, seawater) with temperature,
contamination, fog, bleed, density · expired stock · redscale ·
solarisation · light leak · scratches · dust · 24 scanned damage plates
from real 35 mm (see ANALOG_SYSTEM.md)

## Depth
Depth-driven grain, halation, diffusion, burn and haze · WebGPU
depth-aware light injection with up to four lights (GPU_PIPELINE.md)

## Time — the engine's memory
Echo in four behaviours (trail, lighten, darken, difference) · the
feedback loop (zoom, turn, drift, colour turn, push) · slit-scan (angle,
speed, band width) · time drag (amount, direction) · Gray-Scott
reaction-diffusion in three styles (etch, dye, relief) with feed, kill,
growth rate and how hard the picture steers it

## Warp — eleven geometries
Wave · ripple · twirl · pinch · glass · kaleidoscope · mirror · polar ·
fisheye · shear · tile — each with amount, scale, phase, drift and
centre, and three edge behaviours (hold, wrap, mirror)

## Signal — grade, then the display
**Grade:** temperature · tint · vibrance · hue turn · clarity (local
contrast) · colour isolate (keep one hue, drain the rest) · split tone ·
tilt-shift (angle, band width, position)

**The tube:** phosphor mask · pitch · bend

**The tape:** chroma slip · tracking · dropout

**Broken:** block shift · pixel sort · palette quantise

## Print
Halftone (mono, and four plates at press angles with grey component
replacement) · duotone · four paper stocks with relief, bleed and deckle
· dither · posterise · scan comb · scan lines with roll

## The vector layer
Trace in five modes (boxes, swarm, points, links, typographic) over
either an edge-energy tracker or a background-subtraction blob tracker ·
face and hand landmarks (MediaPipe) · contact-sheet sequence

## Output
Stills to PNG/JPEG at full, half or 2048 · clips through a film gate
(Regular 8, Super 8, 16, Super 16, 35 Academy) to 1080 or 4K
(VIDEO_EXPORT.md)

---

## Count

Roughly **100 named effects**, against about 50 before the Time, Warp
and Signal stages existed.

## What is still missing

Named honestly, because the gap is the useful part of a list like this:

* **Curves and per-band HSL.** There is temperature, tint, vibrance and
  a hue turn, but no tone curve and no eight-band hue/saturation/
  luminance. This is the biggest remaining hole in the grade.
* **A real pixel sort.** What is here samples along the run and pulls
  the brightest of eight taps forward. It looks like the artefact but it
  is not a sort, because a sort needs the whole run in one place.
* **Bokeh with a shaped aperture.** Blur is Gaussian and directional;
  there are no aperture blades and no highlight discs.
* **Displacement by an image you supply.** Glass and ripple are
  procedural only.
* **Camera shake, rolling shutter, frame drop.** The time stages can
  smear and hold, but there is nothing that moves the whole frame the
  way a handheld camera does.
* **Depth model weights.** The WebGPU light rig has its contract but no
  network behind it yet.

## How this was checked

`tools/verify/newfx-ui.mjs` renders every warp mode and every signal
control on its own against an unprocessed frame and measures how far the
result moved. All 34 come back changed, GL error 0. The grade controls
are measured against a colour target rather than the window scene,
because you cannot see a hue rotation on a picture with no hue in it.

One caveat on that harness: **dropout** measures as "no change" because
its artefact is single-scanline dashes and the metric downsamples to
64 × 42, which averages them away. It is visible in the rendered sheet
the same run writes out. The measurement is wrong there, not the effect.
