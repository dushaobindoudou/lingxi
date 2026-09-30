"""Verify the v5 rig actually deforms what it should - and only what it should.

Static checks catch the quiet failures (a vertex group whose bone was renamed, weights
that never summed to 1, vertices bound to nothing and therefore glued to the origin).
Dynamic checks pose a bone and measure the resulting displacement, comparing three
groups of points:

  should move   - vertices weighted mainly to the posed bone
  should stay   - vertices with zero weight for it (e.g. hind paws when the head turns)
  fur           - render curves, which must follow their skinned source strands

    blender --background assets/.../lingxi-short-fur-rig-v5.blend \
        --python scripts/blender/verify_rig_deform.py

Prints one JSON object. Any "FAIL" is a rig bug, not a taste question.
"""
import bpy, json, numpy as np

scene = bpy.context.scene
rig = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
if rig is None:
    raise SystemExit('no armature in scene')

report = {'armature': rig.name, 'static': {}, 'dynamic': {}}

# ---------- static ----------
bone_names = {b.name for b in rig.data.bones}
orphan_groups, unweighted_verts, sum_error = [], [], []
skinned = [o for o in scene.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
report['static']['skinned_meshes'] = len(skinned)
# A rendered mesh with no armature at all never moves: it stays at its rest position while the
# cat walks off (the paw pads once sat on the floor as pink dots through a sit). Only the studio
# set may be static.
unbound = sorted(o.name for o in scene.objects
                 if o.type == 'MESH' and not o.hide_render and o not in skinned
                 and not o.name.startswith(('Studio', 'Ground', 'Floor')))
report['static']['rendered_meshes_without_armature'] = unbound

for o in skinned:
    for vg in o.vertex_groups:
        if vg.name not in bone_names:
            orphan_groups.append(f'{o.name}:{vg.name}')
    if not len(o.data.vertices):
        continue
    weights = np.zeros(len(o.data.vertices))
    for vg in o.vertex_groups:
        try:
            sel = bpy.data.objects[o.name].data.vertices
        except Exception:
            continue
    # sample via a temporary attribute-free path: iterate vertices once
    total = np.zeros(len(o.data.vertices))
    for i, v in enumerate(o.data.vertices):
        s = 0.0
        for g in v.groups:
            s += g.weight
        total[i] = s
    zero = int((total < 1e-6).sum())
    if zero:
        unweighted_verts.append({'mesh': o.name, 'unweighted': zero, 'total': len(total)})
    # only judge normalisation on vertices that are bound at all
    bound = total[total > 1e-6]
    if len(bound):
        sum_error.append({'mesh': o.name, 'min': float(bound.min()), 'max': float(bound.max())})

report['static']['orphan_vertex_groups'] = orphan_groups
report['static']['meshes_with_unweighted_verts'] = unweighted_verts
report['static']['weight_sum_range'] = sum_error

# ---------- dynamic ----------
def world_points(obj_name, use_curves=False):
    """Evaluated world-space coordinates of an object's geometry."""
    o = bpy.data.objects[obj_name]
    deps = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(deps)
    if use_curves or ev.type == 'CURVES':
        attr = ev.data.attributes.get('position')
        arr = np.empty(len(attr.data) * 3, dtype='f')
        attr.data.foreach_get('vector', arr)
        pts = arr.reshape(-1, 3)
    else:
        arr = np.empty(len(ev.data.vertices) * 3, dtype='f')
        ev.data.vertices.foreach_get('co', arr)
        pts = arr.reshape(-1, 3)
    if not use_curves and ev.type != 'CURVES' and len(pts) > len(o.data.vertices):
        pts = pts[:len(o.data.vertices)]    # Solidify appends its shell after the original vertices
    mw = np.array(ev.matrix_world)
    homo = np.column_stack((pts, np.ones(len(pts))))
    return (homo @ mw.T)[:, :3]

def bone_subtree(bone):
    """A bone plus everything parented under it. Rotating an upper leg must carry the
    lower leg and the paw, so "unweighted" can only mean unweighted for the WHOLE
    subtree - judging the bone alone flags correct hierarchy motion as a failure."""
    names, stack = {bone}, [bone]
    while stack:
        b = stack.pop()
        for child in rig.data.bones[b].children:
            if child.name not in names:
                names.add(child.name)
                stack.append(child.name)
    return names

def subtree_weights(obj_name, bone):
    return sum(group_weights(obj_name, b) for b in bone_subtree(bone))

def group_weights(obj_name, bone):
    """Per-vertex weight for one bone, without touching edit mode."""
    o = bpy.data.objects[obj_name]
    vg = o.vertex_groups.get(bone)
    n = len(o.data.vertices)
    w = np.zeros(n)
    if vg is None:
        return w
    for i in range(n):
        try:
            w[i] = vg.weight(i)
        except RuntimeError:
            w[i] = 0.0
    return w

# The rig ships with NLA clips and shape-key actions. Setting a pose bone's rotation while
# those evaluate only changes it until the next update overwrites it from the action, which
# makes the measurement show animation drift instead of skinning. Strip animation first.
# Nothing is saved, so the file on disk keeps its clips.
for o in list(scene.objects):
    if o.animation_data:
        o.animation_data_clear()
for datablock in (getattr(o.data, 'shape_keys', None) for o in scene.objects):
    if datablock is not None and datablock.animation_data:
        datablock.animation_data_clear()

TESTS = [
    # bone, rotation euler (radians), mesh to measure
    ('Head', (0.0, 0.45, 0.0), 'LX_Head'),
    ('FrontUpper.L', (-0.7, 0.0, 0.0), 'LX_Body'),
    ('RearUpper.R', (0.6, 0.0, 0.0), 'LX_Body'),
    ('Tail2', (0.5, 0.0, 0.0), 'LX_Tail'),
    ('Jaw', (-0.35, 0.0, 0.0), 'LX_Jaw'),
    ('Scap.L', (0.4, 0.0, 0.0), 'LX_Body'),
    ('LidUpper.L', (-0.2, 0.0, 0.0), 'LX_LidUpper.L'),
]

for bone, rot, mesh in TESTS:
    pb = rig.pose.bones.get(bone)
    if pb is None:
        report['dynamic'][bone] = 'FAIL: bone missing'
        continue
    if mesh not in bpy.data.objects:
        report['dynamic'][bone] = f'FAIL: mesh {mesh} missing'
        continue

    # rest
    for p in rig.pose.bones:
        p.rotation_euler = (0, 0, 0)
    scene.frame_set(1)
    bpy.context.view_layer.update()
    base = world_points(mesh)
    base_fur = None
    fur_obj = next((o.name for o in scene.objects
                    if o.type == 'CURVES' and mesh.replace('LX_', '') in o.name), None)
    if fur_obj:
        base_fur = world_points(fur_obj, use_curves=True)

    # posed
    pb.rotation_euler = rot
    bpy.context.view_layer.update()
    moved = world_points(mesh)
    disp = np.linalg.norm(moved - base, axis=1)

    w = group_weights(mesh, bone)
    should_move = w > 0.35
    # Anything the posed bone or its children influence may legitimately move;
    # the rest of the cat must not.
    w_sub = subtree_weights(mesh, bone)
    should_stay = w_sub < 1e-6
    res = {
        'posed_degrees': round(float(np.degrees(max(abs(r) for r in rot))), 1),
        'moved_mean_mm': round(float(disp[should_move].mean() * 1000), 2) if should_move.any() else None,
        'moved_max_mm': round(float(disp[should_move].max() * 1000), 2) if should_move.any() else None,
        'stay_mean_mm': round(float(disp[should_stay].mean() * 1000), 4) if should_stay.any() else None,
        'stay_max_mm': round(float(disp[should_stay].max() * 1000), 4) if should_stay.any() else None,
    }
    # When an unweighted vertex moves, name the region it belongs to: that is the bone
    # that is wrongly dragging it, and the mesh area to look at.
    if should_stay.any():
        idx = np.where(should_stay)[0]
        worst = idx[int(np.argmax(disp[idx]))]
        vert = bpy.data.objects[mesh].data.vertices[int(worst)]
        if len(vert.groups):
            top = max(vert.groups, key=lambda g: g.weight)
            res['worst_stay'] = {
                'vertex': int(worst),
                'moved_mm': round(float(disp[idx].max() * 1000), 2),
                'dominant_group': bpy.data.objects[mesh].vertex_groups[top.group].name,
                'position': [round(float(c), 4) for c in vert.co],
            }
    if fur_obj:
        fur_now = world_points(fur_obj, use_curves=True)
        fur_disp = np.linalg.norm(fur_now - base_fur, axis=1)
        res['fur_follows_mean_mm'] = round(float(fur_disp.mean() * 1000), 2)
        res['fur_follows'] = bool(fur_disp.mean() > 1e-5)

    ok = True
    if res['moved_mean_mm'] is None or res['moved_mean_mm'] < 1.0:
        ok = False                      # weighted region did not follow the bone
    if res['stay_max_mm'] is not None and res['stay_max_mm'] > 2.0:
        ok = False                      # unweighted region dragged along
    if fur_obj and not res['fur_follows']:
        ok = False                      # fur stayed behind the skin
    res['verdict'] = 'PASS' if ok else 'FAIL'
    report['dynamic'][bone] = res

    pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()

report['summary'] = {
    'orphan_groups': len(orphan_groups),
    'meshes_with_unweighted_vertices': len(unweighted_verts),
    'rendered_meshes_without_armature': len(unbound),
    'failed_bones': [k for k, v in report['dynamic'].items() if isinstance(v, dict) and v.get('verdict') == 'FAIL'],
}
print(json.dumps(report, indent=2, ensure_ascii=False))
