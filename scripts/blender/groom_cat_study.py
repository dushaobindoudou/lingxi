"""Third 3D study: explicit tapered hair curves with regional comb directions.
Run with v2 active in the official Blender MCP session. Still unapproved artwork.
"""
import bpy
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
assert bpy.context.scene.get('stage', '').startswith('Unapproved facial structure')
bpy.ops.scene.new(type='FULL_COPY')
scene = bpy.context.scene
scene.name = 'Lingxi • Combed Hair Study v3'
scene['stage'] = 'Unapproved combed-hair study v3; offline render, no runtime rig'
rng = np.random.default_rng(20260911)
collection = bpy.data.collections.new('LX_v3_RegionalGroom')
scene.collection.children.link(collection)

def select(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

def normalize(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)

def make_groom(o, count, length, region):
    materials = [m for m in o.data.materials if m and m.use_nodes]
    hair_material = next((m for m in materials if any(n.bl_idname == 'ShaderNodeBsdfHairPrincipled' for n in m.node_tree.nodes)), None)
    if hair_material is None:
        return 0
    select(o)
    while o.particle_systems:
        bpy.ops.object.particle_system_remove()
    mesh = o.data
    mesh.calc_loop_triangles()
    verts = np.empty(len(mesh.vertices)*3, dtype=np.float32)
    mesh.vertices.foreach_get('co', verts)
    verts = verts.reshape(-1, 3)
    normals = np.empty_like(verts)
    mesh.vertices.foreach_get('normal', normals.ravel())
    triangles = np.empty(len(mesh.loop_triangles)*3, dtype=np.int32)
    mesh.loop_triangles.foreach_get('vertices', triangles)
    triangles = triangles.reshape(-1, 3)
    corners = verts[triangles]
    weights = np.linalg.norm(np.cross(corners[:, 1]-corners[:, 0], corners[:, 2]-corners[:, 0]), axis=1)
    indices = rng.choice(len(triangles), count, p=weights/weights.sum())
    uv = rng.random((count, 2))
    uv[uv.sum(axis=1)>1] = 1-uv[uv.sum(axis=1)>1]
    bary = np.column_stack((1-uv.sum(axis=1), uv))
    roots = (corners[indices]*bary[:, :, None]).sum(axis=1)
    normals = normalize((normals[triangles[indices]]*bary[:, :, None]).sum(axis=1))
    if region == 'head':
        # Do not grow hair inside the eye sockets or over the tiny nose/mouth.
        near_front = roots[:, 1] < -.048
        eyes = np.zeros(count, dtype=bool)
        for side in [-1, 1]:
            eyes |= ((roots[:, 0]-side*.043)/.027)**2 + ((roots[:, 2]-.007)/.026)**2 < 1.05
        muzzle_center = (abs(roots[:, 0]) < .014) & (roots[:, 2] < -.022) & (roots[:, 1] < -.082)
        keep = ~(near_front & (eyes | muzzle_center))
        roots, normals = roots[keep], normals[keep]
    count = len(roots)
    direction = np.zeros_like(roots)
    if region == 'head':
        direction[:, 0] = np.sign(roots[:, 0])*.85
        direction[:, 1] = .32
        direction[:, 2] = np.where(roots[:, 2] > .025, .15, -.65)
    elif region == 'chest':
        direction[:, 0] = np.sign(roots[:, 0])*.15
        direction[:, 2] = -1
    elif region == 'paw':
        direction[:, 1] = -1
        direction[:, 2] = -.12
    elif region == 'ear':
        direction[:, 2] = 1
        direction[:, 1] = .3
    else:
        direction[:, 1] = 1
        direction[:, 2] = -.25
    tangent = normalize(direction-(direction*normals).sum(axis=1)[:, None]*normals)
    sideways = normalize(np.cross(normals, tangent))
    lengths = length*rng.uniform(.6, 1.25, (count, 1))
    if region == 'head':
        lengths *= np.where(roots[:, 2:3] < -.015, 1.2, .75)
    samples = 7
    t = np.linspace(0, 1, samples)[None, :, None]
    phase = rng.random((count, 1, 1))*6.283
    # Each strand rises away from the surface, then follows the regional comb.
    positions = roots[:, None, :] + lengths[:, :, None]*(normals[:, None, :]*(.80*t-.36*t*t) + tangent[:, None, :]*(.45*t+.30*t*t))
    positions += sideways[:, None, :]*np.sin(t*5+phase)*(.0006*t)
    data = bpy.data.hair_curves.new('Groom_'+region)
    data.add_curves([samples]*count)
    data.attributes['position'].data.foreach_set('vector', positions.astype(np.float32).ravel())
    radius = data.attributes.new('radius', 'FLOAT', 'POINT')
    root_radius = rng.uniform(.000035, .000075, (count, 1))
    radii = root_radius*(1-np.linspace(0, 1, samples)[None, :])**.8+.000002
    radius.data.foreach_set('value', radii.astype(np.float32).ravel())
    groom = bpy.data.objects.new('LX_v3_Groom_'+o.name, data)
    collection.objects.link(groom)
    groom.matrix_world = o.matrix_world.copy()
    data.materials.append(hair_material)
    groom['region'] = region
    groom['source_surface'] = o.name
    groom['production_binding'] = False
    return count

total = 0
for o in list(scene.objects):
    if o.type != 'MESH' or not o.name.startswith('LX_'):
        continue
    if o.name.startswith('LX_v2_UnifiedHead'):
        total += make_groom(o, 65000, .019, 'head')
    elif o.particle_systems:
        if 'Ear_' in o.name:
            total += make_groom(o, 1800, .005, 'ear')
        elif 'Chest' in o.name:
            total += make_groom(o, 17000, .020, 'chest')
        elif 'Front' in o.name:
            total += make_groom(o, 8000, .009, 'paw')
        elif 'Torso' in o.name:
            total += make_groom(o, 48000, .022, 'body')
        else:
            total += make_groom(o, 18000, .016, 'body')

# Remove the heavy circular rim and fit slender lids to the iris perimeter.
for rim in [o for o in scene.objects if o.name.startswith('LX_EyeRim_')]:
    side = -1 if '_-1' in rim.name else 1
    iris = next(o for o in scene.objects if o.name.startswith('LX_Iris_'+str(side)+'.') or o.name == 'LX_Iris_'+str(side))
    lid_material = bpy.data.materials.new('LX_v3_Lid')
    lid_material.diffuse_color = (.065, .035, .020, 1)
    lid_material.use_nodes = True
    shader = lid_material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.065, .035, .020, 1)
    shader.inputs['Roughness'].default_value = .65
    curve = bpy.data.curves.new('LX_v3_ContourLid', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = .00125
    curve.bevel_resolution = 3
    spline = curve.splines.new('POLY')
    spline.points.add(63)
    for i, p in enumerate(spline.points):
        angle = 2*np.pi*i/64
        p.co = (np.cos(angle)*.027, -.0015, np.sin(angle)*.028, 1)
    spline.use_cyclic_u = True
    eyelid = bpy.data.objects.new('LX_v3_Eyelid', curve)
    scene.collection.objects.link(eyelid)
    eyelid.matrix_world = iris.matrix_world.copy()
    curve.materials.append(lid_material)
    bpy.data.objects.remove(rim, do_unlink=True)
    # A darker iris ring around a large pupil, with a restrained wet reflection.
    for slot in iris.material_slots:
        if slot.material:
            slot.material = slot.material.copy()
            for n in slot.material.node_tree.nodes:
                if n.bl_idname == 'ShaderNodeValToRGB':
                    n.color_ramp.elements[0].color = (.035, .026, .010, 1)
                    n.color_ramp.elements[1].color = (.19, .14, .047, 1)

scene.cycles.samples = 64
scene.render.filepath = str(ROOT/'assets/characters/lingxi/reference/anatomy-study-v3.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/characters/lingxi/source/lingxi-anatomy-study-v3.blend'), compress=True)
result = {'scene':scene.name, 'file':bpy.data.filepath, 'curve_strands':total, 'stage':scene['stage']}
