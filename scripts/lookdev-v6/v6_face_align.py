#!/usr/bin/env python3
"""v6 -- scale two faces onto one pupil separation and lay them side by side with a difference.

Proportion is only visible once both faces are the same size, and the pupil pair is the one
landmark that survives crop, lens and species. This scales the render so its pupil separation
matches the reference's, centres both on the pupil midpoint, and writes a three-panel sheet
(reference | render | red-cyan difference).

  python v6_face_align.py REF RENDER --out sheet.png --e-px 220 --crop 2.6
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v6_face_landmarks import subject, pupils  # noqa: E402


def eyes_of(path, e_px=None):
    arr, mask = subject(path)
    e = pupils(arr, mask)
    if len(e) != 2:
        raise SystemExit(f'{path}: pupil detection failed')
    detected = float(np.hypot(e[1]['x'] - e[0]['x'], e[1]['y'] - e[0]['y']))
    E = float(e_px) if e_px else detected
    return (0.5 * (e[0]['x'] + e[1]['x']), 0.5 * (e[0]['y'] + e[1]['y'])), E


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ref')
    ap.add_argument('render')
    ap.add_argument('--out', required=True)
    ap.add_argument('--e-px', type=float, help='the render pupil separation in its own pixels')
    ap.add_argument('--crop', type=float, default=2.4, help='half-width of the frame, in E')
    ap.add_argument('--height', type=int, default=760)
    ap.add_argument('--dy', type=float, default=0.25, help='pupil line, in E from the top')
    a = ap.parse_args()

    e_px = a.e_px
    (rc, rE) = eyes_of(a.ref)
    (cc, cE) = eyes_of(a.render, e_px)
    k = rE / cE                                   # render pixels -> reference pixels

    half_w = a.crop * rE
    h = a.height
    w = int(round(2 * half_w))
    top = a.dy * rE

    panels = []
    for path, (cx, cy), s in ((a.ref, rc, 1.0), (a.render, cc, k)):
        im = Image.open(path).convert('RGB')
        im = im.resize((max(1, int(round(im.width * s))), max(1, int(round(im.height * s)))),
                       Image.LANCZOS)
        x0 = int(round(cx * s - half_w))
        y0 = int(round(cy * s - top))
        canvas = Image.new('RGB', (w, h), (235, 235, 235))
        canvas.paste(im, (-x0, -y0))
        panels.append(canvas)

    g = [np.asarray(p.convert('L')).astype(np.float32) / 255.0 for p in panels]
    ov = np.dstack([g[0], g[1], g[1]])
    diff = Image.fromarray((np.clip(ov, 0, 1) * 255).astype(np.uint8))

    # Guides: the pupil line and the two pupil centres, so the alignment can be checked by eye.
    from PIL import ImageDraw
    for p in panels + [diff]:
        d = ImageDraw.Draw(p)
        d.line([0, top, w, top], fill=(255, 60, 60), width=1)
        for sgn in (-1, 1):
            x = w / 2 + sgn * rE / 2
            d.line([x, top - 12, x, top + 12], fill=(255, 60, 60), width=1)

    sheet = Image.new('RGB', (w * 3 + 24, h), (235, 235, 235))
    for i, p in enumerate(panels + [diff]):
        sheet.paste(p, (i * (w + 12), 0))
    sheet.save(a.out)
    print(f'wrote {a.out}   ref E {rE:.1f}px  render E {cE:.1f}px  scale {k:.4f}  '
          f'frame {2 * a.crop:.2f}E wide')


if __name__ == '__main__':
    main()
