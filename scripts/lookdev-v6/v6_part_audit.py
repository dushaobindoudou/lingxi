"""v6 -- measure the three parts the user called out: paws, ears, mouth.

Everything here is read off the BUILT blend (no rebuild), so the numbers are the real
geometry, sagged by sculpting and voxel-remeshing and all - not the authored parameters.
That distinction matters for the paws in particular: the toes are separate objects sitting
on top of the body mesh, and whether a toe is visible is decided by how far it stands PROUD
of the body surface, which no parameter in build_lingxi_v5.py states.

  Blender --background <blend> --python v6_part_audit.py [--json out.json]

Each measurement prints a target next to it. Where a target comes from the script's own
comments (the ear's "135 mm tall, 112 mm across, w/h .83") it is quoted, so a mismatch is
the code disagreeing with itself rather than with a photograph.
"""
import bpy
import json
import math
import os
from mathutils import Vector, bvhtree
from pathlib import Path

OUT_JSON = os.environ.get('V6_AUDIT_JSON', '')
s = bpy.context.scene
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()


def world_bbox(names):
    pts = []
    for n in names:
        o = bpy.data.objects.get(n)
        if o is None:
            continue
        ev = o.evaluated_get(deps)
        pts.extend(ev.matrix_world @ Vector(c) for c in ev.bound_box)
    if not pts:
        return None
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    return lo, hi


