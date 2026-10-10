"""v6 round j -- gait, head carriage and body proportions, on any built blend.

Codex's round-h audit (reviews/compare/REPORT.md) measured these with one-off scripts pinned to
round h's files (assets/characters/lingxi/v6/round-i-check/{audit,summarize,proportions}.py). This
is the same ruler, reading the blend it is run on and its animations.json, so a new build can be
held against round h's numbers directly. Same definitions as summarize.py:

  paw tip         the FrontPaw/RearPaw bone's tail; `base` its rest height (round h: 35 / 36 mm)
  swing           tip above base + 8 mm;  contact: tip at or below base + 3 mm
  contact step    largest horizontal move of a paw between two consecutive contact frames
  same-side overlap  frames in which the front and hind paw of one side are both in swing
  all-air         frames with every paw above base + 3 mm

and, beyond summarize.py:

  sole_*          the same contact questions on REAL vertices: each foot is the body mesh's
                  vertices around that paw plus its toes, pad and beans; sole = their lowest z
  root_travel_mm  how far the root moves over the clip (the clips used to walk in place, so a
                  planted paw had to slide back under the body)
  head/neck       world pitch of the Head and Neck bones (+ = tail higher than head) and the
                  Spine-head -> Head-head distance: the neck's fold. (summarize.py's Head-Neck
                  distance is the Neck bone's own length and cannot change.)
  proportions     proportions.py's frame-1 ruler, unchanged

  Blender -b <blend> --python v6_gait_audit.py      (V6_GAIT_JSON=out.json to write the result)
Only scene.frame_set() is used to read the clips; nothing is assigned to the rig.
"""
import bpy
import json
import math
import os
import numpy as np
from mathutils import Vector
from pathlib import Path

OUT_JSON = os.environ.get('V6_GAIT_JSON', '')
s = bpy.context.scene
rig = next(o for o in s.objects if o.type == 'ARMATURE')
pb = rig.pose.bones
PAWS = ('FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R')
deps = lambda: bpy.context.evaluated_depsgraph_get()


def W(name, tip=False):
    m = rig.matrix_world @ pb[name].matrix
    return m @ Vector((0, pb[name].bone.length, 0)) if tip else m.translation


def pitch(name):
    a, b = W(name), W(name, True)
    return math.degrees(math.atan2(b.z - a.z, max(1e-9, math.hypot(b.x - a.x, b.y - a.y))))


def eval_points(name):
    o = bpy.data.objects.get(name)
    if o is None:
        return np.zeros((0, 3))
    e = o.evaluated_get(deps())
    me = e.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype='f')
    me.vertices.foreach_get('co', co)
    e.to_mesh_clear()
    m = np.array(e.matrix_world)
    return co.reshape(-1, 3).astype(float) @ m[:3, :3].T + m[:3, 3]


# Each foot's real vertices: the body mesh's own paw ball (picked once, at rest) and the separate
# toe / pad / bean objects bound to that paw.
body = bpy.data.objects['LX_Body']
rest = np.empty(len(body.data.vertices) * 3, dtype='f')
body.data.vertices.foreach_get('co', rest)
rest = rest.reshape(-1, 3) @ np.array(body.matrix_world)[:3, :3].T + np.array(body.matrix_world)[:3, 3]
FOOT = {}
for nm in PAWS:
    pre, suf = nm.split('Paw.')
    h = rig.matrix_world @ pb[nm].bone.head_local
    t = rig.matrix_world @ pb[nm].bone.tail_local
    cx, cy = .5 * (h.x + t.x), .5 * (h.y + t.y)
    idx = np.where((np.abs(rest[:, 0] - cx) < .06) & (np.abs(rest[:, 1] - cy) < .08) & (rest[:, 2] < .07))[0]
    parts = [f'LX_{pre}Pad.{suf}'] + [f'LX_{pre}{k}{i}.{suf}' for k in ('Toe', 'Bean') for i in range(4)]
    FOOT[nm] = (idx, [p for p in parts if bpy.data.objects.get(p)])
BASE = {nm: round(1000 * (rig.matrix_world @ pb[nm].bone.tail_local).z, 2) for nm in PAWS}


