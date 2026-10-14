# ScratchEar acceptance numbers (codex ROUND-ZZF-AUDIT #2) at FRAME: forepaw soles' lowest points, pelvis world side-roll (rad),
# the scratching hind foot's nearest point to the left ear's base, and the head / ear-base heights.
import bpy, os, math
import numpy as np
from mathutils import Vector
sc = bpy.context.scene; sc.frame_set(int(os.environ.get('FRAME', 975)))
rig = bpy.data.objects['LX_Rig']; W = rig.matrix_world; pb = rig.pose.bones; dg = bpy.context.evaluated_depsgraph_get()
ob = bpy.data.objects['LX_Body']; ev = ob.evaluated_get(dg); me = ev.to_mesh(); M = np.array(ob.matrix_world)
co = np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3]; gn = {g.index: g.name for g in ob.vertex_groups}
lab = np.array([max(((g.weight, gn.get(g.group, '?')) for g in v.groups), default=(0, '-'))[1] for v in me.vertices]); ev.to_mesh_clear()
def sel(pred): m = np.array([pred(l) for l in lab]); return co[m]
out = {}
for s in ('L', 'R'):
    p = sel(lambda l: l.endswith('.' + s) and any(k in l for k in ('FrontPaw', 'FrontFoot', 'FrontToe')))
    out['fore ' + s] = round(1000 * p[:, 2].min(), 1)
b = pb['Pelvis']; R = (W @ b.matrix @ b.bone.matrix_local.inverted()).to_3x3(); lat = R @ Vector((1, 0, 0))
out['pelvis side-roll rad'] = round(math.asin(max(-1, min(1, lat.z))), 3)
ear = W @ pb['Ear.L'].head; foot = sel(lambda l: l.endswith('.L') and any(k in l for k in ('RearPaw', 'RearFoot', 'RearToe')))
out['hind foot -> ear base mm'] = round(1000 * np.linalg.norm(foot - np.array(ear[:]), axis=1).min(), 1)
out['ear base z'] = round(1000 * ear.z); out['head z'] = round(1000 * (W @ pb['Head'].head).z)
print('SEM', out, '(codex: fore 0-5, |roll| <= .10, foot->ear <= 25, head not lower than now by >20)')
