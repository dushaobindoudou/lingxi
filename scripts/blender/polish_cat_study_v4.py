"""Fourth native 3D study: real eyes, soft face mask, rebuilt ears, layered dense fur,
a jaw/tongue, added rear legs, and a functional 24-bone skeleton.
Run with v3 active in the official Blender MCP session. Still unapproved artwork.

Known gap, carried forward honestly (see docs/12-character-study-review.md): the fur is
native Curves geometry with baked world-space positions, not bound to the armature via a
surface/UV attachment. Posing the skeleton moves the body meshes correctly but the fur stays
put. Re-grooming per-pose (or switching to surface-bound curves) is separate follow-up work.
The jaw bone also has no mouth cavity to open into yet - the head mesh needs an actual cut
before "mouth open" reads convincingly.
"""
import bpy
import math
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
rng = np.random.default_rng(20260912)

src = bpy.data.scenes.get('Lingxi • Combed Hair Study v3')
if src is None:
    raise RuntimeError('Open lingxi-anatomy-study-v3.blend first')
bpy.context.window.scene = src
bpy.ops.scene.new(type='FULL_COPY')
scene = bpy.context.scene
scene.name = 'Lingxi • Polish + Rig Study v4'
scene['stage'] = 'Unapproved polish + rig study v4; offline render, functional skeleton, fur not yet bound to deformation'

# the scene copy also copies its groom collection under an auto-numbered name; resolve it
# by walking the actual scene hierarchy rather than guessing a literal collection name.
groom_collection = next(c for c in scene.collection.children if 'RegionalGroom' in c.name)
body_collection = next(c for c in scene.collection.children if c.name.startswith('Lingxi_Cat_Study'))


def O(prefix):
    for o in scene.objects:
        if o.name == prefix or o.name.startswith(prefix + '.'):
            return o
    return None


def move_to_body(obj):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    body_collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------- eyes ----
head = O('LX_v2_UnifiedHead')
EYE_X, EYE_Y, EYE_Z, R = 0.0435, -0.256, 0.154, 0.0185

for prefix in ['LX_Iris_-1', 'LX_Iris_1', 'LX_Pupil_-1', 'LX_Pupil_1', 'LX_v3_Eyelid']:
    while True:
        o = O(prefix)
        if not o:
            break
        bpy.data.objects.remove(o, do_unlink=True)

for side in [-1, 1]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=(side*EYE_X, EYE_Y+0.004, EYE_Z))
    cutter = bpy.context.object
    cutter.scale = (0.0225, 0.021, 0.0225)
    bpy.context.view_layer.objects.active = head
    boolean = head.modifiers.new('EyeSocket'+str(side), 'BOOLEAN')
    boolean.operation = 'DIFFERENCE'
    boolean.object = cutter
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def make_mat(name, color, rough=0.4, transmission=0.0, ior=1.45, coat=0.0, coat_rough=0.03):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    key = 'Transmission Weight' if 'Transmission Weight' in p.inputs else 'Transmission'
    p.inputs[key].default_value = transmission
    if 'IOR' in p.inputs:
        p.inputs['IOR'].default_value = ior
    if 'Coat Weight' in p.inputs:
        p.inputs['Coat Weight'].default_value = coat
        p.inputs['Coat Roughness'].default_value = coat_rough
    return m, p, m.node_tree


eyes_collection = bpy.data.collections.new('LX_v4_Eyes')
scene.collection.children.link(eyes_collection)

sclera_mat, _, _ = make_mat('LX_v4_Sclera', (0.80, 0.77, 0.72), rough=0.35)
pupil_mat, pp, _ = make_mat('LX_v4_Pupil', (0.006, 0.005, 0.006), rough=0.20, coat=0.5, coat_rough=0.04)
lid_mat, _, _ = make_mat('LX_v4_Lid', (0.09, 0.055, 0.045), rough=0.55)
highlight_mat, hp, _ = make_mat('LX_v4_Highlight', (1, 1, 1), rough=0.0)
hp.inputs['Emission Strength'].default_value = 6.0
hp.inputs['Emission Color'].default_value = (1, 1, 1, 1)


