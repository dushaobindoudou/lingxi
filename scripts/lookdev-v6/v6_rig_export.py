"""Rig v1 freeze: write the skeleton contract of a built rig.

blender -b <rig>.blend --python v6_rig_export.py   (RIG_JSON: output path, default rig-v1.json next to the .blend)

For every bone: parent, rest head / tail (metres, armature space), length, deform, group (what it is for). With face-controls.json
(written by build_lingxi_v5.py) this is the interface the app builds against; after the freeze a new bone means a new spec version.
"""
import bpy, json, os

rig = bpy.data.objects['LX_Rig']
GROUPS = [
    ('trunk', ('Root', 'Pelvis', 'Loin', 'LoinB', 'Spine', 'Chest')),
    ('neck-head', ('Neck', 'NeckB', 'Head', 'Jaw')),
    ('ear', ('Ear.', 'EarTip.')),
    ('eye', ('Eye.', 'LidUpper.', 'LidLower.')),
    ('face-control', ('BrowIn.', 'BrowOut.', 'MouthCorner.', 'LipUp.', 'LipLow', 'NoseSide.', 'Nostril.', 'LipUpper', 'Nose', 'Whisker.')),
    ('tongue', ('Tongue',)),
    ('foreleg', ('Scap.', 'FrontUpper.', 'FrontLower.', 'ForearmTwist.', 'FrontPaw.', 'FrontFoot.', 'FrontToe')),
    ('hindleg', ('RearUpper.', 'RearLower.', 'RearPaw.', 'RearFoot.', 'RearToe')),
    ('tail', ('Tail',)),
]


def group(name):
    for g, pre in GROUPS:
        if name in pre or any(name.startswith(p) for p in pre if p.endswith('.') or p in ('FrontToe', 'RearToe', 'Tongue', 'Tail')):
            return g
    return 'other'


bones = []
for b in rig.data.bones:
    bones.append({'name': b.name, 'parent': b.parent.name if b.parent else None, 'group': group(b.name),
                  'head': [round(v, 5) for v in b.head_local], 'tail': [round(v, 5) for v in b.tail_local],
                  'length': round(b.length, 5), 'deform': b.use_deform})
skins = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.name.startswith('LX_') and not o.name.startswith('LX_Fur_') and not o.hide_render:
        sk = [k.name for k in o.data.shape_keys.key_blocks[1:]] if o.data.shape_keys else []
        skins[o.name] = {'vertices': len(o.data.vertices), 'groups': len(o.vertex_groups), 'shape_keys': sk}
out = os.environ.get('RIG_JSON') or os.path.join(os.path.dirname(bpy.data.filepath), 'rig-v1.json')
counts = {}
for b in bones:
    counts[b['group']] = counts.get(b['group'], 0) + 1
json.dump({'version': 1, 'bones': bones, 'bone_count': len(bones), 'by_group': counts, 'meshes': skins,
           'clips': [t.name for t in rig.animation_data.nla_tracks] if rig.animation_data else []},
          open(out, 'w'), indent=1, ensure_ascii=False)
print('RIG_EXPORT', out, len(bones), counts)
