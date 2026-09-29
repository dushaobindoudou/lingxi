"""Render a background plate (every cat part hidden) so coat metrics can be
computed by differencing instead of guessing which pixels are backdrop."""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path('/Users/liepin/workspace/lingxi/assets/characters/lingxi/v5')
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
s.view_settings.exposure = 0.0

for o in s.objects:
    if o.name.startswith('LX_'):
        o.hide_render = True
s.render.filepath = str(OUT / 'plate.png')
bpy.ops.render.render(write_still=True)
for o in s.objects:
    if o.name.startswith('LX_'):
        o.hide_render = False
for o in s.objects:
    if o.name.startswith('LX_Fur_') and o.type == 'MESH':
        o.hide_render = True
print('PLATE DONE')
