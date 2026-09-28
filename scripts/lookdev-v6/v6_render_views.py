"""v6 look-dev -- render the views the photographic references are framed in.

Deliberately independent of render_lingxi_v5_poses.py: it must be cheap (one blend open,
three frames, no rebuild) so a look can be judged against the reference in about a minute.
It also removes the "Studio ground" plate, which is what drew the black bar across the
bottom of every review render.

  Blender --background <blend> --python v6_render_views.py
  V6_RES=900 V6_SAMPLES=48 V6_VIEWS=front,face Blender ...
"""
import bpy
import json
import math
import os
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('V6_OUT', ROOT / 'assets/characters/lingxi/v6/look'))
OUT.mkdir(parents=True, exist_ok=True)

RES = int(os.environ.get('V6_RES', '640'))
SAMPLES = int(os.environ.get('V6_SAMPLES', '24'))
VIEWS = [v for v in (os.environ.get('V6_VIEWS', 'front,side,face,threequarter').split(',')) if v]
FOCAL = float(os.environ.get('V6_FOCAL', '85'))          # mm, long enough to keep the face flat
SENSOR = 36.0
MARGIN = float(os.environ.get('V6_MARGIN', '1.10'))      # 1.10 = 10 % air around the subject
BG = float(os.environ.get('V6_BG', '0.548'))             # linear grey == sRGB 195/190/190

s = bpy.context.scene
s.render.resolution_x = s.render.resolution_y = RES
s.cycles.samples = SAMPLES
s.cycles.use_denoising = os.environ.get('V6_DENOISE', '1') not in ('0', 'false', 'no')

# The studio plate is a separate mesh, not part of the character: it is what drew the
# black bar across the bottom of the review renders.
for o in list(s.objects):
    if o.name.lower().startswith('studio ground') or 'ground' in o.name.lower():
        o.hide_render = True
        print(f'v6: hiding plate {o.name!r}')

# Neutral photographic grey, but keep the existing strength so the fill light the world
# provides does not change - only its colour.
w = s.world
node = w.node_tree.nodes['Background']
node.inputs['Color'].default_value = (BG, BG, BG * 0.995, 1.0)


def subject_bounds(prefixes=None):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in s.objects:
        if o.hide_render or o.type not in {'MESH', 'CURVES', 'CURVE'}:
            continue
        if not o.name.startswith('LX_'):
            continue
        if prefixes and not any(o.name.startswith(p) for p in prefixes):
            continue
        ev = o.evaluated_get(deps)
        pts.extend(ev.matrix_world @ Vector(c) for c in ev.bound_box)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def place(cam, centre, cover, direction):
    """Put `cam` back along `direction` far enough to cover `cover` metres with FOCAL."""
    dist = cover * FOCAL / SENSOR * MARGIN
    cam.location = Vector(centre) + Vector(direction).normalized() * dist
    cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat('-Z', 'Y').to_euler()


cam = s.camera
cam.data.type = 'PERSP'
cam.data.angle = 2 * math.atan(SENSOR / 2 / FOCAL)
cam.data.dof.use_dof = False          # a comparison sheet has to be sharp

s.frame_set(1)
bpy.context.view_layer.update()

lo, hi = subject_bounds()
body_c = (lo + hi) * .5
body_cover = max(hi.x - lo.x, hi.z - lo.z) / 1.0

hlo, hhi = subject_bounds(['LX_Head', 'LX_Jaw', 'LX_Ear', 'LX_Nose', 'LX_Eye', 'LX_Fur_guard_LX_Head',
                           'LX_RenderFur_LX_Fur_guard_LX_Head', 'LX_Whisker'])
head_c = (hlo + hhi) * .5
head_cover = max(hhi.x - hlo.x, hhi.z - hlo.z)

VIEW_SPEC = {
    'front':        (body_c, body_cover, (0, -1, 0.0)),
    'side':         (body_c, body_cover, (-1, 0, 0.0)),
    'threequarter': (body_c, body_cover, (-0.72, -0.72, 0.18)),
    'face':         (head_c, head_cover, (0, -1, 0.0)),
    'face34':       (head_c, head_cover, (-0.55, -0.85, 0.10)),
}

done = []
for name in VIEWS:
    if name not in VIEW_SPEC:
        print(f'v6: unknown view {name!r}')
        continue
    c, cover, d = VIEW_SPEC[name]
    place(cam, c, cover, d)
    s.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    done.append({'view': name, 'cam': [round(v, 4) for v in cam.location],
                 'cover_m': round(cover, 4)})

print('V6_VIEWS ' + json.dumps({'res': RES, 'samples': SAMPLES, 'focal': FOCAL,
                                'bounds_body': [[round(v, 4) for v in lo], [round(v, 4) for v in hi]],
                                'bounds_head': [[round(v, 4) for v in hlo], [round(v, 4) for v in hhi]],
                                'rendered': done}, ensure_ascii=False))
