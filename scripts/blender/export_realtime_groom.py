"""Preserve a look-dev groom as skinned six-point ribbons, without re-grooming it.

blender -b <round>/lingxi-short-fur-rig-v5.blend --python <this file> -- \
  --out <app>/public/characters/lingxi-realistic/current --budget 240000

Only original strand indices are sampled. Positions, point colours, tapered radii and
per-point weights come from the Blender sources. Coordinates are converted to glTF Y-up.
Eyelid root displacements are sampled from their source shape keys, so the original
coat closes with the lid instead of floating over a closed eye.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--budget', type=int, default=240000)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
cat = (out / 'cat.glb').read_bytes()
gltf = json.loads(cat[20:20 + int.from_bytes(cat[12:16], 'little')])
joint_names = [gltf['nodes'][i]['name'] for i in gltf['skins'][0]['joints']]
joints = {name: i for i, name in enumerate(joint_names)}
sources = sorted((o for o in bpy.data.objects if o.name.startswith('LX_Fur_')), key=lambda o: o.name)
total = sum(len(o.data.vertices) // int(o['strand_points']) for o in sources)
rng = np.random.default_rng(7331)
parts, blocks, offset = [], [], 0

def store(a, dtype):
    global offset
    a = np.ascontiguousarray(a, dtype=dtype)
    raw = a.tobytes()
    pad = (-len(raw)) % 4
    descriptor = {'offset': offset, 'count': int(a.size)}
    blocks.append(raw + b'\0' * pad)
    offset += len(raw) + pad
    return descriptor

def yup(a):
    return np.stack((a[..., 0], a[..., 2], -a[..., 1]), axis=-1)

trees = {}
for src in sources:
    p = int(src['strand_points'])
    count = len(src.data.vertices) // p
    n = min(count, max(1, round(count * min(1, args.budget / total))))
    selected = np.sort(rng.choice(count, n, replace=False))
    xyz = np.empty(len(src.data.vertices) * 3, dtype='f')
    src.data.vertices.foreach_get('co', xyz)
    xyz = xyz.reshape(count, p, 3)[selected]
    # Source meshes are world-space in this asset. Fail instead of silently double-transforming a future asset.
    assert np.allclose(np.array(src.matrix_world), np.eye(4), atol=1e-6), src.name
    rgba = np.empty(len(src.data.vertices) * 4, dtype='f')
    src.data.attributes['fur_color'].data.foreach_get('color', rgba)
    colors = rgba.reshape(count, p, 4)[selected, :, :3]
    radius = np.empty(len(src.data.vertices), dtype='f')
    src.data.attributes['fur_radius'].data.foreach_get('value', radius)
    radius = radius.reshape(count, p)[selected]
    # Match native_fur_lingxi_v5.py, including its fine undercoat and face strand profile.
    native = np.interp(np.linspace(0, 1, p), np.linspace(0, 1, 4), [.00026, .00020, .00012, .000012])
    radius = radius[:, :1] / .00078 * native[None, :]
    indices = np.zeros((n, p, 4), dtype='<u2')
    weights = np.zeros((n, p, 4), dtype='<f4')
    names = {g.index: g.name for g in src.vertex_groups}
    for row, strand in enumerate(selected):
        for point in range(p):
            groups = sorted(((joints[names[g.group]], g.weight) for g in src.data.vertices[int(strand) * p + point].groups if names[g.group] in joints), key=lambda g: -g[1])[:4]
            assert groups and sum(w for _, w in groups) > 0, (src.name, int(strand), point)
            for col, (bone, weight) in enumerate(groups):
                indices[row, point, col], weights[row, point, col] = bone, weight
    weights /= weights.sum(axis=2, keepdims=True)
    region = src.name.split('_', 3)[-1]
    base_name = 'LX_Head' if region in ('LX_NoseVelvet',) else 'LX_Body' if region in ('LX_Legs', 'LX_SoleSrc') else 'LX_Tail' if region == 'LX_TailTip' else region
    base = bpy.data.objects.get(base_name)
    assert base is not None, base_name
    if base_name not in trees:
        tree = KDTree(len(base.data.vertices))
        ns = []
        normal_matrix = base.matrix_world.to_3x3().inverted().transposed()
        for i, v in enumerate(base.data.vertices):
            tree.insert(base.matrix_world @ v.co, i)
            ns.append(tuple((normal_matrix @ v.normal).normalized()))
        tree.balance()
        trees[base_name] = tree, np.array(ns)
    tree, ns = trees[base_name]
    nearest = [tree.find(Vector(root))[1] for root in xyz[:, 0]]
    normals = ns[nearest]
    morphs = {}
    if 'Lid' in base_name and base.data.shape_keys:
        basis = np.array([v.co[:] for v in base.data.shape_keys.key_blocks[0].data])
        for key in list(base.data.shape_keys.key_blocks)[1:]:
            delta = np.array([v.co[:] for v in key.data]) - basis
            morphs[key.name] = store(yup(delta[nearest]), '<f4')
    parts.append({'name': src.name, 'strands': n, 'sourceStrands': count, 'points': p,
                  'positions': store(yup(xyz), '<f4'), 'colors': store(colors, '<f4'),
                  'radii': store(radius, '<f4'), 'normals': store(yup(normals), '<f4'),
                  'joints': store(indices, '<u2'), 'weights': store(weights, '<f4'), 'skinPerPoint': True,
                  'morphTarget': base_name if morphs else None, 'morphs': morphs,
                  'widthCompensation': min(2.0, (count / n) ** .5)})
    print('GROOM_PART', src.name, n, '/', count, flush=True)

(out / 'groom.bin').write_bytes(b''.join(blocks))
manifest = {'version': 1, 'source': Path(bpy.data.filepath).parent.name,
            'modelSha256': hashlib.sha256(cat).hexdigest(), 'jointNames': joint_names,
            'coordinateSpace': 'gltf-rest', 'sourceStrands': total,
            'strands': sum(part['strands'] for part in parts), 'parts': parts, 'bytes': offset}
(out / 'groom.json').write_text(json.dumps(manifest, indent=2))
print('GROOM_EXPORTED', json.dumps({k: manifest[k] for k in ('source', 'sourceStrands', 'strands', 'bytes')}), flush=True)
