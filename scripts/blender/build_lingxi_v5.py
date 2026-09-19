"""Rebuild an editable short-fur character with shared skin weights and named actions.
Uses the approved generated material sources; preserves v4 unchanged.
"""
import bpy, math, json
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/characters/lingxi/v5';OUT.mkdir(exist_ok=True)
rng=np.random.default_rng(512)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.name='Lingxi • Short Fur Rig v5'
lib=ROOT/'assets/characters/lingxi/materials/short-fur-v1/lingxi-short-fur-materials.blend'
with bpy.data.libraries.load(str(lib),link=False) as (a,b):b.materials=list(a.materials)
M=lambda n:bpy.data.materials['LX_ShortFur_'+n]
def mat(name,col,rough=.5):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough;return m
cream=M('WhiteDownBase');coat=M('CoatBase');pink=M('PinkPawPads');nosemat=M('PinkNose');mouthmat=M('PinkMouth')
dark=mat('LX_MouthInterior',(.035,.009,.014));black=mat('LX_Pupil',(.004,.006,.004),.13);toothmat=mat('LX_IvoryTeeth',(.85,.80,.67),.3)
# Triplanar source mapping eliminates seams on the merged body. This is not a baked UV atlas.
for material in [coat,pink,nosemat,mouthmat]:
 nt=material.node_tree
 for t in [n for n in nt.nodes if n.type=='TEX_IMAGE']:
  c=nt.nodes.new('ShaderNodeTexCoord');nt.links.new(c.outputs['Generated'],t.inputs['Vector']);t.projection='BOX';t.projection_blend=.3

def sphere(name,loc,scale,material=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=loc)
 o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if material:o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 return o

def merge(objects,name,voxel=.009):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
 mod=o.modifiers.new('Continuous surface','REMESH');mod.mode='VOXEL';mod.voxel_size=voxel;bpy.ops.object.modifier_apply(modifier=mod.name)
 mod=o.modifiers.new('Surface relaxation','SMOOTH');mod.factor=1.2;mod.iterations=5;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in o.data.polygons:p.use_smooth=True
 return o
# metres, facing -Y; a neutral standing rest pose enables locomotion.
parts=[sphere('Torso',(0,.07,.34),(.16,.30,.17)),sphere('Chest',(0,-.14,.35),(.14,.16,.18)),sphere('Rump',(0,.25,.32),(.155,.16,.17))]
for s in [-1,1]:
 parts += [sphere('FrontUpper',(s*.105,-.17,.25),(.062,.066,.16)),sphere('FrontLower',(s*.108,-.19,.12),(.046,.046,.095)),sphere('FrontPaw',(s*.108,-.215,.047),(.064,.088,.047)),sphere('Haunch',(s*.12,.24,.24),(.082,.105,.14)),sphere('RearHock',(s*.12,.30,.12),(.044,.06,.095)),sphere('RearPaw',(s*.12,.245,.046),(.061,.085,.045))]
body=merge(parts,'LX_Body',.007);body.data.materials.clear();body.data.materials.append(coat)
head=merge([sphere('Cranium',(0,-.285,.525),(.172,.145,.162)),sphere('MuzzleL',(-.037,-.405,.465),(.051,.039,.037)),sphere('MuzzleR',(.037,-.405,.465),(.051,.039,.037))],'LX_Head',.005)
head.data.materials.clear();head.data.materials.append(cream)
# Muzzle remains divided from lower jaw; dark recessed opening gives a real oral interior.
jaw=sphere('LX_Jaw',(0,-.378,.433),(.068,.065,.023),cream)
cavity=sphere('LX_MouthCavity',(0,-.393,.445),(.045,.039,.019),dark)
tongue=sphere('LX_Tongue',(0,-.414,.435),(.022,.034,.006),mouthmat)
nose=sphere('LX_Nose',(0,-.443,.486),(.022,.010,.013),nosemat)
for v in nose.data.vertices:
 if v.co.z<0:v.co.x*=max(.22,1+v.co.z/.015)
# Skeleton: common bind space shared by body, separate face parts, and fur vertices.
ad=bpy.data.armatures.new('LingxiSkeleton');rig=bpy.data.objects.new('LX_Rig',ad);scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(n,a,b,parent=None):
 x=ad.edit_bones.new(n);x.head=a;x.tail=b
 if parent:x.parent=ad.edit_bones[parent]
 return x
