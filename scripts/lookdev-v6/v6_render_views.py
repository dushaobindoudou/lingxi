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

# V6_BALD=1 strips every strand of render fur so the *base geometry* can be judged:
# eye sockets, nose pad, mouth line and muzzle planform are all invisible under a
# 3 cm coat, which is exactly what made the face-proportion review a guessing game.
# The camera framing is still computed with the fur present (see subject_bounds), so a
# bald frame and a furry frame share one composition and can be overlaid directly.
BALD = os.environ.get('V6_BALD', '0') not in ('0', 'false', 'no')
HIDE = [p for p in os.environ.get('V6_HIDE', '').split(',') if p]

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
    elif (BALD and ('Fur' in o.name or 'fur' in o.name)) or any(o.name.startswith(p) for p in HIDE):
        o.hide_render = True
        print(f'v6: hiding fur/skin layer {o.name!r}')

# Neutral photographic grey, but keep the existing strength so the fill light the world
# provides does not change - only its colour.
w = s.world
node = w.node_tree.nodes['Background']
node.inputs['Color'].default_value = (BG, BG, BG * 0.995, 1.0)


def subject_bounds(prefixes=None):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in s.objects:
        # Under BALD the fur is hidden from the render but must still vote on framing,
        # otherwise the bald face would be shot at a different scale than the furry one.
        if (o.hide_render and not BALD) or o.type not in {'MESH', 'CURVES', 'CURVE'}:
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

# --- Face views: pin the frame on the eye pair, not on the bounding box ------------------------
# Deriving the framing from the subject's bounds makes every measurement move when *any*
# geometry moves: enlarging the nose, shortening the jaw or changing the fur all resize the head
# box, so the camera pulls in or back and every ratio to the pupil separation shifts with it.
# That is a measurement artefact, not a change to the face - it turned a run where the eyes had
# not been touched at all into a 27 % swing in pupil separation (174 px -> 127 px).
#
# So for the two face views the frame is defined by the eye pair itself: the camera looks at the
# midpoint of the two Eye bones and stands back far enough that the pupil separation is exactly
# V6_FACE_E_PX wide. E is then a constant of the setup, which is what makes it a usable ruler -
# anything measured against it afterwards can only move because the face moved.
EYE_PX = float(os.environ.get('V6_FACE_E_PX', '220'))     # 0 disables the lock
EYE_BONES = ('Eye.L', 'Eye.R')
rig = bpy.data.objects.get('LX_Rig')
aim_eyes = None
if EYE_PX > 0 and rig is not None:
    pts = [rig.matrix_world @ rig.pose.bones[b].head for b in EYE_BONES
           if b in rig.pose.bones]
    if len(pts) == 2:
        aim_eyes = ((pts[0] + pts[1]) * .5, (pts[0] - pts[1]).length)
        print(f'v6: face views locked on the eye pair, E = {aim_eyes[1]:.4f} m -> {EYE_PX:.0f} px')
if aim_eyes:
    eye_c, eye_sep = aim_eyes
    # place() pads its distance by MARGIN, so the frame covers MARGIN times the cover it is
    # given; divide it out to land the pupil separation on EYE_PX exactly.
    want = eye_sep * RES / EYE_PX
    VIEW_SPEC['face'] = (eye_c, want / MARGIN, (0, -1, 0.0))
    VIEW_SPEC['face34'] = (eye_c, want / MARGIN, (-0.55, -0.85, 0.10))
    print(f'v6: face frame covers {want:.4f} m ({want * 1000 / RES:.3f} mm/px)')

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
