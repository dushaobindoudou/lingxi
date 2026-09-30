"""Isolation test: render with (A) curves hidden and (B) skin meshes hidden,
to find which object class actually produces the white fluff."""
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

# clean up any leftover RGB node from the previous test and restore attribute link
mat = bpy.data.materials['LX_ShortFur_Strand']
nt = mat.node_tree
for n in [n for n in nt.nodes if n.type == 'RGB' and not n.outputs[0].is_linked and n.location.length == 0]:
    nt.nodes.remove(n)
sh = next(n for n in nt.nodes if n.type == 'BSDF_HAIR_PRINCIPLED')
if not sh.inputs['Color'].is_linked:
    attr = next(n for n in nt.nodes if n.type == 'ATTRIBUTE')
    nt.links.new(attr.outputs['Color'], sh.inputs['Color'])

curves = [o for o in s.objects if o.type == 'CURVES']
meshes = [o for o in s.objects if o.type == 'MESH' and o.name.startswith(('LX_Body', 'LX_Head', 'LX_Jaw', 'LX_Tail'))]
fur_src = [o for o in s.objects if o.type == 'MESH' and o.name.startswith('LX_Fur_')]
other = [o for o in s.objects if o.type == 'MESH' and o not in meshes and o not in fur_src]

def hide_set(objs, val):
    for o in objs:
        o.hide_render = val

print('counts: curves', len(curves), 'skin', len(meshes), 'fursrc', len(fur_src), 'other-mesh', len(other))
for o in other:
    print('  other mesh:', o.name)

# A: hide curves -> what is left is skin + fur sources
hide_set(curves, True)
s.render.filepath = str(OUT / 'iso_nocurves.png')
bpy.ops.render.render(write_still=True)
hide_set(curves, False)

# B: hide skin, keep curves + fur sources
hide_set(meshes, True)
s.render.filepath = str(OUT / 'iso_noskin.png')
bpy.ops.render.render(write_still=True)
hide_set(meshes, False)

print('ISO DONE')
