"""Pupil and iris size relative to the pupil spacing E, catchlights included.

Why this exists: v6_face_shape.py sizes a pupil by the radius of the largest circle that fits in
its dark region (a distance-transform peak). The reference photograph has big catchlights INSIDE
its pupils, which bite into that circle, so it read .194E - while the render, with small
catchlights, read its full pupil. On that biased comparison the eyes were shrunk to EYE_R .66,
and the cat lost the big round eyes the reference actually has (pupil ~.28E, iris ~.44E).

Here the dark region is hole-filled first (a catchlight is part of the pupil), sized by its
area, and searched only in a window around each eye so it cannot leak into dark fur.

usage: v6_eye_size.py IMAGE [--eyes x1,y1,x2,y2]   (eyes default: the two largest dark blobs)
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage

IRIS_SAT_DROP = 0.35  # the iris ends where the ring stops being darker than the surround


def eye_centres(lum):
    dark = ndimage.binary_fill_holes(ndimage.binary_opening(lum < 50, iterations=2))
    lab, n = ndimage.label(dark)
    blobs = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if len(xs) < 200:
            continue
        bw, bh = np.ptp(xs) + 1, np.ptp(ys) + 1
        if 0.5 < bw / bh < 2:
            blobs.append((len(xs), xs.mean(), ys.mean()))
    blobs.sort(reverse=True)
    return sorted([(b[1], b[2]) for b in blobs[:2]])


def measure(path, eyes=None):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float)
    lum = im.mean(axis=2)
    eyes = eyes or eye_centres(lum)
    (x1, y1), (x2, y2) = eyes
    E = float(np.hypot(x2 - x1, y2 - y1))
    win = int(E * 0.35)
    pupils, irises = [], []
    for xc, yc in eyes:
        x0, y0 = int(xc) - win, int(yc) - win
        patch = lum[max(y0, 0):int(yc) + win, max(x0, 0):int(xc) + win]
        # Relative, not absolute: a rendered pupil under a glossy cornea sits at lum ~55, a
        # photographed one at ~15. "Darkest third of this eye's range" finds both.
        lo, mid = np.percentile(patch, 1), np.median(patch)
        core = ndimage.binary_fill_holes(patch < lo + 0.33 * (mid - lo))
        lab, _ = ndimage.label(core)
        cy, cx = int(yc) - max(y0, 0), int(xc) - max(x0, 0)
        region = lab == lab[cy, cx] if lab[cy, cx] else np.zeros_like(core)
        pupils.append(2 * np.sqrt(region.sum() / np.pi))
        # Iris: the radial luminance profile from the pupil edge outward, averaged over angles;
        # the iris is the band that stays darker than the fur beyond it.
        rs = np.arange(1, win)
        prof = []
        for r in rs:
            angles = np.linspace(0, 2 * np.pi, 72, endpoint=False)
            xs = np.clip((cx + r * np.cos(angles)).astype(int), 0, patch.shape[1] - 1)
            ys = np.clip((cy + r * np.sin(angles)).astype(int), 0, patch.shape[0] - 1)
            prof.append(np.median(patch[ys, xs]))
        prof = np.array(prof)
        fur = np.median(prof[-8:])
        edge = np.argmax(np.gradient(prof)[int(pupils[-1] / 2):]) + int(pupils[-1] / 2)
        irises.append(2 * rs[edge])
    p, i = float(np.mean(pupils)), float(np.mean(irises))
    return {'E_px': round(E), 'pupil_d': round(p / E, 3), 'iris_d': round(i / E, 3), 'pupil_to_iris': round(p / i, 2)}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('--eyes', help='x1,y1,x2,y2 pupil centres, if auto-detection picks wrong blobs')
    args = ap.parse_args()
    eyes = None
    if args.eyes:
        v = [float(x) for x in args.eyes.split(',')]
        eyes = [(v[0], v[1]), (v[2], v[3])]
    for path in args.images:
        print(path.rsplit('/', 1)[-1], measure(path, eyes))