bone('Root',(0,0,0),(0,0,.1));bone('Pelvis',(0,.24,.30),(0,.08,.33),'Root');bone('Spine',(0,.08,.33),(0,-.16,.36),'Pelvis');bone('Neck',(0,-.16,.36),(0,-.27,.48),'Spine');bone('Head',(0,-.27,.48),(0,-.38,.53),'Neck');bone('Jaw',(0,-.34,.452),(0,-.42,.43),'Head');bone('Tongue',(0,-.39,.438),(0,-.448,.438),'Jaw');bone('Nose',(0,-.43,.48),(0,-.45,.49),'Head')
segments=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R'
 for front,y in [(True,-.17),(False,.24)]:
  pre='Front' if front else 'Rear';x=s*(.108 if front else .12)
  a=(x,y,.32);b=(x,y+(.012 if front else .065),.17);c=(x,y-(.02 if front else -.025),.065);d=(x,y-.08,.035)
  bone(pre+'Upper.'+suf,a,b,'Spine' if front else 'Pelvis');bone(pre+'Lower.'+suf,b,c,pre+'Upper.'+suf);bone(pre+'Paw.'+suf,c,d,pre+'Lower.'+suf)
  for i in range(4):bone(pre+f'Toe{i}.'+suf,(x+(i-1.5)*.023,y-.06,.04),(x+(i-1.5)*.023,y-.10,.033),pre+'Paw.'+suf)
 bone('Ear.'+suf,(s*.115,-.275,.625),(s*.14,-.25,.765),'Head')
 bone('Eye.'+suf,(s*.072,-.398,.541),(s*.072,-.43,.541),'Head')
 bone('Whisker.'+suf,(s*.048,-.43,.477),(s*.21,-.43,.48),'Head')
tailpoints=[(0,.36,.33),(.04,.45,.36),(.09,.53,.40),(.13,.61,.45),(.14,.68,.50),(.12,.73,.55)]
for i in range(5):bone('Tail'+str(i),tailpoints[i],tailpoints[i+1],'Pelvis' if i==0 else 'Tail'+str(i-1))
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for p in rig.pose.bones:p.rotation_mode='XYZ'

# Weight algorithm: piecewise smooth anatomical regions, normalized per vertex.
def weights(points,region):
 n=len(points);w={}
 def add(k,v):w[k]=np.asarray(v if np.ndim(v) else np.full(n,v),dtype=float)
 if region not in ['body','tail']:
  add(region,1);return w
 if region=='tail':
  centers=np.array([(np.array(tailpoints[i])+np.array(tailpoints[i+1]))/2 for i in range(5)])
  dist=np.linalg.norm(points[:,None,:]-centers[None,:,:],axis=2);val=np.exp(-dist**2/.006)
  val/=val.sum(axis=1)[:,None]
  return {'Tail'+str(i):val[:,i] for i in range(5)}
 x,y,z=points.T;pel=np.clip((y+.06)/.30,0,1);add('Pelvis',pel);add('Spine',1-pel)
 for s in [-1,1]:
  suf='L' if s<0 else 'R'
  for pre,cy in [('Front',-.17),('Rear',.26)]:
   mask=np.clip((.31-z)/.12,0,1)*np.clip((s*x-.035)/.045,0,1)*np.exp(-((y-cy)/.13)**6)
   for k in list(w):w[k]*=(1-mask)
   low=np.clip((.23-z)/.13,0,1);paw=np.clip((.105-z)/.045,0,1)
   add(pre+'Upper.'+suf,mask*(1-low));add(pre+'Lower.'+suf,mask*low*(1-paw));add(pre+'Paw.'+suf,mask*low*paw)
 total=sum(w.values());return {k:v/total for k,v in w.items()}

def bind(o,region):
 bpy.context.view_layer.update()
 # apply all transforms so meshes and fur use common world-space skin coordinates
 mw=o.matrix_world.copy()
 for v in o.data.vertices:v.co=mw@v.co
 o.matrix_world.identity()
 pts=np.array([v.co[:] for v in o.data.vertices]);w=weights(pts,region)
 for k,vals in w.items():
  g=o.vertex_groups.new(name=k)
  # quantized batching preserves normalization within 0.001, avoids millions of API calls
  q=np.round(vals*1000).astype(int)
  for val in np.unique(q):
   if val>0:g.add(np.where(q==val)[0].tolist(),float(val)/1000,'REPLACE')
 mod=o.modifiers.new('Shared skeletal deformation','ARMATURE');mod.object=rig;o['skin_region']=region
 return pts
