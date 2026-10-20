"""Toe clefts on a front paw silhouette (codex ROUND-ZZF-AUDIT #1): the bottom edge per column (lowest opaque pixel), the four toe
bottoms (local lows) and the three clefts between them (highest edge between neighbouring lows); depth = cleft rise above the mean of
its two toes, mm (0.16 m / 1024 px unless MMPX). Usage: python3 this.py image.png [more.png ...]   (alpha or white-on-black mask)"""
import sys, os, numpy as np
from PIL import Image
MMPX = float(os.environ.get('MMPX', 160 / 1024))
def mask(p):
    im = Image.open(p)
    return (np.asarray(im.convert('RGBA'))[:, :, 3] > 128) if im.mode in ('RGBA', 'LA') else (np.asarray(im.convert('L')) > 128)
def valleys(m):
    H, W = m.shape; cols = np.where(m.any(0))[0]; yb = np.full(W, np.nan)
    for c in cols: yb[c] = np.where(m[:, c])[0].max()
    floor = np.nanmax(yb); band = cols[yb[cols] > floor - 120]   # the paw's bottom: columns whose edge is within ~19 mm of the floor
    x0, x1 = band.min(), band.max(); xs = np.arange(x0, x1 + 1); y = np.array([yb[c] if not np.isnan(yb[c]) else floor for c in xs])
    k = max(3, (x1 - x0) // 40); ys = np.convolve(y, np.ones(k) / k, mode='same')   # smooth stray hairs
    order = np.argsort(-ys); lows = []   # the four lowest points at least ~19 mm apart (the toe bottoms), left to right
    for i in order:
        if all(abs(i - j) >= 120 for j in lows): lows.append(int(i))
        if len(lows) == 4: break
    lows.sort()
    out = []
    for a, b in zip(lows, lows[1:]):
        j = a + int(np.argmin(ys[a:b + 1])); depth = (ys[a] + ys[b]) / 2 - ys[j]; out.append(round(depth * MMPX, 1))
    return dict(width_mm=round((x1 - x0) * MMPX, 1), cleft_depths_mm=out, toe_x=[int(xs[i]) for i in lows])
for p in sys.argv[1:]: print(os.path.basename(p), valleys(mask(p)))
