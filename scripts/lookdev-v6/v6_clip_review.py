"""v6 -- what each clip actually does, as numbers, at its most expressive frame.

A contact sheet answers "what does this clip look like"; this answers "what did it MOVE",
which is the question behind "the clip does not read". Every clip is reduced to the handful
of signals a viewer actually reads a cat's behaviour from:

  root_z        is it leaving the floor, or dropping to it
  paw heights   which feet are planted, and how high the raised ones come up
  head          pitch / yaw / roll in degrees - the tilt is most of a cat's expression
  jaw           how far the mouth opens
  lids / tongue the face
  tail          how much of the tail is swept
  spread        nose-to-tail length: a stretch lengthens it, a crouch shortens it

and two scores: `departure` (the same one the renderer uses to pick the frame) and
`distance_to_idle` (Euclidean over every bone's rotation, in degrees) - a clip that sits
close to Idle in that space is a clip that looks like Idle.

  Blender --background <blend> --python v6_clip_review.py [--json out.json]
"""
import bpy
import json
import math
import os
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('LINGXI_OUT', ROOT / 'assets/characters/lingxi/v6/round-b4'))
OUT_JSON = os.environ.get('V6_REVIEW_JSON', '')

s = bpy.context.scene
rig = next(o for o in s.objects if o.type == 'ARMATURE')
print('BONES ' + json.dumps(sorted(b.name for b in rig.pose.bones)))


def find(name, *cands):
    for c in cands:
        if c in rig.pose.bones:
            return rig.pose.bones[c]
    for b in rig.pose.bones:                      # fall back on a prefix, e.g. Tail1..Tail5
        if b.name.startswith(name):
            return b
    return None


def departure():
    """Identical to render_lingxi_v5_poses.py's: bone travel plus the face's shape keys."""
    total = 0.0
    for bone in rig.pose.bones:
        total += sum(abs(math.degrees(a)) for a in bone.rotation_euler)
        total += bone.location.length * 400
    for obj in s.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if not keys:
            continue
        total += sum(abs(b.value) * 45 for b in keys.key_blocks[1:]
                     if b.name not in ('Breath', 'Blink'))
    return total


def world(pb, tip=False):
    m = rig.matrix_world @ pb.matrix
    return m.translation if not tip else m @ Vector((0, pb.bone.length, 0))


def measure():
    bpy.context.view_layer.update()
    d = {}
    root = find('Root')
    if root:
        d['root_z_mm'] = round(1000 * world(root).z, 1)
    head = find('Head')
    if head:
        r = head.rotation_euler
        d['head_pitch_deg'] = round(math.degrees(r.x), 1)
        d['head_yaw_deg'] = round(math.degrees(r.y), 1)
        d['head_roll_deg'] = round(math.degrees(r.z), 1)
    jaw = find('Jaw')
    if jaw:
        d['jaw_deg'] = round(math.degrees(jaw.rotation_euler.x), 1)
    # Ears are half of what a cat says with its face - an alert clip that does not move them
    # is a clip that reads as a head tilt and nothing else.
    ear = max((abs(math.degrees(a)) for nm in ('Ear.L', 'Ear.R')
               for a in rig.pose.bones[nm].rotation_euler), default=0.0) \
        if 'Ear.L' in rig.pose.bones else 0.0
    d['ear_deg'] = round(ear, 1)
    paws = {}
    for nm in ('FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R'):
        pb = rig.pose.bones.get(nm)
        if pb:
            paws[nm] = round(1000 * world(pb, tip=True).z, 1)
    d['paw_tip_z_mm'] = paws
    tails = [b.name for b in rig.pose.bones if b.name.lower().startswith('tail')]
    if tails:
        d['tail_deg'] = round(sum(abs(math.degrees(a))
                                  for t in tails for a in rig.pose.bones[t].rotation_euler), 1)
    lids = [b.name for b in rig.pose.bones if 'lid' in b.name.lower()]
    if lids:
        d['lid_deg'] = round(sum(abs(math.degrees(a))
                                 for t in lids for a in rig.pose.bones[t].rotation_euler), 1)
    # nose-to-tail spread: how long the cat is in this frame
    zs = []
    for nm in ('Head',) + tuple(t[-1] for t in [tails] if t):
        pb = rig.pose.bones.get(nm)
        if pb:
            zs.append(world(pb, tip=True))
    if len(zs) == 2:
        d['body_length_mm'] = round(1000 * (zs[0] - zs[1]).length, 1)
    # shape keys that carry meaning
    for obj in s.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if not keys:
            continue
        for b in keys.key_blocks[1:]:
            if b.name in ('Blink', 'Breath', 'Out', 'Extend'):
                d.setdefault('shape_' + b.name, round(max(d.get('shape_' + b.name, 0), b.value), 2))
    return d


