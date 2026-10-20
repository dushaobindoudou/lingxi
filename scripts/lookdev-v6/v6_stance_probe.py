"""Stance slip, split into ROLL and SLIP: for each paw and contact frame of a clip, the lowest sole point's xy step (what the gait audit
reports) and the xy step of the same material points (the vertices that were in contact the frame before) - a planted pad that only
rolls keeps its material points still; a sliding one moves them.
blender -b <rig>.blend --python v6_stance_probe.py   (CLIP name, default Walk; OUT json)"""
import bpy, json, os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
s = bpy.context.scene; rig = bpy.data.objects['LX_Rig']; pb = rig.pose.bones
clips = json.load(open(os.path.join(os.path.dirname(bpy.data.filepath), 'animations.json')))
clips = clips.get('clips', clips) if isinstance(clips, dict) else clips
name = os.environ.get('CLIP', 'Walk')
clip = next(c for c in (clips if isinstance(clips, list) else [dict(name=k, **v) for k, v in clips.items()]) if c['name'] == name)
PAWS = ['FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R']
dg = lambda: bpy.context.evaluated_depsgraph_get()
def pts(o):
    e = bpy.data.objects[o].evaluated_get(dg()); return np.array([(e.matrix_world @ v.co)[:] for v in e.data.vertices])
s.frame_set(clip['start']); rest = pts('LX_Body')
FOOT = {}
for nm in PAWS:
    h = rig.matrix_world @ pb[nm].bone.head_local; t = rig.matrix_world @ pb[nm].bone.tail_local
    cx, cy = .5 * (h.x + t.x), .5 * (h.y + t.y)
    FOOT[nm] = np.where((np.abs(rest[:, 0] - cx) < .06) & (np.abs(rest[:, 1] - cy) < .08) & (rest[:, 2] < .07))[0]
rows = []
for f in range(clip['start'], clip['end'] + 1):
    s.frame_set(f); P = pts('LX_Body'); rows.append({nm: P[FOOT[nm]] for nm in PAWS})
out = {}
for nm in PAWS:
    rec = []
    for i in range(1, len(rows)):
        A, B = rows[i - 1][nm], rows[i][nm]; la, lb = A[:, 2].min(), B[:, 2].min()
        if la > .003 or lb > .003: continue
        ia = A[:, 2] < la + .003; ib = B[:, 2] < lb + .003
        cen = 1000 * np.hypot(*(B[ib, :2].mean(0) - A[ia, :2].mean(0)))
        mat = 1000 * np.hypot(*(B[ia, :2].mean(0) - A[ia, :2].mean(0)))       # same material points
        rec.append({'f': clip['start'] + i, 'low_mm': round(1000 * lb, 1), 'centroid_step': round(cen, 2), 'material_step': round(mat, 2)})
    out[nm] = {'max_centroid_step': max((r['centroid_step'] for r in rec), default=0), 'max_material_step': max((r['material_step'] for r in rec), default=0),
               'worst': sorted(rec, key=lambda r: -r['material_step'])[:4], 'frames': rec}
json.dump(out, open(os.environ.get('OUT', '/tmp/stance.json'), 'w'), indent=1)
for nm in PAWS: print('STANCE', name, nm, out[nm]['max_centroid_step'], out[nm]['max_material_step'], out[nm]['worst'][:2])
