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
import numpy as np
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


def real_points(name):
    """Evaluated vertices of one object in world space, (n, 3) - real geometry, not bound_box."""
    o = bpy.data.objects.get(name)
    if o is None:
        return np.zeros((0, 3))
    e = o.evaluated_get(deps)
    me = e.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype='f')
    me.vertices.foreach_get('co', co)
    e.to_mesh_clear()
    m = np.array(e.matrix_world)
    return co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


# Toe clefts (round i, the user's "four white balls"). The front of the toe row, sampled across x:
# the most forward point (-y) of the four toes' union in a 2.5 mm band at each toe's centre (the
# crown) and half-way between neighbours (the cleft) - v6_g_review.py's ruler, on every paw.
#   cleft_depth_mm      v6_g_review's number: cleft minus the crown on its -x side only. One-sided,
#                       so the outer pair on the +x side scores the INNER toe's crown and reads
#                       as a groove whatever the outer toe does (round h: [-3.8, +5.3, +5.3])
#   cleft_depth_sym_mm  cleft minus the LESS proud of its two crowns: + = a groove both
#                       neighbours stand in front of, - = no groove (the union only steps back)
def toe_clefts(pre, suf):
    pts = [real_points(f'LX_{pre}Toe{i}.{suf}') for i in range(4)]
    if any(not len(p) for p in pts):
        return None
    xs = [float(p[:, 0].mean()) for p in pts]
    allp = np.concatenate(pts)

    def front(x, w=.0025):
        band = allp[np.abs(allp[:, 0] - x) < w, 1]
        return float(band.min()) if len(band) else None
    crown = [front(x) for x in xs]
    cleft = [front(.5 * (xs[i] + xs[i + 1])) for i in range(3)]
    return {
        'toe_crown_front_mm': [round(1000 * c, 1) for c in crown],
        'cleft_front_mm': [round(1000 * c, 1) for c in cleft],
        'cleft_depth_mm': [round(1000 * (cleft[i] - crown[i]), 1) for i in range(3)],
        'cleft_depth_sym_mm': [round(1000 * (cleft[i] - max(crown[i], crown[i + 1])), 1) for i in range(3)],
        'toe_size_mm': [round(1000 * float(v), 1) for v in (pts[1].max(0) - pts[1].min(0))],
    }


clefts = {f'{pre}.{suf}': toe_clefts(pre, suf) for pre in ('Front', 'Rear') for suf in ('L', 'R')}
_sym = [d for c in clefts.values() if c for d in c['cleft_depth_sym_mm']]
clefts['all_grooves'] = bool(_sym) and min(_sym) > 0
clefts['min_sym_mm'] = min(_sym) if _sym else None
clefts['target'] = 'cleft_depth_sym_mm 全部 > 0（每条趾缝都是两侧趾冠之后的沟，没有单调台阶 / 反向鼓包）'


# The coat on the foot and leg, as strand lengths (median, mm) per zone, and how wide the leg's
# coat envelope is - "a thin stick on a snowball": short leg coat under a long body coat.
def strands(name):
    p = real_points(name)
    o = bpy.data.objects.get(name)
    n_pts = int(o.get('strand_points', 6)) if o else 6
    if not len(p):
        return np.zeros((0, n_pts, 3))
    return p.reshape(-1, n_pts, 3)


