import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';s=bpy.context.scene
for o in [o for o in s.objects if o.name.startswith('LX_Fur_')]:
 ng=next(m.node_group for m in o.modifiers if m.type=='NODES');rr=next(n for n in ng.nodes if n.bl_idname=='GeometryNodeSetCurveRadius')
 for l in list(rr.inputs['Radius'].links):ng.links.remove(l)
 rr.inputs['Radius'].default_value=.00035
 # use rest geometry stored curve color via named attribute on CURVE domain
 read=ng.nodes.new('GeometryNodeInputNamedAttribute');read.data_type='FLOAT_COLOR';read.inputs['Name'].default_value='fur_color'
 store=ng.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type='FLOAT_COLOR';store.domain='CURVE';store.inputs['Name'].default_value='coat_color';ng.links.new(rr.outputs['Curve'],store.inputs['Geometry']);ng.links.new(read.outputs['Attribute'],store.inputs['Value'])
 mat=bpy.data.materials['LX_ShortFur_Strand'];sh=next(n for n in mat.node_tree.nodes if n.type=='BSDF_HAIR_PRINCIPLED');a=next(n for n in mat.node_tree.nodes if n.type=='ATTRIBUTE');a.attribute_name='coat_color'
 sm=ng.nodes.new('GeometryNodeSetMaterial');sm.inputs['Material'].default_value=mat;ng.links.new(store.outputs['Geometry'],sm.inputs['Geometry']);out=next(n for n in ng.nodes if n.type=='GROUP_OUTPUT');ng.links.new(sm.outputs['Geometry'],out.inputs['Geometry'])
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True);s.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
result={'fixed':'curve-domain color and radius'}
