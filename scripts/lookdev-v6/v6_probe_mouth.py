#!/usr/bin/env python3
"""v6 -- which object is that patch? Print every part's place on the face, in E units.

A landmark that shows up in a render but not in the model's intent ("there is pink under the
mouth") cannot be blamed on an object by looking at the render, and with no image input it
cannot be looked at at all. This answers it from the other end: for each object, the world-space
bounding box, converted into the same origin the face tools use - the pupil line, with x from the
pupil midpoint and dy positive downward, both in units of the pupil separation E.

Then a patch measured at (x, dy) in the render can be matched to the object that projects there.

  Blender --background <blend> --python v6_probe_mouth.py
  V6_ONLY=muzzle        restrict to the parts near the mouth
"""
import bpy
import json
import os
from mathutils import Vector

ONLY = os.environ.get('V6_ONLY', 'muzzle')

rig = bpy.data.objects.get('LX_Rig')
eyes = [rig.matrix_world @ rig.pose.bones[f'Eye.{s}'].head for s in 'LR']
eye_c = (eyes[0] + eyes[1]) * .5
E = (eyes[0] - eyes[1]).length
print(f'V6_PROBE eye mid {tuple(round(v, 4) for v in eye_c)}  E {E:.5f} m')

# Parts within this distance of the mouth, in metres, when V6_ONLY=muzzle
MOUTH = Vector((0, -.44, .45))
NEAR = 0.13

deps = bpy.context.evaluated_depsgraph_get()
rows = []
for o in bpy.context.scene.objects:
    if o.type not in {'MESH', 'CURVES', 'CURVE'} or not o.name.startswith('LX_'):
        continue
    if ONLY == 'muzzle' and any(k in o.name for k in
                                ('Fur', 'fur', 'Whisker', 'Body', 'Tail', 'Foot', 'Leg',
                                 'Haunch', 'Toe', 'Paw', 'Claw')):
        continue
    ev = o.evaluated_get(deps)
    pts = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) * .5
    if ONLY == 'muzzle' and (c - MOUTH).length > NEAR:
        continue
    rows.append({
        'name': o.name,
        'hidden': bool(o.hide_render),
        'x_E': [round((lo.x - eye_c.x) / E, 3), round((hi.x - eye_c.x) / E, 3)],
        'dy_E': [round((eye_c.z - hi.z) / E, 3), round((eye_c.z - lo.z) / E, 3)],
        'y_mm': [round(lo.y * 1000), round(hi.y * 1000)],
        'z_mm': [round(lo.z * 1000), round(hi.z * 1000)],
        'mat': o.data.materials[0].name if getattr(o.data, 'materials', None) and o.data.materials else None,
    })

rows.sort(key=lambda r: r['dy_E'][0])
print(f"{'object':22s} {'hide':>4s} {'x (E)':>16s} {'dy (E)':>17s} {'y (mm)':>14s}  material")
for r in rows:
    print(f"{r['name']:22s} {str(r['hidden'])[0]:>4s} "
          f"{r['x_E'][0]:>7.3f}..{r['x_E'][1]:<7.3f} "
          f"{r['dy_E'][0]:>7.3f}..{r['dy_E'][1]:<7.3f} "
          f"{r['y_mm'][0]:>6d}..{r['y_mm'][1]:<6d}  {r['mat']}")
print('V6_PROBE ' + json.dumps({'E': round(E, 5), 'objects': len(rows)}, ensure_ascii=False))