# angles of everything, for the distance-to-idle score
def angles():
    v = []
    for b in rig.pose.bones:
        v.extend(math.degrees(a) for a in b.rotation_euler)
    return v


def lowest_point_mm():
    """The character's lowest geometry, to catch a pose that sinks through the floor.

    SideLie and Sleep put one pair of paws at z = -105 mm on the bone, which is 140 mm below
    where a standing paw sits - either the paw is buried in the ground plane or the whole
    body is. Measured on the evaluated meshes, so sculpt and the voxel remesh are included.
    """
    # Real vertices, not bound boxes: a rolled-over body's AABB corner sits far below its
    # actual surface, which reported SideLie as 218 mm "under the floor" when most of that
    # was box inflation. Fur is excluded too - strand control points hang below the sole.
    per_obj = {}
    for o in s.objects:
        if o.type != 'MESH' or not o.name.startswith('LX_') or o.hide_render:
            continue
        if any(k in o.name for k in ('Fur', 'Whisker', 'Brow', 'Furnish', 'Claw')):
            continue
        ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        me.transform(ev.matrix_world)
        if me.vertices:
            per_obj[o.name] = round(1000 * min(v.co.z for v in me.vertices), 1)
        ev.to_mesh_clear()
    if not per_obj:
        return None, {}
    low = sorted(per_obj.items(), key=lambda kv: kv[1])[:3]
    return low[0][1], dict(low)


def scan(clip):
    """Per-paw and per-body travel across the WHOLE clip.

    One frame cannot show a gait: at any instant a walking cat's feet may all be within a
    few millimetres of each other. What distinguishes a walk from a stand is how far each
    paw travels over the cycle, so the range is measured over every frame of the clip.
    """
    pawz = {nm: [] for nm in ('FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R')
            if nm in rig.pose.bones}
    lens = []
    rootp = []
    for frame in range(clip['start'], clip['end'] + 1):
        s.frame_set(frame)
        bpy.context.view_layer.update()
        for nm in pawz:
            pawz[nm].append(1000 * world(rig.pose.bones[nm], tip=True).z)
        tails = [b.name for b in rig.pose.bones if b.name.lower().startswith('tail')]
        h = rig.pose.bones.get('Head')
        t = rig.pose.bones.get(tails[-1]) if tails else None
        if h and t:
            lens.append(1000 * (world(h, tip=True) - world(t, tip=True)).length)
        if 'Root' in rig.pose.bones:
            rootp.append(world(rig.pose.bones['Root']).copy())
    # How far the body travels in 3D, not just vertically: a knead rocks side to side and a
    # lick sinks straight down, and a purely vertical measure scores the rocking as zero.
    rt = 0.0
    if len(rootp) > 1:
        rt = max((a - b).length for a in rootp for b in rootp)
    out = {'paw_travel_mm': {nm: round(max(v) - min(v), 1) for nm, v in pawz.items()},
           'paw_min_mm': {nm: round(min(v), 1) for nm, v in pawz.items()},
           'length_range_mm': round(max(lens) - min(lens), 1) if lens else None,
           'root_travel_mm': round(1000 * rt, 1)}
    return out


manifest = json.loads((OUT / 'animations.json').read_text())
rows = []
for clip in manifest:
    travel = scan(clip)
    best, best_score = clip['start'], -1.0
    for frame in range(clip['start'], clip['end'] + 1):
        s.frame_set(frame)
        bpy.context.view_layer.update()
        sc = departure()
        if sc > best_score:
            best, best_score = frame, sc
    s.frame_set(best)
    bpy.context.view_layer.update()
    row = measure()
    row['lowest_mm'], row['lowest_parts'] = lowest_point_mm()
    row.update(travel)
    row.update({'name': clip['name'], 'frame': best, 'length_frames': clip['end'] - clip['start'] + 1,
                'departure': round(best_score, 1), 'angles': angles()})
    rows.append(row)

idle = next((r for r in rows if r['name'] == 'Idle'), None)

# Distance to Idle in bone-angle space: a clip that lands near Idle here is a clip that
# reads as Idle, whatever its departure score says (departure counts a held pose once,
# this counts how far the whole skeleton has actually travelled).
if idle is not None:
    s.frame_set(idle['frame'])
    bpy.context.view_layer.update()
    ia = angles()
    for r in rows:
        ra = r.pop('angles', None)
        if ra is None:
            continue
        r['distance_to_idle'] = round(math.sqrt(sum((x - y) ** 2 for x, y in zip(ra, ia))), 1)
else:
    for r in rows:
        r.pop('angles', None)

print(json.dumps(rows, ensure_ascii=False, indent=1))
if OUT_JSON:
    Path(OUT_JSON).write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print('wrote', OUT_JSON)
