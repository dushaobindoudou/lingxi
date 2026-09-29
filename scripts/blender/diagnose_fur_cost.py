"""Measure where the v5 fur pipeline actually spends memory, at a safe small scale.

Runs entirely in a throwaway scene, so it never touches the 36 MB .blend and never
reaches production fur counts. It reports RSS (and wall time) per stage, plus the
per-strand cost, so those numbers can be extrapolated to the real build instead of
having to reproduce the 50 GB blow-up to study it.

    blender --background --python scripts/blender/diagnose_fur_cost.py -- --strands 40000

Stages measured:
  build    nylon polynomials are created and weights bound
  convert  strands -> render curves (what native_fur_lingxi_v5.py does)
  render   one Cycles frame, which is where hair BVH and denoise buffers live
  release  what the session gets back after dropping the source mesh
"""
import bpy, json, sys, time, resource, gc
import numpy as np

def cli(name, default):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return next((float(a.split('=', 1)[1]) for a in argv if a.startswith(f'--{name}=')), default)

N = int(cli('strands', 40000))
SAMPLES = int(cli('samples', 16))
RES = int(cli('res', 256))

def rss():
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(v / (1024 ** 3 if sys.platform == 'darwin' else 1024 ** 2), 4)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
report = {'strands': N, 'samples': SAMPLES, 'res': RES, 'stages_gb': {}}
t0 = time.time()

# ---- stage: build
rng = np.random.default_rng(3)
root = rng.random((N, 3)) * .2
pts = np.repeat(root, 4, axis=0)
pts[:, 0] += np.tile(np.arange(4) * .008, N)
idx = np.arange(N * 4).reshape(N, 4)
edges = np.column_stack((idx[:, :-1].ravel(), idx[:, 1:].ravel()))
me = bpy.data.meshes.new('Strands')
me.from_pydata(pts.tolist(), edges.tolist(), [])
ob = bpy.data.objects.new('LX_Fur_Probe', me)
scene.collection.objects.link(ob)
col = me.attributes.new('fur_color', 'FLOAT_COLOR', 'POINT')
col.data.foreach_set('color', rng.random((N * 4, 4)).astype('f').ravel())
rad = me.attributes.new('fur_radius', 'FLOAT', 'POINT')
rad.data.foreach_set('value', np.tile([.0004, .0003, .0002, .0001], N).astype('f'))
del pts, edges, root, idx
gc.collect()
report['stages_gb']['after_build'] = rss()

# ---- weight binding: the algorithm build_lingxi_v5.py uses today.
# np.where scans the WHOLE array once per distinct weight, then materialises a
# Python list; cost is O(unique_values x vertices), not O(vertices).
vals = rng.random(N * 4)
q = np.round(vals * 1000).astype(int)
g = ob.vertex_groups.new(name='Spine')
tb = time.time()
for v in np.unique(q):
    if v > 0:
        g.add(np.where(q == v)[0].tolist(), float(v) / 1000, 'REPLACE')
report['old_bind_seconds'] = round(time.time() - tb, 2)
report['old_bind_unique_weights'] = int(len(np.unique(q)))
gc.collect()
report['stages_gb']['after_bind'] = rss()

# ---- stage: convert to render curves
d = bpy.data.hair_curves.new('Probe')
d.add_curves([4] * N)
arr = np.empty(N * 4 * 3, dtype='f')
me.vertices.foreach_get('co', arr)
d.attributes['position'].data.foreach_set('vector', arr)
d.attributes.new('radius', 'FLOAT', 'POINT').data.foreach_set(
    'value', np.tile([.00026, .0002, .00012, .000012], N).astype('f'))
cmat = bpy.data.materials.new('ProbeFur')
d.materials.append(cmat)
cob = bpy.data.objects.new('LX_RenderFur_Probe', d)
scene.collection.objects.link(cob)
del arr
gc.collect()
report['stages_gb']['after_convert'] = rss()

# ---- stage: render
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.image_settings.file_format = 'PNG'
cam = bpy.data.cameras.new('C')
camobj = bpy.data.objects.new('C', cam)
scene.collection.objects.link(camobj)
scene.camera = camobj
camobj.location = (.45, -.9, .45)
camobj.rotation_euler = (.9, 0, .8)
tr = time.time()
bpy.ops.render.render(write_still=True)
report['render_seconds'] = round(time.time() - tr, 2)
report['stages_gb']['after_render'] = rss()

# ---- stage: release the source the way native_fur never does
bpy.data.objects.remove(ob)
bpy.data.meshes.remove(me)
del q, vals
gc.collect()
report['stages_gb']['after_release_source'] = rss()

report['gb_per_1k_strands_render'] = round(report['stages_gb']['after_render'] / (N / 1000), 4)
report['seconds_total'] = round(time.time() - t0, 1)
print(json.dumps(report, indent=2))
