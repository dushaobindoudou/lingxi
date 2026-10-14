"""Every-Nth-frame lowest point of the deformed cat (all armature-skinned meshes), mm - the clip review samples ONE frame per clip and
missed Turn going 10-14 mm under the floor (round ZZG / ZZH). Env FRAMES=a,b,step. Prints LOW frame:mm ..."""
import bpy, os, numpy as np
sc = bpy.context.scene; dg = bpy.context.evaluated_depsgraph_get()
obs = [o for o in sc.objects if o.type == 'MESH' and not o.hide_render and any(m.type == 'ARMATURE' for m in o.modifiers) and 'Whisker' not in o.name]   # whiskers (thin, rigid) reported apart: belly-up pushes them 43 mm through the floor
a, b, st = [int(x) for x in os.environ['FRAMES'].split(',')]; out = []
for f in range(a, b + 1, st):
    sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get(); low = 9
    for o in obs:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); M = np.array(o.matrix_world)
        z = (np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3])[:, 2].min(); ev.to_mesh_clear(); low = min(low, z)
    out.append(f'{f}:{1000*low:.1f}')
print('LOW', ' '.join(out))
