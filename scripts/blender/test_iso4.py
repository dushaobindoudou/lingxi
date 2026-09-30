"""Definitive isolation: render each object class alone.
A) only curves  B) only skin  C) only fur sources  D) only everything-else
Also prints every curve object's material + the strand material's node graph shape.
"""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parents[2] / 'assets/characters/lingxi/v5'
s = bpy.context.scene

cam = bpy.data.objects['Portrait']
target = Vector((0, -.03, .37))
direction = (cam.location - target).normalized()
cam.location = target + direction * 2.45
cam.data.dof.focus_distance = (cam.location - target).length
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
s.render.resolution_x = 320
s.render.resolution_y = 320
s.cycles.samples = 8
s.view_settings.exposure = -1.0

curves = [o for o in s.objects if o.type == 'CURVES']
skin = [o for o in s.objects if o.type == 'MESH' and o.name.startswith(('LX_Body', 'LX_Head', 'LX_Jaw', 'LX_Tail'))]
fursrc = [o for o in s.objects if o.type == 'MESH' and o.name.startswith('LX_Fur_')]
rest = [o for o in s.objects if o.type == 'MESH' and o not in skin and o not in fursrc]

for c in curves:
    print('CURVE', c.name, 'mat', [m.name if m else None for m in c.data.materials], 'hide', c.hide_render)

all_objs = [o for o in s.objects]
for o in all_objs:
    o.hide_render = True

def show(objs):
    for o in objs:
        o.hide_render = False

show(curves)
s.render.filepath = str(OUT / 'isoA_curves.png')
bpy.ops.render.render(write_still=True)

show(curves); show(skin)
s.render.filepath = str(OUT / 'isoB_curves_skin.png')
bpy.ops.render.render(write_still=True)

for o in curves: o.hide_render = True
show(skin)
s.render.filepath = str(OUT / 'isoC_skin.png')
bpy.ops.render.render(write_still=True)

# restore full visibility (fur sources stay hidden - that is now the intended state)
for o in all_objs: o.hide_render = False
for o in fursrc: o.hide_render = True
print('ISO4 DONE')