def make_iris_mat():
    m, p, nt = make_mat('LX_v4_Iris', (0.35, 0.30, 0.09), rough=0.22, coat=0.55, coat_rough=0.05)
    tex = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (62, 62, 62)  # object coords are metres, not 0..1
    nt.links.new(tex.outputs['Object'], mapping.inputs['Vector'])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(mapping.outputs['Vector'], sep.inputs['Vector'])
    xz = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], xz.inputs['X'])
    nt.links.new(sep.outputs['Z'], xz.inputs['Y'])
    radius_n = nt.nodes.new('ShaderNodeVectorMath'); radius_n.operation = 'LENGTH'
    nt.links.new(xz.outputs['Vector'], radius_n.inputs[0])
    angle_n = nt.nodes.new('ShaderNodeMath'); angle_n.operation = 'ARCTAN2'
    nt.links.new(sep.outputs['Z'], angle_n.inputs[0]); nt.links.new(sep.outputs['X'], angle_n.inputs[1])
    fibers = nt.nodes.new('ShaderNodeTexWave')
    fibers.wave_type = 'BANDS'; fibers.inputs['Scale'].default_value = 1.0
    fibers.inputs['Distortion'].default_value = 0.6; fibers.inputs['Detail'].default_value = 2.0
    fibers.inputs['Detail Scale'].default_value = 1.5
    angle_scaled = nt.nodes.new('ShaderNodeMath'); angle_scaled.operation = 'MULTIPLY'
    angle_scaled.inputs[1].default_value = 3.2
    nt.links.new(angle_n.outputs['Value'], angle_scaled.inputs[0])
    combine_fib = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(angle_scaled.outputs['Value'], combine_fib.inputs['X'])
    nt.links.new(radius_n.outputs['Value'], combine_fib.inputs['Y'])
    nt.links.new(combine_fib.outputs['Vector'], fibers.inputs['Vector'])
    fine_noise = nt.nodes.new('ShaderNodeTexNoise')
    fine_noise.inputs['Scale'].default_value = 6.0; fine_noise.inputs['Detail'].default_value = 3.0
    nt.links.new(mapping.outputs['Vector'], fine_noise.inputs['Vector'])
    fiber_mix = nt.nodes.new('ShaderNodeMixRGB'); fiber_mix.blend_type = 'MULTIPLY'; fiber_mix.inputs['Fac'].default_value = 0.55
    nt.links.new(fibers.outputs['Fac'], fiber_mix.inputs['Color1']); nt.links.new(fine_noise.outputs['Fac'], fiber_mix.inputs['Color2'])
    radial_ramp = nt.nodes.new('ShaderNodeValToRGB')
    radial_ramp.color_ramp.elements[0].color = (0.62, 0.47, 0.10, 1)
    radial_ramp.color_ramp.elements[1].color = (0.27, 0.36, 0.12, 1)
    radius_norm = nt.nodes.new('ShaderNodeMath'); radius_norm.operation = 'MULTIPLY'; radius_norm.inputs[1].default_value = 1.05
    nt.links.new(radius_n.outputs['Value'], radius_norm.inputs[0])
    nt.links.new(radius_norm.outputs['Value'], radial_ramp.inputs['Fac'])
    fiber_tint = nt.nodes.new('ShaderNodeMixRGB'); fiber_tint.blend_type = 'MULTIPLY'; fiber_tint.inputs['Fac'].default_value = 0.35
    nt.links.new(radial_ramp.outputs['Color'], fiber_tint.inputs['Color1']); nt.links.new(fiber_mix.outputs['Color'], fiber_tint.inputs['Color2'])
    limbal = nt.nodes.new('ShaderNodeValToRGB')
    limbal.color_ramp.elements[0].position = 0.80; limbal.color_ramp.elements[1].position = 0.97
    limbal.color_ramp.elements[1].color = (0.02, 0.02, 0.015, 1)
    nt.links.new(radius_norm.outputs['Value'], limbal.inputs['Fac'])
    final_mix = nt.nodes.new('ShaderNodeMixRGB')
    nt.links.new(limbal.outputs['Color'], final_mix.inputs['Fac']); nt.links.new(fiber_tint.outputs['Color'], final_mix.inputs['Color1'])
    final_mix.inputs['Color2'].default_value = (0.02, 0.018, 0.012, 1)
    nt.links.new(final_mix.outputs['Color'], p.inputs['Base Color'])
    return m


iris_mat = make_iris_mat()

for side in [-1, 1]:
    cx = side * EYE_X
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=18, location=(cx, EYE_Y+0.016, EYE_Z), radius=R*0.62*0.92)
    sclera = bpy.context.object; sclera.name = f'LX_v4_Sclera_{side}'
    sclera.scale = (0.62, 0.62, 0.62); sclera.data.materials.append(sclera_mat)
    for f in sclera.data.polygons: f.use_smooth = True
    eyes_collection.objects.link(sclera); scene.collection.objects.unlink(sclera)

    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=R*0.86, radius2=0.0, depth=0.003, location=(cx, EYE_Y+0.001, EYE_Z))
    iris = bpy.context.object; iris.name = f'LX_v4_Iris_{side}'
    iris.rotation_euler = (math.radians(-90), 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for v in iris.data.vertices: v.co.y *= 0.35
    iris.data.materials.append(iris_mat)
    for f in iris.data.polygons: f.use_smooth = True
    eyes_collection.objects.link(iris); scene.collection.objects.unlink(iris)

    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=R*0.40, radius2=0.0, depth=0.002, location=(cx, EYE_Y-0.0005, EYE_Z))
    pupil = bpy.context.object; pupil.name = f'LX_v4_Pupil_{side}'
    pupil.rotation_euler = (math.radians(-90), 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for v in pupil.data.vertices: v.co.y *= 0.3
    pupil.data.materials.append(pupil_mat)
    for f in pupil.data.polygons: f.use_smooth = True
    eyes_collection.objects.link(pupil); scene.collection.objects.unlink(pupil)

    for hi, (off, sz) in enumerate([((0.006*side*-1, -0.010, 0.008), 0.0040), ((-0.003*side*-1, -0.007, -0.004), 0.0016)]):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=(cx+off[0], EYE_Y-0.0105, EYE_Z+off[2]))
        hl = bpy.context.object; hl.name = f'LX_v4_Highlight_{side}_{hi}'
        hl.scale = (sz, sz*0.4, sz)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        hl.data.materials.append(highlight_mat)
        for f in hl.data.polygons: f.use_smooth = True
        eyes_collection.objects.link(hl); scene.collection.objects.unlink(hl)


