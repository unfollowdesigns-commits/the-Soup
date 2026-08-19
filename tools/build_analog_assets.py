#!/usr/bin/env python3
"""
Build the curated analog material library in /public/analog.

Two kinds of material go in, and the difference matters:

  SOURCED   Real film artefacts, traced from 35mm scans by the
            FilmDamageSimulator project (MIT, Daniela Ivanova).
            We curate a small set and never ship the whole corpus.

  AUTHORED  Plates written from scratch here (paper fibre, toner,
            blue noise). Original work, same licence as this repo.

Nothing else is redistributed. See docs/ANALOG_SYSTEM.md.

Usage:
    git clone --depth 1 https://github.com/daniela997/FilmDamageSimulator /tmp/fds
    python3 tools/build_analog_assets.py --fds /tmp/fds
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------
# CURATION
# Chosen for a spread of density and shape, not by score alone.
# Every entry here is a deliberate pick; the corpus has thousands.
# ---------------------------------------------------------------
CURATED = {
    "dust": [
        ("dirt", "dirt-101.png"), ("dirt", "dirt-022.png"),
        ("dirt", "dirt-091.png"), ("dirt", "dirt-106.png"),
        ("spots", "spots-075.png"), ("spots", "spots-002.png"),
        ("sprinkles", "sprink-0099.png"), ("sprinkles", "sprink-0002.png"),
    ],
    "hair": [
        ("hair-short", "hair-sh-0013.png"), ("hair-short", "hair-sh-0056.png"),
        ("hair-short", "hair-sh-0045.png"),
        ("lint", "lint-066.png"), ("lint", "lint-022.png"), ("lint", "lint-035.png"),
    ],
    "scratches": [
        ("scratches", "scratch-0116.png"), ("scratches", "scratch-0049.png"),
        ("scratches", "scratch-0041.png"), ("scratches", "scratch-0081.png"),
        ("scratches", "scratch-0007.png"),
        ("smut", "smut-0080.png"), ("smut", "smut-0034.png"),
    ],
    "stain": [
        ("stain", "stain-038.png"), ("stain", "stain-048.png"), ("stain", "stain-109.png"),
    ],
}

PLATE = 1024
ATLAS_SLOTS = ["dust", "scratches", "hair", "stain"]

# how many tiles are scattered into one plate, and at what scale range.
# Restraint is the point: a plate that reads as "damaged" at a glance
# is already too much.
SCATTER = {
    "dust":      dict(n=14, scale=(0.45, 1.15), alpha=(0.5, 1.0)),
    "scratches": dict(n=5,  scale=(0.8, 2.2),   alpha=(0.35, 0.9)),
    "hair":      dict(n=7,  scale=(0.6, 1.6),   alpha=(0.55, 1.0)),
    "stain":     dict(n=4,  scale=(1.0, 2.4),   alpha=(0.3, 0.75)),
}


def load_mask(path: Path) -> np.ndarray:
    """FDS tiles are white RGB with the artefact carried in alpha."""
    im = Image.open(path).convert("RGBA")
    return np.array(im)[..., 3].astype(np.float32) / 255.0


def place(plate: np.ndarray, tile: np.ndarray, cx: int, cy: int, alpha: float):
    """Composite with wrap-around so the plate has no seam."""
    th, tw = tile.shape
    ys = (np.arange(th) + cy) % plate.shape[0]
    xs = (np.arange(tw) + cx) % plate.shape[1]
    sub = plate[np.ix_(ys, xs)]
    plate[np.ix_(ys, xs)] = 1.0 - (1.0 - sub) * (1.0 - tile * alpha)


def build_plate(kind: str, tiles: list, rng: np.random.Generator) -> np.ndarray:
    cfg = SCATTER[kind]
    plate = np.zeros((PLATE, PLATE), np.float32)
    for _ in range(cfg["n"]):
        src = tiles[rng.integers(len(tiles))]
        s = rng.uniform(*cfg["scale"])
        size = max(24, int(src.shape[0] * s))
        img = Image.fromarray((src * 255).astype(np.uint8)).resize(
            (size, size), Image.LANCZOS
        )
        # rotate and flip so a source tile never reads twice the same way
        img = img.rotate(float(rng.uniform(0, 360)), expand=True, resample=Image.BICUBIC)
        if rng.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        t = np.array(img).astype(np.float32) / 255.0
        if t.shape[0] >= PLATE:
            t = t[:PLATE - 1, :PLATE - 1]
        place(plate, t, int(rng.integers(PLATE)), int(rng.integers(PLATE)),
              float(rng.uniform(*cfg["alpha"])))
    return np.clip(plate, 0, 1)


# ---------------------------------------------------------------
# AUTHORED PLATES — original work
# ---------------------------------------------------------------

def spectral_noise(size, beta, rng, aniso=1.0):
    """Periodic noise by spectral synthesis.

    Filtering white noise in the frequency domain and coming back gives a
    field that is periodic on the torus by construction — so the plate tiles
    with no seam, which upsampled value noise does not. `beta` sets the
    falloff (larger = smoother), `aniso` stretches the spectrum along one
    axis, which is how paper fibre acquires a machine direction.
    """
    w = np.fft.fftfreq(size)[:, None]
    h = np.fft.fftfreq(size)[None, :]
    r = np.sqrt((w * aniso) ** 2 + (h / aniso) ** 2)
    r[0, 0] = 1.0
    spectrum = np.fft.fft2(rng.standard_normal((size, size))) * (r ** -beta)
    spectrum[0, 0] = 0.0
    out = np.real(np.fft.ifft2(spectrum)).astype(np.float32)
    s = out.std()
    return out / (s if s > 1e-9 else 1.0)


AUTHORED = 512   # authored plates are low-frequency; 512 is plenty


def paper_plate(rng) -> np.ndarray:
    """Fibre, laid unevenly, with the faint cloudiness of a coated sheet."""
    n = AUTHORED
    # weighted toward the high frequencies: tooth never reads as a repeat,
    # low-frequency cloud does as soon as the plate tiles twice
    cloud = spectral_noise(n, 1.6, rng)
    fibre = spectral_noise(n, 1.0, rng, aniso=0.34)   # drawn out along the web
    tooth = spectral_noise(n, 0.3, rng)
    p = 0.5 + cloud * 0.045 + fibre * 0.062 + tooth * 0.085
    return np.clip(p, 0, 1)


def photocopy_plate(rng) -> np.ndarray:
    """Toner: patchy adhesion, a drum band, and loose specks."""
    n = AUTHORED
    patch = spectral_noise(n, 1.35, rng)
    speck = spectral_noise(n, 0.15, rng)
    y = np.linspace(0, 2 * np.pi, n, endpoint=False, dtype=np.float32)[:, None]
    # the band must complete whole cycles or the plate will not meet itself
    band = np.sin(y * 6.0 + rng.random() * 6.28)
    p = 0.5 + patch * 0.075 + speck * 0.07 + band * 0.03
    # a scatter of toner that did not fuse
    dots = (speck > 2.6).astype(np.float32)
    return np.clip(p + dots * 0.35, 0, 1)


def blue_noise(size=256, iterations=28, rng=None) -> np.ndarray:
    """Void-and-cluster-ish: repeatedly subtract the low frequencies.

    Used to decorrelate procedural grain so the hash lattice never shows.
    """
    n = rng.random((size, size)).astype(np.float32)
    for _ in range(iterations):
        lp = np.array(
            Image.fromarray((n * 255).astype(np.uint8))
            .resize((size // 4, size // 4), Image.BOX)
            .resize((size, size), Image.BILINEAR)
        ).astype(np.float32) / 255.0
        n = n - (lp - lp.mean())
        n = (n - n.min()) / max(n.max() - n.min(), 1e-6)
    # flatten the histogram so the field is uniform
    order = np.argsort(n.ravel())
    ranked = np.empty(size * size, np.float32)
    ranked[order] = np.linspace(0, 1, size * size, dtype=np.float32)
    return ranked.reshape(size, size)


def save_gray(arr: np.ndarray, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), mode="L").save(
        path, optimize=True
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fds", required=True, help="path to a FilmDamageSimulator clone")
    ap.add_argument("--out", default="public/analog")
    args = ap.parse_args()

    fds = Path(args.fds) / "synthetic"
    out = Path(args.out)
    if not fds.exists():
        sys.exit(f"FilmDamageSimulator synthetic/ not found at {fds}")

    manifest = {"sourced": [], "authored": [], "plates": []}

    # ---- 1. curated source tiles, kept as the licensed material of record
    loaded = {}
    for kind, entries in CURATED.items():
        loaded[kind] = []
        for cat, fn in entries:
            src = fds / cat / fn
            if not src.exists():
                print(f"  ! missing {src}", file=sys.stderr)
                continue
            mask = load_mask(src)
            loaded[kind].append(mask)
            dest = out / "source" / kind / fn.replace(".png", "").replace("-", "_")
            dest = dest.with_suffix(".png")
            save_gray(mask, dest)
            manifest["sourced"].append({
                "file": str(dest.relative_to(out)).replace(os.sep, "/"),
                "kind": kind,
                "origin": "FilmDamageSimulator",
                "originPath": f"synthetic/{cat}/{fn}",
                "license": "MIT",
                "attribution": "Daniela Ivanova, FilmDamageSimulator (Eurographics 2023)",
            })

    # ---- 2. scatter plates: one frame-sized field per category, per variant
    for variant in range(2):
        rng = np.random.default_rng(0xA17 + variant * 977)
        atlas = np.zeros((PLATE * 2, PLATE * 2), np.float32)
        for i, kind in enumerate(ATLAS_SLOTS):
            if not loaded.get(kind):
                continue
            plate = build_plate(kind, loaded[kind], rng)
            oy, ox = (i // 2) * PLATE, (i % 2) * PLATE
            atlas[oy:oy + PLATE, ox:ox + PLATE] = plate
        name = f"damage-atlas-{variant + 1}.png"
        save_gray(atlas, out / "plates" / name)
        manifest["plates"].append({
            "file": f"plates/{name}",
            "slots": ATLAS_SLOTS,
            "layout": "2x2, 1024px per slot, wrap-safe",
            "derivedFrom": "FilmDamageSimulator (MIT)",
        })

    # ---- 3. authored plates
    rng = np.random.default_rng(20250819)
    for name, arr, note in [
        ("paper/paper-fibre-1.png", paper_plate(rng), "coated sheet, machine direction"),
        ("paper/paper-fibre-2.png", paper_plate(rng), "heavier rag, uneven coating"),
        ("photocopy/toner-1.png", photocopy_plate(rng), "patchy toner, drum banding"),
        ("photocopy/toner-2.png", photocopy_plate(rng), "second generation copy"),
        ("grain/blue-noise-256.png", blue_noise(256, 28, rng), "grain decorrelation field"),
    ]:
        save_gray(arr, out / name)
        manifest["authored"].append({
            "file": name,
            "origin": "authored for this project",
            "license": "same as repository",
            "note": note,
        })

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = len(manifest["sourced"]) + len(manifest["authored"]) + len(manifest["plates"])
    print(f"analog library built: {total} files → {out}")
    for k in ("sourced", "authored", "plates"):
        print(f"  {k}: {len(manifest[k])}")


if __name__ == "__main__":
    main()
