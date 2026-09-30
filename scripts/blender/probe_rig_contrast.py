"""Does the fill/bounce rig wash the tabby flat?

Coat contrast measures 56/255 against the reference's 74/255. Suspect: Fill (40W)
and Bounce (22W) lift the dark bands. Probes three rigs at the same exposure;
metrics_render.py picks the closest to the reference.
"""
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
s.render.resolution_x = 480
s.render.resolution_y = 480
s.cycles.samples = 16
s.view_settings.exposure = -0.15

def set_light(name, power):
    o = bpy.data.objects.get(name)
    if o and o.data:
        o.data.energy = power

for tag, fill, bounce in [('fill40b22', 40, 22), ('fill25b12', 25, 12), ('fill14b8', 14, 8)]:
    set_light('Fill', fill)
    set_light('Bounce', bounce)
    s.render.filepath = str(OUT / f'rig_{tag}.png')
    bpy.ops.render.render(write_still=True)

set_light('Fill', 40)
set_light('Bounce', 22)
print('RIG PROBE DONE')
