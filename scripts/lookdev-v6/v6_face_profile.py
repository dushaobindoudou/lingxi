#!/usr/bin/env python3
"""v6 -- head shape as numbers: half-width of the silhouette at each height, in E.

Landmarks (pupils, nose, mouth) say where the parts are but not how big the head around them is,
and "the eyes are in the wrong place" is mostly a claim about the head, not about the eyes: the
same eye pair reads high on a tall skull and low on a short one. This measures the silhouette
itself - the outline the eye pair sits inside - on the same pupil grid, so the two can be read
together.

It also prints where the silhouette starts and ends vertically (top of skull, bottom of chin)
so "eye position" has an upper and a lower bound to be checked against.

  python v6_face_profile.py IMG [IMG...] [--e-px 220] [--span=-1.2,1.2,-1.2,1.4]
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v6_face_landmarks import subject, pupils  # noqa: E402

# Rows this tall in E, sampled this finely
DEFAULT_SPAN = (-1.30, 1.30, -1.10, 1.60)
STEP = 0.05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('--e-px', type=float,
                    help='pupil separation in pixels when known from the render setup; the '
                         'reference photograph must be left to measure its own')
    ap.add_argument('--span', default=None, help='x0,x1,y0,y1 in E')
    ap.add_argument('--step', type=float, default=STEP)
    a = ap.parse_args()

    span = tuple(float(v) for v in a.span.split(',')) if a.span else DEFAULT_SPAN
    y0, y1 = span[2], span[3]
    outs = []
    for p in a.images:
        arr, mask = subject(p)
        eyes = pupils(arr, mask)
        if len(eyes) != 2:
            print(f'{os.path.basename(p)}: pupil detection failed')
            continue
        detected = float(np.hypot(eyes[1]['x'] - eyes[0]['x'], eyes[1]['y'] - eyes[0]['y']))
        E = float(a.e_px) if a.e_px else detected
        ex = 0.5 * (eyes[0]['x'] + eyes[1]['x'])
        ey = 0.5 * (eyes[0]['y'] + eyes[1]['y'])
        ys, xs = np.where(mask)
        top, bot = ys.min(), ys.max()
        rel_y = (ys - ey) / E
        rel_x = (xs - ex) / E
        keep = (rel_y >= y0) & (rel_y <= y1)
        rel_y, rel_x = rel_y[keep], rel_x[keep]
        rows = []
        dy = y0
        while dy <= y1 + 1e-9:
            band = np.abs(rel_y - dy) < a.step / 2
            if band.sum() > 20:
                v = rel_x[band]
                rows.append((dy, float(v.min()), float(v.max()), int(band.sum())))
            else:
                rows.append((dy, float('nan'), float('nan'), int(band.sum())))
            dy += a.step
        outs.append({'name': os.path.basename(p), 'E': E, 'rows': rows,
                     'top': (top - ey) / E, 'bot': (bot - ey) / E,
                     'w_eye': None})
        # width at the pupil line itself
        band = np.abs((ys - ey) / E) < 0.05
        if band.sum() > 20:
            v = (xs[band] - ex) / E
            outs[-1]['w_eye'] = (float(v.min()), float(v.max()))

    print(f"{'dy (E)':>8s} " + ' '.join(f"{o['name'][:22]:>23s}" for o in outs))
    print(f"{'':>8s} " + ' '.join(f"{'half-width L..R (E)':>23s}" for o in outs))
    for i in range(len(outs[0]['rows'])):
        dy = outs[0]['rows'][i][0]
        cells = []
        for o in outs:
            _d, lo, hi, n = o['rows'][i]
            cells.append(f"{lo:+.2f}..{hi:+.2f}" if n > 20 else f"{'--':>11s} (n={n})")
        print(f'{dy:>8.2f} ' + ' '.join(f'{c:>23s}' for c in cells))
    print()
    for o in outs:
        we = o['w_eye']
        print(f"{o['name'][:24]:24s} E={o['E']:.0f}px  skull top {o['top']:+.2f}E  "
              f"silhouette bottom {o['bot']:+.2f}E  "
              f"width at pupil line {we[1] - we[0]:.2f}E ({we[0]:+.2f}..{we[1]:+.2f})"
              if we else f"{o['name'][:24]:24s} E={o['E']:.0f}px  no pupil-line row")


if __name__ == '__main__':
    main()