def proud_of_body(obj_names, body_name='LX_Body'):
    """How far each object's surface stands outside the body mesh, in mm.

    A toe that is inside the paw ellipsoid is invisible no matter what the coat does, and
    that is the whole question: the coat was already shortened (round C) and the paw still
    read as a pom-pom, which pointed at the geometry rather than at the fur.
    Signed distance by nearest-face normal, sampled over the object's own vertices.
    """
    body = bpy.data.objects.get(body_name)
    if body is None:
        return None
    ev = body.evaluated_get(deps)
    me = ev.to_mesh()
    me.transform(ev.matrix_world)
    tree = bvhtree.BVHTree.FromPolygons([v.co[:] for v in me.vertices],
                                        [p.vertices[:] for p in me.polygons])
    ev.to_mesh_clear()
    report = {}
    for n in obj_names:
        o = bpy.data.objects.get(n)
        if o is None:
            continue
        e = o.evaluated_get(deps)
        m = e.matrix_world
        vals = []
        for v in e.data.vertices:
            p = m @ v.co
            loc, nor, _idx, _d = tree.find_nearest(p)
            if loc is None:
                continue
            # inside is negative: the nearest point's normal points away from the body
            vals.append((p - loc).dot(nor) * 1000.0)      # mm, + = outside
        if not vals:
            continue
        vals.sort()
        outside = [v for v in vals if v > 0]
        report[n] = {
            'max_proud_mm': round(max(vals), 2),
            'p95_proud_mm': round(vals[int(.95 * (len(vals) - 1))], 2),
            'median_proud_mm': round(vals[len(vals) // 2], 2),
            'outside_vertex_pct': round(100.0 * len(outside) / len(vals), 1),
        }
    return report


# --- Paws -----------------------------------------------------------------------------------
# A cat's foot reads as toes because the toes stand proud of the paw's own mass and the
# clefts between them are clear. The pads only show when the foot is lifted, but they have
# to exist below the skin line to show at all.
paws = {}
for pre in ('Front', 'Rear'):
    for suf in ('L', 'R'):
        toes = [f'LX_{pre}Toe{i}.{suf}' for i in range(4)]
        pads = [f'LX_{pre}Pad.{suf}']
        beans = [f'LX_{pre}Bean{i}.{suf}' for i in range(4)]
        claws = [f'LX_{pre}Claw{i}.{suf}' for i in range(4)]
        paws[f'{pre}.{suf}'] = {
            'toes': proud_of_body(toes),
            'pad': proud_of_body(pads),
            'beans': proud_of_body(beans),
            'claws': proud_of_body(claws),
        }
# toe spread: how far apart the four toe centres are, and how wide the row is
spread = {}
for pre in ('Front', 'Rear'):
    centres = []
    for i in range(4):
        o = bpy.data.objects.get(f'LX_{pre}Toe{i}.L')
        if o:
            centres.append(o.matrix_world.translation.x)
    if len(centres) >= 2:
        spread[pre] = {'toe_gap_mm': round(1000 * (max(centres) - min(centres)) / 3, 2),
                       'toe_row_mm': round(1000 * (max(centres) - min(centres)), 2)}
bb = world_bbox([f'LX_FrontToe{i}.L' for i in range(4)])
paw_row = {'front_toe_row_bbox_mm': [round(1000 * v, 1) for v in (bb[1] - bb[0])]} if bb else {}

# --- Ears -----------------------------------------------------------------------------------
# Target quoted from build_lingxi_v5.py's own comment: "A cat ear is a TALL narrow
# triangle: 135 mm tall, 112 mm across the base (w/h .83)".
ears = {}
for suf in ('L', 'R'):
    o = bpy.data.objects.get(f'LX_Ear.{suf}')
    if o is None:
        continue
    e = o.evaluated_get(deps)
    pts = [e.matrix_world @ Vector(v.co) for v in e.data.vertices]
    zs = [p.z for p in pts]
    z0, z1 = min(zs), max(zs)
    height = z1 - z0
    rows = {}
    for p in pts:
        t = (p.z - z0) / height
        k = int(t * 20) / 20.0
        rows.setdefault(round(k, 2), []).append(abs(p.x))
    # Width is the SPAN of the row (max x - min x), not the largest |x|: the ear sits off to
    # one side of the head, so an absolute x measures where it is, not how wide it is.
    prof = {k: round(1000 * (max(v) - min(v)), 1) for k, v in sorted(rows.items()) if v}
    base_w = prof.get(0.0, 0)
    ears[suf] = {
        'height_mm': round(1000 * height, 1),
        'base_width_mm': round(base_w, 1),
        'wh_ratio': round(base_w / (1000 * height), 3) if height else None,
        'tip_width_at_0p9_mm': prof.get(0.9, None),
        'tip_width_at_0p8_mm': prof.get(0.8, None),
        'width_profile_mm': prof,
    }
head_bb = world_bbox(['LX_Head'])
head_w = round(1000 * (head_bb[1].x - head_bb[0].x), 1) if head_bb else None

# --- Mouth ----------------------------------------------------------------------------------
# Ratios to E (pupil separation) are what v6_face_shape.py reports, so the same ruler is
# used here: E is taken from the Eye bones, not detected, exactly as the render pins it.
rig = next((o for o in s.objects if o.type == 'ARMATURE'), None)
E = None
if rig and 'Eye.L' in rig.pose.bones:
    a = rig.matrix_world @ rig.pose.bones['Eye.L'].head
    b = rig.matrix_world @ rig.pose.bones['Eye.R'].head
    E = (a - b).length
mouth = {}
nose = bpy.data.objects.get('LX_Nose')
if nose is not None:
    nb = [nose.matrix_world @ Vector(c) for c in nose.bound_box]
    mouth['nose_width_mm'] = round(1000 * (max(p.x for p in nb) - min(p.x for p in nb)), 1)
    mouth['nose_centre_z'] = round(1000 * (.5 * (max(p.z for p in nb) + min(p.z for p in nb))), 1)
lip_names = [n for n in bpy.data.objects if n.name.startswith('LX_Lip')]
if lip_names:
    lb = world_bbox([n.name for n in lip_names])
    mouth['lip_span_mm'] = round(1000 * (lb[1].x - lb[0].x), 1)
    mouth['lip_centre_z'] = round(1000 * .5 * (lb[0].z + lb[1].z), 1)
if E:
    mouth['E_mm'] = round(1000 * E, 1)
    nw = mouth.get('nose_width_mm')
    ls = mouth.get('lip_span_mm')
    if nw:
        mouth['nose_w_over_E'] = round(nw / (1000 * E), 3)
    if ls:
        mouth['mouth_w_over_E'] = round(ls / (1000 * E), 3)
    if nw and ls:
        mouth['mouth_to_nose_width'] = round(ls / nw, 3)
    # vertical: how far the lip line sits below the nose centre, in E
    if 'nose_centre_z' in mouth and 'lip_centre_z' in mouth:
        d = mouth['nose_centre_z'] - mouth['lip_centre_z']
        mouth['lip_below_nose_mm'] = round(d, 1)
        mouth['lip_below_nose_over_E'] = round(d / (1000 * E), 3)

result = {'paws': paws, 'toe_spread': spread, 'paw_bbox': paw_row,
          'ears': ears, 'head_width_mm': head_w, 'mouth': mouth,
          'targets': {'ear': 'comment in build_lingxi_v5.py: 135 mm tall, 112 mm across, w/h .83',
                      'mouth': 'v6_face_shape.py REFERENCE: nose w 0.311E, mouth w 0.288E, '
                               'nose dy +0.320E, mouth dy +0.630E (so lip 0.310E below the nose)'}}
print(json.dumps(result, ensure_ascii=False, indent=1))
if OUT_JSON:
    Path(OUT_JSON).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print('wrote', OUT_JSON)
