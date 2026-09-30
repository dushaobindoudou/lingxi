"""v6 -- where does a pose sink through the floor, and what part is it?

`v6_clip_review.py` reports that five clips put geometry below the standing sole, but "the
lowest vertex is -166 mm" does not say what to change: raising the root lifts the whole cat,
which fixes a sunken FLANK and leaves a sunken PAW exactly where it was (the paw is placed
by IK against a world-space target, so it does not move with the root).

So this prints the lowest vertex's own coordinates. A lowest point near the belly (y around
0, z low) is the body and wants the root raised; one near a paw (y -0.3 for the front, +0.25
for the rear) is the leg solution and wants the foot target changed instead.

It also sweeps the root offset, because the lowest point moves linearly with a pure
translation: the sweep is only there to confirm that linearity and to give the exact number
to put in build_lingxi_v5.py.

  Blender --background <blend> --python v6_ground_calib.py
"""
import bpy
import json
import os
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('LINGXI_OUT', ROOT / 'assets/characters/lingxi/v6/round-b4'))
CLIPS = [c for c in os.environ.get('V6_CALIB_CLIPS', 'LieDown,SideLie,Sleep,Lick,Stretch').split(',') if c]

s = bpy.context.scene
rig = next(o for o in s.objects if o.type == 'ARMATURE')
PARTS = [o.name for o in s.objects
         if o.type == 'MESH' and o.name.startswith('LX_') and not o.hide_render
         and not any(k in o.name for k in ('Fur', 'Whisker', 'Brow', 'Furnish', 'Claw'))]


def lowest():
    """(z, x, y, owner) of the character's lowest vertex."""
    best = None
    for nm in PARTS:
        o = bpy.data.objects[nm]
        ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        me.transform(ev.matrix_world)
        for v in me.vertices:
            if best is None or v.co.z < best[0]:
                best = (v.co.z, v.co.x, v.co.y, nm)
        ev.to_mesh_clear()
    return best


manifest = json.loads((OUT / 'animations.json').read_text())
report = []
for clip in manifest:
    if clip['name'] not in CLIPS:
        continue
    # the clips are baked as NLA strips over actions named LX_<clip>
    act = bpy.data.actions.get('LX_' + clip['name']) or bpy.data.actions.get(clip['name'])
    if act is None:
        print('no action for', clip['name'], '| have:', [a.name for a in bpy.data.actions][:20])
        continue
    rig.animation_data.action = act
    mid = (clip['start'] + clip['end']) // 2
    s.frame_set(mid)
    bpy.context.view_layer.update()
    z, x, y, owner = lowest()
    row = {'clip': clip['name'], 'frame': mid, 'lowest_mm': round(1000 * z, 1),
           'at_x_mm': round(1000 * x, 1), 'at_y_mm': round(1000 * y, 1), 'owner': owner,
           'root_location_y': round(rig.pose.bones['Root'].location.y, 4)}
    # sweep: lift the root and confirm the floor error closes linearly
    base = rig.pose.bones['Root'].location.y
    sweep = []
    for add in (0.0, 0.05, 0.10, 0.15, 0.20, 0.25):
        rig.pose.bones['Root'].location.y = base + add
        bpy.context.view_layer.update()
        # how high the body sits once the lowest point is on the floor: a side-lying cat
        # whose pelvis ends up half a metre in the air has not rolled, it has been hoisted
        sweep.append([round(1000 * add, 1), round(1000 * lowest()[0], 1),
                      round(1000 * (rig.matrix_world @ rig.pose.bones['Pelvis'].head).z, 1)])
    rig.pose.bones['Root'].location.y = base
    bpy.context.view_layer.update()
    row['lift_sweep_mm'] = sweep
    # translate the sweep into the offset that lands the lowest vertex on the floor
    if sweep[0][1] < 0:
        row['root_lift_needed_mm'] = round(-sweep[0][1], 1)
    report.append(row)

print(json.dumps(report, ensure_ascii=False, indent=1))
