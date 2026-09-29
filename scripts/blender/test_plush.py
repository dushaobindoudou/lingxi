"""Replace the strand material with an opaque Principled BSDF driven by the
coat_color attribute - plush look, stripes should come through.

Blender 5.2 note: node.inputs['name'] / node.outputs['name'] look up by internal
identifier, which does not always match the UI label (e.g. hair "Transmission" is
'TT lobe'), so every socket in this file is resolved by label via sock().
"""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path('/Users/liepin/workspace/lingxi/assets/characters/lingxi/v5')
s = bpy.context.scene

def sock(node, name, io='inputs'):
    return next(i for i in getattr(node, io) if i.name == name)

cam = bpy.data.objects['Portrait']
target = Vector((0, -.03, .37))
direction = (cam.location - target).normalized()
cam.location = target + direction * 2.45
cam.data.dof.focus_distance = (cam.location - target).length
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
s.render.resolution_x = 320
s.render.resolution_y = 320
s.cycles.samples = 8
s.view_settings.exposure = -1.0

mat = bpy.data.materials['LX_ShortFur_Strand']
nt = mat.node_tree
attr = next(n for n in nt.nodes if n.type == 'ATTRIBUTE')

# keep the attribute node itself (removing it would invalidate the reference);
# drop everything else and rebuild an opaque plush shader around it
for n in list(nt.nodes):
    if n != attr:
        nt.nodes.remove(n)
out_ = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
nt.links.new(sock(attr, 'Color', 'outputs'), sock(bsdf, 'Base Color'))
nt.links.new(bsdf.outputs[0], sock(out_, 'Surface'))
sock(bsdf, 'Roughness').default_value = .72
# optional inputs differ between Blender releases - set them when they exist
for nm, val in [('Sheen Weight', .25), ('Specular IOR Level', .2)]:
    try:
        sock(bsdf, nm).default_value = val
    except StopIteration:
        pass

s.render.filepath = str(OUT / 'shd_plush.png')
bpy.ops.render.render(write_still=True)
print('PLUSH TEST DONE')
