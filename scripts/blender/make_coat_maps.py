"""Clean the painted coat maps into build-ready textures (see v5/COAT-MAPS.md).

The painted sources (v5-imagegen-sources/coat_*.png) are tracked in Git; the cleaned
textures land in v5/textures/, which is not. Cleaning does three things:

1. resamples to the template's 1024 square, the frame build_lingxi_v5.py samples through;
2. removes the alignment marks the painter copied from the template (red eye rings, nose,
   mouth and ear-base lines) - a red line on the crown would otherwise dye the fur red;
3. throws away a few pixels inside the silhouette edge (painted fringe: yellow/red halo,
   background bleed) and grows the clean interior colour outward over the whole square, so a
   strand rooted just outside the painted outline still samples coat, never background.

NumPy + Pillow only, deterministic. Run from the repo root:
    python3 scripts/blender/make_coat_maps.py [--out DIR]
"""
from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_coat_templates as tpl  # noqa: E402  (shares the frames and the silhouette)

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets/characters/lingxi/v5-imagegen-sources'
N = tpl.N


def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Separable box blur with edge padding, on an (H, W, C) array."""
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def erode(mask: np.ndarray, r: int) -> np.ndarray:
    return box_blur(mask[..., None].astype(np.float64), r)[..., 0] > 0.999


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    return box_blur(mask[..., None].astype(np.float64), r)[..., 0] > 0.001


def grow(color: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Fill every invalid pixel from its nearest valid neighbourhood (push-pull by blurring)."""
    out = color.copy()
    have = valid.copy()
    r = 2
    while not have.all():
        w = box_blur(have[..., None].astype(np.float64), r)
        c = box_blur(out * have[..., None], r)
        fill = (~have) & (w[..., 0] > 1e-6)
        out[fill] = c[fill] / w[fill]
        have |= fill
        r = min(r * 2, N)
    return out


def silhouette(name: str) -> np.ndarray:
    frame = tpl.FRAMES[name]
    m = tpl.silhouette(frame, tpl.HEAD if 'head' in name else tpl.BODY)
    if name == 'coat_head_front':
        from PIL import ImageDraw
        im = Image.fromarray(m.astype(np.uint8) * 255)
        d = ImageDraw.Draw(im)
        for tri in tpl.ears(frame):
            d.polygon([tpl.to_px(frame, p) for p in tri], fill=255)
        m = np.asarray(im) > 127
    return m


def clean(name: str) -> np.ndarray:
    a = np.asarray(Image.open(SRC / f'{name}.png').convert('RGB').resize((N, N), Image.Resampling.LANCZOS),
                   dtype=np.float64) / 255
    t = np.asarray(Image.open(SRC / 'templates' / f'{name}_template.png').convert('RGB'), dtype=np.float64) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    painted_marks = (r > .55) & (g < .35) & (b < .35)                    # red copied from the template
    template_marks = ((t[..., 0] > .7) & (t[..., 1] < .2)) | ((t[..., 2] > .7) & (t[..., 0] < .2))
    marks = dilate(painted_marks | template_marks, 4)
    valid = erode(silhouette(name), 6) & ~marks
    return grow(a, valid)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--out', default=str(ROOT / 'assets/characters/lingxi/v5/textures'))
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    start = time.time()
    written = 0
    for name in tpl.FRAMES:
        if not (SRC / f'{name}.png').exists():
            continue                                  # the build falls back to procedural colour
        img = clean(name)
        Image.fromarray(np.clip(img * 255 + .5, 0, 255).astype(np.uint8)).save(out / f'{name}.png')
        written += 1
    (out / 'coat_frames.json').write_text(json.dumps(
        {n: {'h': f[0], 'h_range': f[1], 'v': f[2], 'v_range_top_to_bottom': f[3]} for n, f in tpl.FRAMES.items()},
        indent=1))
    print(json.dumps({'coat_maps': written, 'runtime_s': round(time.time() - start, 2)}))


if __name__ == '__main__':
    main()