bind(body,'body');bind(head,'Head')
for o,r in [(jaw,'Jaw'),(cavity,'Head'),(tongue,'Tongue'),(nose,'Nose')]:bind(o,r)
# Curved ear shells with pink inner membrane.
ears=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R';vs=[];fs=[]
 for j in range(13):
  t=j/12;wid=.072*(1-t)+.004
  for k in range(13):
   u=k/6-1;vs.append((s*(.112+.03*t)+wid*u,-.273+.022*t+.029*(1-u*u)*math.sin(math.pi*t),.616+.155*t))
 for j in range(12):
  for k in range(12):a=j*13+k;fs.append((a,a+1,a+14,a+13))
 me=bpy.data.meshes.new('Ear');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('LX_Ear.'+suf,me);scene.collection.objects.link(o);me.materials.append(nosemat)
 for p in me.polygons:p.use_smooth=True
 mod=o.modifiers.new('Ear shell','SOLIDIFY');mod.thickness=.006
 bind(o,'Ear.'+suf);ears.append(o)
# Eyes: photo-derived iris mapped on front disk, shallow corneal cap, actual eyelid shape keys.
eyelids=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R';cx=s*.072;cy=-.409;cz=.543;r=.037
 eyeb=sphere('LX_Eyeball.'+suf,(cx,cy+.014,cz),(r,r*.76,r),black);bind(eyeb,'Eye.'+suf)
 vs=[(cx,cy-.017,cz)]+[(cx+math.cos(a)*r,cy-.006,cz+math.sin(a)*r) for a in np.linspace(0,2*math.pi,97)[:-1]]
 me=bpy.data.meshes.new('Iris');me.from_pydata(vs,[],[(0,i+1,(i+1)%96+1) for i in range(96)]);me.update();uv=me.uv_layers.new()
 for p in me.polygons:
  for li in p.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=((v.x-cx)/r/2+.5,(v.z-cz)/r/2+.5)
 o=bpy.data.objects.new('LX_Iris.'+suf,me);scene.collection.objects.link(o);me.materials.append(M('HazelIris'));bind(o,'Eye.'+suf)
 cor=sphere('LX_Cornea.'+suf,(cx,cy-.005,cz),(r*1.008,.015,r*1.008),M('ClearCornea'));bind(cor,'Eye.'+suf)
 for upper in [True,False]:
  vs=[];fs=[]
  for j in range(9):
   t=j/8
   for i in range(41):
    a=math.pi*i/40+(0 if upper else math.pi);rad=r*(1.01+.24*t)
    vs.append((cx+math.cos(a)*rad,cy-.009+.012*t,cz+math.sin(a)*rad))
  for j in range(8):
   for i in range(40):a=j*41+i;fs.append((a,a+1,a+42,a+41))
  me=bpy.data.meshes.new('Eyelid');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('LX_Lid'+('Upper' if upper else 'Lower')+'.'+suf,me);scene.collection.objects.link(o);me.materials.append(cream)
  for p in me.polygons:p.use_smooth=True
  bind(o,'Head');o.shape_key_add(name='Basis');key=o.shape_key_add(name='Blink')
  for j in range(9):
   t=j/8
   for i in range(41):
    ix=j*41+i;a=math.pi*i/40+(0 if upper else math.pi)
    key.data[ix].co.z-=math.sin(a)*r*(1-t)*1.02;key.data[ix].co.y-=.013*(1-t)
  eyelids.append(o)
