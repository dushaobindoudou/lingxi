"""Round 2 lookdev: push exposure further down (-2.0 / -2.5), full-body framing."""
import bpy
from mathutils import Vector
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'assets/characters/lingxi/v5'
s = bpy.context.scene

cam = bpy.data.objects['Portrait']
target = Vector((0, -.03, .37))
direction = (Vector((.62, -1.35, .62)) - target).normalized()
cam.location = target + direction * 2.45
cam.data.dof.focus_distance = (cam.location - target).length
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

s.render.resolution_x = 480
s.render.resolution_y = 480
s.cycles.samples = 16

for ev in (-2.0, -2.5):
    s.view_settings.exposure = ev
    s.render.filepath = str(OUT / f'lookdev_full_ev{ev}.png')
    bpy.ops.render.render(write_still=True)

print('LOOKDEV2 DONE')
