#!/usr/bin/env python3
"""v6 -- locate the eyes and the nose in a front-on face, and report face ratios.

Reported as ratios of the head's visible span, so a 1254 px photo and a 512 px render can be
compared directly. It prints the strongest dark blobs (eye candidates) and pink blobs (nose
candidates) with position, size and solidity, and writes a marked-up copy.

Verifying the detection by eye is part of the workflow: a plausible number read off the wrong
blob is worse than no number at all.

  python v6_face_metrics.py IMG [--out marked.png] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi


def load(path):
    arr = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = arr.shape
    k = max(8, min(h, w) // 16)
    corners = np.concatenate([arr[:k, :k].reshape(-1, 3), arr[:k, -k:].reshape(-1, 3),
                              arr[-k:, :k].reshape(-1, 3), arr[-k:, -k:].reshape(-1, 3)])
    bg = np.median(corners, 0)
    mask = np.sqrt(((arr - bg) ** 2).sum(-1)) > 14
    lab, n = ndi.label(mask)
    if n > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        mask = lab == sizes.argmax()
    return arr, mask


def blobs(mask, min_area=80):
    lab, n = ndi.label(mask)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        a = int(ys.size)
        if a < min_area:
            continue
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        out.append({'area': a, 'cx': float(xs.mean()), 'cy': float(ys.mean()),
                    'w': x1 - x0 + 1, 'h': y1 - y0 + 1,
                    'solid': a / max((x1 - x0 + 1) * (y1 - y0 + 1), 1),
                    'bbox': [x0, y0, x1, y1]})
    return sorted(out, key=lambda b: -b['area'])


def luma(arr):
    return 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]


def measure(path, dark_pct=6.0, pink_delta=20.0):
    arr, mask = load(path)
    g = luma(arr)
    h, w = mask.shape
    ys, xs = np.where(mask)
    top, bot = int(ys.min()), int(ys.max())
    left, right = int(xs.min()), int(xs.max())
    head_w, head_h = right - left + 1, bot - top + 1

    dark = mask & (g <= np.percentile(g[mask], dark_pct))
    eyes = [b for b in blobs(dark, min_area=max(60, head_w * head_h // 9000))]

    r, gr, b = arr[..., 0], arr[..., 1], arr[..., 2]
    pink = mask & (r - np.maximum(gr, b) > pink_delta) & (r > 110)
    noses = blobs(pink, min_area=max(40, head_w * head_h // 20000))

    def rel(b):
        return {**b,
                'cx_rel_head': (b['cx'] - left) / head_w,
                'cy_rel_head': (b['cy'] - top) / head_h,
                'w_rel_head': b['w'] / head_w, 'h_rel_head': b['h'] / head_h}

    return {
        'path': path, 'size': [w, h],
        'head_bbox': [left, top, right, bot], 'head_w': head_w, 'head_h': head_h,
        'eye_candidates': [rel(b) for b in eyes[:10]],
        'nose_candidates': [rel(b) for b in noses[:10]],
        'arr': arr, 'mask': mask,
    }


def draw(m, out_path):
    arr, mask = m['arr'].astype(np.uint8), m['mask']
    im = Image.open(m['path']).convert('RGB')
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', max(14, im.height // 60))
    except OSError:
        f = ImageFont.load_default()
    for i, b in enumerate(m['eye_candidates'][:8]):
        x0, y0, x1, y1 = b['bbox']
        d.rectangle([x0, y0, x1, y1], outline=(255, 0, 0), width=2)
        d.text((x0, y0 - 16), f"E{i} {b['cx_rel_head']:.2f},{b['cy_rel_head']:.2f}", fill=(255, 0, 0), font=f)
    for i, b in enumerate(m['nose_candidates'][:8]):
        x0, y0, x1, y1 = b['bbox']
        d.rectangle([x0, y0, x1, y1], outline=(0, 180, 255), width=2)
        d.text((x0, y1 + 2), f"N{i} {b['cx_rel_head']:.2f},{b['cy_rel_head']:.2f}", fill=(0, 180, 255), font=f)
    im.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('--dir')
    ap.add_argument('--json')
    a = ap.parse_args()

    rows = []
    for p in a.images:
        m = measure(p)
        if a.dir:
            os.makedirs(a.dir, exist_ok=True)
            draw(m, os.path.join(a.dir, os.path.basename(p).replace('.png', '.marked.png')))
        print(f"== {os.path.basename(p)}  head {m['head_w']}x{m['head_h']}  bbox {m['head_bbox']}")
        print("   eyes   (cx,cy,w,h as fraction of head box):")
        for b in m['eye_candidates'][:6]:
            print(f"     {b['cx_rel_head']:.3f} {b['cy_rel_head']:.3f}  "
                  f"w{b['w_rel_head']:.3f} h{b['h_rel_head']:.3f}  solid {b['solid']:.2f}  a={b['area']}")
        print("   noses:")
        for b in m['nose_candidates'][:6]:
            print(f"     {b['cx_rel_head']:.3f} {b['cy_rel_head']:.3f}  "
                  f"w{b['w_rel_head']:.3f} h{b['h_rel_head']:.3f}  solid {b['solid']:.2f}  a={b['area']}")
        rows.append({k: v for k, v in m.items() if k not in ('arr', 'mask')})
    if a.json:
        with open(a.json, 'w') as f:
            json.dump(rows, f, indent=1)
        print('wrote', a.json)


if __name__ == '__main__':
    main()
