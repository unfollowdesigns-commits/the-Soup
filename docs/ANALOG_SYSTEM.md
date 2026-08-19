# The Analog Material System

This document covers the material library in `public/analog` and the layer
system in `src/analog` that puts it on screen. It does not cover the
photographic engine in `src/engine`, which processes the photograph itself
and is documented in the source.

The governing rule, in order:

1. **Real material first.** Artefacts traced from actual film scans.
2. **Procedural second.** Filter primitives generated per element.
3. **CSS only when neither will do.**

The second rule matters as much as the first: grain, halation and burns are
never assets, because a stored texture repeats and a photograph does not.

---

## 1. Source review

Every source supplied was inspected. What follows is what each one actually
contains and what may legally be done with it.

| Source | Licence | Verdict |
| --- | --- | --- |
| [FilmDamageSimulator](https://github.com/daniela997/FilmDamageSimulator) | **MIT** (Daniela Ivanova, 2022) | **Assets included.** 5,900 artefact masks traced from real 35mm scans, plus the scans themselves. MIT permits redistribution with the notice. 24 curated masks are shipped; see §2. |
| [afterglow](https://github.com/vlrmprjct/afterglow--obs-filter-collection) | CC BY-SA 4.0 (Thomas Meschke) | **Reference only.** HLSL shaders, no assets. Share-alike would attach a copyleft obligation to any derived shader, so `filmburn.hlsl` and `lomo.hlsl` were read for technique and nothing was copied. |
| [spektrafilm](https://github.com/andreavolpato/spektrafilm) | GPLv3 (code), CC BY-SA 4.0 (profiles and LUTs) | **Reference only.** The spectral coupler approach informed the crossover model in `FRAG_BASE`. GPLv3 is unsuitable for linking into this app and the profile share-alike would attach to any LUT shipped from it. No code or profile is included. |
| [filmr](https://github.com/W-Mai/filmr) | MIT (Benign X) | **Reference only.** Rust; the repository carries a logo and one screenshot, no reusable material. |
| [ComfyUI-Darkroom](https://github.com/jeremieLouvaert/ComfyUI-Darkroom) | **None** — no licence file at repository root | **Excluded.** No licence means all rights reserved; neither the code nor the baked `.cube` LUTs may be redistributed. Its vendored `third_party/spectral_film_lut` *is* MIT, so if spectral LUTs are wanted later, take them from [JanLohse/spectral_film_lut](https://github.com/JanLohse/spectral_film_lut) upstream rather than from this repository. |
| [Descanning / DESCAN-18K](https://github.com/jhcha08/Descanning) | **None** — no licence file; dataset distributed by request | **Excluded.** Research dataset behind a separate download, no redistribution grant. |
| [Texturelabs](https://texturelabs.org/) | Free for use, redistribution of the files restricted | **Not included.** Texturelabs permits use in work but not redistribution of the asset files themselves; committing them to a public repository is redistribution. Also unreachable from the build environment (see §6). |
| [FilmLooks](https://shop.filmlooks.com/) | Commercial, paid | **Excluded.** A purchased product; no licence to redistribute under any circumstance. |
| [Wikimedia film strips](https://commons.wikimedia.org/wiki/Category:Film_strips) | Per file — public domain through CC BY-SA | **Slot reserved.** Usable with per-file attribution, but licences must be checked per file, and the host is unreachable from the build environment. See §6. |
| [Internet Archive moving images](https://archive.org/details/movies) | Per item | **Slot reserved.** Same position as Wikimedia. |

### What this means in practice

One source cleared for redistribution: **FilmDamageSimulator**. It happens to
be the strongest of the set for this purpose — its masks are traced from real
damaged 35mm frames rather than drawn, which is exactly the quality that
procedural noise cannot reach. Everything else is either reference, or is
waiting on a licence check that cannot be performed from here.

---

## 2. What ships

31 files, `public/analog`. Run `python3 tools/build_analog_assets.py --fds <clone>`
to rebuild; the curation list lives in that script, so the library is
reproducible rather than a folder of mystery PNGs.

### 2.1 Sourced — FilmDamageSimulator, MIT

24 single-channel masks, 400 × 400, white = artefact. Converted from the
original RGBA (which carried the mask in alpha) to 8-bit grayscale.


**dust** (8 files)

| file | traced from |
| --- | --- |
| `source/dust/dirt_101.png` | `synthetic/dirt/dirt-101.png` |
| `source/dust/dirt_022.png` | `synthetic/dirt/dirt-022.png` |
| `source/dust/dirt_091.png` | `synthetic/dirt/dirt-091.png` |
| `source/dust/dirt_106.png` | `synthetic/dirt/dirt-106.png` |
| `source/dust/spots_075.png` | `synthetic/spots/spots-075.png` |
| `source/dust/spots_002.png` | `synthetic/spots/spots-002.png` |
| `source/dust/sprink_0099.png` | `synthetic/sprinkles/sprink-0099.png` |
| `source/dust/sprink_0002.png` | `synthetic/sprinkles/sprink-0002.png` |

**hair** (6 files)

| file | traced from |
| --- | --- |
| `source/hair/hair_sh_0013.png` | `synthetic/hair-short/hair-sh-0013.png` |
| `source/hair/hair_sh_0056.png` | `synthetic/hair-short/hair-sh-0056.png` |
| `source/hair/hair_sh_0045.png` | `synthetic/hair-short/hair-sh-0045.png` |
| `source/hair/lint_066.png` | `synthetic/lint/lint-066.png` |
| `source/hair/lint_022.png` | `synthetic/lint/lint-022.png` |
| `source/hair/lint_035.png` | `synthetic/lint/lint-035.png` |

**scratches** (7 files)

| file | traced from |
| --- | --- |
| `source/scratches/scratch_0116.png` | `synthetic/scratches/scratch-0116.png` |
| `source/scratches/scratch_0049.png` | `synthetic/scratches/scratch-0049.png` |
| `source/scratches/scratch_0041.png` | `synthetic/scratches/scratch-0041.png` |
| `source/scratches/scratch_0081.png` | `synthetic/scratches/scratch-0081.png` |
| `source/scratches/scratch_0007.png` | `synthetic/scratches/scratch-0007.png` |
| `source/scratches/smut_0080.png` | `synthetic/smut/smut-0080.png` |
| `source/scratches/smut_0034.png` | `synthetic/smut/smut-0034.png` |

**stain** (3 files)

| file | traced from |
| --- | --- |
| `source/stain/stain_038.png` | `synthetic/stain/stain-038.png` |
| `source/stain/stain_048.png` | `synthetic/stain/stain-048.png` |
| `source/stain/stain_109.png` | `synthetic/stain/stain-109.png` |
> **Attribution.** Daniela Ivanova, *Simulating analogue film damage to
> analyse and improve artifact restoration on high-resolution scans*,
> Eurographics 2023. MIT licence; the notice is reproduced at
> `public/analog/source/LICENSE-FilmDamageSimulator.txt`.

### 2.2 Plates — derived

| file | contents | notes |
| --- | --- | --- |
| `plates/damage-atlas-1.png` | 2048 × 2048, four 1024 slots: dust, scratches, hair, stain | source masks scattered at random position, rotation, scale and opacity, wrapped at the edges so the plate has no seam |
| `plates/damage-atlas-2.png` | as above, second variant | a surface picks a variant by seed so two surfaces do not wear identical marks |

The atlas exists so a frame-sized field costs one texture bind instead of
twenty draw calls. Scatter density is deliberately low — 14 dust marks,
5 scratches, 7 hairs and 4 stains per plate.

### 2.3 Authored — original work, repository licence

| file | contents |
| --- | --- |
| `paper/paper-fibre-1.png`, `paper-fibre-2.png` | 512², coated sheet: low-frequency cloud, fibre drawn along the machine direction, fine tooth |
| `photocopy/toner-1.png`, `toner-2.png` | 512², patchy toner adhesion, drum banding, loose specks |
| `grain/blue-noise-256.png` | 256², histogram-flattened blue noise; decorrelates procedural grain so the hash lattice never shows |

---

## 3. Usage table

Every asset, with how it is meant to be applied. Opacities are the
**recommended ceiling**, not a starting point — start at half.

| asset | blend | opacity | animate | randomise | scope |
| --- | --- | --- | --- | --- | --- |
| atlas · dust | `multiply` | ≤ 0.25 | no | position, rotation, scale, variant | local |
| atlas · hair | `multiply` | ≤ 0.20 | no | as above | local, sparingly |
| atlas · scratches | `screen` | ≤ 0.22 | only when projected | as above | local |
| atlas · stain | mask for burn | ≤ 0.45 as a mask | no | as above | local, one surface at a time |
| paper fibre | `overlay` | ≤ 0.34 | no | which of two files | global |
| toner | `overlay` | ≤ 0.38 | no | which of two files | local, for document surfaces |
| blue noise | engine input | n/a | n/a | n/a | engine |
| grain (procedural) | `overlay` | ≤ 0.5 of the control | no | seed per element | global at low value |
| burn (procedural) | `screen` | by control | no | position and mask | local, rare |
| halation (procedural) | SVG filter | by control | no | no | local |
| flicker (procedural) | filter animation | by control | **yes** | keyframes from seed | local, projected surfaces only |
| jitter (procedural) | transform animation | by control | **yes** | keyframes from seed | local, projected surfaces only |
| displacement (procedural) | SVG filter | by control | no | seed | local |

### Scratches deserve a note

Constant scratches are the single clearest tell of a cheap vintage filter.
They belong on a surface that is meant to read as *projected* or as a
*working contact sheet*, and nowhere else. The `contact` and `projected`
presets are the only ones that carry them.

---

## 4. The layer system

```tsx
import { AnalogSurface } from './analog/AnalogSurface';

<AnalogSurface preset="archival" seed={7}>
  <img src={…} />
</AnalogSurface>

// or compose the controls directly
<AnalogSurface grain={0.2} dust={0.15} texture="paper" textureOpacity={0.3} seed={12} />
```

### Controls

| prop | 0 → 1 | kind |
| --- | --- | --- |
| `grain` | clean → heavy | procedural, per-element filter |
| `dust` | clean → dirty (drives dust and hair together) | **real** |
| `scratches` | none → scratched | **real** |
| `burn` | none → burnt through | procedural, masked by a real stain |
| `halation` | none → bleeding | procedural, SVG filter |
| `flicker` | steady → failing lamp | procedural, animated |
| `jitter` | locked → loose gate | procedural, animated |
| `displace` | registered → drifting | procedural, SVG filter |
| `texture` | `none` / `paper` / `photocopy` | **real** |
| `textureOpacity` | — | — |
| `seed` | — | determines every placement |

A layer is only mounted when its control is above zero, so an unused effect
costs nothing at runtime.

### Presets

| preset | character |
| --- | --- |
| `bench` | the tooth of a coated sheet under everything; almost nothing |
| `archival` | a print that has been handled |
| `contact` | a working contact sheet: scratched, dusty, not precious |
| `document` | duplicated on a copier — toner, registration drift |
| `projected` | old lamp, loose gate. The only preset that moves |
| `scorched` | the end of the reel |

Presets are a character, not a maximum. None of them enables every layer,
and that is deliberate — a surface that reads as "damaged" at a glance is
already wrong.

---

## 5. Determinism

Everything is seeded. The same `seed` lays the same material down in the same
place, which means a recipe archived today reproduces exactly, and two
surfaces in the same view never wear identical marks. The seed feeds:

- placement, rotation, scale and flip of every real-material layer
- which atlas variant and which paper file are used
- the generated flicker and jitter keyframes
- the `feTurbulence` seed for grain and displacement

---

## 6. Sources that could not be fetched

`texturelabs.org`, `commons.wikimedia.org` and `archive.org` are blocked by
this environment's network policy — the proxy answers `403` to `CONNECT` for
all three. They are not unusable, only unreachable from here.

To add material from them later:

1. Check the licence **per file**. Wikimedia and the Internet Archive are
   per-item; a category page is not a licence.
2. Drop the files into the matching folder under `public/analog/`.
3. Add an entry to `public/analog/manifest.json` with `origin`, `license`
   and `attribution`.
4. Add a row to §2 and §3 of this document.

The folders `burns/`, `light-leaks/`, `halation/`, `film-edges/`,
`film-frames/` and `archival/` are deliberately empty. Burns, light leaks and
halation are generated by the engine, and a stored version of any of them
would repeat. Film edges and frame furniture are the one category where a
scanned asset would genuinely beat generation — that is what those two
folders are waiting for.

---

## 7. Licence notices

The repository redistributes MIT-licensed material. The notice travels with
it at `public/analog/source/LICENSE-FilmDamageSimulator.txt` and must not be
removed.
