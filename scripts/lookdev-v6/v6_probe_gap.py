#!/usr/bin/env python3
"""
v6 look-dev -- measure how far the current render is from the photographic reference.

Every number is computed on a silhouette normalised to the same height, so a 1254 px
AI photo and a 520 px Blender render can be compared directly.

Interpreter: /Users/liepin/.workbuddy/venvs/lookdev/bin/python  (numpy + Pillow + scipy)

  python v6_probe_gap.py IMG [IMG ...]
  python v6_probe_gap.py IMG --grid 2:2          # contact sheet -> measure each cell
  python v6_probe_gap.py A.png B.png --pair out.png
  python v6_probe_gap.py IMG --json out.json
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

TARGET_H = 640          # normalised silhouette height, px
BG_TOL = 14             # colour distance from the corner median that counts as "subject"
FUZZ_RADII = (2, 4, 8, 16, 32)
MIN_AREA = 2000


# ---------------------------------------------------------------- masks

def _disk(r):
    if r <= 0:
        return np.ones((1, 1), bool)
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def largest_component(mask):
    lab, n = ndi.label(mask, structure=ndi.generate_binary_structure(2, 1))
    if n <= 1:
        return mask
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return lab == sizes.argmax()


def strip_dark_bars(mask, rgb):
    """Drop the near-black plate the render scripts leave at the bottom of a frame.

    The cat stands on it, so a plain largest-component pass keeps it. A bar is: near
    black, touching the frame edge, long across the frame and thin the other way.
    """
    g = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    dark = mask & (g < 24)
    if not dark.any():
        return mask
    lab, n = ndi.label(dark)
    h, w = mask.shape
    kill = np.zeros_like(mask)
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        bh, bw = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)
        long_r, thin_r = max(bh, bw) / max(h, w), min(bh, bw) / max(h, w)
        if long_r > 0.75 and thin_r < 0.25:
            kill |= lab == i
    return mask & ~kill


def load_rgb_mask(path, rect=None):
    arr = np.asarray(Image.open(path))
    if arr.ndim == 3 and arr.shape[2] == 4 and arr[..., 3].min() < 250:
        rgb, mask = arr[..., :3].astype(np.float32), arr[..., 3] > 128
    else:
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, -1)
        rgb = arr[..., :3].astype(np.float32)
        h, w, _ = rgb.shape
        k = max(8, min(h, w) // 16)
        corners = np.concatenate([
            rgb[:k, :k].reshape(-1, 3), rgb[:k, -k:].reshape(-1, 3),
            rgb[-k:, :k].reshape(-1, 3), rgb[-k:, -k:].reshape(-1, 3),
        ])
        bg = np.median(corners, axis=0)
        mask = np.sqrt(((rgb - bg) ** 2).sum(-1)) > BG_TOL
    if rect is not None:
        x0, y0, x1, y1 = rect
        rgb, mask = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    return rgb, strip_dark_bars(mask, rgb)


def normalise(rgb, mask, target_h=TARGET_H):
    ys, xs = np.where(mask)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    rgb, mask = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    h, w = mask.shape
    nw = max(1, int(round(w * target_h / h)))
    rgb = np.asarray(Image.fromarray(rgb.astype(np.uint8)).resize((nw, target_h), Image.LANCZOS))
    mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((nw, target_h), Image.NEAREST))
    mask = largest_component(mask > 127)
    return rgb.astype(np.float32), mask


# ---------------------------------------------------------------- helpers

def boxblur(g, r):
    if r < 1:
        return g
    k = 2 * r + 1
    pad = np.pad(g, r, mode="edge")
    c = np.cumsum(np.cumsum(pad, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def fuzz_shell(profile, thresh):
    """Radius (px, normalised scale) at which the silhouette has lost (1-thresh) of its area."""
    for r in sorted(profile):
        if profile[r] < thresh:
            return r
    return None


# ---------------------------------------------------------------- measure

def measure(path, rect=None, label=None):
    rgb, mask = load_rgb_mask(path, rect)
    mask = largest_component(mask)
    if mask.sum() < 200:
        return None
    rgb, mask = normalise(rgb, mask)
    h, w = mask.shape
    area = int(mask.sum())
    ys, xs = np.where(mask)
    bh, bw = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)

    dt = ndi.distance_transform_edt(mask)
    boundary = int((mask & ~(dt > 1.0)).sum())

    erode = {r: float((dt > r).sum() / area) for r in FUZZ_RADII}
    openr = {r: float(ndi.binary_opening(mask, _disk(r)).sum() / area) for r in FUZZ_RADII}

    g = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    fine = (g - boxblur(g, 4))[mask]
    mid = (boxblur(g, 4) - boxblur(g, 16))[mask]
    coarse = (boxblur(g, 16) - boxblur(g, 64))[mask]
    g_in = g[mask]

    p = np.percentile(g_in, [2, 10, 50, 90, 98])
    sat = ((rgb.max(-1) - rgb.min(-1)) / np.maximum(rgb.max(-1), 1e-6))[mask]
    lum = g_in / 255.0
    whiteish = float(((lum > 0.78) & (sat < 0.18)).mean())

    return {
        "label": label or os.path.basename(path),
        "path": path, "rect": rect, "size": [w, h], "mask_area": area,
        "bbox_w": bw, "bbox_h": bh, "bbox_aspect": float(bw / bh),
        "fill_bbox": float(area / (bw * bh)),
        "norm_perimeter": float(boundary / np.sqrt(area)),
        "detail_fine": float(fine.std() / max(g_in.std(), 1e-6)),
        "detail_mid": float(mid.std() / max(g_in.std(), 1e-6)),
        "detail_coarse": float(coarse.std() / max(g_in.std(), 1e-6)),
        "luma_p2": float(p[0]), "luma_p10": float(p[1]), "luma_p50": float(p[2]),
        "luma_p90": float(p[3]), "luma_p98": float(p[4]),
        "luma_spread": float(p[3] - p[1]),
        "sat_mean": float(sat.mean()),
        "white_fraction": whiteish,
        "erode_retention": erode,
        "open_retention": openr,
        "fuzz_97": fuzz_shell(openr, 0.97),
        "fuzz_90": fuzz_shell(openr, 0.90),
    }


# ---------------------------------------------------------------- report

COLS = ["label", "bbox_ar", "fill", "perim", "fine", "mid", "coarse",
        "luma10-90", "sat", "white%", "shell97", "shell90"]


def table(rows):
    out = ["| " + " | ".join(COLS) + " |", "|" + "---|" * len(COLS)]
    for r in rows:
        out.append("| " + " | ".join([
            r["label"][:30], f"{r['bbox_aspect']:.3f}", f"{r['fill_bbox']:.3f}",
            f"{r['norm_perimeter']:.2f}", f"{r['detail_fine']:.3f}",
            f"{r['detail_mid']:.3f}", f"{r['detail_coarse']:.3f}",
            f"{r['luma_spread']:.1f}", f"{r['sat_mean']:.3f}",
            f"{r['white_fraction'] * 100:.1f}",
            f"{r['fuzz_97']}", f"{r['fuzz_90']}",
        ]) + " |")
    return "\n".join(out)


def grid_rects(w, h, spec):
    r, c = (int(x) for x in spec.split(":"))
    return [(int(x * w / c), int(y * h / r), int((x + 1) * w / c), int((y + 1) * h / r))
            for y in range(r) for x in range(c)]


def make_pair(a, b, out_path):
    """Side-by-side, both scaled to the same silhouette height, with a 1:1 face strip."""
    imgs = []
    for p in (a, b):
        rgb, mask = load_rgb_mask(p)
        mask = largest_component(mask)
        rgb, mask = normalise(rgb, mask, 640)
        ys, xs = np.where(mask)
        rgb = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        rgb[~mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]] = 235
        imgs.append(Image.fromarray(rgb.astype(np.uint8)))
    W = sum(i.width for i in imgs) + 24
    H = max(i.height for i in imgs)
    canvas = Image.new("RGB", (W, H), (235, 235, 235))
    x = 0
    for im in imgs:
        canvas.paste(im, (x, 0))
        x += im.width + 24
    canvas.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--grid")
    ap.add_argument("--json")
    ap.add_argument("--pair")
    ap.add_argument("--tag", default="")
    a = ap.parse_args()

    if a.pair:
        assert len(a.images) == 2, "--pair needs exactly two images"
        print("wrote", make_pair(a.images[0], a.images[1], a.pair))
        return

    rows = []
    for p in a.images:
        base = os.path.basename(p)
        if a.grid:
            w, h = Image.open(p).size
            for i, rect in enumerate(grid_rects(w, h, a.grid)):
                rows.append(measure(p, rect, f"{a.tag}{base}#{i}"))
        else:
            rows.append(measure(p, None, f"{a.tag}{base}"))
    rows = [r for r in rows if r and r["mask_area"] >= MIN_AREA]

    print(table(rows))
    print()
    for r in rows:
        print(f"{r['label']}\n   open {r['open_retention']}\n   luma {r['luma_p2']:.0f}/{r['luma_p10']:.0f}/"
              f"{r['luma_p50']:.0f}/{r['luma_p90']:.0f}/{r['luma_p98']:.0f}")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"\nwrote {a.json}")


if __name__ == "__main__":
    main()
