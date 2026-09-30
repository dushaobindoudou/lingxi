"""Quantitative look metrics so the coat can be judged without eyeballing.

Two masking strategies:
  - renders: differenced against plate.png (same camera, every LX_* part hidden)
  - reference: its backdrop is a flat colour, so the modal RGB is found and
    pixels close to it are dropped
Reports luminance percentiles, stripe contrast (p90-p10) and warmth (R-B).
"""
import sys
import os
import re
import numpy as np
from PIL import Image
from pathlib import Path

V5 = Path('/Users/liepin/workspace/lingxi/assets/characters/lingxi/v5')
REF = Path('/Users/liepin/workspace/lingxi/assets/characters/lingxi/reference/turnaround-v1.png')
PLATE = V5 / 'plate.png'


def load(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype='f') / 255.


def mask_from_plate(im, plate):
    d = np.abs(im - plate).max(2)
    return d > .04


def mask_modal_background(im):
    q = (im * 32).astype('i')
    flat = q.reshape(-1, 3)
    keys = flat[:, 0] * 1024 + flat[:, 1] * 32 + flat[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    top = vals[np.argmax(counts)]
    r, g, b = (top // 1024) % 32, (top // 32) % 32, top % 32
    bg = np.array([r, g, b], dtype='f') / 32. * 255. / 255.
    d = np.abs(im - bg).max(2)
    return d > .03


def stats(im, mask):
    px = im[mask]
    if len(px) < 500:
        return None
    lum = px.mean(1)
    return dict(px=int(mask.sum()),
                p05=np.percentile(lum, 5) * 255,
                p25=np.percentile(lum, 25) * 255,
                p50=np.percentile(lum, 50) * 255,
                p75=np.percentile(lum, 75) * 255,
                p95=np.percentile(lum, 95) * 255,
                contrast=(np.percentile(lum, 90) - np.percentile(lum, 10)) * 255,
                warmth=(px[:, 0].mean() - px[:, 2].mean()) * 255)


def plate_for(path):
    """A plate must be rendered at the SAME exposure as the image, otherwise the
    whole frame differs and the mask selects everything."""
    m = re.search(r'ev(-?\d+(?:\.\d+)?)', Path(path).name)
    if m:
        p = V5 / f'plate_{m.group(1)}.png'
        if p.exists():
            return load(p)
    override = os.environ.get('LINGXI_PLATE')
    if override and Path(override).exists():
        return load(override)
    return load(PLATE) if PLATE.exists() else None


def main(paths):
    plate = None
    print(f"{'image':30s} {'px':>7s} {'p05':>5s} {'p25':>5s} {'p50':>5s} {'p75':>5s} {'p95':>5s} {'contr':>6s} {'warm':>5s}")
    for name, p in [('reference(turnaround)', REF)] + [(q.name, q) for q in paths]:
        if not Path(p).exists():
            print(f'{name:30s} MISSING'); continue
        im = load(p)
        h, w, _ = im.shape
        plate = plate_for(p)
        if plate is not None:
            # the plate is rendered at probe size; downscale full-size renders to match
            if im.shape != plate.shape:
                im = np.asarray(Image.open(p).convert('RGB').resize(
                    (plate.shape[1], plate.shape[0])), dtype='f') / 255.
            mask = mask_from_plate(im, plate)
        else:
            im = im[: h // 2]                    # top row of the turnaround sheet
            mask = mask_modal_background(im)
        s = stats(im, mask)
        if s is None:
            print(f'{name:30s} too few cat pixels'); continue
        print(f"{name:30s} {s['px']:7d} {s['p05']:5.0f} {s['p25']:5.0f} {s['p50']:5.0f} "
              f"{s['p75']:5.0f} {s['p95']:5.0f} {s['contrast']:6.0f} {s['warmth']:5.0f}")


if __name__ == '__main__':
    args = [Path(a) for a in sys.argv[1:]]
    main(args)