def coat_audit():
    rig_ = next((o for o in s.objects if o.type == 'ARMATURE'), None)
    if rig_ is None:
        return None
    out = {}
    body = np.concatenate([strands('LX_Fur_guard_LX_Body'), strands('LX_Fur_under_LX_Body'),
                           strands('LX_Fur_guard_LX_Legs')])   # the legs' extra layer (round i on)
    if not len(body):
        return None
    root = body[:, 0]
    blen = np.linalg.norm(np.diff(body, axis=1), axis=2).sum(1)
    med = lambda v: round(1000 * float(np.median(v)), 1) if len(v) else None
    for pre in ('Front', 'Rear'):
        pw = rig_.pose.bones[pre + 'Paw.L']
        a, b = rig_.matrix_world @ pw.head, rig_.matrix_world @ pw.tail
        px, py = .5 * (a.x + b.x), .5 * (a.y + b.y)       # the paw ball under the wrist/hock
        col = (np.abs(root[:, 0] - px) < .065) & (np.abs(root[:, 1] - py) < .075)
        toe = np.concatenate([strands(f'LX_Fur_under_LX_{pre}Toe{i}.L') for i in range(4)])
        tlen = np.linalg.norm(np.diff(toe, axis=1), axis=2).sum(1) if len(toe) else []
        zone = lambda z0, z1: med(blen[col & (root[:, 2] >= z0) & (root[:, 2] < z1)])
        d = {'toe_coat_mm': med(tlen), 'paw_back_coat_mm': zone(0, .075),
             'leg_low_coat_mm': zone(.075, .14), 'leg_mid_coat_mm': zone(.14, .21),
             'leg_top_coat_mm': zone(.21, .28)}
        # envelope: every coat point of strands rooted on this leg, in a 10 mm slab
        legp = body[col & (root[:, 2] < .24)].reshape(-1, 3)
        for h in (.10, .15):
            sl = legp[np.abs(legp[:, 2] - h) < .005]
            if len(sl) > 20:
                lo, hi = np.percentile(sl[:, :2], 2, axis=0), np.percentile(sl[:, :2], 98, axis=0)
                d[f'leg_width_z{int(h * 1000)}_mm'] = [round(1000 * float(v), 1) for v in hi - lo]   # [x (front view), y (side view)]
        out[pre + '.L'] = d
    out['torso_coat_mm'] = med(blen[root[:, 2] > .33])
    out['target'] = '趾毛 ≤ 爪背毛；腿毛从爪背向上逐段加长、接近躯干（torso_coat_mm）'
    return out


coat = coat_audit()

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

# --- Open mouth, canines, lick contact (round j) --------------------------------------------
# Codex's round-h audit (reviews/compare/REPORT.md) measured the yawn on the render - 26 px of red
# on a ~700 px head (.037) against the reference's .256 - and the canines with a forward ray from
# each upper tooth's HIGHEST vertex, which is its root inside the gum. The same questions, asked of
# the geometry in the head's own rest frame (the face camera turns with the head, V6_FACE_FOLLOW):
#   open_mm_mesh / _fur   how tall the opening is seen from straight in front: rows of a .5 mm ray
#                         grid in which most rays of the centre band (|x| <= 6 mm) reach the inside
#                         of the mouth (cavity, floor, tongue, teeth) before anything else. _mesh
#                         counts skin only; _fur also the coat, drawn as the renderer draws it
#                         (ribbons of native_fur_lingxi_v5.py's strand radius).
#   open_head_fur         open_mm_fur over the coat's width across the face (the render's ruler)
#   shell_rays            rays that reach the INSIDE of the head shell through the mouth - a white
#                         hole where the mouth bag does not cover the gap
#   canines               each canine's real tip (lowest vertex of an upper tooth, highest of a lower):
#     skin_ahead_mm       how far a forward ray from the tip runs before it hits skin (None = none:
#                         the tip is in the open) - the "skin in front of the tip"
#     exposed_mm[_fur]    how much of the tooth, from the tip toward the gum, the viewer sees
#     behind_lip_mm       how far the tip sits behind the front of the upper lip above it (+ = inside
#                         the mouth; - = it floats out in front of the lip)
#     root_skin_ahead_mm  REPORT.md's ruler, kept for comparison: the world -Y ray from the highest
#                         vertex to LX_Head / the upper lips
#   lick                  at the Lick frame with the tongue furthest out: the signed gap from the tongue
#                         to the raised paw's pad, beans and toes (- = into them), and the triangle
#                         pairs the tongue shares with other meshes (LX_Jaw is hide_render - an unseen
#                         leftover volume, so it is listed apart from what the camera can see)
MOUTH_HOW = ('头部静止坐标系（随头转，等同 V6_FACE_FOLLOW 的脸部镜头）；求值网格真实顶点；毛按 native_fur 的'
             '渲染半径做成面向镜头的细带参与遮挡；帧只用 scene.frame_set() 取（Yawn/Bite 取 |Jaw| 最大帧，'
             'Lick 取舌 Out 最大帧）。')
