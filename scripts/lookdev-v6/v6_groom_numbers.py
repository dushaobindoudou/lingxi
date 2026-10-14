# (round ZZL) GroomSide numbers at FRAME: nose tip to the nearest right-flank / shoulder skin (mm), head yaw relative to the body (deg, 0 = straight
# ahead, 180 = looking back), face pitch (deg below horizontal), nose height
import bpy, os, math, numpy as np
from mathutils import Vector
sc = bpy.context.scene; sc.frame_set(int(os.environ.get('FRAME', 1095))); rig = bpy.data.objects['LX_Rig']; W = rig.matrix_world; pb = rig.pose.bones
dg = bpy.context.evaluated_depsgraph_get(); ob = bpy.data.objects['LX_Body']; ev = ob.evaluated_get(dg); me = ev.to_mesh(); M = np.array(ob.matrix_world)
co = np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3]; gn = {g.index: g.name for g in ob.vertex_groups}
lab = np.array([max(((g.weight, gn.get(g.group, '?')) for g in v.groups), default=(0, '-'))[1] for v in me.vertices]); ev.to_mesh_clear()
nose = np.array((W @ pb['Nose'].tail)[:])
flank = co[np.array([l in ('Chest', 'Spine', 'Loin', 'LoinB', 'Scap.R', 'FrontUpper.R', 'RearUpper.R', 'Pelvis') for l in lab])]
side = flank[flank[:, 0] * np.sign((W @ pb['Scap.R'].head).x) > 0]
d = np.linalg.norm(side - nose, axis=1).min()
hd = (W @ pb['Head'].tail) - (W @ pb['Head'].head); bd = (W @ pb['Chest'].head) - (W @ pb['Pelvis'].head)
ya = math.degrees(math.atan2(hd.x * bd.y - hd.y * bd.x, hd.x * bd.x + hd.y * bd.y)); pitch = math.degrees(math.atan2(-hd.z, math.hypot(hd.x, hd.y)))
dl = np.linalg.norm(flank[flank[:, 0] * np.sign((W @ pb['Scap.R'].head).x) <= 0] - nose, axis=1).min(); print('GSM', {'nose_to_right_flank_mm': round(1000 * d, 1), 'nose_to_left_flank_mm': round(1000 * dl, 1), 'head_yaw_deg': round(ya, 1), 'face_down_deg': round(pitch, 1), 'nose_z': round(1000 * nose[2])})
