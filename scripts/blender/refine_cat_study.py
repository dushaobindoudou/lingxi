"""Second native 3D study: integrated face, recessed eyes and pigmented hair.
Run after create_cat_study.py through the official Blender MCP.
This remains an unapproved anatomy study, not a production character.
"""
import bpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
source = bpy.data.scenes.get('Lingxi • Anatomy and Groom Study')
if source is None:
    raise RuntimeError('Open lingxi-anatomy-study.blend first')
bpy.context.window.scene = source
bpy.ops.scene.new(type='FULL_COPY')
scene = bpy.context.scene
scene.name = 'Lingxi • Facial Structure Study v2'
objects = {o.name.split('.')[0]: o for o in scene.objects}

def obj(name):
    return objects['LX_' + name]

def select_only(items):
    bpy.ops.object.select_all(action='DESELECT')
    for item in items:
        item.select_set(True)
    bpy.context.view_layer.objects.active = items[0]

def remove_hair(item):
    select_only([item])
    while item.particle_systems:
        bpy.ops.object.particle_system_remove()

def math_node(tree, op, a, b=None):
    n = tree.nodes.new('ShaderNodeMath')
    n.operation = op
    if op == 'MULTIPLY_ADD':
        n.inputs[2].default_value = 0
    for i, v in enumerate([a, b]):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            tree.links.new(v, n.inputs[i])
    return n.outputs[0]