def feet():
    bp = eval_points('LX_Body')
    out = {}
    for nm, (idx, parts) in FOOT.items():
        P = np.concatenate([bp[idx]] + [eval_points(p) for p in parts])
        lo = P[:, 2].min()
        sole = P[P[:, 2] < lo + .003]
        out[nm] = (1000 * lo, 1000 * sole[:, 0].mean(), 1000 * sole[:, 1].mean())
    return out


def runs(frames):
    """[[start, end], ...] of consecutive frame numbers."""
    r = []
    for f in frames:
        if r and f == r[-1][1] + 1:
            r[-1][1] = f
        else:
            r.append([f, f])
    return r


def gait(clip):
    rows = []
    for f in range(clip['start'], clip['end'] + 1):
        s.frame_set(f)
        rows.append({'f': f, 'paws': {n: [1000 * v for v in W(n, True)] for n in PAWS}, 'feet': feet(),
                     'root': [1000 * v for v in W('Root')],
                     'head_local_deg': math.degrees(pb['Head'].rotation_euler.x),
                     'head_pitch': pitch('Head'), 'neck_pitch': pitch('Neck'), 'spine_pitch': pitch('Spine'),
                     'neck_fold_mm': 1000 * (W('Head') - W('Spine')).length,
                     'head_neck_mm': 1000 * (W('Head') - W('Neck')).length,
                     'head_z': 1000 * W('Head').z})
    o = {}
    swing = {k: [r['f'] for r in rows if r['paws'][k][2] > BASE[k] + 8] for k in PAWS}
    contact = {k: [r for r in rows if r['paws'][k][2] <= BASE[k] + 3] for k in PAWS}
    o['swing_runs'] = {k: runs(v) for k, v in swing.items()}
    o['contact_count'] = {k: len(v) for k, v in contact.items()}
    o['max_contact_step_mm'] = {k: round(max((math.hypot(b['paws'][k][0] - a['paws'][k][0], b['paws'][k][1] - a['paws'][k][1])
                                              for a, b in zip(v, v[1:]) if b['f'] == a['f'] + 1), default=0), 2)
                                for k, v in contact.items()}
    o['all_air_frames'] = [r['f'] for r in rows if all(r['paws'][k][2] > BASE[k] + 3 for k in PAWS)]
    o['paw_tip_low_relative_mm'] = round(min(r['paws'][k][2] - BASE[k] for r in rows for k in PAWS), 2)
    o['same_side_overlap_frames'] = {sf: len(set(swing['FrontPaw.' + sf]) & set(swing['RearPaw.' + sf])) for sf in 'LR'}
    onset = sorted((rr[0], k) for k, v in o['swing_runs'].items() for rr in v if rr[0] > clip['start'])
    o['swing_order'] = [k.replace('Paw.', '') for _, k in onset]
    # real vertices
    sc = {k: [r for r in rows if r['feet'][k][0] <= 3] for k in PAWS}
    o['sole_contact_count'] = {k: len(v) for k, v in sc.items()}
    o['sole_max_contact_step_mm'] = {k: round(max((math.hypot(b['feet'][k][1] - a['feet'][k][1], b['feet'][k][2] - a['feet'][k][2])
                                                   for a, b in zip(v, v[1:]) if b['f'] == a['f'] + 1), default=0), 2)
                                     for k, v in sc.items()}
    o['sole_low_mm'] = round(min(r['feet'][k][0] for r in rows for k in PAWS), 2)
    o['sole_all_air_frames'] = [r['f'] for r in rows if all(r['feet'][k][0] > 3 for k in PAWS)]
    o['sole_never_down'] = [k for k in PAWS if not sc[k]]
    o['root_z_range_mm'] = [round(min(r['root'][2] for r in rows), 2), round(max(r['root'][2] for r in rows), 2)]
    o['root_travel_mm'] = round(math.dist(rows[0]['root'][:2], rows[-1]['root'][:2]), 1)
    for key in ('head_local_deg', 'head_pitch', 'neck_pitch', 'spine_pitch', 'neck_fold_mm'):
        v = [r[key] for r in rows]
        o[key + '_range'] = [round(min(v), 2), round(max(v), 2)]
    v = [r['head_neck_mm'] for r in rows]
    o['head_neck_dist_range_mm'] = [round(min(v), 2), round(max(v), 2)]   # summarize.py's: the Neck bone's length
    o['frames'] = [{'f': r['f'], 'sole_mm': {k: round(r['feet'][k][0], 1) for k in PAWS},
                    'head_pitch': round(r['head_pitch'], 1), 'neck_pitch': round(r['neck_pitch'], 1),
                    'head_z': round(r['head_z'], 1), 'root_z': round(r['root'][2], 1)} for r in rows]
    return o


