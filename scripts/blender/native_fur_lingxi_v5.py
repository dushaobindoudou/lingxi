import bpy,numpy as np,json,os
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=Path(os.environ.get('LINGXI_OUT',ROOT/'assets/characters/lingxi/v5'));s=bpy.context.scene
# Idempotent: a previous conversion must never survive into this one, or the render
# doubles the hair count and every later run adds another ".00x" layer.
for old in [o for o in s.objects if o.type=='CURVES' and o.name.startswith('LX_RenderFur_')]:
 bpy.data.objects.remove(old,do_unlink=True)
mat=bpy.data.materials['LX_ShortFur_Strand']
# Blender 5.2 resolves node sockets by internal identifier, which does not always match
# the UI label (hair "Transmission" is 'TT lobe'), so sockets are matched by label.
def sock(node,name,io='inputs'):return next(i for i in getattr(node,io) if i.name==name)
a=next(n for n in mat.node_tree.nodes if n.type=='ATTRIBUTE');a.attribute_name='coat_color'
# Principled Hair BSDF in COLOR mode barely absorbs at this palette: 290k translucent
# strands scattered light into a milky white veil that hid the tabby underneath
# (measured: coat median 197 / 255 with the pattern invisible, at any exposure).
# An opaque Principled BSDF on the same coat_color attribute gives the plush long-hair
# look the reference turnaround has, and the stripes survive (contrast 95 vs ref 78).
# `!=`, never `is not`: Blender hands out a fresh RNA wrapper per iteration, so an
# identity test would match nothing and delete the very node we still need (a removed
# node's sockets go empty, which surfaces as a StopIteration in sock() below).
for n in list(mat.node_tree.nodes):
 if n!=a:mat.node_tree.nodes.remove(n)
out_=mat.node_tree.nodes.new('ShaderNodeOutputMaterial');bsdf=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
mat.node_tree.links.new(sock(a,'Color','outputs'),sock(bsdf,'Base Color'))
# 15% translucent: thin hair lets light through, which is the soft glowing edge of a backlit kitten
# in the references; a fully opaque strand read as felt.
tl=mat.node_tree.nodes.new('ShaderNodeBsdfTranslucent');mx=mat.node_tree.nodes.new('ShaderNodeMixShader');mx.inputs[0].default_value=.15
mat.node_tree.links.new(sock(a,'Color','outputs'),sock(tl,'Color'))
mat.node_tree.links.new(bsdf.outputs[0],mx.inputs[1]);mat.node_tree.links.new(tl.outputs[0],mx.inputs[2])
mat.node_tree.links.new(mx.outputs[0],sock(out_,'Surface'))
sock(bsdf,'Roughness').default_value=.72
# Sheen .25 laid a white velvet haze over the whole coat at grazing angles - the milky,
# low-contrast look; a trace keeps the soft edge glow.
for nm,val in [('Sheen Weight',.06),('Specular IOR Level',.2)]:
 try:sock(bsdf,nm).default_value=val
 except StopIteration:pass
for src in [o for o in s.objects if o.name.startswith('LX_Fur_')]:
 for mod in list(src.modifiers):
  if mod.type=='NODES':src.modifiers.remove(mod)
 P=int(src.get('strand_points',4));n=len(src.data.vertices)//P;d=bpy.data.hair_curves.new('Native short fur');d.add_curves([P]*n);arr=np.empty(n*P*3,dtype='f');src.data.vertices.foreach_get('co',arr);d.attributes['position'].data.foreach_set('vector',arr)
 # One radius profile for every layer threw away the undercoat's thinner strands; scale the render
 # profile by each strand's root radius relative to a guard hair (.00078 in RADII).
 # .00042 was the OLD guard root: with it every guard strand rendered 1.86x too thick.
 fr=np.empty(n*P,dtype='f');src.data.attributes['fur_radius'].data.foreach_get('value',fr);k=fr.reshape(n,P)[:,:1]/.00078
 r=d.attributes.new('radius','FLOAT','POINT');r.data.foreach_set('value',(np.tile(np.interp(np.linspace(0,1,P),np.linspace(0,1,4),[.00026,.00020,.00012,.000012]),(n,1))*k).astype('f').ravel())
 # `ca`, not `a`: re-using the name would shadow the material's Attribute node above.
 # Per POINT, not per curve: the curve domain kept only the root colour and threw away the
 # root-to-tip gradient the groom computes, so every hair rendered as one flat colour.
 c=np.empty(n*P*4,dtype='f');src.data.attributes['fur_color'].data.foreach_get('color',c);ca=d.attributes.new('coat_color','FLOAT_COLOR','POINT');ca.data.foreach_set('color',c)
 ob=bpy.data.objects.new('LX_RenderFur_'+src.name,d);s.collection.objects.link(ob);d.materials.append(mat);ob['deformation_source']=src.name
 ng=bpy.data.node_groups.new('Follow skinned point positions','GeometryNodeTree');ng.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');ng.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');ns=ng.nodes;ls=ng.links;inp=ns.new('NodeGroupInput');out=ns.new('NodeGroupOutput');info=ns.new('GeometryNodeObjectInfo');info.inputs['Object'].default_value=src;info.transform_space='RELATIVE';sample=ns.new('GeometryNodeSampleIndex');sample.data_type='FLOAT_VECTOR';sample.domain='POINT';pos=ns.new('GeometryNodeInputPosition');ix=ns.new('GeometryNodeInputIndex');setp=ns.new('GeometryNodeSetPosition');ls.new(info.outputs['Geometry'],sample.inputs['Geometry']);ls.new(pos.outputs['Position'],sample.inputs['Value']);ls.new(ix.outputs['Index'],sample.inputs['Index']);ls.new(inp.outputs['Geometry'],setp.inputs['Geometry']);ls.new(sample.outputs['Value'],setp.inputs['Position']);ls.new(setp.outputs['Geometry'],out.inputs['Geometry']);mod=ob.modifiers.new('Follow weighted source mesh','NODES');mod.node_group=ng
 # The strand SOURCE meshes have no material of their own; in a Cycles render they come
 # out as default-white fluff and bury both the striped skin and the coloured curves.
 # They only exist as the GN deformation source, which works fine with hide_render.
 src.hide_render=True
s.frame_set(1)
# Full-body portrait framing: at 105mm the original 1.48m distance cropped the cat to
# a face close-up; pull back to 2.45m so the whole kitten fits with margin.
cam=bpy.data.objects['Portrait'];target=Vector((0,-.27,.34))
cam.location=Vector((0,-2.35,.42))
cam.data.dof.focus_distance=(cam.location-target).length
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
# With the palette finally stored as linear (see srgb_lin in the build script) the coat
# no longer clips, so only a nudge is needed. Measured over a plate-differenced mask
# against the reference turnaround (median 193 / contrast 74 / warmth 23):
# -0.05 lands median ~190, contrast ~72, warmth ~28 - the closest of the sweeps tried.
s.view_settings.exposure=-0.05
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True)
clips=json.loads((OUT/'animations.json').read_text());lie=next(c for c in clips if c['name']=='LieDown')
s.frame_set(int(lie['start']+.72*(lie['end']-lie['start'])))
s.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
result={'native_curves':sum(o.type=='CURVES' for o in s.objects)}
print('NATIVE_FUR',json.dumps(result))
