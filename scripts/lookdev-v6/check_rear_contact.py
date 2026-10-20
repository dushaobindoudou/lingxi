"""Report evaluated rear paw clearance at a standing frame.

Usage: Blender -b MODEL.blend --python check_rear_contact.py
Set FRAMES=1,805 to inspect the standing and seated poses (the default).
"""

import os
import sys

import bpy
import numpy as np


scene = bpy.context.scene
rig = bpy.data.objects["LX_Rig"]


def low_points(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", coords)
    ev.to_mesh_clear()
    matrix = np.asarray(ev.matrix_world)
    return coords.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]


clearance_limit = float(os.environ.get("MAX_CLEARANCE_MM", "3"))
floating = []
for frame in (int(part) for part in os.environ.get("FRAMES", "1,805").split(",")):
    scene.frame_set(frame)
    for side in "LR":
        paw = rig.pose.bones[f"RearFoot.{side}"]
        centre = rig.matrix_world @ paw.head
        pieces = []
        for name in [f"LX_RearToe{i}.{side}" for i in range(4)] + [f"LX_RearPad.{side}"]:
            obj = bpy.data.objects.get(name)
            if obj is not None:
                pts = low_points(obj)
                if len(pts):
                    pieces.append((name, round(1000 * float(pts[:, 2].min()), 1)))
        body = low_points(bpy.data.objects["LX_Body"])
        nearby = body[(abs(body[:, 0] - centre.x) < .07) & (abs(body[:, 1] - centre.y) < .10)]
        low_mm = round(1000 * float(nearby[:, 2].min()), 1)
        print("REAR_CONTACT", frame, side, "foot_z_mm", round(1000 * centre.z, 1),
              "body_low_mm", low_mm, "parts", pieces)
        if low_mm > clearance_limit:
            floating.append((frame, side, low_mm))
if floating:
    print("FLOATING_REAR_PAWS", floating)
    sys.exit(1)
