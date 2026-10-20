#!/usr/bin/env python3
"""v6 -- read a face as text.

Reviewing a render against a photograph normally means *looking*. When the reviewer cannot
(no image input, a headless run, a diff in a log), the next best thing is to sample the exact
same region of both images on a common anatomical grid and print it as characters.

The grid is anchored on the pupil pair, so the same cell in the output always means the same
place on the face no matter how the photograph was cropped or what lens shot it. Cells are in
units of E (the pupil separation): x is measured from the pupil midpoint, y from the pupil line
(positive = below, matching the other v6 face tools).

    python v6_ascii_face.py IMG [IMG...]            # luma, dark = @
    python v6_ascii_face.py IMG --channel pink       # r - max(g,b), the nose/mouth red
    python v6_ascii_face.py IMG --span -1.0,1.0,0.55,1.15 --cols 100
"""
from __future__ import annotations

import argparse
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v6_face_landmarks import subject, pupils  # noqa: E402

RAMP_DARK = '@%#*+=-:. '     # darkest first
RAMP_LIGHT = ' .:-=+*#%@'    # brightest first


def grid(arr, eyes, span, cols, rows, e_px=None):
    detected = float(np.hypot(eyes[1]['x'] - eyes[0]['x'], eyes[1]['y'] - eyes[0]['y']))
    E = float(e_px) if e_px else detected
    ex = 0.5 * (eyes[0]['x'] + eyes[1]['x'])
    ey = 0.5 * (eyes[0]['y'] + eyes[1]['y'])
    x0, x1, y0, y1 = (v * E for v in span)
    xs = np.linspace(ex + x0, ex + x1, cols)
    ys = np.linspace(ey + y0, ey + y1, rows)
    xi = np.clip(np.round(xs).astype(int), 0, arr.shape[1] - 1)
    yi = np.clip(np.round(ys).astype(int), 0, arr.shape[0] - 1)
    return arr[np.ix_(yi, xi)], E


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('--span', default=None,
                    help='x0,x1,y0,y1 in units of E (x from pupil midpoint, y below pupil line); '
                         'use --span=... so a leading minus is not read as an option')
    ap.add_argument('--cols', type=int, default=84)
    ap.add_argument('--rows', type=int, default=26)
    ap.add_argument('--channel', default='luma', choices=['luma', 'pink', 'dark'])
    ap.add_argument('--crop', default='full', choices=['full', 'face', 'muzzle'],
                    help='shorthand spans')
    ap.add_argument('--e-px', type=float,
                    help='pupil separation in pixels when it is known from the render setup '
                         '(V6_FACE_E_PX); otherwise it is measured, and on a furry render the '
                         'measurement over-reads by ~16 %, which compresses the whole grid')
    a = ap.parse_args()

    span = {'full': (-1.05, 1.05, -0.55, 1.20),
            'face': (-0.85, 0.85, -0.50, 0.95),
            'muzzle': (-0.55, 0.55, 0.10, 0.95)}[a.crop]
    if a.span:
        span = tuple(float(v) for v in a.span.split(','))

    for p in a.images:
        arr, _ = subject(p)
        eyes = pupils(arr, mask := subject(p)[1])
        if len(eyes) != 2:
            print(f'== {os.path.basename(p)}: pupil detection failed')
            continue
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        chan = {'luma': 0.299 * r + 0.587 * g + 0.114 * b,
                'pink': r - np.maximum(g, b),
                'dark': -np.maximum(r, np.maximum(g, b))}[a.channel]
        tile, E = grid(chan, eyes, span, a.cols, a.rows, a.e_px)
        lo, hi = np.percentile(tile, 2), np.percentile(tile, 98)
        norm = np.clip((tile - lo) / max(hi - lo, 1e-6), 0, 1)
        ramp = RAMP_DARK if a.channel in ('luma', 'dark') else RAMP_LIGHT
        # mark the two pupil centres so the grid can be verified at a glance
        marks = {}
        for i, e in enumerate(eyes):
            cu = (e['x'] - (0.5 * (eyes[0]['x'] + eyes[1]['x']) + span[0] * E)) / ((span[1] - span[0]) * E)
            cv = (e['y'] - (0.5 * (eyes[0]['y'] + eyes[1]['y']) + span[2] * E)) / ((span[3] - span[2]) * E)
            marks[(int(round(cv * (a.rows - 1))), int(round(cu * (a.cols - 1))))] = 'P' if i == 0 else 'Q'
        print(f"== {os.path.basename(p)}   E={E:.1f}px"
              f"{' (pinned)' if a.e_px else ''}  x {span[0]:+.2f}..{span[1]:+.2f}  "
              f"y {span[2]:+.2f}..{span[3]:+.2f}E  channel={a.channel}")
        print("   x-axis: -1E                      0                       +1E")
        for j in range(a.rows):
            line = ''.join(marks.get((j, k), ramp[min(int(norm[j, k] * (len(ramp) - 1) + 0.5),
                                                     len(ramp) - 1)]) for k in range(a.cols))
            yy = span[2] + (span[3] - span[2]) * j / (a.rows - 1)
            print(f'  {yy:+.2f} |{line}|')
        print()


if __name__ == '__main__':
    main()
