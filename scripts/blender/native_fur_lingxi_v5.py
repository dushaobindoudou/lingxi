import bpy,numpy as np,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';s=bpy.context.scene
mat=bpy.data.materials['LX_ShortFur_Strand'];sh=next(n for n in mat.node_tree.nodes if n.type=='BSDF_HAIR_PRINCIPLED');a=next(n for n in mat.node_tree.nodes if n.type=='ATTRIBUTE');a.attribute_name='coat_color'
for src in [o for o in s.objects if o.name.startswith('LX_Fur_')]:
 for mod in list(src.modifiers):
  if mod.type=='NODES':src.modifiers.remove(mod)
 n=len(src.data.vertices)//4;d=bpy.data.hair_curves.new('Native short fur');d.add_curves([4]*n);arr=np.empty(n*4*3,dtype='f');src.data.vertices.foreach_get('co',arr);d.attributes['position'].data.foreach_set('vector',arr)
 r=d.attributes.new('radius','FLOAT','POINT');r.data.foreach_set('value',np.tile([.00026,.00020,.00012,.000012],n).astype('f'))
 c=np.empty(n*4*4,dtype='f');src.data.attributes['fur_color'].data.foreach_get('color',c);a=d.attributes.new('coat_color','FLOAT_COLOR','CURVE');a.data.foreach_set('color',c.reshape(n,4,4)[:,0,:].copy().ravel())
 ob=bpy.data.objects.new('LX_RenderFur_'+src.name,d);s.collection.objects.link(ob);d.materials.append(mat);ob['deformation_source']=src.name
 ng=bpy.data.node_groups.new('Follow skinned point positions','GeometryNodeTree');ng.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');ng.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');ns=ng.nodes;ls=ng.links;inp=ns.new('NodeGroupInput');out=ns.new('NodeGroupOutput');info=ns.new('GeometryNodeObjectInfo');info.inputs['Object'].default_value=src;info.transform_space='RELATIVE';sample=ns.new('GeometryNodeSampleIndex');sample.data_type='FLOAT_VECTOR';sample.domain='POINT';pos=ns.new('GeometryNodeInputPosition');ix=ns.new('GeometryNodeInputIndex');setp=ns.new('GeometryNodeSetPosition');ls.new(info.outputs['Geometry'],sample.inputs['Geometry']);ls.new(pos.outputs['Position'],sample.inputs['Value']);ls.new(ix.outputs['Index'],sample.inputs['Index']);ls.new(inp.outputs['Geometry'],setp.inputs['Geometry']);ls.new(sample.outputs['Value'],setp.inputs['Position']);ls.new(setp.outputs['Geometry'],out.inputs['Geometry']);mod=ob.modifiers.new('Follow weighted source mesh','NODES');mod.node_group=ng
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True);s.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
result={'native_curves':sum(o.type=='CURVES' for o in s.objects)}
