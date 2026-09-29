#!/usr/bin/env python3
"""v6 -- align two front-on faces on their eyes and overlay them.

Face difference is mostly a question of proportion, and proportion can only be judged once
both faces are the same size. This scales one onto the other using the eye pair (the most
reliable landmark on a cat face) and writes a red/cyan overlay: red where only the reference
has tone, cyan where only the render does, white where they agree.

  python v6_face_overlay.py REF RENDER --out overlay.png
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v6_face_metrics import load, luma, measure  # noqa: E402


def eye_pair(m, aspect_lo=0.45, aspect_hi=2.2, solid_min=0.42):
    """The two blobs that look most like a pair of eyes: similar size, similar height,
    straddling the vertical centre, and roughly as wide as they are tall."""
    cands = []
    for b in m['eye_candidates']:
        ar = b['w'] / max(b['h'], 1)
        if aspect_lo <= ar <= aspect_hi and b['solid'] >= solid_min:
            cands.append(b)
    if len(cands) < 2:
        cands = m['eye_candidates'][:2]
    cands = sorted(cands, key=lambda b: -b['area'])
    best, best_score = None, None
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            a, b = cands[i], cands[j]
            if a['cx'] > b['cx']:
                a, b = b, a
            area_r = abs(a['area'] - b['area']) / max(a['area'], b['area'])
            dy = abs(a['cy'] - b['cy']) / max(a['h'], 1)
            score = area_r + dy
            if best_score is None or score < best_score:
                best, best_score = (a, b), score
    return best


def centre(b):
    x0, y0, x1, y1 = b['bbox']
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def bar(img, frac, colour, width=2):
    d = ImageDraw.Draw(img)
    w, h = img.size
    x = int(w * frac)
    d.line([x, 0, x, h], fill=colour, width=width)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ref')
    ap.add_argument('render')
    ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=560)
    ap.add_argument('--keep', help='also write the two aligned faces next to the overlay')
    a = ap.parse_args()

    mr, mc = measure(a.ref), measure(a.render)
    er, ec = eye_pair(mr), eye_pair(mc)
    if not er or not ec:
        print('eye detection failed', bool(er), bool(ec))
        return
    (rlx, rly), (rrx, rry) = centre(er[0]), centre(er[1])
    (clx, cly), (crx, cry) = centre(ec[0]), centre(ec[1])
    rdist = np.hypot(rrx - rlx, rry - rly)
    cdist = np.hypot(crx - clx, cry - cly)
    k = rdist / cdist
    rmid = np.array([(rlx + rrx) / 2, (rly + rry) / 2])
    cmid = np.array([(clx + crx) / 2, (cly + cry) / 2])

    ims = []
    for path, mid, scale in ((a.ref, rmid, 1.0), (a.render, cmid, k)):
        im = Image.open(path).convert('RGB')
        im = im.resize((max(1, int(round(im.width * scale))), max(1, int(round(im.height * scale)))), Image.LANCZOS)
        canvas = Image.new('RGB', (a.size, a.size), (235, 235, 235))
        px = int(round(a.size / 2 - mid[0] * scale))
        py = int(round(a.size / 2 - mid[1] * scale))
        canvas.paste(im, (px, py))
        ims.append(canvas)

    g = [np.asarray(i.convert('L')).astype(np.float32) / 255.0 for i in ims]
    ov = np.dstack([g[0], g[1], g[1]])
    ovim = Image.fromarray((np.clip(ov, 0, 1) * 255).astype(np.uint8))

    d = ImageDraw.Draw(ovim)
    for frac in (0.25, 0.5, 0.75):
        d.line([0, a.size * frac, a.size, a.size * frac], fill=(90, 90, 90), width=1)
        d.line([a.size * frac, 0, a.size * frac, a.size], fill=(90, 90, 90), width=1)
    d.text((6, 6), 'ref=red  render=cyan  agree=white', fill=(255, 255, 255))

    if a.keep:
        w = a.size * 3 + 24
        sheet = Image.new('RGB', (w, a.size), (235, 235, 235))
        for i, im in enumerate([ims[0], ims[1], ovim]):
            sheet.paste(im, (i * (a.size + 12), 0))
        sheet.save(a.keep)
        print('wrote', a.keep)
    ovim.save(a.out)
    print('wrote', a.out)
    print(f'eye distance: ref {rdist:.1f} px, render {cdist:.1f} px, scale {k:.3f}')
    print(f'ref  eyes {centre(er[0])} {centre(er[1])}  w {er[0]["w"]} {er[1]["w"]}')
    print(f'rend eyes {centre(ec[0])} {centre(ec[1])}  w {ec[0]["w"]} {ec[1]["w"]}')


if __name__ == '__main__':
    main()
