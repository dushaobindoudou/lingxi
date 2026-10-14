# SideLie acceptance numbers (codex ROUND-ZZF-AUDIT #4) at FRAME: world roll of pelvis / loin / chest (angle of the rest-dorsal axis from
# world up), lowest points of hind paws, rump / hind belly, chest underside, forepaws, and the forepaws' spacing.
import bpy, os, math
import numpy as np
from mathutils import Vector
sc = bpy.context.scene; sc.frame_set(int(os.environ.get('FRAME', 288)))
rig = bpy.data.objects['LX_Rig']; W = rig.matrix_world; pb = rig.pose.bones; dg = bpy.context.evaluated_depsgraph_get()
def roll(n):
    b = pb[n]; R = (W @ b.matrix @ b.bone.matrix_local.inverted()).to_3x3(); d = R @ Vector((0, 0, 1))
    return round(math.degrees(math.acos(max(-1, min(1, d.z)))), 1)
print('SIDEM roll deg', {n: roll(n) for n in ('Pelvis', 'LoinB', 'Loin', 'Spine', 'Chest') if n in pb}, '(codex: pelvis 70-85, loin 45-65, chest 20-35)')
ob = bpy.data.objects['LX_Body']; ev = ob.evaluated_get(dg); me = ev.to_mesh(); M = np.array(ob.matrix_world)
co = np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3]; gn = {g.index: g.name for g in ob.vertex_groups}
lab = np.array([max(((g.weight, gn.get(g.group, '?')) for g in v.groups), default=(0, '-'))[1] for v in me.vertices]); ev.to_mesh_clear()
def low(pred):
    m = np.array([pred(l) for l in lab]); return round(1000 * co[m, 2].min(), 1) if m.any() else None
out = {}
for s in ('L', 'R'):
    out['hind paw ' + s] = low(lambda l: l.endswith('.' + s) and any(k in l for k in ('RearPaw', 'RearFoot', 'RearToe')))
    out['fore paw ' + s] = low(lambda l: l.endswith('.' + s) and any(k in l for k in ('FrontPaw', 'FrontFoot', 'FrontToe')))
out['rump / hind belly'] = low(lambda l: l in ('Pelvis', 'LoinB') or l.startswith('RearUpper') or l.startswith('Thigh'))
out['chest underside'] = low(lambda l: l in ('Chest', 'Spine'))
print('SIDEM lowest mm', out, '(codex: hind paws 0-5, rump 0-10, chest 20-30, forepaws 0-5)')
a = W @ pb['FrontPaw.L'].head; b = W @ pb['FrontPaw.R'].head
print('SIDEM forepaw centres', [round(1000*c) for c in a], [round(1000*c) for c in b], 'apart', round(1000 * math.hypot(a.x - b.x, a.y - b.y)), 'mm (codex 45-70)')
