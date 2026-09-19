"""Read-only check of the saved study; does not certify visual quality."""
import bpy

scene = bpy.context.scene
assert scene.get('stage', '').startswith('Unapproved'), scene.name
assert scene.camera is not None
assert scene.render.engine == 'CYCLES'
assert scene.render.film_transparent
heads = [o for o in scene.objects if o.name.startswith('LX_v2_UnifiedHead')]
assert len(heads) == 1
assert len(heads[0].data.polygons) > 1000
grooms = [o for o in scene.objects if o.type == 'CURVES']
assert len(heads[0].particle_systems) == 1 or grooms
assert len([o for o in scene.objects if o.type == 'LIGHT']) == 3
assert not [o for o in scene.objects if o.type == 'ARMATURE']
image_nodes = [n for o in scene.objects if o.type == 'MESH'
               for m in o.data.materials if m and m.use_nodes
               for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage']
assert not image_nodes, 'Study should render native meshes, not reference image planes'
result = {
    'file': bpy.data.filepath,
    'scene': scene.name,
    'stage': scene['stage'],
    'meshes': len([o for o in scene.objects if o.type == 'MESH']),
    'head_polygons': len(heads[0].data.polygons),
    'hair_systems': sum(len(o.particle_systems) for o in scene.objects),
    'hair_curve_strands': sum(len(o.data.curves) for o in grooms),
    'reference_image_shader_nodes': len(image_nodes),
    'transparent': scene.render.film_transparent,
    'production_rig': False,
    'visual_acceptance': 'not passed',
}
