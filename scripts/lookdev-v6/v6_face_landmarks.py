#!/usr/bin/env python3
"""v6 -- pupil/nose landmarks, normalised by the pupil separation.

Why this exists: the silhouette-normalised probe (v6_probe_gap.py) and the eye-aligned
overlay (v6_face_overlay.py) both assume the reviewer can *look* at the result. This one is
meant to be read as numbers, because the face proportions have to be judged even when nobody
can see the frame.

The one landmark pair that survives a change of framing, lens, crop and species is the two
pupils: they are large, near-black, nearly circular, and always horizontally paired. So every
number here is a ratio to the pupil separation E:

    pupil_d        pupil diameter / E
    nose_w,h       nose blob width, height / E
    nose_dx,dy     nose centre minus pupil midpoint, / E  (dy positive = below the pupils)
    eye_to_nose    pupil midpoint to nose centre / E

Pupils are found by distance transform rather than by thresholding blobs: a pupil is the
point whose distance to the nearest non-dark pixel is maximal, which gives both its centre
and its radius without any assumption about the eyelid or the fur around it.

  python v6_face_landmarks.py IMG [IMG...] [--dir marked/] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi


def subject(path):
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
    mask = ndi.binary_fill_holes(mask)
    return arr, mask


def pupils(arr, mask, dark_max=76.0, peak=0.42):
    """Two horizonally-paired near-black discs, found as distance-transform peaks."""
    luma = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    # Erode the mask a little: a pupil never touches the silhouette edge, and the background
    # ring would otherwise supply an infinite-distance plateau.
    dark = mask & (luma < dark_max)
    dark = ndi.binary_opening(dark, np.ones((3, 3)))
    dt = ndi.distance_transform_edt(dark)
    if dt.max() < 4:
        return []
    cand = dt >= max(dt.max() * peak, 4.0)
    lab, n = ndi.label(cand)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if ys.size < 6:
            continue
        r = float(dt[ys, xs].max())
        out.append({'x': float(xs.mean()), 'y': float(ys.mean()), 'r': r,
                    'area': int(ys.size)})
    out.sort(key=lambda b: -b['r'])
    # Keep the two largest that are a plausible pair: one each side of the mask's x centre and
    # roughly level. If the top few are all one side (a nostril, a shadow), this rejects them.
    ys, xs = np.where(mask)
    xc = float(xs.mean())
    picks = []
    for side in (-1, 1):
        pool = [b for b in out if (('x' in b) and np.sign(b['x'] - xc) == side)]
        if not pool:
            continue
        best = pool[0]
        if picks and abs(best['y'] - picks[0]['y']) > 0.45 * best['r']:
            # try the next one, level enough with the first pick
            level = [b for b in pool if abs(b['y'] - picks[0]['y']) <= 0.30 * b['r']]
            if level:
                best = level[0]
        picks.append(best)
    if len(picks) != 2:
        return []
    picks.sort(key=lambda b: b['x'])
    return picks


def nose(arr, mask, eyes, pink_delta=26.0):
    """The pinkest compact blob between and below the pupils."""
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    pink = mask & (r - np.maximum(g, b) > pink_delta) & (r > 105)
    if not pink.any():
        return None
    ex = 0.5 * (eyes[0]['x'] + eyes[1]['x'])
    ey = 0.5 * (eyes[0]['y'] + eyes[1]['y'])
    E = float(np.hypot(eyes[1]['x'] - eyes[0]['x'], eyes[1]['y'] - eyes[0]['y']))
    lab, n = ndi.label(pink)
    best = None
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        a = ys.size
        if a < max(24, (E * 0.07) ** 2):
            continue
        cx, cy = float(xs.mean()), float(ys.mean())
        dx, dy = (cx - ex) / E, (cy - ey) / E
        # the nose sits just below and centred between the pupils
        if not (0.05 <= dy <= 1.2) or abs(dx) > 0.45:
            continue
        w = float(xs.max() - xs.min() + 1)
        h = float(ys.max() - ys.min() + 1)
        solid = a / max(w * h, 1)
        if solid < 0.35:
            continue
        score = a * solid * np.exp(-(dx / 0.25) ** 2) * np.exp(-((dy - 0.42) / 0.35) ** 2)
        if best is None or score > best['score']:
            best = {'w': w / E, 'h': h / E, 'dx': dx, 'dy': dy, 'solid': solid,
                    'area': int(a), 'score': score, 'cx': cx, 'cy': cy, 'bbox': None,
                    'px': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]}
    return best


def measure(path):
    arr, mask = subject(path)
    eyes = pupils(arr, mask)
    if len(eyes) != 2:
        return {'path': path, 'ok': False, 'reason': f'pupils: found {len(eyes)}'}
    E = float(np.hypot(eyes[1]['x'] - eyes[0]['x'], eyes[1]['y'] - eyes[0]['y']))
    ys, xs = np.where(mask)
    ex = 0.5 * (eyes[0]['x'] + eyes[1]['x'])
    ey = 0.5 * (eyes[0]['y'] + eyes[1]['y'])
    nz = nose(arr, mask, eyes)
    row = {
        'path': path, 'ok': True,
        'image': [arr.shape[1], arr.shape[0]],
        'subject_px': [int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
        'eye_sep_px': round(E, 2),
        'pupil_r_px': [round(b['r'], 2) for b in eyes],
        'pupil_d': [round(2 * b['r'] / E, 4) for b in eyes],
        'pupil_cy_dy': round((eyes[1]['y'] - eyes[0]['y']) / E, 4),
        'nose': None,
        'arr': arr, 'mask': mask, 'eyes': eyes, 'nose_px': nz,
    }
    if nz:
        row['nose'] = {k: (round(v, 4) if isinstance(v, float) else v)
                       for k, v in nz.items() if k not in ('score',)}
        row['nose']['d'] = round(float(np.hypot(nz['cx'] - ex, nz['cy'] - ey)) / E, 4)
        row['nose']['rel_eye_sep'] = round(float(nz['w']) / 1.0, 4)
    return row


def draw(row, out_path):
    im = Image.open(row['path']).convert('RGB')
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', max(15, im.height // 55))
    except OSError:
        f = ImageFont.load_default()
    for i, b in enumerate(row['eyes']):
        r = b['r']
        d.ellipse([b['x'] - r, b['y'] - r, b['x'] + r, b['y'] + r], outline=(255, 40, 40), width=3)
        d.text((b['x'] - r, b['y'] - r - 20), f"P{i} r{r:.0f}", fill=(255, 40, 40), font=f)
    if row['nose_px']:
        x0, y0, x1, y1 = row['nose_px']['px']
        d.rectangle([x0, y0, x1, y1], outline=(0, 190, 255), width=3)
        d.text((x0, y1 + 4), f"N w{row['nose']['w']:.2f} h{row['nose']['h']:.2f}",
               fill=(0, 190, 255), font=f)
    e0, e1 = row['eyes']
    d.line([e0['x'], e0['y'], e1['x'], e1['y']], fill=(255, 255, 0), width=2)
    im.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('--dir')
    ap.add_argument('--json')
    a = ap.parse_args()
    rows = []
    print(f"{'image':38s} {'E px':>7s} {'pupil_d':>16s} {'nose w/h':>13s} {'nose dx,dy':>13s}")
    for p in a.images:
        r = measure(p)
        if not r['ok']:
            print(f"{os.path.basename(p):38s} FAILED  {r['reason']}")
            rows.append(r)
            continue
        pd = ' '.join(f'{v:.3f}' for v in r['pupil_d'])
        if r['nose']:
            nw = f"{r['nose']['w']:.3f}/{r['nose']['h']:.3f}"
            nd = f"{r['nose']['dx']:+.3f},{r['nose']['dy']:+.3f}"
        else:
            nw = nd = '--'
        print(f"{os.path.basename(p):38s} {r['eye_sep_px']:7.1f} {pd:>16s} {nw:>13s} {nd:>13s}")
        if a.dir:
            os.makedirs(a.dir, exist_ok=True)
            draw(r, os.path.join(a.dir, os.path.basename(p).replace('.png', '.lm.png')))
        rows.append({k: v for k, v in r.items() if k not in ('arr', 'mask', 'eyes', 'nose_px')})
    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(rows, fh, indent=1)
        print('wrote', a.json)


if __name__ == '__main__':
    main()