# Paws: four toes, retractable claws, pink pads; miniature teeth have separate geometry.
claws=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R'
 for pre,y,x in [('Front',-.17,s*.108),('Rear',.26,s*.12)]:
  pad=sphere('LX_'+pre+'Pad.'+suf,(x,y-.022,.009),(.035,.046,.009),pink);bind(pad,pre+'Paw.'+suf)
  for i in range(4):
   toe=sphere('LX_'+pre+f'Toe{i}.'+suf,(x+(i-1.5)*.023,y-.080,.040),(.017,.030,.024),cream);bind(toe,pre+f'Toe{i}.'+suf)
   p=sphere('LX_'+pre+f'Bean{i}.'+suf,(x+(i-1.5)*.023,y-.078,.017),(.013,.016,.006),pink);bind(p,pre+f'Toe{i}.'+suf)
   c=sphere('LX_'+pre+f'Claw{i}.'+suf,(x+(i-1.5)*.023,y-.100,.035),(.004,.016,.004),toothmat);bind(c,pre+f'Toe{i}.'+suf);c.shape_key_add(name='Basis');k=c.shape_key_add(name='Extend')
   for v in k.data:v.co.y-=.015
   claws.append(c)
 for i in range(3):
  o=sphere('LX_Tooth', (s*(.017+i*.009),-.420+i*.003,.442),(.003,.004,.006),toothmat);bind(o,'Jaw')
# Tail tubular mesh, smoothly weighted over five bones.
vs=[];fs=[]
for j in range(41):
 t=j/40*5;idx=min(int(t),4);f=t-idx;c=np.array(tailpoints[idx])*(1-f)+np.array(tailpoints[idx+1])*f;rad=.038*(1-j/48)
 for i in range(20):a=i*math.tau/20;vs.append(c+np.array([math.cos(a)*rad,0,math.sin(a)*rad]))
for j in range(40):
 for i in range(20):a=j*20+i;b=j*20+(i+1)%20;fs.append((a,b,b+20,a+20))
me=bpy.data.meshes.new('Tail');me.from_pydata(vs,[],fs);me.update();tail=bpy.data.objects.new('LX_Tail',me);scene.collection.objects.link(tail);me.materials.append(coat)
for p in me.polygons:p.use_smooth=True
bind(tail,'tail')
# Short fur: skin-weighted mesh strands -> native curves AFTER armature deformation.
# Thus no Python frame handler / external addon is required to keep fur attached.
furmat=M('Strand');nt=furmat.node_tree;sh=next(n for n in nt.nodes if n.type=='BSDF_HAIR_PRINCIPLED');att=nt.nodes.new('ShaderNodeAttribute');att.attribute_name='fur_color';nt.links.new(att.outputs['Color'],sh.inputs['Color'])
def fur_color(p,reg):
 x,y,z=p.T;stripe=(np.sin(y*49+np.sin(z*32)*1.4)+1)/2
 col=np.array([.26,.205,.155])[None,:]*(1-stripe[:,None]) + np.array([.48,.39,.30])[None,:]*stripe[:,None]
 white=np.zeros(len(p))
 if reg=='Head':white=np.maximum(np.clip((.513-z)/.025,0,1),np.clip((.019+.18*(.64-z)-abs(x))/.012,0,1))*np.clip((-y-.31)/.045,0,1)
 if reg=='body':white=np.maximum(np.clip((-y-.18)/.06,0,1),np.clip((.105-z)/.04,0,1))
 return col*(1-white[:,None])+np.array([.80,.75,.66])[None,:]*white[:,None]
