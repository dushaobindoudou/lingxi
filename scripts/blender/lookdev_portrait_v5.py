"""Fast look-development probes for the over-exposed portrait.

Loads the finished .blend (curves already converted) and renders four cheap
variants: exposure x framing. 480px / 16 samples keeps each pass under ~2GB so
this is safe to run alongside a busy desktop.  Output: lookdev_*.png next to
the blend file.
"""
import bpy, math
from mathutils import Vector
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'assets/characters/lingxi/v5'
s = bpy.context.scene

def set_exposure(ev):
    s.view_settings.exposure = ev

def fullbody_camera():
    cam = bpy.data.objects['Portrait']
    d = cam.data
    target = Vector((0, -.03, .37))
    direction = (Vector((.62, -1.35, .62)) - target).normalized()
    cam.location = target + direction * 2.45
    d.dof.focus_distance = (cam.location - target).length
    aim = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.rotation_euler = aim

s.render.resolution_x = 480
s.render.resolution_y = 480
s.cycles.samples = 16

for ev in (-1.0, -1.5):
    set_exposure(ev)
    # close-up framing (camera untouched from the saved file)
    s.render.filepath = str(OUT / f'lookdev_close_ev{ev}.png')
    bpy.ops.render.render(write_still=True)
    fullbody_camera()
    s.render.filepath = str(OUT / f'lookdev_full_ev{ev}.png')
    bpy.ops.render.render(write_still=True)
    # restore close-up position for the next exposure round
    cam = bpy.data.objects['Portrait']
    target = Vector((0, -.03, .37))
    cam.location = target + (Vector((.62, -1.35, .62)) - target)
    cam.data.dof.focus_distance = (cam.location - target).length
    aim = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.rotation_euler = aim

print('LOOKDEV DONE')
