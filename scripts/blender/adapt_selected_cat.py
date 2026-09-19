"""Non-destructive Lingxi v6 adaptation of supplied an-animated-cat; run after evaluation."""
import bpy,math,random,json
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6';OUT.mkdir(exist_ok=True)
TEX=OUT/'textures'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/characters/lingxi/model-evaluation/animated-original.blend'))
s=bpy.context.scene;rig=next(o for o in s.objects if o.type=='ARMATURE');rig.name='Lingxi_Rig_v6'
source=bpy.data.actions.get('Take 001');source.name='source_groom_paw';source.use_fake_user=True
# glTF has static pose transforms not keyed by the clip. Capture evaluated world-space poses before reset.
original_motion={'rest':{b.name:list(map(list,b.matrix_local)) for b in rig.data.bones},'frames':[]}
for frame in range(145):
 s.frame_set(frame);bpy.context.view_layer.update();original_motion['frames'].append({p.name:list(map(list,p.matrix)) for p in rig.pose.bones})
(OUT/'source-motion.json').write_text(json.dumps(original_motion))

for o in list(s.objects):
 if o.type=='MESH' and o.name=='Icosphere':bpy.data.objects.remove(o,do_unlink=True)
rig.animation_data_clear()
for p in rig.pose.bones:p.matrix_basis.identity()
bpy.context.view_layer.update()
body=next(o for o in s.objects if o.type=='MESH' and '#81' in o.name);eyes=next(o for o in s.objects if o.type=='MESH' and '#105' in o.name);whisk=next(o for o in s.objects if o.type=='MESH' and '#93' in o.name)
body.name='Lingxi_Coat';eyes.name='Lingxi_Eyes';whisk.name='Lingxi_Whiskers'
# Keep anatomical rig and weights. Small sculpt only, without scaling leg bones.
def sculpt(p):
 x,y,z=p
 for side in [-1,1]:
  center=Vector((12.382,side*1.178,16.893));d=Vector((x,y,z))-center;radius=d.length
  if radius<1.4:
   factor=.55*math.exp(-(radius/.9)**4);p=Vector((x,y,z))+d*factor;x,y,z=p
 h=max(0,min(1,(z-12.5)/2.0))*max(0,min(1,(x-6.5)/2))
 # Compact body and legs, full cheek/skull volume; smooth field is shared by rig and skin.
 base=Vector((x*.86,y*1.18,z*.80))
 head=Vector((11.2*.86+(x-11.2)*1.18,y*1.43,16.6*.80+(z-16.6)*1.15+.3))
 if x>13:head.x-=(x-13)*.22
 if z>18.7:head.z-=(z-18.7)*.20
 p=base.lerp(head,h)
 if z<2.4 and abs(y)>1 and abs(x)>3 and x<8:
  w=(1-z/2.4)*.20;cx=5.6 if x>0 else -7.6;cy=2.2 if y>0 else -2.2
  p.x+=(x-cx)*w;p.y+=(y-cy)*w
 return p
original={o.name:[o.matrix_world@v.co for v in o.data.vertices] for o in [body,eyes,whisk]}
for o in [body,eyes,whisk]:
 inv=o.matrix_world.inverted()
 for v in o.data.vertices:v.co=inv@sculpt(o.matrix_world@v.co)
 for p in o.data.polygons:p.use_smooth=True
# Apply the same sculpt to bone origins, preserving local axis orientation and weight topology.
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for b in rig.data.edit_bones:
 old=b.head.copy();delta=sculpt(old)-old;b.head+=delta;b.tail+=delta
bpy.ops.object.mode_set(mode='OBJECT')
# Coat markings defined on actual surface, then baked into original UV.
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def coat(p):
 x,y,z=p
 stripe=(.5+.5*math.sin(x*1.55+1.6*math.sin(z*.65)+abs(y)*1.3))**9
 base=Vector((.43,.34,.255))*(1-.50*stripe)
 white=max(1-smooth(2.0,3.7,z), (1-smooth(8.5,10.5,z))*(smooth(-5,4,x)))
 if x>8:
  # White chin and muzzle, narrow forehead blaze; retain tabby cheeks.
  white=max(white,(1-smooth(15.5,16.5,z))*smooth(10.6,12.2,x), (1-smooth(.18,.65,abs(y)))*smooth(12.0,13.3,x))
 base=base.lerp(Vector((.88,.82,.71)),white)
 earmask=smooth(18.4,19.2,z)*smooth(10.5,11.35,x)*(1-smooth(2.0,2.7,abs(y)))
 base=base.lerp(Vector((.63,.30,.27)),earmask*.85)
 return (*base,1)