furs=[]
def groom(o,n,length,reg):
 me=o.data;me.calc_loop_triangles();v=np.array([v.co[:] for v in me.vertices]);norm=np.array([v.normal[:] for v in me.vertices]);tri=np.array([t.vertices[:] for t in me.loop_triangles]);corn=v[tri];area=np.linalg.norm(np.cross(corn[:,1]-corn[:,0],corn[:,2]-corn[:,0]),axis=1);ids=rng.choice(len(tri),n,p=area/area.sum());b=rng.random((n,2));b[b.sum(1)>1]=1-b[b.sum(1)>1];b=np.column_stack((1-b.sum(1),b));root=(corn[ids]*b[:,:,None]).sum(1);normal=(norm[tri[ids]]*b[:,:,None]).sum(1);normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-8)
 if reg=='Head':
  keep=np.ones(n,dtype=bool)
  for s in [-1,1]:keep &= ~((((root[:,0]-s*.072)/.043)**2+((root[:,2]-.543)/.046)**2<1)&(root[:,1]<-.375))
  keep &= ~((abs(root[:,0])<.024)&(root[:,1]<-.427)&(root[:,2]<.503))
  root=root[keep];normal=normal[keep];n=len(root)
 direction=np.tile([0,1,-.2],(n,1)) if reg in ['body','tail'] else np.column_stack((np.sign(root[:,0])*.8,np.ones(n)*.1,-np.ones(n)*.3))
 tangent=direction-(direction*normal).sum(1)[:,None]*normal;tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-8)
 t=np.linspace(0,1,4)[None,:,None];ln=length*rng.uniform(.65,1.15,(n,1,1));pts=root[:,None,:]+ln*(normal[:,None,:]*(.65*t-.25*t*t)+tangent[:,None,:]*(.65*t*t))
 edges=np.column_stack((np.arange(n*4).reshape(n,4)[:,:-1].ravel(),np.arange(n*4).reshape(n,4)[:,1:].ravel()))
 mesh=bpy.data.meshes.new('FurStrands');mesh.from_pydata(pts.reshape(-1,3),edges,[]);mesh.update();ob=bpy.data.objects.new('LX_Fur_'+o.name,mesh);scene.collection.objects.link(ob);bind(ob,reg)
 colors=np.repeat(fur_color(root,reg),4,axis=0);a=mesh.attributes.new('fur_color','FLOAT_COLOR','POINT');a.data.foreach_set('color',np.column_stack((colors,np.ones(len(colors)))).astype('f').ravel())
 radius=mesh.attributes.new('fur_radius','FLOAT','POINT');radius.data.foreach_set('value',np.tile([.00024,.00018,.00010,.000015],n).astype('f'))
 ng=bpy.data.node_groups.new('Skin strands to render curves','GeometryNodeTree');ng.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');ng.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');nodes=ng.nodes;links=ng.links;inp=nodes.new('NodeGroupInput');out=nodes.new('NodeGroupOutput');cv=nodes.new('GeometryNodeMeshToCurve');rr=nodes.new('GeometryNodeSetCurveRadius');at=nodes.new('GeometryNodeInputNamedAttribute');at.data_type='FLOAT';at.inputs['Name'].default_value='fur_radius';sm=nodes.new('GeometryNodeSetMaterial');sm.inputs['Material'].default_value=furmat;links.new(inp.outputs['Geometry'],cv.inputs['Mesh']);links.new(cv.outputs['Curve'],rr.inputs['Curve']);links.new(at.outputs['Attribute'],rr.inputs['Radius']);links.new(rr.outputs['Curve'],sm.inputs['Geometry']);links.new(sm.outputs['Geometry'],out.inputs['Geometry']);mod=ob.modifiers.new('Render native short hairs','NODES');mod.node_group=ng;ob['strand_count']=n;furs.append(ob)
for o,n,l,r in [(body,65000,.015,'body'),(head,70000,.010,'Head'),(tail,13000,.016,'tail'),(jaw,4000,.008,'Jaw')]:groom(o,n,l,r)
# Belly breathing applies identically to body surface and its bound hairs.
for o in [body,furs[0]]:
 o.shape_key_add(name='Basis');k=o.shape_key_add(name='Breath')
 for v in k.data:
  p=v.co;fac=math.exp(-((p.y-.06)/.22)**4)*max(0,min(1,(p.z-.13)/.15));p.x*=1+.022*fac;p.z+=.003*fac
# Whiskers as skinned bevelled curves converted to mesh.
for s in [-1,1]:
 suf='L' if s<0 else 'R'
 for i in range(5):
  cu=bpy.data.curves.new('Whisker','CURVE');cu.dimensions='3D';cu.bevel_depth=.00045;cu.bevel_resolution=2;sp=cu.splines.new('POLY');sp.points.add(7)
  for j,p in enumerate(sp.points):t=j/7;p.co=(s*(.045+.16*t),-.431+.028*t*t,.475+(i-2)*.008+.025*(i-2)*t,1);p.radius=1-.9*t
  o=bpy.data.objects.new('LX_Whisker',cu);scene.collection.objects.link(o);cu.materials.append(cream);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');bind(o,'Whisker.'+suf)