SKIN_MESHES = ('LX_Head', 'LX_Nose', 'LX_LipPhiltrum', 'LX_LipUpper.L', 'LX_LipUpper.R', 'LX_LipLower', 'LX_Body')
INNER_MESHES = ('LX_MouthCavity', 'LX_MouthFloor', 'LX_Tongue')
FUR_PROFILE = (.00026, .00020, .00012, .000012)   # native_fur_lingxi_v5.py: render radius, root -> tip, per .00078 of fur_radius


def mouth_frames():
    anim = Path(bpy.data.filepath).with_name('animations.json')
    try:
        clips = {c['name']: c for c in json.loads(anim.read_text())}
    except (OSError, ValueError):
        return {}
    jaw = rig.pose.bones.get('Jaw')
    tongue = bpy.data.objects.get('LX_Tongue')
    out_key = tongue.data.shape_keys.key_blocks.get('Out') if tongue and tongue.data.shape_keys else None
    frames = {}
    for name in ('Yawn', 'Bite', 'Lick'):
        c = clips.get(name)
        if c is None or jaw is None:
            continue
        best = None
        for f in range(c['start'], c['end'] + 1):
            s.frame_set(f)
            v = out_key.value if (name == 'Lick' and out_key) else abs(jaw.rotation_euler.x)
            if best is None or v > best[1] + 1e-6:
                best = (f, v)
        frames[name] = best[0]
    return frames


def head_rest_matrix():
    """World -> the head's rest frame (cat faces -y, z up), for the current frame."""
    hb = rig.pose.bones['Head']
    return np.array((rig.matrix_world @ hb.bone.matrix_local) @ (rig.matrix_world @ hb.matrix).inverted())


def xf(P, A):
    return P @ A[:3, :3].T + A[:3, 3]


def eval_tris(name, A=None, polys=False):
    """(points, triangles) of an object's evaluated mesh - world space, or A's frame. polys=True
    gives the mesh's own polygons instead (a list): REPORT.md counted intersecting POLYGON pairs."""
    o = bpy.data.objects.get(name)
    if o is None:
        return None
    e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype='f')
    me.vertices.foreach_get('co', co)
    if polys:
        tri = [tuple(p.vertices) for p in me.polygons]
    else:
        me.calc_loop_triangles()
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
        me.loop_triangles.foreach_get('vertices', tri)
        tri = tri.reshape(-1, 3)
    e.to_mesh_clear()
    P = xf(co.reshape(-1, 3).astype(float), np.array(e.matrix_world))
    return (xf(P, A) if A is not None else P), tri


def tree_of(parts):
    """One BVH over several (points, tris) parts; also returns each part's first triangle index."""
    pts, tris, starts, off = [], [], [], 0
    for P, T in parts:
        starts.append(sum(len(t) for t in tris))
        pts.append(P)
        tris.append(T + off)
        off += len(P)
    if not pts:
        return None, []
    P = np.concatenate(pts)
    T = np.concatenate(tris)
    return bvhtree.BVHTree.FromPolygons(P.tolist(), T.tolist()), starts


