"""Read-only memory forensics for the v5 fur rig.

This opens the built .blend and takes an inventory of what it actually holds,
plus Blender's own RSS. It deliberately does NOT render and does NOT evaluate
the depsgraph, so its own footprint stays in the hundreds of MB - it exists to
answer "where did the memory go" without reproducing the 50 GB render.

    BLENDER_BIN=... blender --background assets/.../v5/lingxi-*.blend \
        --python scripts/blender/diagnose_v5_memory.py [--json]

Optional: --synthetic also builds a controlled strand mesh in a fresh scene and
measures the cost of keeping versus deleting the source after curves conversion.
"""
import bpy, json, sys, resource, gc

def rss_gb():
    # ru_maxrss is bytes on macOS, kilobytes on Linux.
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(v / (1024 ** 3 if sys.platform == 'darwin' else 1024 ** 2), 3)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SYNTHETIC = '--synthetic' in argv

report = {'rss_after_open_gb': rss_gb()}

def inventory():
    objects, mesh_bytes, curve_bytes = [], 0, 0
    for o in bpy.data.objects:
        d = o.data
        if o.type == 'MESH':
            nv, ne, npoly = len(d.vertices), len(d.edges), len(d.polygons)
            attrs = {a.name: len(a.data) for a in getattr(d, 'attributes', [])}
            # Blender overhead per vertex is dominated by position+loops+edges;
            # 200 B is a conservative upper bound, attrs counted separately.
            est = nv * 200 + sum(v * (16 if 'color' in k else 4) for k, v in attrs.items())
            if o.name.startswith('LX_Fur_') or o.name.startswith('LX_RenderFur_'):
                mesh_bytes += est
            objects.append(dict(name=o.name, kind='MESH', verts=nv, edges=ne, polys=npoly,
                                attrs=attrs, est_bytes=est))
        elif o.type == 'CURVES':
            pos = d.attributes.get('position')
            n = len(pos.data) if pos else 0
            est = n * 120  # position + radius + curve offsets/tables
            curve_bytes += est
            objects.append(dict(name=o.name, kind='CURVES', points=n, est_bytes=est))
        else:
            objects.append(dict(name=o.name, kind=o.type))
    return objects, mesh_bytes, curve_bytes

objects, mesh_bytes, curve_bytes = inventory()
report['objects'] = objects
report['strand_mesh_bytes'] = mesh_bytes
report['render_curve_bytes'] = curve_bytes
report['objects_total'] = len(objects)
report['datablocks'] = {k: len(v) for k, v in [('meshes', bpy.data.meshes), ('curves', bpy.data.hair_curves),
                                               ('materials', bpy.data.materials), ('images', bpy.data.images),
                                               ('node_groups', bpy.data.node_groups), ('actions', bpy.data.actions)]}

# The headline question: after native_fur converts each strand MESH into CURVES,
# is the source mesh still in the scene? If yes the same 1.2M points are held twice.
sources = [o['name'] for o in objects if o['kind'] == 'MESH' and o['name'].startswith('LX_Fur_')]
renders = [o['name'] for o in objects if o['kind'] == 'CURVES']
report['source_strand_meshes_kept'] = sources
report['render_curve_objects'] = renders
report['duplicate_holding'] = bool(sources and renders)
report['duplicate_bytes_estimate'] = min(mesh_bytes, curve_bytes)

if SYNTHETIC:
    # Controlled measurement in a clean scene: build N strands, convert to curves,
    # then delete the source and see what comes back.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import numpy as np
    n = 120000
    rng = np.random.default_rng(7)
    root = rng.random((n, 3))
    pts = np.repeat(root, 4, axis=0) + np.tile(np.arange(4) * .01, (n, 1))[:, None]
    edges = np.column_stack((np.arange(n * 4).reshape(n, 4)[:, :-1].ravel(),
                             np.arange(n * 4).reshape(n, 4)[:, 1:].ravel()))
    me = bpy.data.meshes.new('Strands')
    me.from_pydata(pts.tolist(), edges.tolist(), [])
    ob = bpy.data.objects.new('LX_Fur_Probe', me)
    bpy.context.scene.collection.objects.link(ob)
    col = me.attributes.new('fur_color', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', (rng.random((n * 4, 4))).astype('f').ravel())
    r = me.attributes.new('fur_radius', 'FLOAT', 'POINT')
    r.data.foreach_set('value', np.tile([.0004, .0003, .0002, .0001], n).astype('f'))
    del edges
    gc.collect()
    base = rss_gb()

    d = bpy.data.hair_curves.new('Probe')
    d.add_curves([4] * n)
    arr = np.empty(n * 4 * 3, dtype='f')
    me.vertices.foreach_get('co', arr)
    d.attributes['position'].data.foreach_set('vector', arr)
    del arr
    gc.collect()
    report['rss_after_probe_mesh_gb'] = base
    report['rss_after_curves_gb'] = rss_gb()
    report['cost_of_curves_gb'] = round(rss_gb() - base, 3)

    # The fix being evaluated: stop keeping the source once curves own the data.
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    gc.collect()
    report['rss_after_deleting_source_gb'] = rss_gb()
    report['reclaimed_gb'] = round(report['rss_after_curves_gb'] - report['rss_after_deleting_source_gb'], 3)

print(json.dumps(report, indent=2, ensure_ascii=False))