def coat_material(name, face=False, hair=False, white=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    shader = nt.nodes.new('ShaderNodeBsdfHairPrincipled' if hair else 'ShaderNodeBsdfPrincipled')
    if hair:
        shader.parametrization = 'COLOR'
        shader.inputs['Roughness'].default_value = .38
    else:
        shader.inputs['Roughness'].default_value = .75
    color_input = shader.inputs['Color' if hair else 'Base Color']
    nt.links.new(shader.outputs[0], out.inputs['Surface'])
    cream = (.68, .57, .43, 1)
    if white:
        color_input.default_value = cream
        return mat
    coords = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.bands_direction = 'X' if face else 'Y'
    wave.inputs['Scale'].default_value = 2.6
    wave.inputs['Distortion'].default_value = 4
    wave.inputs['Detail Scale'].default_value = 1.8
    nt.links.new(coords.outputs['Generated'], wave.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .17
    ramp.color_ramp.elements[0].color = (.055, .031, .020, 1)
    ramp.color_ramp.elements[1].position = .51
    ramp.color_ramp.elements[1].color = (.30, .20, .125, 1)
    nt.links.new(wave.outputs['Fac'], ramp.inputs[0])
    color = ramp.outputs['Color']
    if face:
        # Head-local coordinates keep the blaze attached when the head tilts.
        position = nt.nodes.new('ShaderNodeVectorMath')
        position.operation = 'ADD'
        position.inputs[1].default_value = (0, -.180, .168)
        nt.links.new(coords.outputs['Object'], position.inputs[0])
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(position.outputs[0], sep.inputs[0])
        absx = math_node(nt, 'ABSOLUTE', sep.outputs['X'])
        widening = math_node(nt, 'SUBTRACT', .229, sep.outputs['Z'])
        width = math_node(nt, 'MULTIPLY_ADD', widening, .54)
        # A continuous inverted V, painted on the unified face, no raised strip.
        blaze = math_node(nt, 'LESS_THAN', absx, width)
        lowface = math_node(nt, 'LESS_THAN', sep.outputs['Z'], .152)
        face_mask = math_node(nt, 'MAXIMUM', blaze, lowface)
        front = math_node(nt, 'LESS_THAN', sep.outputs['Y'], -.189)
        mask = math_node(nt, 'MULTIPLY', face_mask, front)
        mix = nt.nodes.new('ShaderNodeMixRGB')
        nt.links.new(mask, mix.inputs[0])
        nt.links.new(color, mix.inputs[1])
        mix.inputs[2].default_value = cream
        color = mix.outputs[0]
    nt.links.new(color, color_input)
    return mat

skin_head = coat_material('LX_v2_Face', face=True)
hair_head = coat_material('LX_v2_FaceHair', face=True, hair=True)
skin_body = coat_material('LX_v2_Coat')
hair_body = coat_material('LX_v2_CoatHair', hair=True)
skin_white = coat_material('LX_v2_White', white=True)
hair_white = coat_material('LX_v2_WhiteHair', white=True, hair=True)

# Merge the face masses before groom: remove the seams around muzzle and cheeks.
bpy.data.objects.remove(obj('Blaze'), do_unlink=True)
face_parts = [obj(n) for n in ['Head', 'Cheek_L', 'Cheek_R', 'Muzzle_L', 'Muzzle_R', 'Chin']]
for part in face_parts:
    remove_hair(part)
for name in ['Cheek_L', 'Cheek_R']:
    obj(name).scale = (.87, .87, 1)
select_only(face_parts)
bpy.ops.object.join()
head = bpy.context.object
head.name = 'LX_v2_UnifiedHead'
head.data.remesh_voxel_size = .0013
bpy.ops.object.voxel_remesh()
smooth = head.modifiers.new('Blend facial masses', 'SMOOTH')
smooth.factor = 1.1
smooth.iterations = 7
bpy.ops.object.modifier_apply(modifier=smooth.name)
for p in head.data.polygons:
    p.use_smooth = True
head.data.materials.clear()
head.data.materials.append(skin_head)

# The gaze sits in sockets. A smaller, partially covered iris avoids a startled look.
for side in [-1, 1]:
    for name, scale, y in [('EyeRim_', (.88, 1, .81), -.243),
                           ('Iris_', (.85, .82, .79), -.251),
                           ('Pupil_', (.94, .72, .83), -.255)]:
        eye = obj(name + str(side))
        eye.location = (side * .043, y, .175)
        eye.scale = scale
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=(side*.043, -.248, .175))
    cutter = bpy.context.object
    cutter.scale = (.0245, .024, .023)
    select_only([head])
    boolean = head.modifiers.new('Inset eye socket', 'BOOLEAN')
    boolean.operation = 'DIFFERENCE'
    boolean.object = cutter
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def add_hair(item, material, length, count=1500):
    select_only([item])
    remove_hair(item)
    item.data.materials.append(material)
    bpy.ops.object.particle_system_add()
    s = item.particle_systems[-1].settings
    s.type = 'HAIR'
    s.count = count
    s.hair_length = length
    s.hair_step = 4
    s.child_type = 'INTERPOLATED'
    s.child_percent = 8
    s.rendered_child_count = 32
    s.material = len(item.data.materials)
    s.root_radius = .000055
    s.tip_radius = .000007
    s.radius_scale = 1
    s.clump_factor = .13
    s.roughness_1 = .0014
    s.roughness_1_size = .3
    s.roughness_2 = .0006

add_hair(head, hair_head, .010, 3000)
for name, item in objects.items():
    if not name.startswith('LX_') or name in ['LX_Head', 'LX_Cheek_L', 'LX_Cheek_R', 'LX_Muzzle_L', 'LX_Muzzle_R', 'LX_Chin', 'LX_Blaze']:
        continue
    if item.type == 'MESH' and item.particle_systems:
        white = any(part in name for part in ['Front', 'Chest'])
        item.data.materials.clear()
        item.data.materials.append(skin_white if white else skin_body)
        add_hair(item, hair_white if white else hair_body, .005 if white else .011)

# Fur on the tail, also hiding the curve's rigid tube appearance.
tail = obj('Tail')
select_only([tail])
bpy.ops.object.convert(target='MESH')
tail = bpy.context.object
tail.data.materials.clear()
tail.data.materials.append(skin_body)
add_hair(tail, hair_body, .009)

# Shorter ear tips, with fine hair on the outer shell.
for side in [-1, 1]:
    for prefix in ['Ear_', 'InnerEar_']:
        ear = obj(prefix + str(side))
        for v in ear.data.vertices:
            v.co.z = .211 + (v.co.z - .211)*.84
        if prefix == 'Ear_':
            select_only([ear])
            bpy.ops.object.convert(target='MESH')
            ear = bpy.context.object
            ear.data.materials.clear()
            ear.data.materials.append(skin_body)
            add_hair(ear, hair_body, .003, 350)

scene.world = scene.world.copy()
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.70, .63, .53, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .25
for item in scene.objects:
    if item.type == 'LIGHT':
        item.data.energy *= .43
        if 'Key' in item.name:
            item.data.size = .28
# Bring the cheek close to the paws and incline the head as in the identity reference.
from mathutils import Matrix
face_center = Vector((0, -.180, .168))
tilt = Matrix.Rotation(-.12, 4, 'Y')
face_names = ('EyeRim_', 'Iris_', 'Pupil_', 'Ear_', 'InnerEar_', 'Nose', 'Mouth_', 'Whisker_')
for item in list(scene.objects):
    if item == head or (item.name.startswith('LX_') and any(item.name[3:].startswith(n) for n in face_names)):
        item.matrix_world = Matrix.Translation(Vector((0, -.006, -.022))) @ Matrix.Translation(face_center) @ tilt @ Matrix.Translation(-face_center) @ item.matrix_world
for side in [-1, 1]:
    obj('FrontPaw_'+str(side)).location.x = side * .037
scene.camera.location = (.13, -.87, .30)
scene.camera.rotation_euler = (Vector((0, -.06, .14)) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera.data.ortho_scale = .48
scene.cycles.samples = 64
scene['stage'] = 'Unapproved facial structure and fur study v2; no deformable rig or runtime asset'
scene.render.filepath = str(ROOT/'assets/characters/lingxi/reference/anatomy-study-v2.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/characters/lingxi/source/lingxi-anatomy-study-v2.blend'))
result = {'scene': scene.name, 'file': bpy.data.filepath, 'stage': scene['stage']}