def fur_ribbons(A, lo, hi, only=''):
    """The coat inside the box lo..hi (head rest frame) as ribbons facing the camera (+y view)."""
    quads = []
    for o in s.objects:
        if o.type != 'MESH' or not o.name.startswith('LX_Fur_') or 'fur_radius' not in o.data.attributes:
            continue
        if only not in o.name:
            continue
        # the build's GN modifier turns the strands into curves; the strand POINTS are wanted
        mods = [m for m in o.modifiers if m.type == 'NODES' and m.show_viewport]
        for m in mods:
            m.show_viewport = False
        bpy.context.view_layer.update()
        P = real_points(o.name)
        for m in mods:
            m.show_viewport = True
        npts = int(o.get('strand_points', 6))
        if not len(P):
            continue
        S = xf(P, A).reshape(-1, npts, 3)
        keep = ((S > lo) & (S < hi)).all(2).any(1)
        if not keep.any():
            continue
        S = S[keep]
        rr = np.empty(len(o.data.vertices), dtype='f')
        o.data.attributes['fur_radius'].data.foreach_get('value', rr)
        k = rr.reshape(-1, npts)[keep, 0] / .00078
        R = np.interp(np.linspace(0, 1, npts), np.linspace(0, 1, 4), FUR_PROFILE)[None, :] * k[:, None]
        seg = S[:, 1:] - S[:, :-1]
        side = np.cross(seg, np.array([0., 1., 0.]))
        n = np.linalg.norm(side, axis=2, keepdims=True)
        side = np.where(n > 1e-9, side / np.maximum(n, 1e-12), np.array([1., 0., 0.]))
        r0, r1 = R[:, :-1, None], R[:, 1:, None]
        a, b = S[:, :-1], S[:, 1:]
        quads.append(np.stack([a + side * r0, a - side * r0, b - side * r1, b + side * r1], 2).reshape(-1, 3))
    if not quads:
        return None
    V = np.concatenate(quads)
    return V, np.arange(len(V), dtype=np.int32).reshape(-1, 4)


def first_hit(o, d, trees, far=3.0):
    """(class, distance, part index, face normal) of the nearest hit among {class: (tree, starts)}."""
    best = None
    for cls, (t, starts) in trees.items():
        if t is None:
            continue
        loc, nor, idx, dist = t.ray_cast(o, d, far)
        if loc is not None and (best is None or dist < best[1]):
            part = max(i for i, st in enumerate(starts) if idx >= st) if starts else 0
            best = (cls, dist, part, nor)
    return best