def lid_curve(name, side, a0_deg, a1_deg, base_radius, y_offset, rx=1.06, rz=1.05):
    cx = side * EYE_X
    data = bpy.data.curves.new(name, 'CURVE'); data.dimensions = '3D'; data.bevel_depth = 1.0; data.bevel_resolution = 4
    spline = data.splines.new('POLY'); n = 28; spline.points.add(n - 1)
    a0, a1 = math.radians(a0_deg), math.radians(a1_deg)
    for i, p in enumerate(spline.points):
        t = i / (n - 1); a = a0 + (a1 - a0) * t
        taper = math.sin(math.pi * t) ** 0.7
        x = cx + math.cos(a) * R * rx; z = EYE_Z + math.sin(a) * R * rz; y = EYE_Y + y_offset - 0.0028 * taper
        p.co = (x, y, z, 1); p.radius = base_radius * (0.35 + 0.65 * taper)
    obj = bpy.data.objects.new('LX_v4_' + name, data)
    data.materials.append(lid_mat)
    eyes_collection.objects.link(obj)
    return obj


for side in [-1, 1]:
    lid_curve(f'UpperLid_{side}', side, 8, 172, 0.0034, 0.0035)
    lid_curve(f'LowerLid_{side}', side, 200, 340, 0.0018, 0.0030)

# ------------------------------------------------------------ face mask ----


