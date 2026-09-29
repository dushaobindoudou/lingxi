"""Gamma-correct the authored coat colours (display -> linear) on every place
the pattern lives, then render a proof.

The palette in build_lingxi_v5.py is authored as display-space values but written
raw into FLOAT_COLOR attributes, which Cycles reads as linear - so .47 dark stripes
rendered like .75 light fur and the whole cat washed out. pow(2.2) restores them.
Applies to: curves coat_color, fur-source fur_color, and the skin corner fur_color.
"""
import bpy, numpy as np
from pathlib import Path
from mathutils import Vector

OUT = Path('/Users/liepin/workspace/lingxi/assets/characters/lingxi/v5')
s = bpy.context.scene

def sock(node, name, io='inputs'):
    return next(i for i in getattr(node, io) if i.name == name)

def fix(datablock, attr_name):
    a = datablock.attributes.get(attr_name)
    if a is None:
        return 0
    n = len(a.data)
    arr = np.empty(n * 4, dtype='f')
    a.data.foreach_get('color', arr)
    c = arr.reshape(-1, 4)
    c[:, :3] = np.power(np.clip(c[:, :3], 0, 1), 2.2)
    a.data.foreach_set('color', c.astype('f').ravel())
    return n

total = 0
for ob in s.objects:
    if ob.type == 'CURVES' and ob.name.startswith('LX_RenderFur_'):
        total += fix(ob.data, 'coat_color')
    elif ob.type == 'MESH' and ob.name.startswith(('LX_Fur_', 'LX_Body', 'LX_Head', 'LX_Tail')):
        total += fix(ob.data, 'fur_color')
print('gamma-corrected attributes, points total:', total)

cam = bpy.data.objects['Portrait']
target = Vector((0, -.03, .37))
direction = (cam.location - target).normalized()
cam.location = target + direction * 2.45
cam.data.dof.focus_distance = (cam.location - target).length
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
s.render.resolution_x = 320
s.render.resolution_y = 320
s.cycles.samples = 8

for ev in (-0.3, -0.7):
    s.view_settings.exposure = ev
    s.render.filepath = str(OUT / f'gamma_ev{ev}.png')
    bpy.ops.render.render(write_still=True)

print('GAMMA TEST DONE')
