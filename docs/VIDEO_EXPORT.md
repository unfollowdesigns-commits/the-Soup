# Running a clip through the lab

A moving specimen goes through exactly the same engine as a still one, one
frame at a time, and comes out the other side as a file. Nothing about the
export is realtime: it runs as fast as the machine can decode, render and
encode, and it never drops a frame to keep up, because there is nothing to
keep up with.

`Develop` on a moving specimen opens the gate bench instead of the print
bench.

---

## The gate

The gate is the rectangle the light actually goes through. Picking one sets
the shape of the picture, the size and pitch of the perforations beside it,
the rate the format is normally run at, and how much the frame moves.

| Gate | Aperture | Aspect | Rate | Perfs / frame | Edges |
|---|---|---|---|---|---|
| Regular 8 | 4.80 × 3.50 mm | 1.371 | 16 | 1 | one |
| Super 8 | 5.79 × 4.01 mm | 1.444 | 18 | 1 | one |
| 16 mm | 10.26 × 7.49 mm | 1.370 | 24 | 1 | both |
| Super 16 | 12.52 × 7.41 mm | 1.690 | 24 | 1 | one |
| 35 mm Academy | 21.00 × 15.20 mm | 1.382 | 24 | 4 | both |
| As shot | — | source | source | — | — |

**Fidelity.** The apertures, perforation dimensions and frame rates above
are documented figures for each format. The **weave** figures are a
*reconstruction*: they put each movement in roughly the right region — a
claw-registered Super 8 cartridge wanders, a 35 mm movement on pilot pins
does not — but they are not a measurement of any one camera, and the lab
does not claim they are.

`src/lab/gate.ts` holds the numbers. `src/video/gatePaint.ts` draws from
them; nothing in the film frame is a stock overlay.

### What is actually drawn

* the aperture, with the corner radius that plate really has, masking the
  picture — the corners are cut, not faded
* the perforations as **holes**: the lamp comes through them, so they are
  the brightest thing in the frame, with the punched edge holding dye
* wear on the sprocket holes, at a rate you set, on stock that has been run
* the edge print between the perforations and the picture, latent-exposed
  at the factory, carrying the frame number
* the weave: a per-frame claw jump plus a slow drift as the loop tightens
  and loosens, and a fraction of a degree of rotation, because the gate is
  never quite square to the movement
* the lamp spilling round the aperture

**Frame: show the film / picture only.** *Show the film* puts the whole
strip in the output frame — perforations, edge print, gutter. *Picture only*
fills the output with what came through the gate, pillarboxed where the gate
is narrower than the delivery frame (a 1.37 gate in a 16:9 frame is
pillarboxed, as it should be).

---

## Grain moves

With **Grain moves** on, every frame gets its own grain seed, its own soup
seed and its own damage seed. This is what stock does — the crystals are
not in the same place twice — and it is the single biggest difference
between "a film look" and a still image with a film filter stuck on a
timeline.

It costs bitrate. Grain is the most expensive thing there is to encode.
Below about 30 Mb/s at 4K the encoder starts smearing it into blocks; the
data-rate control says so.

The engine renders at **exactly the pixel size the picture occupies in the
output**, so the grain is the right size for the delivery frame rather than
rendered small and scaled up.

---

## Encoding

The lab asks the browser what it can encode, in this order, and takes the
first that works:

```
avc1.640033   H.264 High 5.1     → MP4
avc1.640028   H.264 High 4.0     → MP4
avc1.4D0028   H.264 Main         → MP4
avc1.42E01F   H.264 Baseline     → MP4
vp09.00.51.08 VP9                → WebM
vp09.00.41.08 VP9                → WebM
vp8           VP8                → WebM
av01.0.08M.08 AV1                → WebM
```

H.264 is first because that is what an editor will open. The bench prints
which codec and container you are actually going to get before you start —
it does not promise MP4 and hand you something else.

Both containers are written in `src/video/mux.ts` rather than pulled in as a
dependency, so there is no opaque binary in the export path:

* **MP4** — plain, not fragmented. The whole file is in memory anyway, so a
  real sample table (`stts` / `stss` / `stsc` / `stsz` / `stco`) is both
  simpler to get right and opens everywhere. 64-bit `mdat` once the picture
  is big enough to need it.
* **WebM** — EBML with the segment size known, so the duration is real and
  the file seeks. A new cluster on every key frame.

A key frame goes in every second, so the result scrubs.

### What has been verified, and what has not

Verified end to end in headless Chromium (`tools/verify/video-ui.mjs`,
`tools/verify/cliprun-ui.mjs`):

* the **WebM** path, all the way from the bench button to a file that loads,
  reports the right duration and dimensions, seeks to an arbitrary point and
  decodes a real frame
* gate layout arithmetic for every format at 3840 × 2160, against the
  published aspect ratios

Verified **structurally only** (`tools/verify/mp4-ui.mjs`): the **MP4**
muxer. Every box length is consistent, the boxes fill their parents exactly,
`stco` lands on the first byte of sample data, `stsz` sums to the payload
and `tkhd` carries the right dimensions. It has **not** been decode-verified
here, because the Chromium in this container ships without H.264 and refuses
to encode it — so there was no real H.264 elementary stream to put in the
container. On a browser with H.264 the MP4 path is what will run.

---

## Seeking the source

* a specimen the lab animates itself (`tick`) is deterministic: it is asked
  for the exact second and gives it
* a file is seeked with `currentTime` and waited on; a source that will not
  seek times out after 400 ms rather than hanging the export

A live camera cannot be exported offline — there is nothing to seek. Record
it to a file first, then run the file through.
