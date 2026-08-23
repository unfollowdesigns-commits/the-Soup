import type { PhotoRecipe } from './types';

/* ============================================================
   THE CATALOGUE

   Every effect in the lab, flat, addressable and searchable.

   The stages are how the engine is built. This is how you look
   for something. Nobody opens a photograph thinking "I want the
   signal stage" — they think "chroma slip", "kaleidoscope",
   "countdown". So each entry carries the words you would search
   for, the recipe patch that switches it on, and the one number
   that is its strength.

   `read` and `write` are how the library shows a strength and
   drags it. `on` is what "add this to the picture" means. `off`
   is how it is taken out again.
   ============================================================ */

export type EffectGroup =
  | 'Material'
  | 'Exposure'
  | 'Emulsion'
  | 'Optics'
  | 'Damage'
  | 'Chemistry'
  | 'Time'
  | 'Geometry'
  | 'Grade'
  | 'Display'
  | 'Print'
  | 'Vector'
  | 'The Gate';

export interface Effect {
  id: string;
  name: string;
  group: EffectGroup;
  /** what it does, in one sentence, in the lab's own voice */
  note: string;
  /** the other words someone might type looking for this */
  find: string;
  /** its strength, 0..1, as the library shows it */
  read: (r: PhotoRecipe) => number;
  write: (r: PhotoRecipe, v: number) => PhotoRecipe;
  /** what switching it on means — often more than one number */
  on: (r: PhotoRecipe) => PhotoRecipe;
  off: (r: PhotoRecipe) => PhotoRecipe;
  /** a few settings worth having as buttons rather than a drag */
  presets?: { label: string; apply: (r: PhotoRecipe) => PhotoRecipe }[];
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** the common shape: one section, one key, 0..1 */
function simple(
  id: string,
  name: string,
  group: EffectGroup,
  note: string,
  find: string,
  section: keyof PhotoRecipe,
  key: string,
  wake = 0.6,
  extra?: (r: PhotoRecipe) => PhotoRecipe,
  presets?: Effect['presets'],
): Effect {
  const get = (r: PhotoRecipe) => (r[section] as Record<string, number>)[key] ?? 0;
  const put = (r: PhotoRecipe, v: number) =>
    ({ ...r, [section]: { ...(r[section] as object), [key]: v } }) as PhotoRecipe;
  return {
    id, name, group, note, find,
    read: (r) => clamp(get(r)),
    write: (r, v) => put(r, clamp(v)),
    on: (r) => (extra ? extra(put(r, wake)) : put(r, wake)),
    off: (r) => put(r, 0),
    presets,
  };
}

/** bipolar controls read as distance from the middle */
function bipolar(
  id: string, name: string, group: EffectGroup, note: string, find: string,
  section: keyof PhotoRecipe, key: string, span: number, wake = 0.5,
): Effect {
  const get = (r: PhotoRecipe) => (r[section] as Record<string, number>)[key] ?? 0;
  const put = (r: PhotoRecipe, v: number) =>
    ({ ...r, [section]: { ...(r[section] as object), [key]: v } }) as PhotoRecipe;
  return {
    id, name, group, note, find,
    read: (r) => clamp(Math.abs(get(r)) / span),
    write: (r, v) => put(r, Math.sign(get(r) || 1) * clamp(v) * span),
    on: (r) => put(r, wake * span),
    off: (r) => put(r, 0),
    presets: [
      { label: 'Down', apply: (r) => put(r, -0.62 * span) },
      { label: 'Off', apply: (r) => put(r, 0) },
      { label: 'Up', apply: (r) => put(r, 0.62 * span) },
    ],
  };
}

/** a mode-and-amount pair: picking the mode is picking the effect */
function moded<M extends string>(
  id: string, name: string, group: EffectGroup, note: string, find: string,
  section: 'warp' | 'blur' | 'trace', modeKey: string, mode: M,
  amountKey: string, wake = 0.7,
  extra?: (r: PhotoRecipe) => PhotoRecipe,
): Effect {
  const sec = (r: PhotoRecipe) => r[section] as unknown as Record<string, unknown>;
  const isMine = (r: PhotoRecipe) => sec(r)[modeKey] === mode;
  const amt = (r: PhotoRecipe) => (sec(r)[amountKey] as number) ?? 0;
  const put = (r: PhotoRecipe, patch: Record<string, unknown>) =>
    ({ ...r, [section]: { ...sec(r), ...patch } }) as PhotoRecipe;
  return {
    id, name, group, note, find,
    read: (r) => (isMine(r) ? clamp(amt(r)) : 0),
    write: (r, v) => put(r, { [modeKey]: mode, [amountKey]: clamp(v) }),
    on: (r) => {
      const next = put(r, { [modeKey]: mode, [amountKey]: wake });
      return extra ? extra(next) : next;
    },
    off: (r) => (isMine(r) ? put(r, { [amountKey]: 0 }) : r),
  };
}

export const EFFECTS: Effect[] = [
  /* ---- exposure ---- */
  bipolar('exposure', 'Exposure', 'Exposure', 'Stops over or under, before anything else happens.', 'ev brightness stops light', 'exposure', 'ev', 3),
  bipolar('contrast', 'Contrast', 'Exposure', 'The slope of the curve between the toe and the shoulder.', 'curve slope hard soft', 'exposure', 'contrast', 1),
  bipolar('highlights', 'Highlights', 'Exposure', 'The top of the scale, pulled back or opened up.', 'recover whites blown', 'exposure', 'highlights', 1),
  bipolar('shadows', 'Shadows', 'Exposure', 'The bottom of the scale, lifted or closed down.', 'blacks lift crush', 'exposure', 'shadows', 1),
  simple('latitude', 'Latitude', 'Exposure', 'How much the material forgives. Set by the stock; move it to see what a different emulsion would have held.', 'forgiveness range dynamic', 'exposure', 'latitude', 0.9),

  /* ---- emulsion ---- */
  simple('grain', 'Grain', 'Emulsion', 'Procedural silver, sized in film space so it magnifies when you zoom rather than staying stuck to the screen.', 'silver noise texture iso', 'grain', 'amount', 0.55, undefined, [
    { label: 'Fine', apply: (r) => ({ ...r, grain: { ...r.grain, amount: 0.22, size: 0.2, clumping: 0.2 } }) },
    { label: 'Medium', apply: (r) => ({ ...r, grain: { ...r.grain, amount: 0.5, size: 0.45, clumping: 0.42 } }) },
    { label: 'Coarse', apply: (r) => ({ ...r, grain: { ...r.grain, amount: 0.85, size: 0.8, clumping: 0.7 } }) },
  ]),
  simple('halation', 'Halation', 'Emulsion', 'Light that went through the emulsion, bounced off the backing and came back. Why a bright window has a red edge.', 'glow bloom red halo highlight', 'halation', 'intensity', 0.7, undefined, [
    { label: 'Trace', apply: (r) => ({ ...r, halation: { ...r.halation, intensity: 0.28, radius: 0.24, threshold: 0.72 } }) },
    { label: 'Vision3', apply: (r) => ({ ...r, halation: { ...r.halation, intensity: 0.72, radius: 0.46, threshold: 0.6 } }) },
    { label: 'No rem-jet', apply: (r) => ({ ...r, halation: { ...r.halation, intensity: 1, radius: 0.72, threshold: 0.5 } }) },
  ]),
  simple('bloom', 'Diffusion', 'Emulsion', 'A filter on the lens, or grease on it. Highlights spread into the frame.', 'soft focus glow pro mist', 'diffusion', 'bloom', 0.5),
  simple('softness', 'Softness', 'Emulsion', 'The whole frame let go a little.', 'blur soft gauze', 'diffusion', 'softness', 0.4),

  /* ---- optics ---- */
  simple('vignette', 'Vignette', 'Optics', 'The corners falling away, the way a lens that is not quite covering the frame does it.', 'corners darken edge falloff', 'optics', 'vignette', 0.55),
  bipolar('distortion', 'Lens distortion', 'Optics', 'Barrel one way, pincushion the other.', 'barrel pincushion lens bend', 'optics', 'distortion', 1),
  simple('chromatic', 'Chromatic aberration', 'Optics', 'The channels not landing in the same place, worst at the frame edge.', 'fringing colour split lens ca', 'optics', 'chromatic', 0.5),
  simple('edgesoft', 'Soft corners', 'Optics', 'Sharp in the middle, letting go at the edge.', 'corner sharpness field curvature', 'optics', 'edgeSoftness', 0.5),
  moded('motionblur', 'Motion blur', 'Optics', 'One direction across the whole frame: a pan, or a subject that moved.', 'pan streak smear directional', 'blur', 'mode', 'motion', 'amount', 0.55),
  moded('zoomblur', 'Zoom blur', 'Optics', 'Streaks outward from a centre. The lens pulled during the exposure.', 'radial pull rush burst', 'blur', 'mode', 'zoom', 'amount', 0.55),
  moded('spinblur', 'Spin blur', 'Optics', 'Streaks around a centre. The camera turned on its axis.', 'rotate radial whip', 'blur', 'mode', 'spin', 'amount', 0.55),

  /* ---- damage ---- */
  simple('scratches', 'Scratches', 'Damage', 'The lines a projector gate leaves down a print that has been run too often.', 'lines print wear tramlines', 'experimental', 'scratches', 0.5),
  simple('dust', 'Dust', 'Damage', 'What was on the negative when it was scanned.', 'dirt specks debris', 'experimental', 'dust', 0.5),
  simple('leak', 'Light leak', 'Damage', 'A back that did not shut, or a cassette opened in the wrong place.', 'flare fog red edge', 'experimental', 'lightLeak', 0.55),
  simple('expired', 'Expired', 'Damage', 'Base fog and dye loss. Stock kept past the date on the box.', 'old fog age dead stock', 'experimental', 'expired', 0.5),
  simple('solar', 'Solarisation', 'Damage', 'The Sabattier effect: light in the darkroom, mid-development, and the highlights invert.', 'sabattier invert man ray', 'experimental', 'solarization', 0.5),
  simple('redscale', 'Redscale', 'Damage', 'The film loaded backwards, exposed through the base.', 'reverse backwards orange', 'experimental', 'redscale', 0.6),

  /* ---- chemistry ---- */
  simple('soup', 'Film soup', 'Chemistry', 'The roll put in something before it was developed. Eight chemicals, each with its own damage.', 'boil cook chemical bath coffee bleach', 'experimental', 'filmSoup', 0.55, undefined, [
    { label: 'Coffee', apply: (r) => ({ ...r, experimental: { ...r.experimental, filmSoup: 0.5, soupChemical: 'coffee', contamination: 0.45 } }) },
    { label: 'Bleach', apply: (r) => ({ ...r, experimental: { ...r.experimental, filmSoup: 0.66, soupChemical: 'bleach', contamination: 0.7 } }) },
    { label: 'Seawater', apply: (r) => ({ ...r, experimental: { ...r.experimental, filmSoup: 0.6, soupChemical: 'seawater', contamination: 0.6 } }) },
    { label: 'Wine', apply: (r) => ({ ...r, experimental: { ...r.experimental, filmSoup: 0.55, soupChemical: 'wine', contamination: 0.5 } }) },
  ]),
  simple('contamination', 'Contamination', 'Chemistry', 'How far into the emulsion whatever it was got.', 'stain spread chemical', 'experimental', 'contamination', 0.6),
  simple('fog', 'Chemical fog', 'Chemistry', 'The black point lifting where the bath got in.', 'veil lift base', 'experimental', 'fog', 0.5),
  simple('bleed', 'Dye bleed', 'Chemistry', 'Colour running out of its own edges.', 'run smear dye', 'experimental', 'bleed', 0.5),

  /* ---- time ---- */
  simple('echo', 'Echo', 'Time', 'The last frame kept and mixed back in. Everything leaves a tail behind it.', 'trail ghost smear onion persistence', 'time', 'echo', 0.72, (r) => ({
    ...r, time: { ...r.time, mode: 'trail', decay: 0.05, feedZoom: 0, feedRot: 0, feedGain: 0.06 },
  }), [
    { label: 'Trail', apply: (r) => ({ ...r, time: { ...r.time, echo: 0.72, mode: 'trail', feedZoom: 0, feedRot: 0 } }) },
    { label: 'Lighten', apply: (r) => ({ ...r, time: { ...r.time, echo: 0.8, mode: 'lighten', feedZoom: 0, feedRot: 0 } }) },
    { label: 'Darken', apply: (r) => ({ ...r, time: { ...r.time, echo: 0.8, mode: 'darken', feedZoom: 0, feedRot: 0 } }) },
    { label: 'Difference', apply: (r) => ({ ...r, time: { ...r.time, echo: 0.7, mode: 'difference', feedZoom: 0, feedRot: 0 } }) },
  ]),
  simple('feedback', 'Feedback', 'Time', 'The frame read back through a small zoom and a fraction of a degree, forever. A camera pointed at its own monitor.', 'tunnel droste infinite loop recursion', 'time', 'echo', 0.9, (r) => ({
    ...r, time: { ...r.time, mode: 'trail', decay: 0.035, feedZoom: 0.045, feedRot: 0.02, feedGain: 0.1 },
  })),
  simple('slit', 'Slit-scan', 'Time', 'A band crosses the frame and everything behind it holds at the moment it passed. Time drawn across space.', 'time slice scan strip smear', 'time', 'slit', 0.95, (r) => ({
    ...r, time: { ...r.time, slitSpeed: 1.6, slitWidth: 0.035, decay: 0, feedZoom: 0, feedRot: 0 },
  })),
  simple('displace', 'Time drag', 'Time', 'Each pixel reads a different distance into the past, set by its own brightness.', 'displacement datamosh smear lag', 'time', 'displace', 0.8, (r) => ({
    ...r, time: { ...r.time, displaceBias: 0, echo: 0.7, feedGain: 0.14 },
  })),
  simple('chemistry', 'Reaction-diffusion', 'Time', 'Gray-Scott, fed by the photograph. The pattern grows out of the picture rather than sitting on it.', 'turing gray scott growth organic culture', 'time', 'rd', 0.85, (r) => ({
    ...r, time: { ...r.time, rdSteps: 26, rdSeed: 0.5, rdFeed: 0.037, rdKill: 0.0605 },
  }), [
    { label: 'Etch', apply: (r) => ({ ...r, time: { ...r.time, rd: 0.85, rdStyle: 'etch' } }) },
    { label: 'Dye', apply: (r) => ({ ...r, time: { ...r.time, rd: 0.85, rdStyle: 'dye' } }) },
    { label: 'Relief', apply: (r) => ({ ...r, time: { ...r.time, rd: 0.85, rdStyle: 'relief' } }) },
  ]),

  /* ---- geometry ---- */
  moded('wave', 'Wave', 'Geometry', 'A sine across the frame. The print, hung wet.', 'ripple sine wobble liquid', 'warp', 'mode', 'wave', 'amount'),
  moded('ripple', 'Ripple', 'Geometry', 'Rings out from a point, as if something was dropped in it.', 'water drop rings pond', 'warp', 'mode', 'ripple', 'amount'),
  moded('twirl', 'Twirl', 'Geometry', 'Rotation that falls off with distance from the centre.', 'swirl vortex spiral whirl', 'warp', 'mode', 'twirl', 'amount'),
  moded('pinch', 'Pinch', 'Geometry', 'The frame pulled in towards its centre.', 'squeeze bulge spherize', 'warp', 'mode', 'pinch', 'amount'),
  moded('glass', 'Glass', 'Geometry', 'Refraction through something uneven and slow-moving.', 'refraction liquid distort frosted', 'warp', 'mode', 'glass', 'amount'),
  moded('kaleidoscope', 'Kaleidoscope', 'Geometry', 'The frame folded into segments around its centre.', 'mirror symmetry mandala fold', 'warp', 'mode', 'kaleidoscope', 'amount', 1),
  moded('mirror', 'Mirror', 'Geometry', 'One half of the picture, twice.', 'symmetry flip reflect', 'warp', 'mode', 'mirror', 'amount', 1),
  moded('polar', 'Polar', 'Geometry', 'The picture wrapped round its own centre. Horizons become circles.', 'tiny planet coordinates wrap round', 'warp', 'mode', 'polar', 'amount', 1),
  moded('fisheye', 'Fisheye', 'Geometry', 'A very wide lens, or the back of a spoon.', 'wide barrel bulge lens', 'warp', 'mode', 'fisheye', 'amount'),
  moded('shear', 'Shear', 'Geometry', 'Scan lines that slipped sideways and held there.', 'slip tear offset rows glitch', 'warp', 'mode', 'shear', 'amount'),
  moded('tile', 'Tile', 'Geometry', 'The frame repeated in a grid, each one turned a little.', 'repeat grid pattern mosaic', 'warp', 'mode', 'tile', 'amount', 1),

  /* ---- grade ---- */
  bipolar('temperature', 'Temperature', 'Grade', 'Cold one way, warm the other, before anything else touches the colour.', 'white balance kelvin warm cool', 'signal', 'temperature', 1),
  bipolar('tint', 'Tint', 'Grade', 'Green through magenta — the axis a colour head has and a slider usually does not.', 'green magenta balance cc', 'signal', 'tint', 1),
  bipolar('vibrance', 'Vibrance', 'Grade', 'Lifts what is already dull and leaves what is already loud.', 'saturation punch colour', 'signal', 'vibrance', 1),
  bipolar('hue', 'Hue turn', 'Grade', 'The whole wheel, rotated.', 'colour shift rotate wheel', 'signal', 'hue', 3.14),
  bipolar('clarity', 'Clarity', 'Grade', 'Local contrast. Negative is the old soft-focus filter; positive is the print dodged and burned.', 'texture punch structure unsharp', 'signal', 'clarity', 1),
  simple('isolate', 'Keep one colour', 'Grade', 'Everything but one hue drained to grey.', 'colour pop selective splash isolate', 'signal', 'isolate', 0.92),
  simple('split', 'Split tone', 'Grade', 'One colour into the shadows, another into the highlights — how a print is toned.', 'toning selenium sepia duotone shadows', 'signal', 'splitAmount', 0.7, undefined, [
    { label: 'Cold shadow', apply: (r) => ({ ...r, signal: { ...r.signal, splitAmount: 0.7, splitShadow: [0.7, 0.82, 1.06], splitHigh: [1.04, 0.96, 0.86] } }) },
    { label: 'Selenium', apply: (r) => ({ ...r, signal: { ...r.signal, splitAmount: 0.6, splitShadow: [0.86, 0.78, 0.94], splitHigh: [1.02, 0.98, 0.92] } }) },
    { label: 'Sepia', apply: (r) => ({ ...r, signal: { ...r.signal, splitAmount: 0.8, splitShadow: [0.94, 0.84, 0.66], splitHigh: [1.06, 0.98, 0.82] } }) },
  ]),
  simple('tilt', 'Tilt-shift', 'Grade', 'One band stays sharp and the rest is let go, the way a swung lens does it.', 'miniature bokeh depth band lensbaby', 'signal', 'tilt', 0.85),

  /* ---- display ---- */
  simple('crt', 'Phosphor mask', 'Display', 'Three stripes to a pixel and a scan line between them.', 'crt tube monitor rgb aperture grille', 'signal', 'crt', 0.75, (r) => ({ ...r, signal: { ...r.signal, crtPitch: 0.45, crtBend: 0.4 } })),
  simple('crtbend', 'Screen bend', 'Display', 'A tube is not flat.', 'curvature barrel monitor glass', 'signal', 'crtBend', 0.55),
  simple('vhs', 'Chroma slip', 'Display', 'Colour smeared sideways off the luma, which is what a worn tape actually does.', 'vhs tape analogue video colour bleed', 'signal', 'vhs', 0.7),
  simple('tracking', 'Tracking', 'Display', 'Bands that tear and creep up the picture.', 'vhs tape head tear roll', 'signal', 'tracking', 0.5),
  simple('dropout', 'Dropout', 'Display', 'The white dashes where the oxide has gone.', 'vhs tape damage dash white', 'signal', 'dropout', 0.6),
  simple('glitch', 'Block shift', 'Display', 'Whole blocks in the wrong place.', 'datamosh corrupt broken glitch macroblock', 'signal', 'glitch', 0.6),
  simple('sort', 'Pixel sort', 'Display', 'Bright pixels dragged up their own column.', 'sorting glitch smear kim asendorf', 'signal', 'sort', 0.75),
  simple('quantise', 'Palette', 'Display', 'Down to a handful of levels per channel.', 'posterise index colours reduce 8bit', 'signal', 'quantise', 0.6),
  simple('scanline', 'Scan lines', 'Display', 'The lines of a raster, with roll.', 'crt interlace tv lines', 'raster', 'scanline', 0.6),
  simple('dither', 'Dither', 'Print', 'An ordered Bayer threshold, the way an early screen faked a tone it did not have.', 'bayer 1bit ordered halftone mac', 'raster', 'dither', 0.7),
  simple('comb', 'Scan comb', 'Display', 'A vertical comb through the picture.', 'interlace tear comb', 'raster', 'comb', 0.5),

  /* ---- print ---- */
  simple('halftone', 'Halftone', 'Print', 'A dot screen. In colour it is four plates at press angles with the grey pulled into black.', 'dots screen print cmyk rosette newsprint', 'screen', 'halftone', 0.9, undefined, [
    { label: 'Mono', apply: (r) => ({ ...r, screen: { ...r.screen, halftone: 0.95, halfColour: false, halfSize: 6 } }) },
    { label: 'Press', apply: (r) => ({ ...r, screen: { ...r.screen, halftone: 1, halfColour: true, halfSize: 8 } }) },
    { label: 'Newsprint', apply: (r) => ({ ...r, screen: { ...r.screen, halftone: 1, halfColour: false, halfSize: 12 } }) },
  ]),
  simple('duotone', 'Duotone', 'Print', 'Two inks across the whole range.', 'riso two colour split ink', 'screen', 'duotone', 0.8),
  simple('paper', 'Paper', 'Print', 'The sheet it is printed on: fibre, rag, toner or a second-generation copy.', 'stock texture tooth deckle sheet', 'paper', 'amount', 0.7, undefined, [
    { label: 'Fibre', apply: (r) => ({ ...r, paper: { ...r.paper, amount: 0.7, stock: 'fibre' } }) },
    { label: 'Rag', apply: (r) => ({ ...r, paper: { ...r.paper, amount: 0.7, stock: 'rag' } }) },
    { label: 'Toner', apply: (r) => ({ ...r, paper: { ...r.paper, amount: 0.8, stock: 'toner' } }) },
    { label: 'Photocopy', apply: (r) => ({ ...r, paper: { ...r.paper, amount: 0.9, stock: 'copy' } }) },
  ]),

  /* ---- the gate ---- */
  {
    id: 'filmgate', name: 'Film gate', group: 'The Gate',
    note: 'The film round the picture: perforations, frame line and edge print, in five formats.',
    find: '8mm super 8 16mm 35mm perforations sprocket strip window',
    read: (r) => (r.gate.show ? 1 : 0),
    write: (r, v) => ({ ...r, gate: { ...r.gate, show: v > 0.5 } }),
    on: (r) => ({ ...r, gate: { ...r.gate, show: true } }),
    off: (r) => ({ ...r, gate: { ...r.gate, show: false } }),
    presets: [
      { label: 'Regular 8', apply: (r) => ({ ...r, gate: { ...r.gate, show: true, format: 'r8', weave: 0.85 } }) },
      { label: 'Super 8', apply: (r) => ({ ...r, gate: { ...r.gate, show: true, format: 's8', weave: 0.7 } }) },
      { label: '16 mm', apply: (r) => ({ ...r, gate: { ...r.gate, show: true, format: 'm16', weave: 0.4 } }) },
      { label: 'Super 16', apply: (r) => ({ ...r, gate: { ...r.gate, show: true, format: 's16', weave: 0.38 } }) },
      { label: '35 mm', apply: (r) => ({ ...r, gate: { ...r.gate, show: true, format: 'm35', weave: 0.12 } }) },
    ],
  },
  simple('burnthrough', 'Burning through', 'The Gate', 'The frame has stopped in front of the lamp. The emulsion goes, then the base, and what is left is a hole with an ember round it.', 'burn melt projector fire hole stuck', 'gate', 'burn', 0.55, undefined, [
    { label: 'Catching', apply: (r) => ({ ...r, gate: { ...r.gate, burn: 0.2 } }) },
    { label: 'Going', apply: (r) => ({ ...r, gate: { ...r.gate, burn: 0.55 } }) },
    { label: 'Gone', apply: (r) => ({ ...r, gate: { ...r.gate, burn: 1 } }) },
  ]),
  {
    id: 'leader', name: 'Countdown leader', group: 'The Gate',
    note: 'The academy leader before the picture starts: a hand sweeping once a second round a numbered circle.',
    find: 'academy smpte countdown numbers picture start head',
    read: (r) => (r.gate.leader ? 1 : 0),
    write: (r, v) => ({ ...r, gate: { ...r.gate, leader: v > 0.5 } }),
    on: (r) => ({ ...r, gate: { ...r.gate, leader: true, leaderAt: 0.15 } }),
    off: (r) => ({ ...r, gate: { ...r.gate, leader: false } }),
  },
  simple('weave', 'Gate weave', 'The Gate', 'How much the frame moves in the gate. Regular 8 wanders; 35 on pilot pins does not.', 'wobble unsteady jitter registration', 'gate', 'weave', 0.8),

  /* ---- vector ---- */
  {
    id: 'trace', name: 'Tracking', group: 'Vector',
    note: 'What the lab has found in the frame, drawn over it: boxes, the graph between them, trails and bearings.',
    find: 'boxes squares constellation lines connect track motion detect',
    read: (r) => (r.trace.enabled ? r.trace.density : 0),
    write: (r, v) => ({ ...r, trace: { ...r.trace, enabled: v > 0, density: Math.max(0.05, clamp(v)) } }),
    on: (r) => ({ ...r, trace: { ...r.trace, enabled: true, density: 0.55, links: 0.5, labels: true, track: 'blob' } }),
    off: (r) => ({ ...r, trace: { ...r.trace, enabled: false } }),
    presets: [
      // blob follows what moves, so it finds few things and each one means
      // something. Energy locks onto edges, so it finds many — which is
      // what a constellation needs to be a constellation.
      { label: 'Boxes', apply: (r) => ({ ...r, trace: { ...r.trace, enabled: true, mode: 'boxes', links: 0.2, labels: true, track: 'blob', density: 0.35 } }) },
      { label: 'Constellation', apply: (r) => ({ ...r, trace: { ...r.trace, enabled: true, mode: 'links', links: 0.72, labels: true, density: 0.62, track: 'energy' } }) },
      { label: 'Swarm', apply: (r) => ({ ...r, trace: { ...r.trace, enabled: true, mode: 'swarm', links: 0.45, density: 0.7, labels: false, track: 'energy' } }) },
      { label: 'Points', apply: (r) => ({ ...r, trace: { ...r.trace, enabled: true, mode: 'points', links: 0.4, density: 0.7, track: 'energy' } }) },
      { label: 'Type', apply: (r) => ({ ...r, trace: { ...r.trace, enabled: true, mode: 'type' } }) },
    ],
  },
  {
    id: 'sequence', name: 'Contact sheet', group: 'Vector',
    note: 'The frame repeated as a strip or a grid, with frame numbers and a date down the edge.',
    find: 'strip grid proof sheet repeat frames contact',
    read: (r) => (r.sequence.enabled ? 1 : 0),
    write: (r, v) => ({ ...r, sequence: { ...r.sequence, enabled: v > 0.5 } }),
    on: (r) => ({ ...r, sequence: { ...r.sequence, enabled: true, stamp: true } }),
    off: (r) => ({ ...r, sequence: { ...r.sequence, enabled: false } }),
    presets: [
      { label: 'Strip of 4', apply: (r) => ({ ...r, sequence: { ...r.sequence, enabled: true, rows: 1, cols: 4, stamp: true } }) },
      { label: '2 × 3', apply: (r) => ({ ...r, sequence: { ...r.sequence, enabled: true, rows: 2, cols: 3, stamp: true } }) },
      { label: '3 × 4', apply: (r) => ({ ...r, sequence: { ...r.sequence, enabled: true, rows: 3, cols: 4, stamp: true } }) },
    ],
  },

  /* ---- depth ---- */
  {
    id: 'depth', name: 'Depth', group: 'Optics',
    note: 'Grain, halation, diffusion and haze weighted by how far away the lab thinks each part of the frame is.',
    find: 'z distance atmosphere haze 3d parallax',
    read: (r) => (r.depth.enabled ? r.depth.influence : 0),
    write: (r, v) => ({ ...r, depth: { ...r.depth, enabled: v > 0, influence: clamp(v) } }),
    on: (r) => ({ ...r, depth: { ...r.depth, enabled: true, influence: 0.65 } }),
    off: (r) => ({ ...r, depth: { ...r.depth, enabled: false } }),
  },
];

export const GROUPS: EffectGroup[] = [
  'Exposure', 'Emulsion', 'Optics', 'Damage', 'Chemistry',
  'Time', 'Geometry', 'Grade', 'Display', 'Print', 'The Gate', 'Vector',
];

export const getEffect = (id: string) => EFFECTS.find((e) => e.id === id);

/** Everything currently doing something, in catalogue order. */
export function activeEffects(r: PhotoRecipe): Effect[] {
  return EFFECTS.filter((e) => e.read(r) > 0.001);
}

/** Free-text search across name, group, note and the extra words. */
export function searchEffects(q: string): Effect[] {
  const s = q.trim().toLowerCase();
  if (!s) return EFFECTS;
  const terms = s.split(/\s+/);
  return EFFECTS.filter((e) => {
    const hay = `${e.name} ${e.group} ${e.note} ${e.find}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