def mouth_audit():
    if rig is None or 'Jaw' not in rig.pose.bones:
        return None
    f0 = s.frame_current
    frames = mouth_frames()
    out = {'how': MOUTH_HOW, 'frames': frames}
    view = Vector((0, 1, 0))
    for clip, f in [('Rest', 1)] + sorted(frames.items(), key=lambda kv: kv[1]):
        s.frame_set(f)
        bpy.context.view_layer.update()
        A = head_rest_matrix()
        skin = [(n, eval_tris(n, A)) for n in SKIN_MESHES if bpy.data.objects.get(n)]
        teeth = [(o.name, eval_tris(o.name, A), 'Head' in o.vertex_groups) for o in s.objects
                 if o.type == 'MESH' and o.name.startswith('LX_Tooth')]
        inner = [(n, eval_tris(n, A)) for n in INNER_MESHES if bpy.data.objects.get(n)] + [(n, g) for n, g, _ in teeth]
        nose = next(g for n, g in skin if n == 'LX_Nose')[0]
        z_top = float(nose[:, 2].min()) + .004
        head_p = next(g for n, g in skin if n == 'LX_Head')[0]
        lo, hi = np.array([-.09, -1.0, z_top - .15]), np.array([.09, -.25, z_top + .03])
        fur = fur_ribbons(A, lo, hi)
        trees = {'skin': tree_of([g for _, g in skin]), 'inner': tree_of([g for _, g in inner])}
        names = {'skin': [n for n, _ in skin], 'inner': [n for n, _ in inner]}
        trees_fur = dict(trees, fur=(tree_of([fur])[0], [0]) if fur else (None, []))
        # the opening: a .5 mm grid in front of the face, looking back along +y
        xs = np.arange(-.035, .0351, .0005)
        zs = np.arange(z_top, z_top - .14, -.0005)
        band = np.abs(xs) <= .006
        rows = {'mesh': [], 'fur': []}
        hits_by = {}
        shell = 0
        for z in zs:
            r_m, r_f = [], []
            for x in xs:
                o = Vector((x, -1.0, z))
                h = first_hit(o, view, trees)
                hf = first_hit(o, view, trees_fur)
                if h and h[0] == 'skin' and h[3].dot(view) > 0 and names['skin'][h[2]] == 'LX_Head':
                    shell += 1
                r_m.append(bool(h and h[0] == 'inner'))
                r_f.append(bool(hf and hf[0] == 'inner'))
                if hf and hf[0] == 'inner':
                    nm = names['inner'][hf[2]]
                    hits_by[nm] = hits_by.get(nm, 0) + 1
            rows['mesh'].append(r_m)
            rows['fur'].append(r_f)
        d = {'frame': f, 'jaw_deg': round(math.degrees(rig.pose.bones['Jaw'].rotation_euler.x), 2)}
        for tag, g in rows.items():
            g = np.array(g)
            frac = g[:, band].mean(1)
            open_rows = frac >= .5
            d['open_mm_' + tag] = round(.5 * int(open_rows.sum()), 1)
            d['open_width_mm_' + tag] = round(.5 * int(g.any(0).sum()), 1)
            if open_rows.any():
                d['open_z_mm_' + tag] = [round(1000 * float(zs[open_rows].max()), 1), round(1000 * float(zs[open_rows].min()), 1)]
        d['inner_hits_fur'] = hits_by
        d['shell_rays'] = shell
        d['head_mesh_width_mm'] = round(1000 * float(np.ptp(head_p[:, 0])), 1)
        hf_ = fur_ribbons(A, np.array([-.5, -1.0, z_top - .10]), np.array([.5, 0.0, z_top + .05]), only='_LX_Head')
        if hf_ is not None:
            V = hf_[0]
            w = max((np.percentile(V[sl, 0], 99) - np.percentile(V[sl, 0], 1))
                    for zc in np.arange(z_top - .08, z_top + .04, .01)
                    for sl in [np.abs(V[:, 2] - zc) < .005] if sl.sum() > 50)
            d['head_coat_width_mm'] = round(1000 * float(w), 1)
            d['open_head_fur'] = round(d['open_mm_fur'] / d['head_coat_width_mm'], 3)
            d['open_head_mesh'] = round(d['open_mm_mesh'] / d['head_coat_width_mm'], 3)
        # canines
        can = {}
        skin_tree = trees['skin'][0]
        world_up = [eval_tris(n) for n in ('LX_Head', 'LX_LipUpper.L', 'LX_LipUpper.R') if bpy.data.objects.get(n)]
        for nm, (P, _), upper in teeth:
            tip = P[np.argmin(P[:, 2])] if upper else P[np.argmax(P[:, 2])]
            t = {'upper': upper, 'tip_mm': [round(1000 * float(v), 1) for v in tip]}
            hit = skin_tree.ray_cast(Vector(tip) + Vector((0, -1e-4, 0)), Vector((0, -1, 0)), .2)
            t['skin_ahead_mm'] = round(1000 * hit[3], 2) if hit[0] is not None else None
            h_tooth = float(np.ptp(P[:, 2]))
            exp_m, exp_f = 0, 0.0
            for j in range(int(h_tooth / .00025)):
                zz = tip[2] + (j * .00025 if upper else -j * .00025)
                h = first_hit(Vector((tip[0], -1.0, zz)), view, trees)
                exp_m += bool(h and h[0] == 'inner' and names['inner'][h[2]] == nm)
                seen = 0
                for dx in (-.0005, 0, .0005):
                    h = first_hit(Vector((tip[0] + dx, -1.0, zz)), view, trees_fur)
                    seen += bool(h and h[0] == 'inner' and names['inner'][h[2]] == nm)
                exp_f += seen / 3
            t['exposed_mm'] = round(.25 * exp_m, 2)
            t['exposed_mm_fur'] = round(.25 * exp_f, 2)
            if upper:
                lip = head_p[(np.abs(head_p[:, 0] - tip[0]) < .003) & (head_p[:, 2] > tip[2]) & (head_p[:, 2] < tip[2] + .012)]
                t['behind_lip_mm'] = round(1000 * float(tip[1] - lip[:, 1].min()), 2) if len(lip) else None
                Pw = eval_tris(nm)[0]
                top = Pw[np.argmax(Pw[:, 2])]
                ds = []
                for Q, T in world_up:
                    loc = bvhtree.BVHTree.FromPolygons(Q.tolist(), T.tolist()).ray_cast(Vector(top), Vector((0, -1, 0)), .2)
                    if loc[0] is not None:
                        ds.append(loc[3])
                t['root_skin_ahead_mm'] = round(1000 * min(ds), 2) if ds else None
            can[nm] = t
        d['canines'] = can
        if clip == 'Lick':
            d['lick'] = lick_contact()
        out[clip] = d
    s.frame_set(f0)
    bpy.context.view_layer.update()
    out['target'] = {'Yawn open_head_fur': '≥ 0.15（参考 0.256；round h 渲染 0.037）',
                     'canines (open)': 'skin_ahead_mm None 且 exposed_mm_fur > 0，behind_lip_mm > 0',
                     'canines (Rest)': 'exposed_mm 0（闭嘴不露齿）',
                     'lick': 'gap_mm ≈ 0（不为负），可见网格相交 0',
                     'shell_rays': '0'}
    return out


