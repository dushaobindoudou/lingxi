"""Pose numbers of a built rig at given frames (armature space = world here, mm / degrees): trunk segment pitch (+ = head end up),
and the hind / fore leg joints (hip, knee, hock, MTP, toe tip) - x across, y back (+ toward the tail), z up.
blender -b <rig>.blend --python v6_pose_numbers.py   (FRAMES='1,800', OUT json)"""
import bpy, os, json, math
s = bpy.context.scene; rig = bpy.data.objects['LX_Rig']; pb = rig.pose.bones; M = rig.matrix_world
def P(n, end='head'): b = pb[n]; return M @ (b.head if end == 'head' else b.tail)
def pitch(n):
    d = P(n, 'tail') - P(n); return round(math.degrees(math.atan2(-d.y if d.y < 0 else d.y, 1e-9)) if False else math.degrees(math.atan2(d.z, math.hypot(d.x, d.y))), 1)
out = {}
for f in [int(x) for x in os.environ.get('FRAMES', '1,800').split(',')]:
    s.frame_set(f); r = {}
    r['pitch_deg'] = {n: pitch(n) for n in ('Pelvis', 'LoinB', 'Loin', 'Spine', 'Chest', 'Neck', 'NeckB', 'Head') if n in pb}
    for side in ('L',):
        chain = [b for b in ('RearUpper.', 'RearLower.', 'RearPaw.', 'RearFoot.') if b + side in pb]
        r['hind'] = {b[:-1]: [round(1000 * c) for c in P(b + side)] for b in chain}
        r['hind']['toe_tip'] = [round(1000 * c) for c in P(chain[-1] + side, 'tail')]
        r['hind_seg_pitch'] = {b[:-1]: pitch(b + side) for b in chain}
        chainf = [b for b in ('Scap.', 'FrontUpper.', 'FrontLower.', 'FrontPaw.', 'FrontFoot.') if b + side in pb]
        r['fore'] = {b[:-1]: [round(1000 * c) for c in P(b + side)] for b in chainf}
        r['fore']['toe_tip'] = [round(1000 * c) for c in P(chainf[-1] + side, 'tail')]
    r['root'] = [round(1000 * c) for c in P('Root')]
    out[f] = r
    print('POSE', f, json.dumps(r))
json.dump(out, open(os.environ.get('OUT', '/tmp/pose.json'), 'w'), indent=1)
