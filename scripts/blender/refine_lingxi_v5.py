import bpy,math,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';scene=bpy.context.scene
# Palette is explicit material assignment on each curve, avoiding shader attribute ambiguity.
palette=[(.16,.115,.08),(.23,.175,.13),(.32,.25,.19),(.43,.35,.27),(.56,.48,.38),(.78,.73,.65)]
mats=[]
for i,c in enumerate(palette):
 m=bpy.data.materials.new('LX_FurTone'+str(i));m.use_nodes=True;nt=m.node_tree;nt.nodes.clear();p=nt.nodes.new('ShaderNodeBsdfHairPrincipled');p.parametrization='COLOR';p.inputs['Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.45;out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(p.outputs[0],out.inputs['Surface']);mats.append(m)
for o in [o for o in scene.objects if o.name.startswith('LX_Fur_')]:
 attr=o.data.attributes['fur_color'];arr=np.empty(len(attr.data)*4,dtype='f');attr.data.foreach_get('color',arr);arr=arr.reshape(-1,4)
 # Quantize existing stable rest-space color to explicit per-curve material slots.
 tone=np.argmin(((arr[:,:3,None]-np.array(palette).T[None,:,:])**2).sum(1),axis=1)
 at=o.data.attributes.new('tone','INT','POINT');at.data.foreach_set('value',tone.astype('i'))
 ng=next(m.node_group for m in o.modifiers if m.type=='NODES');nodes=ng.nodes;links=ng.links;rr=next(n for n in nodes if n.bl_idname=='GeometryNodeSetCurveRadius');out=next(n for n in nodes if n.type=='GROUP_OUTPUT');prev=rr.outputs['Curve'];read=nodes.new('GeometryNodeInputNamedAttribute');read.data_type='INT';read.inputs['Name'].default_value='tone'
 for i,m in enumerate(mats):
  cmp=nodes.new('FunctionNodeCompare');cmp.data_type='INT';cmp.operation='EQUAL';links.new(read.outputs['Attribute'],cmp.inputs[0]);cmp.inputs[1].default_value=i
  sm=nodes.new('GeometryNodeSetMaterial');sm.inputs['Material'].default_value=m;links.new(prev,sm.inputs['Geometry']);links.new(cmp.outputs['Result'],sm.inputs['Selection']);prev=sm.outputs['Geometry']
 links.new(prev,out.inputs['Geometry'])
 # mesh strands converted during whisker operations can lose modifiers: keep checked later
# Put matching coat colors on the underlying head and body surfaces.
for name in ['LX_Head','LX_Body','LX_Tail']:
 o=bpy.data.objects[name];me=o.data;p=np.array([v.co[:] for v in me.vertices]);x,y,z=p.T;st=(np.sin(y*49+np.sin(z*32)*1.4)+1)/2;c=np.array([.26,.205,.155])[None,:]*(1-st[:,None])+np.array([.48,.39,.30])[None,:]*st[:,None]
 white=np.zeros(len(p))
 if name=='LX_Head':white=np.maximum(np.clip((.513-z)/.025,0,1),np.clip((.019+.18*(.64-z)-abs(x))/.012,0,1))*np.clip((-y-.31)/.045,0,1)
 elif name=='LX_Body':white=np.maximum(np.clip((-y-.18)/.06,0,1),np.clip((.105-z)/.04,0,1))
 c=c*(1-white[:,None])+np.array([.80,.75,.66])[None,:]*white[:,None];at=me.color_attributes.new(name='CoatColor',type='FLOAT_COLOR',domain='POINT');at.data.foreach_set('color',np.column_stack((c,np.ones(len(c)))).astype('f').ravel())
 m=bpy.data.materials['LX_ShortFur_CoatBase'].copy();m.name=name+'_TexturedCoat';nt=m.node_tree;p=nt.nodes.get('Principled BSDF');a=nt.nodes.new('ShaderNodeAttribute');a.attribute_name='CoatColor';mix=nt.nodes.new('ShaderNodeMixRGB');mix.inputs[0].default_value=.85
 previous=p.inputs['Base Color'].links[0].from_socket;nt.links.new(previous,mix.inputs[1]);nt.links.new(a.outputs['Color'],mix.inputs[2]);nt.links.new(mix.outputs[0],p.inputs['Base Color']);me.materials.clear();me.materials.append(m)
# A softer iris contrast and larger pupil by zooming the source around its centre.
for o in [o for o in scene.objects if o.name.startswith('LX_Iris')]:
 for uv in o.data.uv_layers.active.data:uv.uv=((uv.uv.x-.5)*.72+.5,(uv.uv.y-.5)*.72+.5)
# Fur and head were being converted with selected whiskers? Assert native mesh chains retained.
for o in [o for o in scene.objects if o.name.startswith('LX_Fur_')]:assert any(m.type=='NODES' for m in o.modifiers)
# Make outer ear tan; pink remains recessed inner inset.
for o in [o for o in scene.objects if o.name.startswith('LX_Ear.')]:
 o.data.materials.append(bpy.data.materials['LX_Head_TexturedCoat'])
 for p in o.data.polygons:
  center=p.center;u=abs(center.x-( -.12 if '.L' in o.name else .12));p.material_index=0 if u<.036 and center.z>.64 and center.z<.735 else 1
# Fine surface bump retains visible short fibers at subpixel groom scale.
for m in [bpy.data.materials.get('LX_Head_TexturedCoat'),bpy.data.materials.get('LX_Body_TexturedCoat')]:
 nt=m.node_tree;p=nt.nodes.get('Principled BSDF');tex=next(n for n in nt.nodes if n.type=='TEX_IMAGE');bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.2;bump.inputs['Distance'].default_value=.001;nt.links.new(tex.outputs['Color'],bump.inputs['Height']);nt.links.new(bump.outputs[0],p.inputs['Normal'])
scene.frame_set(1);scene.render.filepath=str(OUT/'portrait.png');bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True);bpy.ops.render.render(write_still=True)
result={'status':'palette and iris refined','file':bpy.data.filepath}
