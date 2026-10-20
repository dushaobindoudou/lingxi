#!/usr/bin/env python3
"""v6 -- what object is visible at each point of the face? Print it as a character map.

The other v6 tools measure the *rendered pixels* (colour, pink, darkness). When a patch is
wrong, the next question is always "which object is that?", and with no image input there is no
way to point at it. This answers from the geometry side: it rebuilds the same face camera
v6_render_views.py uses, then for every cell of the E grid fires a ray from the camera through
that anatomical point and reports the first object it hits.

So the map and the render share one grid, and a pink blob seen at (x, dy) in the render can be
read straight off as a letter here.

  Blender --background <blend> --python v6_ray_map.py
  V6_SPAN=-0.55,0.55,0.10,1.05   V6_COLS=44 V6_ROWS=22
  V6_HIDE=LX_Tongue,LX_MouthFloor   also hide from the cast (to see what is behind them)
"""
import bpy
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SPAN = [float(v) for v in os.environ.get('V6_SPAN', '-0.55,0.55,0.10,1.05').split(',')]
COLS = int(os.environ.get('V6_COLS', '44'))
ROWS = int(os.environ.get('V6_ROWS', '22'))
RES = float(os.environ.get('V6_RES', '640'))
EYE_PX = float(os.environ.get('V6_FACE_E_PX', '220'))
FOCAL = float(os.environ.get('V6_FOCAL', '85'))
SENSOR = 36.0
MARGIN = float(os.environ.get('V6_MARGIN', '1.10'))
HIDE = [p for p in os.environ.get('V6_HIDE', '').split(',') if p]

s = bpy.context.scene
rig = bpy.data.objects.get('LX_Rig')
pts = [rig.matrix_world @ rig.pose.bones[b].head for b in ('Eye.L', 'Eye.R')]
eye_c = (pts[0] + pts[1]) * .5
E = (pts[0] - pts[1]).length
E = (pts[0] - pts[1]).length
print(f'V6_RAYMAP eye mid {tuple(round(v, 4) for v in eye_c)}  E {E:.5f} m')

# The face camera, identical to v6_render_views.py: stand off along -Y far enough that the
# pupil separation lands on EYE_PX pixels of a RES-wide square frame.
want = E * RES / EYE_PX
dist = want * FOCAL / SENSOR
cam = s.camera
cam.data.type = 'PERSP'
cam.data.angle = 2 * __import__('math').atan(SENSOR / 2 / FOCAL)
cam.data.dof.use_dof = False
cam.location = Vector(eye_c) + Vector((0, -1, 0.0)) * dist
cam.rotation_euler = (Vector(eye_c) - cam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()

deps = bpy.context.evaluated_depsgraph_get()
deps.update()


def hidden(o):
    return o.hide_render or (o.name.startswith(tuple(HIDE)) if HIDE else False)


def first_hit(p):
    """First render-visible object along camera -> p, skipping hidden ones."""
    origin = Vector(cam.location)
    direction = (p - origin).normalized()
    best = None
    # scene.ray_cast returns only the closest hit, so walk forward: cast from just past each
    # hit until nothing visible is left. Bounded because the mouth has at most a few layers.
    start = origin
    for _ in range(8):
        res = s.ray_cast(deps, start + direction * 1e-5, direction * 10.0)
        hit_ok, loc, _n, _i, obj, _m = res
        if not hit_ok or obj is None:
            return best
        if not hidden(obj):
            return obj
        best = best or obj
        start = Vector(loc)
    return best


keys = []


def key_of(name):
    for n, k in keys:
        if name == n:
            return k
    # a fresh letter per distinct object, in the order encountered
    import string
    k = string.ascii_letters[len(keys) % len(string.ascii_letters)]
    keys.append((name, k))
    return k


x0, x1, y0, y1 = SPAN
print(f'V6_RAYMAP span x {x0:+.2f}..{x1:+.2f}  dy {y0:+.2f}..{y1:+.2f} E   '
      f'({"hiding " + ",".join(HIDE) if HIDE else "nothing hidden"})')
rows = []
for j in range(ROWS):
    dy = y0 + (y1 - y0) * j / (ROWS - 1)
    line = ''
    for i in range(COLS):
        x = x0 + (x1 - x0) * i / (COLS - 1)
        p = eye_c + Vector((x * E, 0.0, -dy * E))
        obj = first_hit(p)
        line += key_of(obj.name) if obj is not None else '.'
    yy = dy
    rows.append((yy, line))

for yy, line in rows:
    print(f'  {yy:+.2f} |{line}|')
print('  legend')
for n, k in keys:
    o = bpy.data.objects.get(n)
    print(f'   {k} = {n:24s} {"HIDDEN-FROM-RENDER" if o and o.hide_render else ""}')