def rebuild_face_mask(mat_name, is_hair):
    mat = bpy.data.materials.get(mat_name)
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
    shader = next(n for n in nt.nodes if n.bl_idname in ('ShaderNodeBsdfPrincipled', 'ShaderNodeBsdfHairPrincipled'))
    for n in list(nt.nodes):
        if n not in (out, shader):
            nt.nodes.remove(n)
    links = nt.links
    coords = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.bands_direction = 'X'; wave.inputs['Scale'].default_value = 2.6
    wave.inputs['Distortion'].default_value = 4; wave.inputs['Detail Scale'].default_value = 1.8
    links.new(coords.outputs['Generated'], wave.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.17; ramp.color_ramp.elements[0].color = (0.055, 0.031, 0.020, 1)
    ramp.color_ramp.elements[1].position = 0.51; ramp.color_ramp.elements[1].color = (0.30, 0.20, 0.125, 1)
    links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    striped_color = ramp.outputs['Color']
    position = nt.nodes.new('ShaderNodeVectorMath'); position.operation = 'ADD'; position.inputs[1].default_value = (0, -0.180, 0.168)
    links.new(coords.outputs['Object'], position.inputs[0])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); links.new(position.outputs[0], sep.inputs[0])
    absx = nt.nodes.new('ShaderNodeMath'); absx.operation = 'ABSOLUTE'; links.new(sep.outputs['X'], absx.inputs[0])
    widening = nt.nodes.new('ShaderNodeMath'); widening.operation = 'SUBTRACT'; widening.inputs[0].default_value = 0.229
    links.new(sep.outputs['Z'], widening.inputs[1])
    width = nt.nodes.new('ShaderNodeMath'); width.operation = 'MULTIPLY_ADD'; width.inputs[2].default_value = 0.0
    links.new(widening.outputs[0], width.inputs[0]); width.inputs[1].default_value = 0.54
    SOFT = 0.016
    blaze_lo = nt.nodes.new('ShaderNodeMath'); blaze_lo.operation = 'SUBTRACT'; links.new(width.outputs[0], blaze_lo.inputs[0]); blaze_lo.inputs[1].default_value = SOFT
    blaze_hi = nt.nodes.new('ShaderNodeMath'); blaze_hi.operation = 'ADD'; links.new(width.outputs[0], blaze_hi.inputs[0]); blaze_hi.inputs[1].default_value = SOFT
    blaze_map = nt.nodes.new('ShaderNodeMapRange'); blaze_map.clamp = True
    links.new(absx.outputs[0], blaze_map.inputs['Value']); links.new(blaze_hi.outputs[0], blaze_map.inputs['From Min']); links.new(blaze_lo.outputs[0], blaze_map.inputs['From Max'])
    blaze_map.inputs['To Min'].default_value = 0.0; blaze_map.inputs['To Max'].default_value = 1.0
    SOFT_Z = 0.014
    low_map = nt.nodes.new('ShaderNodeMapRange'); low_map.clamp = True
    links.new(sep.outputs['Z'], low_map.inputs['Value'])
    low_map.inputs['From Min'].default_value = 0.152 + SOFT_Z; low_map.inputs['From Max'].default_value = 0.152 - SOFT_Z
    low_map.inputs['To Min'].default_value = 0.0; low_map.inputs['To Max'].default_value = 1.0
    face_mask = nt.nodes.new('ShaderNodeMath'); face_mask.operation = 'MAXIMUM'
    links.new(blaze_map.outputs[0], face_mask.inputs[0]); links.new(low_map.outputs[0], face_mask.inputs[1])
    SOFT_Y = 0.02
    front_map = nt.nodes.new('ShaderNodeMapRange'); front_map.clamp = True
    links.new(sep.outputs['Y'], front_map.inputs['Value'])
    front_map.inputs['From Min'].default_value = -0.189 + SOFT_Y; front_map.inputs['From Max'].default_value = -0.189 - SOFT_Y
    front_map.inputs['To Min'].default_value = 0.0; front_map.inputs['To Max'].default_value = 1.0
    mask = nt.nodes.new('ShaderNodeMath'); mask.operation = 'MULTIPLY'
    links.new(face_mask.outputs[0], mask.inputs[0]); links.new(front_map.outputs[0], mask.inputs[1])
    edge_noise = nt.nodes.new('ShaderNodeTexNoise'); edge_noise.inputs['Scale'].default_value = 55.0; edge_noise.inputs['Detail'].default_value = 3.0
    links.new(coords.outputs['Object'], edge_noise.inputs['Vector'])
    noise_centered = nt.nodes.new('ShaderNodeMath'); noise_centered.operation = 'SUBTRACT'; links.new(edge_noise.outputs['Fac'], noise_centered.inputs[0]); noise_centered.inputs[1].default_value = 0.5
    noise_scaled = nt.nodes.new('ShaderNodeMath'); noise_scaled.operation = 'MULTIPLY'; links.new(noise_centered.outputs[0], noise_scaled.inputs[0]); noise_scaled.inputs[1].default_value = 0.35
    mask_jitter = nt.nodes.new('ShaderNodeMath'); mask_jitter.operation = 'ADD'; links.new(mask.outputs[0], mask_jitter.inputs[0]); links.new(noise_scaled.outputs[0], mask_jitter.inputs[1])
    mask_clamped = nt.nodes.new('ShaderNodeMath'); mask_clamped.operation = 'MULTIPLY'; mask_clamped.use_clamp = True
    links.new(mask_jitter.outputs[0], mask_clamped.inputs[0]); mask_clamped.inputs[1].default_value = 1.0
    mix = nt.nodes.new('ShaderNodeMixRGB')
    links.new(mask_clamped.outputs[0], mix.inputs[0]); links.new(striped_color, mix.inputs[1]); mix.inputs[2].default_value = (0.68, 0.57, 0.43, 1)
    color_input = shader.inputs['Color'] if is_hair else shader.inputs['Base Color']
    links.new(mix.outputs[0], color_input)
    if is_hair:
        shader.parametrization = 'COLOR'; shader.inputs['Roughness'].default_value = 0.38
    else:
        shader.inputs['Roughness'].default_value = 0.75


rebuild_face_mask('LX_v2_Face.001', is_hair=False)
rebuild_face_mask('LX_v2_FaceHair.001', is_hair=True)

# ------------------------------------------------------------------ ears ----

for prefix in ['LX_Ear_-1', 'LX_Ear_1', 'LX_InnerEar_-1', 'LX_InnerEar_1']:
    o = O(prefix)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(scene.objects):
    if o.name.startswith('LX_v3_Groom_') and ('Ear_-1' in o.name or 'Ear_1' in o.name):
        bpy.data.objects.remove(o, do_unlink=True)

coat_mat = bpy.data.materials.get('LX_v2_Coat.001')
white_mat = bpy.data.materials.get('LX_v2_White.001')
rose_mat = bpy.data.materials.get('LX_Rose')
coat_hair_mat = bpy.data.materials.get('LX_v2_CoatHair.001')
white_hair_mat = bpy.data.materials.get('LX_v2_WhiteHair.001')

