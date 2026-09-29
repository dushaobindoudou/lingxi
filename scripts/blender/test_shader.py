"""Skin + curves, varying how translucent the strands are.

The coat reads as a milky white veil because dense translucent hair (Transmission=1)
scatters light over the striped skin. Sweep Transmission to find where the coat shows
its own colour while still looking soft.
"""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path('/Users/liepin/workspace/lingxi/assets/characters/lingxi/v5')
s = bpy.context.scene

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

hair = bpy.data.materials['LX_ShortFur_Strand']
nt = hair.node_tree
sh = next(n for n in nt.nodes if n.type == 'BSDF_HAIR_PRINCIPLED')
def sock(node, name):
    return next(i for i in node.inputs if i.name == name)
TT = sock(sh, 'Transmission')
curves = [o for o in s.objects if o.type == 'CURVES']

# leave the fur source meshes hidden; keep everything else as authored
for o in s.objects:
    if o.name.startswith('LX_Fur_') and o.type == 'MESH':
        o.hide_render = True

def opaque_brown():
    m = bpy.data.materials.new('PlainBrown')
    nt2 = m.node_tree
    for n in list(nt2.nodes):
        nt2.nodes.remove(n)
    bsdf = nt2.nodes.new('ShaderNodeBsdfPrincipled')
    out_ = nt2.nodes.new('ShaderNodeOutputMaterial')
    nt2.links.new(bsdf.outputs[0], out_.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (.50, .38, .27, 1)
    bsdf.inputs['Roughness'].default_value = .75
    return m

for tag, val in [('T1.00', 1.0), ('T0.40', .40), ('T0.15', .15)]:
    for c in curves:
        c.data.materials[0] = hair
    TT.default_value = val
    s.render.filepath = str(OUT / f'shd_{tag}.png')
    bpy.ops.render.render(write_still=True)

plain = opaque_brown()
for c in curves:
    c.data.materials[0] = plain
s.render.filepath = str(OUT / 'shd_plain.png')
bpy.ops.render.render(write_still=True)

# restore
for c in curves:
    c.data.materials[0] = hair
TT.default_value = 1.0
print('SHADERTEST2 DONE')