def proportions():
    """proportions.py, verbatim ruler: frame 1, real vertices of LX_Body / LX_Head / LX_Tail / LX_FrontToe0.L."""
    s.frame_set(1)
    b, h, t = (eval_points(n) for n in ('LX_Body', 'LX_Head', 'LX_Tail'))
    # round R: the toes are lobes of the body mesh now (no LX_FrontToe0.L): the sole is the body's lowest point
    toe = eval_points('LX_FrontToe0.L') if s.objects.get('LX_FrontToe0.L') else b
    sec = b[(b[:, 1] > -.19) & (b[:, 1] < -.12) & (np.abs(b[:, 0]) < .06)]
    shoulder, sole = sec[:, 2].max(), toe[:, 2].min()
    chest = sec[sec[:, 2] > .15][:, 2].min() if (sec[:, 2] > .15).any() else None
    L, H, T = (1000 * float(np.ptp(p[:, 1])) for p in (b, h, t))
    out = {'body_length_mm': round(L, 2), 'head_length_mm': round(H, 2), 'tail_y_extent_mm': round(T, 2),
           'shoulder_height_mm': round(1000 * (shoulder - sole), 2)}
    if chest is not None:
        out.update({'foreleg_visible_mm': round(1000 * (chest - sole), 2), 'chest_depth_mm': round(1000 * (shoulder - chest), 2)})
    # proportions.py's chest floor is the lowest section vertex ABOVE z = .15 m: the section (|x| <
    # 60 mm) takes in the forelegs' inner sides, so the chest floor it reports is the cut itself
    # (round h: 150.2 mm, i.e. foreleg_visible = 150 mm - sole whatever the chest does). The chest
    # between the forelegs is the midline (|x| < 20 mm) of the same y range - reported beside it.
    mid = b[(b[:, 1] > -.19) & (b[:, 1] < -.12) & (np.abs(b[:, 0]) < .02)]
    out['chest_floor_midline_mm'] = round(1000 * (mid[:, 2].min() - sole), 2)
    out['ratios'] = {'head_body': round(H / L, 3), 'shoulder_body': round(out['shoulder_height_mm'] / L, 3), 'tail_body': round(T / L, 3)}
    if chest is not None:
        out['ratios'].update({'foreleg_body': round(out['foreleg_visible_mm'] / L, 3),
                              'chest_shoulder': round(out['chest_depth_mm'] / out['shoulder_height_mm'], 3)})
    out['ratios']['foreleg_midline_body'] = round(out['chest_floor_midline_mm'] / L, 3)
    return out


anim = Path(bpy.data.filepath).with_name('animations.json')
clips = {c['name']: c for c in json.loads(anim.read_text())}
result = {'base_tip_mm': BASE, 'proportions': proportions()}
for name in ('Walk', 'Run', 'Jump'):
    if name in clips:
        result[name] = gait(clips[name])
result['targets'] = {'Walk': 'swing_order 对角（LF→RH→RF→LH）、same_side_overlap 0、max_contact_step ≤ 3 mm、sole_low 0–3 mm',
                     'Run': 'sole_never_down 空、max_contact_step ≤ 3 mm、all_air 无（除非验收标准改成带腾空）',
                     'head': 'Walk/Run/Jump 的 head_pitch / neck_pitch 有与触地相称的小幅变化（不再恒定）',
                     'proportions': 'foreleg_body → 0.174、shoulder_body 下降；head_body / tail_body 不变'}
for k, v in result.items():
    if k in ('Walk', 'Run', 'Jump'):
        print(k, json.dumps({kk: vv for kk, vv in v.items() if kk != 'frames'}, ensure_ascii=False))
print('proportions', json.dumps(result['proportions']))
if OUT_JSON:
    Path(OUT_JSON).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print('wrote', OUT_JSON)
