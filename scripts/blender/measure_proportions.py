"""Measure the proportional ratios that decide whether this reads as a cat.

Head length / body length and shoulder height / body length are the two numbers a
viewer judges first: too big a head is "bobblehead", too deep a chest is "barrel".
Real cats sit at head/body 0.25-0.30 and shoulder/body 0.50-0.60. Every time geometry
moves, run this before rendering - the ratio is arithmetic, the render is four minutes.

Usage: blender --background assets/.../lingxi-short-fur-rig-v5.blend \
               --python scripts/blender/measure_proportions.py
"""
import bpy, json
from mathutils import Vector

s = bpy.context.scene


def world_bbox(obj):
    """Axis-aligned bounds in world space after every modifier and the armature."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    me.transform(obj.matrix_world)
    pts = [v.co for v in me.vertices]
    if not pts:
        ev.to_mesh_clear()
        return None
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ev.to_mesh_clear()
    return lo, hi


def size(obj):
    b = world_bbox(obj)
    return None if b is None else b[1] - b[0]


def pick(*names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o:
            return o
    return None


def report(frame):
    s.frame_set(frame)
    bpy.context.view_layer.update()
    body = pick('LX_Body')
    head_parts = [o for o in s.objects
                  if o.type == 'MESH'
                  and o.name.startswith(('LX_Head', 'LX_Nose', 'LX_Muzzle', 'LX_Ear.', 'LX_Jaw'))]
    if body is None or not head_parts:
        print('MEASURE missing: body=%s head_parts=%d' % (body is not None, len(head_parts)))
        return None

    bs = size(body)
    lo, hi = None, None
    for o in head_parts:
        b = world_bbox(o)
        if b is None:
            continue
        lo = b[0] if lo is None else Vector(
            (min(lo.x, b[0].x), min(lo.y, b[0].y), min(lo.z, b[0].z)))
        hi = b[1] if hi is None else Vector(
            (max(hi.x, b[1].x), max(hi.y, b[1].y), max(hi.z, b[1].z)))
    hs = hi - lo

    out = {
        'frame': frame,
        'body': {'length_y': round(bs.y, 4), 'width_x': round(bs.x, 4), 'height_z': round(bs.z, 4)},
        'head': {'length_y': round(hs.y, 4), 'width_x': round(hs.x, 4), 'height_z': round(hs.z, 4)},
        'head_over_body': round(hs.y / bs.y, 3),
        'headwidth_over_bodywidth': round(hs.x / bs.x, 3),
        'shoulder_over_body': round(bs.z / bs.y, 3),
    }
    # Targets for a real cat; a kitten is allowed a little more head than an adult.
    out['target'] = {'head_over_body': '0.25-0.30', 'headwidth_over_bodywidth': '~0.60',
                     'shoulder_over_body': '0.50-0.60'}
    print('MEASURE ' + json.dumps(out))
    return out


if __name__ == '__main__':
    report(1)
