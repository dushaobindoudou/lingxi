"""Decisive test: does the Color attribute actually reach Cycles?

Two 320px renders of the same frame:
  A) attribute path kept            -> lookdev_attr.png
  B) attribute swapped for constant -> lookdev_const.png
If A is white but B is brown, the CURVE-domain attribute lookup is failing.
"""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parents[2] / 'assets/characters/lingxi/v5'
s = bpy.context.scene

cam = bpy.data.objects['Portrait']
target = Vector((0, -.03, .37))
direction = (Vector((.62, -1.35, .62)) - target).normalized()
cam.location = target + direction * 2.45
cam.data.dof.focus_distance = (cam.location - target).length
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

s.render.resolution_x = 320
s.render.resolution_y = 320
s.cycles.samples = 8
s.view_settings.exposure = -1.0

mat = bpy.data.materials['LX_ShortFur_Strand']
nt = mat.node_tree
sh = next(n for n in nt.nodes if n.type == 'BSDF_HAIR_PRINCIPLED')
attr = next(n for n in nt.nodes if n.type == 'ATTRIBUTE')

# B) constant colour first
const = nt.nodes.new('ShaderNodeRGB')
const.outputs[0].default_value = (.55, .42, .30, 1)
link = next(l for l in nt.links if l.to_node == sh and l.to_socket.name == 'Color')
const_link = nt.links.new(const.outputs[0], sh.inputs['Color'])
s.render.filepath = str(OUT / 'lookdev_const.png')
bpy.ops.render.render(write_still=True)

# A) restore attribute path
nt.links.remove(const_link)
nt.links.new(attr.outputs['Color'], sh.inputs['Color'])
s.render.filepath = str(OUT / 'lookdev_attr.png')
bpy.ops.render.render(write_still=True)

print('ATTRTEST DONE')