face_center = Vector((0, -0.180, 0.168))
tilt = Matrix.Rotation(-0.12, 4, 'Y')
final_matrix = Matrix.Translation((0, -0.006, -0.022)) @ Matrix.Translation(face_center) @ tilt @ Matrix.Translation(-face_center)


def build_ear(side):
    base_center = Vector((side*0.0665, -0.183, 0.204))
    tip = Vector((side*0.087, -0.154, 0.2782))
    U = (tip - base_center); ear_length = U.length; U.normalize()
    R_axis = U.cross(Vector((0, 0, 1)))
    if R_axis.length < 1e-5: R_axis = Vector((1, 0, 0))
    R_axis.normalize()
    if R_axis.x * side < 0: R_axis = -R_axis
    F_axis = R_axis.cross(U); F_axis.normalize()
    if F_axis.y > 0: F_axis = -F_axis
    Nu, Nv, W0 = 16, 11, 0.040
    verts, idx = [], {}
    for i in range(Nu):
        u = i / (Nu - 1)
        width = W0 * (1 - u) ** 0.62 + 0.0015
        height = ear_length * (u ** 0.94)
        lean = 0.014 * math.sin(u * math.pi * 0.85)
        curl = -0.006 * max(0, u - 0.72) / 0.28
        for j in range(Nv):
            v = (j / (Nv - 1)) * 2 - 1
            concave = -0.0075 * (1 - v*v) * math.sin(math.pi * u) ** 0.8
            p = base_center + U*height + R_axis*(width*v) + F_axis*(lean + curl + concave)
            idx[(i, j)] = len(verts); verts.append(p)
    faces = [(idx[(i, j)], idx[(i+1, j)], idx[(i+1, j+1)], idx[(i, j+1)]) for i in range(Nu-1) for j in range(Nv-1)]
    mesh = bpy.data.meshes.new(f'LX_v4_Ear_{side}_mesh')
    mesh.from_pydata([tuple(p) for p in verts], [], faces); mesh.update()
    for f in mesh.polygons: f.use_smooth = True
    obj = bpy.data.objects.new(f'LX_v4_Ear_{side}', mesh)
    obj.data.materials.append(coat_mat); obj.data.materials.append(rose_mat)
    obj.matrix_world = final_matrix
    scene.collection.objects.link(obj)
    vg = obj.vertex_groups.new(name='thickness')
    for i in range(Nu):
        u = i / (Nu - 1); w = 0.30 + 0.70 * (1 - u) ** 1.4
        for j in range(Nv):
            vg.add([idx[(i, j)]], w, 'REPLACE')
    solid = obj.modifiers.new('Ear thickness', 'SOLIDIFY'); solid.thickness = 0.0055
    solid.thickness_vertex_group = 0.05; solid.vertex_group = 'thickness'; solid.material_offset = 1; solid.use_even_offset = True
    subsurf = obj.modifiers.new('Ear smooth', 'SUBSURF'); subsurf.levels = 2; subsurf.render_levels = 2
    bevel = obj.modifiers.new('Ear rim', 'BEVEL'); bevel.width = 0.0012; bevel.segments = 2; bevel.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    for m in [solid, subsurf, bevel]:
        bpy.ops.object.modifier_apply(modifier=m.name)
    for f in obj.data.polygons: f.use_smooth = True
    return obj


new_ears = [build_ear(-1), build_ear(1)]

# ------------------------------------------------------------- rear legs ----


def ellipsoid(name, loc, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=loc)
    o = move_to_body(bpy.context.object); o.name = 'LX_' + name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for f in o.data.polygons: f.use_smooth = True
    o.data.materials.append(material)
    return o


for side in [-1, 1]:
    ellipsoid(f'RearThigh_{side}', (side*0.075, 0.155, 0.075), (0.052, 0.062, 0.058), coat_mat)
    ellipsoid(f'RearShin_{side}', (side*0.070, 0.175, 0.032), (0.032, 0.050, 0.034), coat_mat)
    ellipsoid(f'RearPaw_{side}', (side*0.068, 0.150, 0.010), (0.036, 0.052, 0.028), white_mat)

# ------------------------------------------------------------ jaw + tongue --

bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=(0, -0.253, 0.114))
jaw = move_to_body(bpy.context.object); jaw.name = 'LX_v4_Jaw'; jaw.scale = (0.026, 0.032, 0.017)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for f in jaw.data.polygons: f.use_smooth = True
jaw.data.materials.append(white_mat)

bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=10, location=(0, -0.243, 0.109))
tongue = move_to_body(bpy.context.object); tongue.name = 'LX_v4_Tongue'; tongue.scale = (0.0095, 0.017, 0.0055)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for f in tongue.data.polygons: f.use_smooth = True
tongue.data.materials.append(rose_mat)

# -------------------------------------------------------------- fur regrow --


