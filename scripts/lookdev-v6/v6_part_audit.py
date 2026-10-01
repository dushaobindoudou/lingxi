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

# --- Closed eyes ----------------------------------------------------------------------------
# The user read round b4b's closed eye as an eye mask with the two lids crossing. Measured on
# the lid meshes themselves, open (Idle's first frame, the resting squint) against shut (the
# middle of Happy, Blink 1), in the eye's own frame - it turns with the head:
#   corner_shift_mm   how far the inner-rim corners move (a real lid hinges at the canthi)
#   margin_stretch    the dark margin's edge (rows 0-1) shut / open: > 1 widens the closed line
#   band_stretch      the whole band, inner rim to outer edge, along the centre column
#   crossing_mm       rays from straight ahead: how far the LOWER lid comes out in front of the
#                     upper where both are hit (the upper is meant to lie over it)
#   closure_*         the upper rim, shut, as height over the eye's centre: the closure line
#   eye_visible_pct   rays inside the eye disc that reach the eye/cornea first, shut
LID_HOW = ('Idle 第 1 帧（睁眼，常驻 squint .14）对 Happy 中帧（Blink 1）；眼的局部坐标（随头转），'
           '拉伸比在关掉 Solidify 的睑面上量，交叉量和露眼比例用带 Solidify 的睑从正前方打射线。')


def clip_frames():
    anim = Path(bpy.data.filepath).with_name('animations.json')
    try:
        clips = {c['name']: c for c in json.loads(anim.read_text())}
        return clips['Idle']['start'], (clips['Happy']['start'] + clips['Happy']['end']) // 2
    except (OSError, KeyError, ValueError):
        return 1, 441


def eye_frame_at(suf):
    """(centre, R) where R maps the rest frame's axes onto the posed head's."""
    hb = rig.pose.bones['Head']
    turn = (rig.matrix_world @ hb.matrix).to_3x3() @ (rig.matrix_world @ hb.bone.matrix_local).to_3x3().inverted()
    return rig.matrix_world @ rig.pose.bones['Eye.' + suf].head, turn


def local_verts(name, c, turn, n=None):
    o = bpy.data.objects[name]
    e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    inv = turn.inverted()
    vs = [inv @ (e.matrix_world @ v.co - c) for v in e.data.vertices]
    return vs[:n] if n else vs


