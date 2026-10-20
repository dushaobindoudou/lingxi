#!/usr/bin/env python3
"""v6 -- the face proportions, as a table, against the photographic reference.

v6_face_landmarks.py answers "where are the pupils"; this answers "and how big is everything
else, measured against them". Every number is a ratio to E, the pupil separation, so a
render and a photograph can be compared without knowing either's framing.

Two landmarks, and one trap that set the design of both.

The trap: taking the widest row of pink under the pupils finds, on the reference, a 0.63E
"nose". It is not the nose - it is scattered pink pixels belonging to the whisker pads and the
warm cast on the muzzle fur, whose *extent* is wide but whose *fill* is 13 %. The nose itself is
a solid block (fill ~100 %) about 0.30E wide. So every row is described by both its span and
how much of that span is filled, and only solid rows are allowed to vote. That single change is
the difference between "the nose is nearly twice as wide as the reference" (wrong, and it sent
the model's nose to less than half size) and the measurement below.

  nose   the widest solid row under the eyes, into which are merged the solid rows above and
         below it until the span falls to a third of the peak. The reference's nose leather has
         a soft taper, so its height is the least sharp of these numbers; the width and the
         centre are solid.
  mouth  the widest solid row below the nose.

The cut for "pink" is a fraction of the nose axis's own peak, so it follows each image's own
exposure rather than an absolute value picked for one of them.

The targets are measured on the reference photograph. Exact agreement is not expected - that is
a photograph of a real kitten and this is a render - but the ratios should land within a few
percent.

  python v6_face_shape.py IMG [IMG...] [--json out.json] [-v]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v6_face_landmarks import subject, pupils  # noqa: E402

# The reference photograph, measured by this script on itself, so the reference column reads
# 0.0 % and every other column is "how far from the photograph".
REFERENCE = {
    'pupil_d': 0.194,
    'nose_w': 0.311,
    'nose_h': 0.160,
    'nose_dy': 0.320,
    'mouth_w': 0.288,
    'mouth_dy': 0.630,
    'nose_pink': 115.0,
}
SOLID = 0.55      # a row has to be this filled to describe the nose or the mouth
MIN_COUNT = 10    # and this many pixels wide, so a stray speck cannot vote


def rows(pink, ey, E, cx, hw, thr, lo, hi):
    """Per-row (dy, span, fill, count) of the pink structure inside |x-cx| < hw."""
    out = []
    for k in np.arange(lo, hi, 0.01):
        y = int(round(ey + k * E))
        seg = pink[y - 1:y + 2, cx - hw:cx + hw + 1].max(0)
        m = seg > thr
        n = int(m.sum())
        if n < 2:
            out.append((round(float(k), 3), 0.0, 0.0, n))
            continue
        i = np.where(m)[0]
        span = (i.max() - i.min() + 1) / E
        out.append((round(float(k), 3), span, n / ((i.max() - i.min() + 1)), n))
    return out


def shape(path, win=0.40, rel=0.35, verbose=False, e_px=None):
    arr, mask = subject(path)
    eyes = pupils(arr, mask)
    if len(eyes) != 2:
        return {'path': path, 'ok': False, 'reason': f'pupils: {len(eyes)}'}
    detected = float(np.hypot(eyes[1]['x'] - eyes[0]['x'], eyes[1]['y'] - eyes[0]['y']))
    # E is the denominator of every number below, so an error in it scales the whole table.
    # The pupil detector reads the two dark discs' centroids, and in a furry render the dark
    # region around an eye is not centred on the pupil: it reported 256 px where the geometry
    # says 220. When the render's framing is pinned (V6_FACE_E_PX in v6_render_views.py) the
    # true value is a constant of the setup, so pass it in and do not measure it.
    E = float(e_px) if e_px else detected
    ex = 0.5 * (eyes[0]['x'] + eyes[1]['x'])
    ey = 0.5 * (eyes[0]['y'] + eyes[1]['y'])
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    pink = r - np.maximum(g, b)
    cx, hw = int(round(ex)), int(win * E)

    axis = pink[int(ey + 0.05 * E):int(ey + 0.85 * E), cx].astype(float)
    peak = float(np.percentile(axis, 98))
    thr = rel * peak
    table = rows(pink, ey, E, cx, hw, thr, 0.10, 0.95)
    if verbose:
        print(f'# {os.path.basename(path)}  E={E:.1f}  thr={thr:.0f}  (dy, span, fill, count)')
        for k, s, f, n in table:
            if n:
                print(f'#   {k:+.2f} {s:6.3f} {f:4.2f} {n:5d}')

    solid = [t for t in table if t[3] >= MIN_COUNT and t[2] >= SOLID]
    if not solid:
        return {'path': path, 'ok': False, 'reason': 'no solid pink structure under the pupils'}

    k_at = lambda t: t[0]                      # noqa: E731
    wide = max(solid, key=lambda t: t[1])
    i = solid.index(wide)
    lo = i
    while lo > 0 and solid[lo - 1][1] >= 0.35 * wide[1] and solid[lo - 1][0] >= wide[0] - 0.35:
        lo -= 1
    hi = i
    while hi < len(solid) - 1 and solid[hi + 1][1] >= 0.35 * wide[1] and solid[hi + 1][0] <= wide[0] + 0.35:
        hi += 1
    run = solid[lo:hi + 1]
    nose = {'w': round(float(max(t[1] for t in run)), 3),
            'h': round(float(run[-1][0] - run[0][0]), 3),
            'dy': round(float((run[0][0] + run[-1][0]) / 2), 3),
            'dy_top': run[0][0], 'dy_bot': run[-1][0]}

    below = [t for t in solid if t[0] > nose['dy_bot'] + 0.02]
    mouth = None
    if below:
        w = max(below, key=lambda t: t[1])
        mouth = {'w': round(float(w[1]), 3), 'dy': w[0], 'fill': round(float(w[2]), 2),
                 'n': w[3]}

    return {'path': path, 'ok': True, 'E_px': round(E, 1), 'E_detected': round(detected, 1),
            'pupil_d': round(float(np.mean([2 * e['r'] / E for e in eyes])), 3),
            'nose': nose, 'mouth': mouth, 'nose_pink': round(peak, 0)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('--json')
    ap.add_argument('-v', '--verbose', action='store_true',
                    help='also print the row table each decision was made from')
    ap.add_argument('--e-px', type=float,
                    help='pupil separation in pixels, when it is known from the render setup '
                         'instead of measured (see V6_FACE_E_PX in v6_render_views.py)')
    a = ap.parse_args()

    rows = [shape(p, verbose=a.verbose, e_px=a.e_px) for p in a.images]
    keys = [('pupil_d', 'pupil diameter'), ('nose_w', 'nose width'), ('nose_h', 'nose height'),
            ('nose_dy', 'nose centre dy'), ('mouth_w', 'mouth width'),
            ('mouth_dy', 'mouth centre dy'), ('nose_pink', 'nose pink peak')]

    def value(row, key):
        if not row.get('ok'):
            return None
        if key == 'nose_pink':
            return row['nose_pink']
        if key.startswith('nose_'):
            return row['nose'].get(key[5:])
        if key.startswith('mouth_'):
            return (row.get('mouth') or {}).get(key[6:])
        return row.get(key)

    def label(p):
        # two different face.png files have to stay distinguishable in the header
        return os.path.basename(os.path.dirname(p)) + '/' + os.path.basename(p)

    print(f"{'landmark':17s} {'reference':>10s}  " +
          '  '.join(f'{label(r["path"])[-24:]:>24s}' for r in rows))
    e_used = '  '.join((f'{r["E_px"]:>15.1f} px' if r.get('ok') else f"{'--':>15s}   ") +
                       (f' ({r["E_detected"]:.0f})' if r.get('ok') else '') for r in rows)
    print(f"{'E (detected)':17s} {'--':>10s}  {e_used}")
    for key, lbl in keys:
        cells = []
        for r in rows:
            v = value(r, key)
            if v is None:
                cells.append(f"{'--':>24s}")
            elif key == 'nose_pink':
                cells.append(f'{v:>24.0f}')
            else:
                pct = 100 * (v - REFERENCE[key]) / REFERENCE[key]
                cells.append(f'{v:>16.3f} ({pct:+5.1f}%)')
        print(f'{lbl:17s} {REFERENCE[key]:>10.3f}  ' + '  '.join(cells))
    for r in rows:
        if not r.get('ok'):
            print(f"!! {r['path']}: {r['reason']}")
    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(rows, fh, indent=1)
        print('wrote', a.json)


if __name__ == '__main__':
    main()