def normalize(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def stripe_color(local, face=False):
    x, y, z = local[:, 0], local[:, 1], local[:, 2]
    axis = x if face else y
    phase = axis*7.5 + np.sin(z*4 + y*3)*0.6
    fac = np.clip(np.sin(phase)*1.6 + 0.15, 0, 1)
    dark = np.array([0.022, 0.012, 0.008]); light = np.array([0.34, 0.235, 0.15])
    col = dark[None, :]*(1-fac[:, None]) + light[None, :]*fac[:, None]
    if face:
        zz, yy = z + 0.168, y - 0.180
        width = (0.229 - zz) * 0.54
        SOFT = 0.016
        blaze = np.clip((width + SOFT - np.abs(x)) / (2*SOFT), 0, 1)
        lowface = np.clip((0.152 + 0.014 - zz) / (2*0.014), 0, 1)
        face_mask = np.maximum(blaze, lowface)
        front = np.clip((-0.189 + 0.02 - yy) / (2*0.02), 0, 1)
        mask = np.clip(face_mask*front, 0, 1)
        col = col*(1-mask[:, None]) + np.array([0.70, 0.60, 0.47])[None, :]*mask[:, None]
    return col


def cream_color(n):
    return np.tile(np.array([0.74, 0.65, 0.54]), (n, 1))


def make_groom(o, count, length, tag, is_white, is_face, direction_fn, material, radius_scale=1.0, avoid_eyes_mouth=False):
    mesh = o.data; mesh.calc_loop_triangles()
    verts = np.empty(len(mesh.vertices)*3, dtype=np.float32); mesh.vertices.foreach_get('co', verts); verts = verts.reshape(-1, 3)
    normals = np.empty_like(verts); mesh.vertices.foreach_get('normal', normals.ravel())
    triangles = np.empty(len(mesh.loop_triangles)*3, dtype=np.int32); mesh.loop_triangles.foreach_get('vertices', triangles); triangles = triangles.reshape(-1, 3)
    corners = verts[triangles]
    weights = np.linalg.norm(np.cross(corners[:, 1]-corners[:, 0], corners[:, 2]-corners[:, 0]), axis=1)
    indices = rng.choice(len(triangles), count, p=weights/weights.sum())
    uv = rng.random((count, 2)); uv[uv.sum(axis=1) > 1] = 1 - uv[uv.sum(axis=1) > 1]
    bary = np.column_stack((1-uv.sum(axis=1), uv))
    roots = (corners[indices]*bary[:, :, None]).sum(axis=1)
    normals_s = normalize((normals[triangles[indices]]*bary[:, :, None]).sum(axis=1))
    if avoid_eyes_mouth:
        near_front = roots[:, 1] < -.048
        eyes = np.zeros(len(roots), dtype=bool)
        for side in [-1, 1]:
            eyes |= ((roots[:, 0]-side*.0435)/.030)**2 + ((roots[:, 2]-.010)/.030)**2 < 1.05
        muzzle_center = (abs(roots[:, 0]) < .014) & (roots[:, 2] < -.022) & (roots[:, 1] < -.082)
        keep = ~(near_front & (eyes | muzzle_center))
        roots, normals_s = roots[keep], normals_s[keep]
    count = len(roots)
    direction = direction_fn(roots)
    tangent = normalize(direction-(direction*normals_s).sum(axis=1)[:, None]*normals_s)
    sideways = normalize(np.cross(normals_s, tangent))
    lengths = length*rng.uniform(0.6, 1.2, (count, 1))
    if is_face:
        lengths *= np.where(roots[:, 2:3] < -.015, 1.2, .75)
    samples = 6
    t = np.linspace(0, 1, samples)[None, :, None]
    phase = rng.random((count, 1, 1))*6.283
    positions = roots[:, None, :] + lengths[:, :, None]*(normals_s[:, None, :]*(.80*t-.36*t*t) + tangent[:, None, :]*(.45*t+.30*t*t))
    positions += sideways[:, None, :]*np.sin(t*5+phase)*(.0005*t)
    data = bpy.data.hair_curves.new(f'Groom_{tag}')
    data.add_curves([samples]*count)
    data.attributes['position'].data.foreach_set('vector', positions.astype(np.float32).ravel())
    radius = data.attributes.new('radius', 'FLOAT', 'POINT')
    root_radius = rng.uniform(.00012, .00024, (count, 1)) * radius_scale
    radii = root_radius*(1-np.linspace(0, 1, samples)[None, :])**.8+.000002
    radius.data.foreach_set('value', radii.astype(np.float32).ravel())
    root_col = cream_color(count) if is_white else stripe_color(roots, face=is_face)
    tfrac = np.linspace(0, 1, samples); warm_tip = np.array([0.55, 0.46, 0.36]); tip_blend = 0.12
    col_pp = (root_col[:, None, :]*(1-tip_blend*tfrac[None, :, None]) + warm_tip[None, None, :]*(tip_blend*tfrac[None, :, None])).reshape(-1, 3)
    cattr = data.attributes.new('lx_color', 'FLOAT_COLOR', 'POINT')
    flat = np.ones((len(col_pp), 4), dtype=np.float32); flat[:, :3] = col_pp
    cattr.data.foreach_set('color', flat.ravel())
    groom = bpy.data.objects.new(f'LX_v4_Groom_{tag}', data)
    groom_collection.objects.link(groom)
    groom.matrix_world = o.matrix_world.copy()
    data.materials.append(material)
    groom['production_binding'] = False
    return count


def use_attribute_color(mat_name):
    mat = bpy.data.materials.get(mat_name)
    shader = next(n for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfHairPrincipled')
    attr = mat.node_tree.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'lx_color'
    mat.node_tree.links.new(attr.outputs['Color'], shader.inputs['Color'])


up = lambda r: np.tile([0, 0.3, 1.0], (len(r), 1))
down = lambda r: np.tile([0, -0.2, -1.0], (len(r), 1))
head_dir = lambda r: np.column_stack([np.sign(r[:, 0])*.85, np.full(len(r), .32), np.where(r[:, 2] > .025, .15, -.65)])
body_dir = lambda r: np.tile([0, 1, -0.25], (len(r), 1))

fur_targets = [
    (O('LX_Torso'), 'body', False, False, body_dir, 85000, .023, coat_hair_mat),
    (O('LX_Chest'), 'chest', True, False, down, 32000, .021, white_hair_mat),
    (head, 'head', False, True, head_dir, 130000, .020, coat_hair_mat),
]
for side in [-1, 1]:
    fur_targets += [
        (O(f'LX_Haunch_{side}'), f'haunch_{side}', False, False, body_dir, 30000, .017, coat_hair_mat),
        (O(f'LX_FrontLeg_{side}'), f'frontleg_{side}', False, False, down, 16000, .010, coat_hair_mat),
        (O(f'LX_FrontPaw_{side}'), f'frontpaw_{side}', True, False, down, 16000, .010, white_hair_mat),
        (O(f'LX_RearThigh_{side}'), f'rearthigh_{side}', False, False, up, 9000, .020, coat_hair_mat),
        (O(f'LX_RearShin_{side}'), f'rearshin_{side}', False, False, up, 6000, .014, coat_hair_mat),
        (O(f'LX_RearPaw_{side}'), f'rearpaw_{side}', True, False, down, 5000, .008, white_hair_mat),
        (new_ears[0 if side == -1 else 1], f'ear_{side}', False, False, up, 5600, .0060, coat_hair_mat),
    ]

total = 0
for obj, tag, is_white, is_face, direction_fn, count, length, mat in fur_targets:
    avoid = is_face
    total += make_groom(obj, count, length, f'guard_{tag}', is_white, is_face, direction_fn, mat, 1.0, avoid)
    total += make_groom(obj, int(count*1.6), length*0.45, f'undercoat_{tag}', is_white, is_face, direction_fn, mat, 0.55, avoid)

tail = O('LX_Tail')
total += make_groom(tail, 26000, .022, 'guard_tail', False, False, body_dir, coat_hair_mat, 1.0)
total += make_groom(tail, 42000, .010, 'undercoat_tail', False, False, body_dir, coat_hair_mat, 0.55)

use_attribute_color('LX_v2_CoatHair.001')
use_attribute_color('LX_v2_WhiteHair.001')
use_attribute_color('LX_v2_FaceHair.001')

# scale up curve radius so fur reads at render resolution instead of falling sub-pixel
for o in scene.objects:
    if o.type == 'CURVES':
        attr = o.data.attributes.get('radius')
        if not attr:
            continue
        n = len(attr.data); vals = [0.0]*n
        attr.data.foreach_get('value', vals)
        mult = 3.2 if 'undercoat' in o.name else 3.6
        attr.data.foreach_set('value', [v*mult for v in vals])

# --------------------------------------------------------------- skeleton --

arm_data = bpy.data.armatures.new('LX_v4_Rig')
arm_obj = bpy.data.objects.new('LX_v4_Armature', arm_data)
scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def add_bone(name, head_co, tail_co, parent=None, connect=False):
    b = eb.new(name); b.head = Vector(head_co); b.tail = Vector(tail_co)
    if parent:
        b.parent = eb[parent]; b.use_connect = connect
    return b


add_bone('Hip', (0, 0.18, 0.115), (0, 0.02, 0.115))
add_bone('Spine01', (0, 0.02, 0.115), (0, -0.12, 0.115), 'Hip', True)
add_bone('Neck', (0, -0.12, 0.115), (0, -0.17, 0.148), 'Spine01', True)
add_bone('Head', (0, -0.17, 0.148), (0, -0.24, 0.165), 'Neck', True)
add_bone('Jaw', (0, -0.205, 0.135), (0, -0.265, 0.115), 'Head', False)
tail_pts = [(0, 0.185, 0.09), (0.07, 0.20, 0.075), (0.146, 0.15, 0.055), (0.166, 0.025, 0.04), (0.125, -0.08, 0.041), (0.09, -0.105, 0.045)]
prev = 'Hip'
for i in range(len(tail_pts) - 1):
    name = f'Tail{i+1:02d}'; add_bone(name, tail_pts[i], tail_pts[i+1], prev, i > 0); prev = name
for side in [-1, 1]:
    base_center = final_matrix @ Vector((side*0.0665, -0.183, 0.204))
    tip = final_matrix @ Vector((side*0.087, -0.154, 0.2782))
    add_bone(f'Ear_{side}', base_center, tip, 'Head')
    ex, ey, ez = side*0.0435, -0.256, 0.154
    add_bone(f'Eye_{side}', (ex, ey+0.010, ez), (ex, ey-0.010, ez), 'Head')
for side in [-1, 1]:
    add_bone(f'FrontUpperLeg_{side}', (side*0.049, -0.122, 0.105), (side*0.047, -0.213, 0.062), 'Spine01')
    add_bone(f'FrontPaw_{side}', (side*0.047, -0.213, 0.062), (side*0.047, -0.225, 0.015), f'FrontUpperLeg_{side}', True)
    add_bone(f'RearThigh_{side}', (side*0.075, 0.135, 0.105), (side*0.070, 0.178, 0.055), 'Hip')
    add_bone(f'RearShin_{side}', (side*0.070, 0.178, 0.055), (side*0.068, 0.150, 0.012), f'RearThigh_{side}', True)
    add_bone(f'RearPaw_{side}', (side*0.068, 0.150, 0.012), (side*0.068, 0.145, -0.005), f'RearShin_{side}', True)
bpy.ops.object.mode_set(mode='OBJECT')


def bone_parent(obj, bone_name):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_data.bones.active = arm_data.bones[bone_name]
    bpy.ops.object.parent_set(type='BONE', keep_transform=True)


mapping = {
    'LX_Torso': 'Spine01', 'LX_Chest': 'Spine01', 'LX_Haunch_-1': 'Hip', 'LX_Haunch_1': 'Hip',
    'LX_FrontLeg_-1': 'FrontUpperLeg_-1', 'LX_FrontLeg_1': 'FrontUpperLeg_1',
    'LX_FrontPaw_-1': 'FrontPaw_-1', 'LX_FrontPaw_1': 'FrontPaw_1',
    'LX_RearThigh_-1': 'RearThigh_-1', 'LX_RearThigh_1': 'RearThigh_1',
    'LX_RearShin_-1': 'RearShin_-1', 'LX_RearShin_1': 'RearShin_1',
    'LX_RearPaw_-1': 'RearPaw_-1', 'LX_RearPaw_1': 'RearPaw_1',
    'LX_v2_UnifiedHead': 'Head', 'LX_Nose': 'Head', 'LX_Mouth_L': 'Head', 'LX_Mouth_R': 'Head',
    'LX_v4_Ear_-1': 'Ear_-1', 'LX_v4_Ear_1': 'Ear_1', 'LX_v4_Jaw': 'Jaw', 'LX_v4_Tongue': 'Jaw',
}
for side in [-1, 1]:
    for prefix in ['LX_v4_Sclera_', 'LX_v4_Iris_', 'LX_v4_Pupil_']:
        mapping[f'{prefix}{side}'] = f'Eye_{side}'
    mapping[f'LX_v4_UpperLid_{side}'] = f'Eye_{side}'
    mapping[f'LX_v4_LowerLid_{side}'] = f'Eye_{side}'
    for hi in range(2):
        mapping[f'LX_v4_Highlight_{side}_{hi}'] = f'Eye_{side}'
for side in [-1, 1]:
    for i in range(5):
        mapping[f'LX_Whisker_{side}_{i}'] = 'Head'
for prefix, bone in mapping.items():
    obj = O(prefix)
    if obj:
        bone_parent(obj, bone)

bpy.ops.object.select_all(action='DESELECT')
tail.select_set(True); arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# ---------------------------------------------------------------- lights --

for o in scene.objects:
    if o.type == 'LIGHT':
        if 'Rim' in o.name: o.data.energy = 34
        elif 'Key' in o.name: o.data.energy = 19
        elif 'Fill' in o.name: o.data.energy = 9

scene.cycles.samples = 160
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.filepath = str(ROOT/'assets/characters/lingxi/reference/anatomy-study-v4.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/characters/lingxi/source/lingxi-anatomy-study-v4.blend'), compress=True)
result = {
    'scene': scene.name, 'file': bpy.data.filepath, 'stage': scene['stage'],
    'total_hair_curves': total, 'bone_count': len(arm_data.bones),
}