def lid_audit():
    if rig is None or 'Eye.L' not in rig.pose.bones or not bpy.data.objects.get('LX_LidUpper.L'):
        return None
    f_open, f_shut = clip_frames()
    f0 = s.frame_current
    shells = [m for n in ('LidUpper', 'LidLower') for suf in 'LR'
              for m in bpy.data.objects['LX_%s.%s' % (n, suf)].modifiers if m.type == 'SOLIDIFY']
    out = {'frames': {'open': f_open, 'shut': f_shut}, 'how': LID_HOW}
    per = {}
    for suf in 'LR':
        cols = 41
        geo = {}
        for tag, f in (('open', f_open), ('shut', f_shut)):
            for m in shells:
                m.show_viewport = False
            s.frame_set(f)
            bpy.context.view_layer.update()
            c, turn = eye_frame_at(suf)
            geo[tag] = {k: local_verts('LX_Lid%s.%s' % (k, suf), c, turn, cols * 9) for k in ('Upper', 'Lower')}
            if tag == 'open':
                r = max(math.hypot(v.x, v.z) for v in local_verts('LX_Eye.' + suf, c, turn))
        d = {}
        d['corner_shift_mm'] = round(1000 * max((geo['shut'][k][i] - geo['open'][k][i]).length
                                                for k in ('Upper', 'Lower') for i in (0, cols - 1)), 2)

        def edge(vs, i, j):
            return (vs[(j + 1) * cols + i] - vs[j * cols + i]).length
        margin, band = [], []
        for k in ('Upper', 'Lower'):
            o_, s_ = geo['open'][k], geo['shut'][k]
            margin.append(max(edge(s_, i, 0) / edge(o_, i, 0) for i in range(cols)))
            band.append(sum(edge(s_, cols // 2, j) for j in range(8)) / sum(edge(o_, cols // 2, j) for j in range(8)))
        d['margin_stretch'] = round(max(margin), 2)
        d['band_stretch'] = round(max(band), 2)
        d['band_stretch_upper_lower'] = [round(b, 2) for b in band]
        rim = [1000 * v.z for v in geo['shut']['Upper'][:cols]]
        mid = cols // 2
        d['closure_centre_mm'] = round(rim[mid], 2)
        d['closure_corners_mm'] = round(.5 * (rim[0] + rim[-1]), 2)
        d['closure_is_arch'] = all(rim[i + 1] >= rim[i] - .05 for i in range(mid)) and \
            all(rim[i + 1] <= rim[i] + .05 for i in range(mid, cols - 1))
        d['closure_profile_mm'] = [round(rim[i], 1) for i in range(0, cols, 5)]
        d['lower_rim_centre_mm'] = round(1000 * geo['shut']['Lower'][mid].z, 2)
        d['rim_overlap_mm'] = round(d['lower_rim_centre_mm'] - d['closure_centre_mm'], 2)   # + = lower rim tucked behind the upper
        # rays, shells on, eyes shut
        for m in shells:
            m.show_viewport = True
        s.frame_set(f_shut)
        bpy.context.view_layer.update()
        deps_ = bpy.context.evaluated_depsgraph_get()
        c, turn = eye_frame_at(suf)
        trees = {k: bvhtree.BVHTree.FromObject(bpy.data.objects[n], deps_)
                 for k, n in (('U', 'LX_LidUpper.' + suf), ('L', 'LX_LidLower.' + suf),
                              ('E', 'LX_Eye.' + suf), ('C', 'LX_Cornea.' + suf))}
        into = turn @ Vector((0, 1, 0))
        cross, n_cross, n_disc, n_seen = 0.0, 0, 0, 0
        steps = 54
        for a in range(steps + 1):
            for b in range(steps + 1):
                x = (-1.35 + 2.7 * a / steps) * r
                z = (-1.35 + 2.7 * b / steps) * r
                o = c + turn @ Vector((x, -.06, z))
                hit = {k: t.ray_cast(o, into, .2) for k, t in trees.items()}
                # only a FACE of a lid counts, not the 2mm rim of its shell grazed edge-on
                du = hit['U'][3] if hit['U'][0] is not None and abs(hit['U'][1].dot(into)) > .3 else None
                dl = hit['L'][3] if hit['L'][0] is not None and abs(hit['L'][1].dot(into)) > .3 else None
                if du is not None and dl is not None and dl < du:
                    cross = max(cross, du - dl)
                    n_cross += (du - dl) > .0001
                if math.hypot(x, z) < .95 * r:
                    n_disc += 1
                    eye = [hit[k][3] for k in 'EC' if hit[k][0] is not None]
                    lid = [v for v in (du, dl) if v is not None]
                    if eye and (not lid or min(lid) > min(eye)):
                        n_seen += 1
        d['crossing_mm'] = round(1000 * cross, 2)
        d['crossing_rays'] = n_cross
        d['eye_visible_pct'] = round(100.0 * n_seen / max(n_disc, 1), 2)
        d['eye_r_mm'] = round(1000 * r, 1)
        per[suf] = d
    s.frame_set(f0)
    bpy.context.view_layer.update()
    for k in ('corner_shift_mm', 'margin_stretch', 'band_stretch', 'crossing_mm', 'eye_visible_pct'):
        out[k] = max(per[suf][k] for suf in per)
    out['closure_centre_mm'] = min(per[suf]['closure_centre_mm'] for suf in per)
    out['closure_corners_mm'] = max(per[suf]['closure_corners_mm'] for suf in per)
    out['closure_is_arch'] = all(per[suf]['closure_is_arch'] for suf in per)
    out['per_eye'] = per
    out.update({'target_corner': '≈ 0', 'target_margin': '≤ 1.5', 'target_crossing': '0（≤ 1 mm）',
                'target_band': '≤ 1.5（外缘钉死时做不到，见 HANDOFF）', 'target_closure': '0–6 mm，拱形',
                'target_visible': '0'})
    return out


lids = lid_audit()

result = {'paws': paws, 'toe_spread': spread, 'paw_bbox': paw_row,
          'ears': ears, 'head_width_mm': head_w, 'mouth': mouth, 'lids': lids,
          'targets': {'ear': 'comment in build_lingxi_v5.py: 135 mm tall, 112 mm across, w/h .83',
                      'mouth': 'v6_face_shape.py REFERENCE: nose w 0.311E, mouth w 0.288E, '
                               'nose dy +0.320E, mouth dy +0.630E (so lip 0.310E below the nose)'}}
print(json.dumps(result, ensure_ascii=False, indent=1))
if OUT_JSON:
    Path(OUT_JSON).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print('wrote', OUT_JSON)
