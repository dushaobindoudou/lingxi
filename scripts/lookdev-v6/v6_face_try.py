"""Try face control values on a built rig without rebuilding: FACE_TRY = JSON list of [label, {control: value}] (or a path to one).
blender -b <rig>.blend --python v6_face_try.py   (FACE_OUT dir, RES, SAMPLES, ZOOM = fraction of the face camera's width, ZOOM_Z = up shift)"""
import bpy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import v6_face_apply as F
F.load()
sc = bpy.context.scene; sc.frame_set(1)
sc.render.engine = 'CYCLES'; sc.cycles.samples = int(os.environ.get('SAMPLES', 16)); sc.cycles.use_denoising = True
for data in [bpy.data.objects['LX_Rig']] + [o.data.shape_keys for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]:
    if data and data.animation_data:
        for t in data.animation_data.nla_tracks: t.mute = True
for pb in bpy.data.objects['LX_Rig'].pose.bones:
    pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
raw = os.environ['FACE_TRY']; todo = json.load(open(raw)) if os.path.exists(raw) else json.loads(raw)
out = os.environ.get('FACE_OUT', '/tmp/face-try'); os.makedirs(out, exist_ok=True)
for i, (label, vals) in enumerate(todo):
    raw = {k: v for k, v in vals.items() if ':' in k}; F.apply({k: v for k, v in vals.items() if ':' not in k})
    for k, v in raw.items():   # 'key:<object>:<shape key>' = value, 'rot:<bone>' = [x, y, z] added, 'mat:<material>:<node>' = value
        kind, *rest = k.split(':')
        if kind == 'key': bpy.data.objects[rest[0]].data.shape_keys.key_blocks[rest[1]].value = v
        elif kind == 'rot': pb = bpy.data.objects['LX_Rig'].pose.bones[rest[0]]; pb.rotation_euler = [a + b for a, b in zip(pb.rotation_euler, v)]
        elif kind == 'mat': bpy.data.materials[rest[0]].node_tree.nodes[rest[1]].outputs[0].default_value = v
    bpy.context.view_layer.update(); F._face_camera(int(os.environ.get('RES', 300)))
    cam = sc.camera; z = float(os.environ.get('ZOOM', 1)); cam.data.ortho_scale *= z; cam.location.z += float(os.environ.get('ZOOM_Z', 0))
    sc.render.filepath = os.path.join(out, f'{i:02d}-{label}.png'); bpy.ops.render.render(write_still=True)
    print('FACE_TRY', i, label)
