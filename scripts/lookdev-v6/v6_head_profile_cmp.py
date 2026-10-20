"""Compare head-profile renders (v6_head_profile.py) row by row against the first: the front edge (first opaque pixel from the left,
median over +-4 rows) at the nose row and at the stop / forehead / chin rows placed from it by codex's ROUND-ZZ-AUDIT readings
(26.7 mm above, 71.8 above, 53.3 below). + = further forward than the first image, mm. Usage: python3 this.py nose_row base.png other.png ..."""
import sys, numpy as np
from PIL import Image
nose = float(sys.argv[1]); paths = sys.argv[2:]; mmpx = 420 / 1024
rows = {'forehead': nose - 71.8 / mmpx, 'stop': nose - 26.7 / mmpx, 'nose': nose, 'chin': nose + 53.3 / mmpx}
def edge(p):
    a = np.asarray(Image.open(p).convert('RGBA'))[:, :, 3] > 128
    out = {}
    for k, r in rows.items():
        xs = [np.argmax(a[y]) for y in range(int(r) - 4, int(r) + 5) if a[y].any()]
        out[k] = float(np.median(xs)) if xs else None
    return out
base = edge(paths[0])
for p in paths:
    e = edge(p); print(p.split('/')[-2] if '/' in p else p, {k: round((base[k] - e[k]) * mmpx, 1) for k in rows})