# Named actions with synchronized shape key actions. One timeline demonstrates all clips.
clips=[('Idle',72),('Walk',48),('Run',32),('Jump',48),('LieDown',48),('SideLie',48),('Sleep',72),('Curious',48),('Happy',48),('Yawn',60),('Lick',48),('Bite',48),('Knead',48),('Stretch',60),('PawPlay',48)]
shapeobs=eyelids+claws+[body,furs[0]];offset=1;manifest=[]
def pose(name,u):
 for p in rig.pose.bones:p.location=(0,0,0);p.rotation_euler=(0,0,0);p.scale=(1,1,1)
 for o in shapeobs:
  for k in o.data.shape_keys.key_blocks[1:]:k.value=0
 phase=u*math.tau;pb=rig.pose.bones
 pb['Head'].rotation_euler[1]=.035*math.sin(phase);pb['Ear.L'].rotation_euler[1]=.10*math.sin(phase);pb['Tail3'].rotation_euler[0]=.12*math.sin(phase)
 blink=max(0,1-abs(u-.65)/.065)
 if name in ['Walk','Run']:
  amp=.38 if name=='Walk' else .68
  for suf,ph in [('L',0),('R',math.pi)]:
   for pre,extra in [('Front',0),('Rear',math.pi if name=='Walk' else .7)]:
    a=math.sin(phase+ph+extra);pb[pre+'Upper.'+suf].rotation_euler[0]=amp*a;pb[pre+'Lower.'+suf].rotation_euler[0]=amp*.65*max(0,-a);pb[pre+'Paw.'+suf].rotation_euler[0]=-amp*.4*a
  pb['Root'].location.y=.015*abs(math.sin(phase))*(2 if name=='Run' else 1)
 if name=='Jump':
  lift=math.sin(math.pi*u)**2;pb['Root'].location.y=.32*lift;pb['Spine'].rotation_euler[0]=-.12*math.sin(phase)
  for suf in ['L','R']:
   pb['FrontUpper.'+suf].rotation_euler[0]=-.65*lift;pb['RearUpper.'+suf].rotation_euler[0]=.7*lift;pb['RearLower.'+suf].rotation_euler[0]=-.9*lift
 if name in ['LieDown','SideLie','Sleep','Stretch']:
  f=min(1,u*3) if name!='Sleep' else 1;pb['Root'].location.y=-.14*f
  for suf in ['L','R']:
   pb['FrontUpper.'+suf].rotation_euler[0]=-.65*f;pb['FrontLower.'+suf].rotation_euler[0]=1.1*f;pb['RearUpper.'+suf].rotation_euler[0]=.7*f;pb['RearLower.'+suf].rotation_euler[0]=-1.0*f
  if name=='SideLie':pb['Root'].rotation_euler[2]=1.25*f;pb['Root'].location.y=.035*f
  if name=='Sleep':blink=1;pb['Head'].rotation_euler[0]=.20
  if name=='Stretch':pb['Spine'].rotation_euler[0]=.18*math.sin(math.pi*u);pb['Head'].rotation_euler[0]=-.15
 if name=='Curious':pb['Head'].rotation_euler[1]=.23*math.sin(phase);pb['Eye.L'].rotation_euler[2]=.1*math.sin(phase);pb['Eye.R'].rotation_euler[2]=.1*math.sin(phase)
 if name=='Happy':blink=.65;pb['Jaw'].rotation_euler[0]=-.09;pb['Tail2'].rotation_euler[0]=.25*math.sin(phase)
 if name in ['Yawn','Bite','Lick']:
  fac=math.sin(math.pi*u)**2 if name=='Yawn' else (.5-.5*math.cos(phase*2))
  pb['Jaw'].rotation_euler[0]=-1*(.65 if name=='Yawn' else .25)*fac
  if name=='Yawn':blink=.85*fac
  if name=='Lick':pb['Tongue'].location.y=.035*fac;pb['Tongue'].rotation_euler[0]=-.4*fac
 if name in ['Knead','PawPlay']:
  for suf,ph in [('L',0),('R',math.pi)]:
   a=.5+.5*math.sin(phase*2+ph);pb['FrontUpper.'+suf].rotation_euler[0]=-.25*a;pb['FrontLower.'+suf].rotation_euler[0]=.35*a
   for i in range(4):pb[f'FrontToe{i}.'+suf].rotation_euler[0]=.35*a
  if name=='PawPlay':pb['FrontUpper.L'].rotation_euler[0]=-.8*(.5+.5*math.sin(phase))
 for o in eyelids:o.data.shape_keys.key_blocks['Blink'].value=blink
 for o in [body,furs[0]]:o.data.shape_keys.key_blocks['Breath'].value=.5+.5*math.sin(phase*2)
 for o in claws:o.data.shape_keys.key_blocks['Extend'].value=.7*(.5+.5*math.sin(phase*2)) if name=='Knead' else 0

