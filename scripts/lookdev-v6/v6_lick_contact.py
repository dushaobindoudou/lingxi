"""Round ZZZ: Lick tongue-to-paw contact per frame - the evaluated LX_Tongue mesh against the raised paw's pad and four beans
(LX_FrontPad.R, LX_FrontBean0-3.R) and the paw's skin (LX_Body vertices weighted to FrontPaw.R / FrontToe*.R): nearest distance, mm
(negative = tongue vertices inside the pad / bean ellipsoid fit, approximately). Env FRAMES=a,b,step (525,572,1). Prints LICK frame {..}."""
import bpy, os, numpy as np
sc = bpy.context.scene
a, b, st = [int(x) for x in os.environ.get('FRAMES', '525,572,1').split(',')]
def pts(o, dg, mask=None):
    ev = o.evaluated_get(dg); me = ev.to_mesh(); M = np.array(o.matrix_world)
    co = np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3]; ev.to_mesh_clear()
    return co if mask is None else co[mask]
body = bpy.data.objects['LX_Body']; gn = {g.index: g.name for g in body.vertex_groups}
pm = np.array([any(gn.get(g.group, '').startswith(('FrontPaw.R', 'FrontToe')) and gn.get(g.group, '').endswith('.R') and g.weight > .5 for g in v.groups) for v in body.data.vertices])
parts = ['LX_FrontPad.R'] + [f'LX_FrontBean{i}.R' for i in range(4)]
for f in range(a, b + 1, st):
    sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
    t = pts(bpy.data.objects['LX_Tongue'], dg)
    out = {}
    for n in parts + ['skin']:
        q = pts(body, dg, pm) if n == 'skin' else pts(bpy.data.objects[n], dg)
        d = np.sqrt(((t[:, None, :] - q[None, ::max(1, len(q) // 1500), :]) ** 2).sum(2)).min()
        out[n.replace('LX_Front', '')] = round(1000 * float(d), 1)
    print('LICK', f, out)
