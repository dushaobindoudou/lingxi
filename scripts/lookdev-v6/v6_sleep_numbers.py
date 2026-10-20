# Sleep acceptance numbers (codex batch 27 #3) at FRAME: tail tip vs chin (horizontal mm, in front of it?), tip height, tail-to-body gap,
# and how far each paw's outermost point stands outside the trunk's own contour (ring radius about the trunk+head centroid).
import bpy, os, math
import numpy as np
sc = bpy.context.scene; sc.frame_set(int(os.environ.get('FRAME', 330)))
rig = bpy.data.objects['LX_Rig']; dg = bpy.context.evaluated_depsgraph_get(); W = rig.matrix_world
def pts(name):
    ob = bpy.data.objects[name]; ev = ob.evaluated_get(dg); me = ev.to_mesh(); M = np.array(ob.matrix_world)
    co = np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3]
    gn = {g.index: g.name for g in ob.vertex_groups}
    lab = [max(((g.weight, gn.get(g.group, '?')) for g in v.groups), default=(0, '-'))[1] for v in me.vertices]
    ev.to_mesh_clear(); return co, np.array(lab)
body, bl = pts('LX_Body'); headp, _ = pts('LX_Head'); tail, tl = pts('LX_Tail')
trunk = body[np.array([not any(s in l for s in ('Paw', 'Foot', 'Toe', 'Forearm', 'Arm', 'Shin', 'Thigh', 'Knee', 'Elbow', 'Hock', 'Wrist', 'Upper', 'Hand')) for l in bl])]
C = np.concatenate([trunk, headp])[:, :2].mean(0)
def ang(p): return math.atan2(p[1] - C[1], p[0] - C[0])
tr = np.concatenate([trunk, headp]); ta = np.arctan2(tr[:, 1] - C[1], tr[:, 0] - C[0]); trr = np.linalg.norm(tr[:, :2] - C, axis=1)
def contour(a):
    m = np.abs((ta - a + math.pi) % math.tau - math.pi) < .12
    return float(trr[m].max()) if m.any() else 0.0
pb = rig.pose.bones; mouth = W @ pb['Head'].head
for n in ('Jaw', 'LowerJaw', 'Chin'):
    if n in pb: mouth = W @ pb[n].tail; break
tip_bone = [b.name for b in rig.data.bones if b.name.startswith('Tail')][-1]; tip = W @ pb[tip_bone].tail
tz = tail[:, 2]; print(f'SLEEPM centre {np.round(C*1000)}  chin {[round(1000*c) for c in mouth]}  tail tip ({tip_bone}) {[round(1000*c) for c in tip]}')
print(f'SLEEPM tip->chin horizontal {1000*math.hypot(tip.x-mouth.x, tip.y-mouth.y):.0f} mm, tip height {1000*tip.z:.0f} mm, tail mesh lowest {1000*tz.min():.1f} mm')
for side in ('FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R'):
    m = np.array([side.split('.')[0].replace('Paw', '') in l and l.endswith(side[-2:]) for l in bl])
    sel = body[m] if m.any() else None
    if sel is None or not len(sel): print('SLEEPM', side, 'no verts'); continue
    r = np.linalg.norm(sel[:, :2] - C, axis=1); j = int(np.argmax(r)); a = ang(sel[j])
    print(f'SLEEPM {side:11s} outermost r {1000*r[j]:4.0f} at {math.degrees(a):5.0f} deg, trunk contour there {1000*contour(a):4.0f} -> sticks out {1000*(r[j]-contour(a)):5.0f} mm, z {1000*sel[j,2]:4.0f}')
for n in ('Head', 'Neck', 'FrontPaw.L', 'FrontPaw.R', 'Tail2', 'Tail3', 'Tail4'):
    if n in pb:
        h = W @ pb[n].head; t = W @ pb[n].tail; print(f'SLEEPP {n:10s} head {[round(1000*c) for c in h]} tail {[round(1000*c) for c in t]}')
print('SLEEPP chin', [round(1000*c) for c in mouth], 'jaw-ish bones', [b for b in pb.keys() if 'Jaw' in b or 'Chin' in b][:6])