for name,duration in clips:
 rig.animation_data_clear()
 for o in shapeobs:o.data.shape_keys.animation_data_clear()
 for f in range(1,duration+1,2):
  pose(name,(f-1)/(duration-1))
  for p in rig.pose.bones:
   p.keyframe_insert('location',frame=f);p.keyframe_insert('rotation_euler',frame=f)
  for o in shapeobs:
   for k in o.data.shape_keys.key_blocks[1:]:k.keyframe_insert('value',frame=f)
 # include exact end for clean loops
 pose(name,1)
 for p in rig.pose.bones:p.keyframe_insert('location',frame=duration);p.keyframe_insert('rotation_euler',frame=duration)
 actions=[]
 for data in [rig]+[o.data.shape_keys for o in shapeobs]:
  if not data.animation_data or not data.animation_data.action:continue
  act=data.animation_data.action;act.name='LX_'+name+('__'+data.name if data!=rig else '');act.use_fake_user=True;slot=data.animation_data.action_slot;data.animation_data.action=None
  track=data.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,offset,act)
  if slot:strip.action_slot=slot
  strip.action_frame_start=1;strip.action_frame_end=duration;strip.frame_end=offset+duration-1;strip.extrapolation='NOTHING';strip.blend_type='REPLACE';actions.append(act.name)
 manifest.append({'name':name,'start':offset,'end':offset+duration-1,'actions':actions});scene.timeline_markers.new(name,frame=offset);offset+=duration
# animation_data_clear above removed previous tracks: rebuild all tracks from saved actions.
for data in [rig]+[o.data.shape_keys for o in shapeobs]:
 data.animation_data_clear();data.animation_data_create()
 for clip in manifest:
  an='LX_'+clip['name']+('__'+data.name if data!=rig else '')
  act=bpy.data.actions.get(an)
  if not act:continue
  tr=data.animation_data.nla_tracks.new();tr.name=clip['name'];st=tr.strips.new(clip['name'],clip['start'],act)
  if len(act.slots):st.action_slot=act.slots[0]
  st.action_frame_start=1;st.action_frame_end=clip['end']-clip['start']+1;st.frame_end=clip['end'];st.extrapolation='NOTHING'
scene.frame_start=1;scene.frame_end=offset-1;scene.render.fps=24
# Studio suitable for checking the actual 3D result.
world=bpy.data.worlds.new('Warm studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.64,.60,.55,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35
floor=sphere('Studio ground',(0,0,-.045),(200,200,.04),mat('Ground',(.65,.61,.54),.9))
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for n,loc,power,size in [('Key',(-1,-1.2,1.8),150,1.3),('Fill',(1,-.7,1.1),60,1.2),('Rim',(0,1,1.5),120,1)]:
 d=bpy.data.lights.new(n,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(n,d);scene.collection.objects.link(o);o.location=loc;aim(o,(0,0,.35))
d=bpy.data.cameras.new('Portrait');cam=bpy.data.objects.new('Portrait',d);scene.collection.objects.link(cam);cam.location=(.9,-1.8,.91);aim(cam,(0,-.03,.37));d.type='ORTHO';d.ortho_scale=1.22;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.frame_set(1);bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
scene['quality_status']='Editable animated reconstruction; likeness requires visual review, not approved reference equivalence.'
scene['controls']='Named NLA clips and pose bones; Blink / Breath / Extend shape keys.'
for im in bpy.data.images:
 if im.source=='FILE':im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True)
(OUT/'animations.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False))
result={'file':str(OUT/'lingxi-short-fur-rig-v5.blend'),'bones':len(ad.bones),'actions':len(bpy.data.actions),'clips':len(clips),'hairs':sum(o['strand_count'] for o in furs),'frames':scene.frame_end}
(OUT/'build-report.json').write_text(json.dumps(result,indent=2))
scene.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