def lick_contact():
    """Tongue against the raised forepaw at the current frame (world space)."""
    tg = eval_tris('LX_Tongue', polys=True)
    if tg is None:
        return None
    paw = max(('L', 'R'), key=lambda sf: (rig.matrix_world @ rig.pose.bones['FrontPaw.' + sf].head).z)
    parts = ['LX_FrontPad.' + paw] + [f'LX_Front{k}{i}.{paw}' for k in ('Bean', 'Toe') for i in range(4)]
    tv = [Vector(p) for p in tg[0]]
    ttree = bvhtree.BVHTree.FromPolygons(tg[0].tolist(), tg[1])
    best = None
    pairs = {}
    for n in parts + ['LX_Head', 'LX_Jaw', 'LX_LipUpper.L', 'LX_LipUpper.R', 'LX_LipLower', 'LX_Body'] + \
            [o.name for o in s.objects if o.name.startswith('LX_Tooth')]:
        g = eval_tris(n, polys=True)
        if g is None:
            continue
        t = bvhtree.BVHTree.FromPolygons(g[0].tolist(), g[1])
        pairs[n] = len(ttree.overlap(t))
        if n in parts:
            for v in tv:
                loc, nor, _i, dist = t.find_nearest(v, .5)
                if loc is None:
                    continue
                sd = dist if (v - loc).dot(nor) >= 0 else -dist
                if best is None or sd < best[0]:
                    best = (sd, n)
    A = head_rest_matrix()
    tr = xf(tg[0], A)
    lip = eval_tris('LX_LipUpper.L', A)
    out = {'paw': 'FrontPaw.' + paw, 'gap_mm': round(1000 * best[0], 2) if best else None,
           'nearest_part': best[1] if best else None,
           'tongue_out_of_lip_mm': round(1000 * float(lip[0][:, 1].min() - tr[:, 1].min()), 1) if lip else None,
           'intersect_pairs': pairs,
           'intersect_visible': sum(v for k, v in pairs.items() if k != 'LX_Jaw')}
    return out


mouth_open = mouth_audit()

result = {'paws': paws, 'toe_spread': spread, 'paw_bbox': paw_row, 'toe_clefts': clefts, 'paw_coat': coat,
          'ears': ears, 'head_width_mm': head_w, 'mouth': mouth, 'lids': lids, 'mouth_open': mouth_open,
          'targets': {'ear': 'comment in build_lingxi_v5.py: 135 mm tall, 112 mm across, w/h .83',
                      'mouth': 'v6_face_shape.py REFERENCE: nose w 0.311E, mouth w 0.288E, '
                               'nose dy +0.320E, mouth dy +0.630E (so lip 0.310E below the nose)'}}
print(json.dumps(result, ensure_ascii=False, indent=1))
if OUT_JSON:
    Path(OUT_JSON).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print('wrote', OUT_JSON)
