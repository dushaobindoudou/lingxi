"""Rig v1 face: apply face-controls.json (written by build_lingxi_v5.py) to a built rig, and render face sheets.

As a module:  apply(values)  sets the face from {control: value} (controls add; everything not named goes back to rest).
              expression(name) / layer_state(layer, state) give those values.
As a script (blender -b <rig>.blend --python v6_face_apply.py):
  FACE_JSON  path to face-controls.json (default: next to the .blend)
  FACE_ITEMS 'layers' (every state of every layer) | 'expressions' (the 30) | comma list of expression names
  FACE_OUT   output dir (one PNG per item + sheet.png)    FRAME (1)   RES (360)   SAMPLES (12)
"""
import bpy, json, math, os
from mathutils import Vector, Quaternion, Matrix

SPEC = None
REST = {}


def load(path=None):
    global SPEC
    path = path or os.environ.get('FACE_JSON') or os.path.join(os.path.dirname(bpy.data.filepath), 'face-controls.json')
    SPEC = json.load(open(path))
    return SPEC


def _rig():
    return bpy.data.objects['LX_Rig']


def _key_targets(name):
    if name.startswith('LX_'):
        return [o for o in bpy.data.objects if o.name == name and o.data and getattr(o.data, 'shape_keys', None)]
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith(name) and o.data.shape_keys]


def _remember_rest():
    if REST:
        return
    for m in bpy.data.materials:
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.name.startswith(('LX_Pupil', 'LX_Catch')):
                    REST[(m.name, n.name)] = n.outputs[0].default_value if n.type == 'VALUE' else n.inputs[1].default_value


def reset():
    _remember_rest()
    rig = _rig()
    bones = set()
    for acts in SPEC['controls'].values():
        for a in acts:
            if a[0] in ('loc', 'loc_local', 'rot', 'rotarm'):
                bones.add(a[1])
            elif a[0] == 'key':
                for o in _key_targets(a[1]):
                    kb = o.data.shape_keys.key_blocks.get(a[2])
                    if kb:
                        kb.value = 0
    for sf in 'LR':
        bones |= {'Ear.' + sf, 'EarTip.' + sf}
    for b in bones:
        pb = rig.pose.bones.get(b)
        if pb:
            pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0)
    for (mn, nn), v in REST.items():
        n = bpy.data.materials[mn].node_tree.nodes[nn]
        if n.type == 'VALUE':
            n.outputs[0].default_value = v
        else:
            n.inputs[1].default_value = v


def _rest3(bone):
    return _rig().data.bones[bone].matrix_local.to_3x3()


def _turn(pb, axis_arm, ang):
    """Add a turn of `ang` about an armature-space axis to a pose bone (XYZ euler)."""
    ax = (_rest3(pb.name).inverted() @ Vector(axis_arm)).normalized()
    q = Quaternion(ax, ang) @ pb.rotation_euler.to_quaternion()
    pb.rotation_euler = q.to_euler('XYZ')