color=body.data.color_attributes.new(name='LXCoat',type='FLOAT_COLOR',domain='CORNER')
for loop in body.data.loops:color.data[loop.index].color=coat(original[body.name][loop.vertex_index])
mat=bpy.data.materials.new('LX_v6_UV_Coat');mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links;n.clear()
out=n.new('ShaderNodeOutputMaterial');p=n.new('ShaderNodeBsdfPrincipled');p.inputs['Roughness'].default_value=.84;l.new(p.outputs['BSDF'],out.inputs['Surface'])
v=n.new('ShaderNodeVertexColor');v.layer_name='LXCoat'
tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(TEX/'fur-basecolor-source.png'));tex.projection='BOX';tex.projection_blend=.25
coord=n.new('ShaderNodeTexCoord');l.new(coord.outputs['Generated'],tex.inputs['Vector'])
mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.28;l.new(v.outputs['Color'],mix.inputs[1]);l.new(tex.outputs['Color'],mix.inputs[2]);l.new(mix.outputs[0],p.inputs['Base Color'])
body.data.materials.clear();body.data.materials.append(mat)
# Pink soft tissues use the existing source image and original UV, preserving teeth.
pink=bpy.data.materials.new('LX_v6_PinkTissue');pink.use_nodes=True;pn=pink.node_tree.nodes.get('Principled BSDF');pn.inputs['Base Color'].default_value=(.65,.25,.23,1);pn.inputs['Roughness'].default_value=.45
pt=pink.node_tree.nodes.new('ShaderNodeTexImage');pt.image=bpy.data.images.load(str(TEX/'pink-tissue-basecolor-source.png'));pm=pink.node_tree.nodes.new('ShaderNodeMixRGB');pm.blend_type='MULTIPLY';pm.inputs[0].default_value=.35;pm.inputs[1].default_value=(.70,.32,.30,1);pink.node_tree.links.new(pt.outputs['Color'],pm.inputs[2]);pink.node_tree.links.new(pm.outputs[0],pn.inputs['Base Color']);body.data.materials.append(pink)
teeth=bpy.data.materials.new('LX_v6_Teeth');teeth.diffuse_color=(.87,.83,.72,1);teeth.use_nodes=True;teeth.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.87,.83,.72,1);body.data.materials.append(teeth)
uv=body.data.uv_layers.active.data
for poly in body.data.polygons:
 points=[original[body.name][i] for i in poly.vertices];c=sum(points,Vector())/len(points);u=sum(uv[i].uv.x for i in poly.loop_indices)/len(poly.loop_indices);v0=sum(uv[i].uv.y for i in poly.loop_indices)/len(poly.loop_indices)
 groups={body.vertex_groups[g.group].name for i in poly.vertices for g in body.data.vertices[i].groups if g.weight>.4}
 tongue=any('tongue' in g for g in groups)
 nose=c.x>13.75 and abs(c.y)<.43 and 15.55<c.z<16.25
 pads=.39<u<.69 and .09<v0<.32 and c.z<.55
 inner_ear=any('_ear_' in g for g in groups) and c.x>10.8 and c.z>18.7 and abs(c.y)<2.3
 oral=(v0>.85 and (u<.34 or u>.64)) or (u<.17 and .54<v0<.84)
 if tongue or nose or pads:poly.material_index=1
 elif oral and c.x>11.0 and 14.9<c.z<15.9 and abs(c.y)<.9:poly.material_index=2
