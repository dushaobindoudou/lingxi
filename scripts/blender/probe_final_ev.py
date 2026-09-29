"""Final exposure pick, measured against the reference turnaround.

Coat median after the linear-palette fix landed on 167/255 against the reference's
193/255, so the whole frame just needs lifting. Probes at 480px/16 samples and
metrics_render.py picks the one closest to the reference.
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

for ev in (-0.15, -0.35, -0.55):
    s.view_settings.exposure = ev
    s.render.filepath = str(OUT / f'ev{ev}.png')
    bpy.ops.render.render(write_still=True)

print('EV PROBE DONE')