def apply(values):
    reset()
    rig = _rig()
    ear = {sf: dict(fwd=0.0, flat=0.0, swivel=0.0, tip=0.0) for sf in 'LR'}
    pupil = {}
    for name, v in values.items():
        for a in SPEC['controls'].get(name, []):
            kind = a[0]
            if kind == 'key':
                for o in _key_targets(a[1]):
                    kb = o.data.shape_keys.key_blocks.get(a[2])
                    if kb:
                        kb.value = min(kb.slider_max, kb.value + v * (a[3] if len(a) > 3 else 1.0))
            elif kind == 'mat':
                pupil[(a[1], a[2])] = v                      # absolute
            elif kind == 'loc':
                pb = rig.pose.bones[a[1]]
                pb.location = Vector(pb.location) + _rest3(a[1]).inverted() @ (Vector(a[2]) * v)
            elif kind == 'loc_local':
                pb = rig.pose.bones[a[1]]; pb.location = Vector(pb.location) + Vector(a[2]) * v
            elif kind == 'rot':
                pb = rig.pose.bones[a[1]]; pb.rotation_euler = Vector(pb.rotation_euler) + Vector(a[2]) * v
            elif kind == 'rotarm':
                _turn(rig.pose.bones[a[1]], a[2], a[3] * v)
            elif kind == 'ear':
                ear[a[1]][a[2]] += v * a[3]
            elif kind == 'catch':
                for (mn, nn), base in REST.items():
                    if mn == a[1] and nn.startswith('LX_Catch'):
                        bpy.data.materials[mn].node_tree.nodes[nn].inputs[1].default_value = base * (1 + (a[2] - 1) * v)
    for (mn, nn), v in pupil.items():
        bpy.data.materials[mn].node_tree.nodes[nn].outputs[0].default_value = v
    for sf, e in ear.items():
        s = -1 if sf == 'L' else 1
        root = rig.pose.bones['Ear.' + sf]
        b = rig.data.bones
        axis = (Vector(b['EarTip.' + sf].tail_local) - Vector(b['Ear.' + sf].head_local)).normalized()
        # forward: tip toward -y (about +X); flatten: tip out to the side (about +Y, toward s*x); swivel: the opening turns out
        _turn(root, axis, s * e['swivel'])
        _turn(root, (0, 1, 0), s * e['flat'])
        _turn(root, (1, 0, 0), e['fwd'])
        _turn(rig.pose.bones['EarTip.' + sf], (1, 0, 0), -e['tip'])     # + folds the tip back
    bpy.context.view_layer.update()


def layer_state(layer, state):
    return dict(SPEC['layers'][layer].get(state, {}))


def expression(name):
    e = SPEC['expressions'][name]; out = {}
    for layer in ('eye', 'brow', 'mouth', 'ear'):
        for k, v in layer_state(layer, e[layer]).items():
            out[k] = out.get(k, 0) + v
    return out


def _face_camera(res):
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    h = bpy.data.objects['LX_Head'].evaluated_get(dg)
    pts = [h.matrix_world @ Vector(c) for c in h.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    cam = sc.camera
    cam.data.type = 'ORTHO'; cam.data.dof.use_dof = False
    cam.data.ortho_scale = (hi.x - lo.x) * 1.45
    c = Vector(((lo.x + hi.x) / 2, lo.y - 1.0, lo.z + (hi.z - lo.z) * .52))
    cam.location = c
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.render.resolution_x = sc.render.resolution_y = res


if __name__ == '__main__':
    load()
    sc = bpy.context.scene
    sc.frame_set(int(os.environ.get('FRAME', 1)))
    res = int(os.environ.get('RES', 360))
    sc.render.engine = 'CYCLES'; sc.cycles.samples = int(os.environ.get('SAMPLES', 12)); sc.cycles.use_denoising = True
    items = os.environ.get('FACE_ITEMS', 'layers')
    if items == 'layers':
        todo = [(f'{layer}:{st}', layer_state(layer, st)) for layer in ('eye', 'brow', 'mouth', 'ear') for st in SPEC['layers'][layer]]
    elif items == 'expressions':
        todo = [(n, expression(n)) for n in SPEC['expressions']]
    else:
        todo = [(n, expression(n)) for n in items.split(',')]
    out = os.environ.get('FACE_OUT', os.path.join(os.path.dirname(bpy.data.filepath), 'face-sheet'))
    os.makedirs(out, exist_ok=True)
    # the clip keys every pose bone and shape key: mute the NLA so the face table alone sets the face
    for data in [bpy.data.objects['LX_Rig']] + [o.data.shape_keys for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]:
        if data and data.animation_data:
            for t in data.animation_data.nla_tracks:
                t.mute = True
    rig = _rig()
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    files = []
    for i, (name, vals) in enumerate(todo):
        apply(vals)
        _face_camera(res)
        fn = os.path.join(out, f'{i:02d}.png'); sc.render.filepath = fn
        bpy.ops.render.render(write_still=True); files.append((name, fn))
        print('FACE_ITEM', i, name, json.dumps(vals, ensure_ascii=False))
    json.dump(files, open(os.path.join(out, 'items.json'), 'w'), ensure_ascii=False)
    print('FACE_SHEET', out, len(files))