# New iris UVs sampled from approved iris source, with separate physically lit specular.
eyemat=bpy.data.materials.new('LX_v6_HazelIris');eyemat.use_nodes=True;ep=eyemat.node_tree.nodes.get('Principled BSDF');ep.inputs['Roughness'].default_value=.16;ep.inputs['Coat Weight'].default_value=.55;ep.inputs['Coat Roughness'].default_value=.07
et=eyemat.node_tree.nodes.new('ShaderNodeTexImage');et.image=bpy.data.images.load(str(TEX/'iris-basecolor-source.png'));eyemat.node_tree.links.new(et.outputs['Color'],ep.inputs['Base Color']);eyes.data.materials.clear();eyes.data.materials.append(eyemat)
euv=eyes.data.uv_layers.active.data
for loop in eyes.data.loops:
 pos=original[eyes.name][loop.vertex_index];sign=1 if pos.y>0 else -1;c=Vector((12.382,sign*1.178,16.893));d=pos-c;euv[loop.index].uv=(.5+(d.y*.8-d.x*sign*.6)/1.3,.5+d.z/1.3)
for m in whisk.data.materials:
 if m and m.use_nodes:
  wp=m.node_tree.nodes.get('Principled BSDF')
  if wp:
   for link in list(wp.inputs['Base Color'].links):m.node_tree.links.remove(link)
   wp.inputs['Base Color'].default_value=(.68,.62,.53,1);wp.inputs['Roughness'].default_value=.8
whisk.hide_render=True;whisk.hide_viewport=True
# UV bake: real image textures survive glTF export instead of procedural-only materials.
s.render.engine='CYCLES';s.cycles.samples=1
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
baked=bpy.data.images.new('lingxi-v6-coat-basecolor',width=4096,height=4096,alpha=False)
for m in body.data.materials:
 tn=m.node_tree.nodes.new('ShaderNodeTexImage');tn.image=baked;m.node_tree.nodes.active=tn
s.render.bake.use_pass_direct=False;s.render.bake.use_pass_indirect=False;s.render.bake.use_pass_color=True;s.render.bake.margin=12
bpy.ops.object.bake(type='DIFFUSE');baked.filepath_raw=str(OUT/'coat-basecolor.png');baked.file_format='PNG';baked.save()
for m in body.data.materials:
 shader=m.node_tree.nodes.get('Principled BSDF');tn=next(node for node in m.node_tree.nodes if node.type=='TEX_IMAGE' and node.image==baked)
 for link in list(shader.inputs['Base Color'].links):m.node_tree.links.remove(link)
 m.node_tree.links.new(tn.outputs['Color'],shader.inputs['Base Color'])
# Bake fine source detail as a tangent-space normal texture for real-time use.
bump=mat.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.32;bump.inputs['Distance'].default_value=.045
mat.node_tree.links.new(tex.outputs['Color'],bump.inputs['Height']);mat.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
normal=bpy.data.images.new('lingxi-v6-coat-normal',width=4096,height=4096,alpha=False);normal.colorspace_settings.name='Non-Color'
for m in body.data.materials:
 tn=m.node_tree.nodes.new('ShaderNodeTexImage');tn.image=normal;m.node_tree.nodes.active=tn
bpy.ops.object.bake(type='NORMAL');normal.filepath_raw=str(OUT/'coat-normal.png');normal.file_format='PNG';normal.save()
for m in body.data.materials:
 shader=m.node_tree.nodes.get('Principled BSDF');tn=next(node for node in m.node_tree.nodes if node.type=='TEX_IMAGE' and node.image==normal);nm=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(tn.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],shader.inputs['Normal'])
# Smooth surface without changing the established skin weights.
sub=body.modifiers.new('Gentle surface refinement','SUBSURF');sub.levels=1;sub.render_levels=1
# Short tapered fur geometry, every root carries interpolated source skin weights and UV.
body.data.calc_loop_triangles();random.seed(612);tris=[t for t in body.data.loop_triangles if body.data.polygons[t.polygon_index].material_index==0]
areas=[t.area for t in tris];verts=[];faces=[];uvs=[];weights=[]
for tri in random.choices(tris,weights=areas,k=44000):
 r=math.sqrt(random.random());q=random.random();bc=(1-r,r*(1-q),r*q);indices=tri.vertices
 pos=sum((body.data.vertices[i].co*w for i,w in zip(indices,bc)),Vector());normal=sum((body.data.vertices[i].normal*w for i,w in zip(indices,bc)),Vector()).normalized()
 world=body.matrix_world@pos
 if world.z<1 or world.x>12.7 and world.z<18:continue
 wt={}
 for i,w in zip(indices,bc):
  for g in body.data.vertices[i].groups:wt[g.group]=wt.get(g.group,0)+w*g.weight
 tuv=sum((uv[li].uv*w for li,w in zip(tri.loops,bc)),Vector((0,0)))
 # Mesh coordinates are not assumed unit scale.
 length=random.uniform(.10,.22);invrot=body.matrix_world.to_3x3().inverted();flow=invrot@Vector((-1,0,-.25 if world.z>16 else -.5));flow=(flow-normal*flow.dot(normal)).normalized()
 direction=(normal*.75+flow*.65).normalized();length/=body.matrix_world.to_scale().length/math.sqrt(3)
 side=normal.cross(flow).normalized()*length*.035;idx=len(verts)
 for t,w in [(0,1),(.5,.6),(1,0)]:
  for sign in [-1,1]:verts.append(pos+direction*length*t+side*w*sign);uvs.append(tuv.copy());weights.append(wt)
 faces.extend([(idx,idx+1,idx+3,idx+2),(idx+2,idx+3,idx+5,idx+4)])
