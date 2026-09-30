"""Alignment templates for the painted coat maps (see v5/COAT-MAPS.md).

Each template is a square orthographic projection of the v5 cat in AUTHORED space - the
coordinates fur_color() is evaluated in, before the head is scaled about the neck. A painter
(image model) fills the grey silhouette with the coat; build_lingxi_v5.py samples the result
back through the same frames, so a stripe painted over a landmark lands on that landmark.

Run from the repo root: python3 scripts/blender/make_coat_templates.py
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/characters/lingxi/v5-imagegen-sources/templates'
N = 1024
# Mirrors build_lingxi_v5.py (authored space; cat faces -Y, z up).
HEAD = [((0, -.285, .525), (.165, .147, .156)), ((-.103, -.345, .468), (.075, .084, .068)),
        ((.103, -.345, .468), (.075, .084, .068)), ((-.034, -.405, .462), (.056, .044, .040)),
        ((.034, -.405, .462), (.056, .044, .040))]
BODY = [((0, .045, .235), (.13, .28, .125)), ((0, -.205, .405), (.155, .14, .115)),
        ((0, .075, .305), (.135, .325, .150)), ((0, -.17, .315), (.145, .17, .160)),
        ((0, .28, .312), (.145, .17, .155))]
for s in (-1, 1):
    BODY += [((s*.105, -.17, .25), (.062, .066, .16)), ((s*.108, -.19, .12), (.046, .046, .095)),
             ((s*.108, -.215, .047), (.064, .088, .047)), ((s*.12, .24, .24), (.082, .105, .14)),
             ((s*.12, .30, .12), (.044, .06, .095)), ((s*.12, .245, .046), (.061, .085, .045))]
EYES = [(s*.064, -.416, .523, .039) for s in (-1, 1)]
NOSE = (0, -.443, .486)
MOUTH_Z = .453
# FRAMES: (horizontal axis, its range, vertical axis, its range top->bottom). All square.
FRAMES = {
    'coat_head_front': ('x', (-.21, .21), 'z', (.76, .34)),     # looking at the face
    'coat_head_top':   ('x', (-.21, .21), 'y', (-.04, -.46)),   # from above, nose at the bottom
    'coat_body_top':   ('x', (-.44, .44), 'y', (.48, -.40)),    # from above, head at the bottom
    'coat_body_side':  ('y', (-.40, .48), 'z', (.72, -.16)),    # cat's left side, nose on the left
}
AX = {'x': 0, 'y': 1, 'z': 2}

def to_px(frame, p):
    h, (h0, h1), v, (v0, v1) = frame
    return ((p[AX[h]] - h0) / (h1 - h0) * N, (p[AX[v]] - v0) / (v1 - v0) * N)

def silhouette(frame, parts):
    h, (h0, h1), v, (v0, v1) = frame
    gh = np.linspace(h0, h1, N)[None, :]; gv = np.linspace(v0, v1, N)[:, None]
    m = np.zeros((N, N), bool)
    for c, r in parts:
        m |= ((gh - c[AX[h]]) / r[AX[h]])**2 + ((gv - c[AX[v]]) / r[AX[v]])**2 <= 1
    return m

def ears(frame):
    # ear shell: base centred at x=+-.102, z=.612, tip ~.727, base half-width ~.049
    return [[(s*(.102-.049), -.238, .612), (s*(.126), -.214, .727), (s*(.102+.049), -.238, .612)] for s in (-1, 1)]

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {'size': N, 'space': 'authored (pre head scale), metres, cat faces -Y, z up', 'frames': {}}
    for name, frame in FRAMES.items():
        parts = HEAD if 'head' in name else BODY
        m = silhouette(frame, parts)
        img = np.full((N, N, 3), 255, np.uint8); img[m] = (150, 150, 150)
        im = Image.fromarray(img); d = ImageDraw.Draw(im)
        if name == 'coat_head_front':
            for tri in ears(frame):d.polygon([to_px(frame, p) for p in tri], fill=(150, 150, 150))
            for x, y, z, r in EYES:
                cx, cy = to_px(frame, (x, y, z)); rp = r / .42 * N
                d.ellipse([cx-rp, cy-rp, cx+rp, cy+rp], outline=(220, 0, 0), width=4)
            nx, ny = to_px(frame, NOSE); d.polygon([(nx-18, ny-10), (nx+18, ny-10), (nx, ny+12)], outline=(220, 0, 0), width=4)
            _, my = to_px(frame, (0, 0, MOUTH_Z)); d.line([(nx-40, my), (nx+40, my)], fill=(220, 0, 0), width=3)
        if name == 'coat_head_top':
            for x, y, z, r in EYES:
                cx, cy = to_px(frame, (x, y, z)); d.ellipse([cx-12, cy-12, cx+12, cy+12], outline=(220, 0, 0), width=4)
            for s in (-1, 1):
                a = to_px(frame, (s*.053, -.238, 0)); b = to_px(frame, (s*.151, -.238, 0)); d.line([a, b], fill=(220, 0, 0), width=6)
        if name == 'coat_body_side':
            gy = to_px(frame, (0, 0, 0))[1]; d.line([(0, gy), (N, gy)], fill=(0, 0, 220), width=3)
        im.save(OUT / f'{name}_template.png')
        meta['frames'][name] = {'horizontal': frame[0], 'h_range': frame[1], 'vertical': frame[2], 'v_range_top_to_bottom': frame[3]}
    (OUT / 'frames.json').write_text(json.dumps(meta, indent=2))
    print(json.dumps({'templates': len(FRAMES), 'out': str(OUT)}))

if __name__ == '__main__':
    main()