fm=bpy.data.meshes.new('ShortFurSkinMesh');fm.from_pydata(verts,[],faces);fm.update();fur=bpy.data.objects.new('Lingxi_ShortFur',fm);s.collection.objects.link(fur);fur.matrix_world=body.matrix_world.copy();fur.data.materials.append(mat)
fu=fm.uv_layers.new(name='UVMap')
for loop in fm.loops:fu.data[loop.index].uv=uvs[loop.vertex_index]
for g in body.vertex_groups:fur.vertex_groups.new(name=g.name)
for i,wt in enumerate(weights):
 for g,w in wt.items():
  if w>.001:fur.vertex_groups[g].add([i],w,'REPLACE')
am=fur.modifiers.new('Original skin weights','ARMATURE');am.object=rig
# Fine replacement whiskers, skinned to the original head bone.
wv=[];wf=[]
for side in [-1,1]:
 for row in range(7):
  start=Vector((13.4,side*(.8+row*.045),15.3+row*.09));start=sculpt(start)
  for step in range(9):
   t=step/8;pos=start+Vector((-.9*t,side*(3.1+row*.17)*t,(row-3)*.11*t+.15*t*t));width=.017*(1-t)+.001
   wv.extend([pos+Vector((0,0,width)),pos-Vector((0,0,width))])
   k=len(wv)-2
   if step:wf.append((k-2,k-1,k+1,k))
wm=bpy.data.meshes.new('Fine whisker geometry');wm.from_pydata(wv,[],wf);wo=bpy.data.objects.new('Lingxi_FineWhiskers',wm);s.collection.objects.link(wo)
wmat=bpy.data.materials.new('LX_WhiskerIvory');wmat.diffuse_color=(.61,.56,.46,1);wm.materials.append(wmat)
wg=wo.vertex_groups.new(name='j_head_08');wg.add(list(range(len(wv))),1,'REPLACE');wo.modifiers.new('Head skin','ARMATURE').object=rig
bpy.data.objects.remove(whisk,do_unlink=True)
# Stable studio lighting, neutral ground and portrait camera.
for o in list(s.objects):
 if o.type in ('LIGHT','CAMERA'):bpy.data.objects.remove(o,do_unlink=True)
s.world=bpy.data.worlds.new('Lingxi Studio');s.world.use_nodes=True
s.world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.51,.46,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for pos,power,size in [((26,-28,40),10000,25),((0,22,30),5000,22),((-22,-5,32),7000,20)]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,9))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.10));ground=bpy.context.object;ground.name='Studio_Ground';gm=bpy.data.materials.new('Studio beige');gm.diffuse_color=(.33,.29,.24,1);ground.data.materials.append(gm)
bpy.ops.object.camera_add(location=(40,-45,26));cam=bpy.context.object;cam.rotation_euler=(Vector((-1,0,8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=40;s.camera=cam
s.render.resolution_x=900;s.render.resolution_y=760;s.render.resolution_percentage=100;s.cycles.samples=32;s.view_settings.view_transform='AgX'
s.render.filepath=str(OUT/'standing.png');bpy.ops.render.render(write_still=True)
bpy.data.orphans_purge(do_recursive=True)
for img in bpy.data.images:
 if img.has_data:img.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6-lookdev.blend'))
print('ADAPTATION_DONE')
