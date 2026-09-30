"""Rebuild an editable short-fur character with shared skin weights and named actions.
Materials are self-contained so the rig can be rebuilt from a clean checkout.
"""
import bpy, math, json, os, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('LINGXI_OUT',ROOT/'assets/characters/lingxi/v5-texdev'));OUT.mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(512)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.name='Lingxi • Short Fur Rig v5'
def mat(name,col,rough=.5):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough;return m
def softmat(name,col,rough=.5,subsurface=0):
 m=bpy.data.materials.new('LX_ShortFur_'+name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1)
 p.inputs['Roughness'].default_value=rough;p.inputs['Subsurface Weight'].default_value=subsurface
 p.inputs['Subsurface Radius'].default_value=(.9,.48,.28);return m
cream=softmat('WhiteDownBase',(.94,.91,.86),.82,.08)
coat=softmat('CoatBase',(.46,.36,.27),.82,.07)

# EXPERIMENT COPY of build_lingxi_v5.py - see v5-texdev note below. The original script is
# left untouched; this one reads its textures from the staged AI set instead, and defaults
# its output to a parallel directory so nothing in v5/ can be disturbed.
TEXDIR=Path(os.environ.get('LINGXI_TEX',ROOT/'assets/characters/lingxi/v5-texdev/textures'))
def texmat(name,albedo,bump=None,rough=.5,sss=.08,fallback=(.6,.3,.3)):
 """Detail material sampling the generated PBR maps (scripts/blender/make_skin_textures.py).
  Falls back to a flat colour when the maps are absent, so a clean checkout without
  numpy/Pillow still builds - the rig contract promises materials are self-contained."""
 try:
  alb=bpy.data.images.load(str(TEXDIR/albedo),check_existing=True)
 except RuntimeError:
  return softmat('LX_Flat_'+name,fallback,rough,sss)
 alb.colorspace_settings.name='sRGB'
 m=bpy.data.materials.new('LX_Tex_'+name);m.use_nodes=True;nt=m.node_tree;p=nt.nodes.get('Principled BSDF')
 t=nt.nodes.new('ShaderNodeTexImage');t.image=alb;t.extension='EXTEND';t.interpolation='Cubic'
 nt.links.new(t.outputs['Color'],p.inputs['Base Color'])
 if bump and (TEXDIR/bump).exists():
  bi=bpy.data.images.load(str(TEXDIR/bump),check_existing=True);bi.colorspace_settings.name='Non-Color'
  bt=nt.nodes.new('ShaderNodeTexImage');bt.image=bi;bp=nt.nodes.new('ShaderNodeBump')
  bp.inputs['Strength'].default_value=.28
  nt.links.new(bt.outputs['Color'],bp.inputs['Height']);nt.links.new(bp.outputs['Normal'],p.inputs['Normal'])
 p.inputs['Roughness'].default_value=rough;p.inputs['Subsurface Weight'].default_value=sss
 p.inputs['Subsurface Radius'].default_value=(.9,.48,.28)
 return m
pink=texmat('Pad','pad_skin.png','pad_bump.png',rough=.5,sss=.15,fallback=(.65,.32,.30))
nosemat=texmat('Nose','nose_skin.png','nose_bump.png',rough=.35,sss=.12,fallback=(.62,.28,.25))
mouthmat=texmat('Tongue','tongue.png','tongue_bump.png',rough=.22,sss=.20,fallback=(.46,.14,.17))
earmat=texmat('Ear','ear_fur.png','ear_bump.png',rough=.72,sss=.10,fallback=(.65,.32,.30))
iris=texmat('Iris','iris_albedo.png','iris_bump.png',rough=.28,sss=.05,fallback=(.22,.26,.13))
if (TEXDIR/'iris_occlusion.png').exists() and iris.name.startswith('LX_Tex_'):
 nt=iris.node_tree;p=nt.nodes.get('Principled BSDF')
 source=p.inputs['Base Color'].links[0].from_socket
 occ=nt.nodes.new('ShaderNodeTexImage');occ.image=bpy.data.images.load(str(TEXDIR/'iris_occlusion.png'),check_existing=True)
 occ.image.colorspace_settings.name='Non-Color';occ.extension='EXTEND'
 multiply=nt.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs['Fac'].default_value=1
 nt.links.new(source,multiply.inputs[1]);nt.links.new(occ.outputs['Color'],multiply.inputs[2])
 nt.links.new(multiply.outputs['Color'],p.inputs['Base Color'])
# Eyelids are face skin, not the bright white belly down - see where they are built.
# The staged lid_skin.png carries the lash line at v=0, which is the lid fan's inner
# radius (the eye opening) - the UV in the lid builder maps v inner->outer, so it lines up.
lidmat=texmat('ThinEyeLine','lid_skin.png','lid_bump.png',rough=.72,sss=.04,fallback=(.18,.13,.105))
for node in lidmat.node_tree.nodes:
 if node.type=='TEX_IMAGE':node.extension='REPEAT'
cornea=softmat('ClearCornea',(1,1,1),.035)
cornea.node_tree.nodes.get('Principled BSDF').inputs['Transmission Weight'].default_value=1
strand=bpy.data.materials.new('LX_ShortFur_Strand');strand.use_nodes=True
strand.node_tree.nodes.clear();hout=strand.node_tree.nodes.new('ShaderNodeOutputMaterial');hairnode=strand.node_tree.nodes.new('ShaderNodeBsdfHairPrincipled')
hairnode.parametrization='COLOR';hairnode.inputs['Color'].default_value=(.45,.36,.28,1);hairnode.inputs['Roughness'].default_value=.38
strand.node_tree.links.new(hairnode.outputs[0],hout.inputs['Surface'])
dark=texmat('Mouth','mouth_dark.png',rough=.55,sss=0,fallback=(.035,.009,.014));black=mat('LX_Pupil',(.0001,.0001,.0001),.65);black.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=0;toothmat=mat('LX_IvoryTeeth',(.85,.80,.67),.3)
M=lambda n:{'HazelIris':iris,'ClearCornea':cornea,'Strand':strand}[n]

def add_micro_detail(m,scale=26.0,bump_strength=.15,rough_base=.80,rough_var=.10,ao_amount=.30):
 """Tileable micro-detail (pores, soft grain, gentle cavity shading) sampled on object
  coordinates. The v5 body/head/tail meshes have no UVs and cannot get sensible ones
  here, so the maps repeat in object space instead; that is why they must be seamless."""
 if not (TEXDIR/'micro_skin_bump.png').exists():return m
 nt=m.node_tree;p=nt.nodes.get('Principled BSDF')
 coord=nt.nodes.new('ShaderNodeTexCoord');mapping=nt.nodes.new('ShaderNodeMapping')
 mapping.inputs['Scale'].default_value=(scale,scale,scale)
 nt.links.new(coord.outputs['Object'],mapping.inputs['Vector'])
 def tile(name,non_color=True,repeat=True):
  im=bpy.data.images.load(str(TEXDIR/name),check_existing=True)
  if non_color:im.colorspace_settings.name='Non-Color'
  t=nt.nodes.new('ShaderNodeTexImage');t.image=im
  if repeat:t.extension='REPEAT'
  t.interpolation='Cubic'
  nt.links.new(mapping.outputs['Vector'],t.inputs['Vector'])
  return t
 bt=tile('micro_skin_bump.png')
 bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=bump_strength
 nt.links.new(bt.outputs['Color'],bump.inputs['Height']);nt.links.new(bump.outputs['Normal'],p.inputs['Normal'])
 rt=tile('micro_skin_rough.png')
 sub=nt.nodes.new('ShaderNodeMath');sub.operation='SUBTRACT';sub.inputs[1].default_value=.5
 nt.links.new(rt.outputs['Color'],sub.inputs[0])
 mul=nt.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=rough_var
 nt.links.new(sub.outputs[0],mul.inputs[0])
 add=nt.nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=rough_base
 nt.links.new(mul.outputs[0],add.inputs[0]);nt.links.new(add.outputs[0],p.inputs['Roughness'])
 at=tile('coat_soft_ao.png')
 mix=nt.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs['Fac'].default_value=ao_amount
 nt.links.new(at.outputs['Color'],mix.inputs[2])
 attr=[n for n in nt.nodes if n.type=='VERTEX_COLOR']
 if attr:nt.links.new(attr[0].outputs['Color'],mix.inputs[1])
 nt.links.new(mix.outputs['Color'],p.inputs['Base Color'])
 return m

def coat_material(name,region):
 # All pattern lives in the fur_color vertex attribute (the SAME map the groom samples),
 # so surface and strands can never disagree again. The material only sets shading.
 m=softmat(name,(.30,.22,.15),.84,.08);return m
bodycoat=coat_material('BodyTabby','body');headcoat=coat_material('FaceTabby','head')
for _m in (bodycoat,headcoat,coat):add_micro_detail(_m)

def sphere(name,loc,scale,material=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=loc)
 o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if material:o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 return o

def planar_uv(o,ua,va,flip_v=False):
 """Flat UVs along two axes, normalised to the mesh bounds (0=x, 1=y, 2=z).
  The nose, tongue and pad maps are painted flat - nostrils either side of centre, tongue root at
  v=0. A UV sphere wraps u around the equator with u=.25 facing -Y and u=.75 facing +Y, so on
  default UVs one nostril landed mid-nose and the other inside the head."""
 me=o.data;co=np.array([v.co[:] for v in me.vertices]);lo=co.min(0);span=np.maximum(co.max(0)-lo,1e-9)
 c=(co[[l.vertex_index for l in me.loops]]-lo)/span;v=1-c[:,va] if flip_v else c[:,va]
 me.uv_layers.active.data.foreach_set('uv',np.column_stack((c[:,ua],v)).astype('f').ravel())

def merge(objects,name,voxel=.009):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
 mod=o.modifiers.new('Continuous surface','REMESH');mod.mode='VOXEL';mod.voxel_size=voxel;bpy.ops.object.modifier_apply(modifier=mod.name)
 mod=o.modifiers.new('Surface relaxation','SMOOTH');mod.factor=1.2;mod.iterations=5;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in o.data.polygons:p.use_smooth=True
 return o
# metres, facing -Y; a neutral standing rest pose enables locomotion.
# Old chest was 380mm deep on a 710mm torso: withers 530mm, i.e. height/length .66 against
# a real cat's ~.55, which is what made it look short and barrel-like. New silhouette has a
# waist (torso narrower than chest and rump), a level back line and a slightly longer body.
parts=[sphere('Belly',(0,.045,.235),(.13,.28,.125)),sphere('NeckRuff',(0,-.205,.405),(.155,.14,.115)),sphere('Torso',(0,.075,.305),(.135,.325,.150)),sphere('Chest',(0,-.17,.315),(.145,.17,.160)),sphere('Rump',(0,.28,.312),(.145,.17,.155))]
for s in [-1,1]:
 parts += [sphere('FrontUpper',(s*.105,-.17,.25),(.062,.066,.16)),sphere('FrontLower',(s*.108,-.19,.12),(.046,.046,.095)),sphere('FrontPaw',(s*.108,-.215,.047),(.064,.088,.047)),sphere('Haunch',(s*.12,.24,.24),(.082,.105,.14)),sphere('RearHock',(s*.12,.30,.12),(.044,.06,.095)),sphere('RearPaw',(s*.12,.245,.046),(.061,.085,.045))]
body=merge(parts,'LX_Body',.007);body.data.materials.clear();body.data.materials.append(bodycoat)
head=merge([sphere('Cranium',(0,-.285,.525),(.165,.147,.156)),sphere('CheekL',(-.103,-.345,.468),(.075,.084,.068)),sphere('CheekR',(.103,-.345,.468),(.075,.084,.068)),sphere('MuzzleL',(-.034,-.405,.462),(.056,.044,.040)),sphere('MuzzleR',(.034,-.405,.462),(.056,.044,.040))],'LX_Head',.005)
head.data.materials.clear();head.data.materials.append(headcoat)
# Eye placement, shared by the Eye bones, the lens, the lids and the groom's eye window.
EYE_X=.064;EYE_Z=.523;EYE_R=.039
def cranium_front(x,z):
 """Front surface (y) of the Cranium ellipsoid above - where an eye set into it must sit."""
 q=1-(x/.165)**2-((z-.525)/.156)**2
 return -.285-.147*math.sqrt(max(q,0))
# Muzzle remains divided from lower jaw; dark recessed opening gives a real oral interior.
jaw=sphere('LX_Jaw',(0,-.378,.433),(.068,.065,.023),cream)
cavity=sphere('LX_MouthCavity',(0,-.380,.443),(.035,.023,.012),dark)
tongue=sphere('LX_Tongue',(0,-.395,.434),(.018,.022,.005),mouthmat);planar_uv(tongue,0,1,flip_v=True)  # tip at v=1
nose=sphere('LX_Nose',(0,-.443,.486),(.022,.010,.013),nosemat)
for v in nose.data.vertices:
 if v.co.z<0:v.co.x*=max(.22,1+v.co.z/.015)
planar_uv(nose,0,2)  # seen from the front
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
 bone('Ear.'+suf,(s*.102,-.238,.612),(s*.124,-.220,.730),'Head')  # matches the new ear shell
 ey=cranium_front(s*EYE_X,EYE_Z);bone('Eye.'+suf,(s*EYE_X,ey+.012,EYE_Z),(s*EYE_X,ey-.020,EYE_Z),'Head')
 bone('Whisker.'+suf,(s*.048,-.43,.477),(s*.21,-.43,.48),'Head')
tailpoints=[(0,.36,.33),(.04,.45,.36),(.09,.53,.40),(.13,.61,.45),(.14,.68,.43),(.12,.73,.42)]
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
  # quantized batching preserves normalization within 0.001, avoids millions of API calls.
  # Sort once and slice the groups out: the old `np.where` per distinct value scanned
  # the whole array every time, so cost was O(weights x vertices) instead of O(n log n).
  q=np.round(vals*1000).astype(int)
  order=np.argsort(q)
  qs=q[order]
  uniq,starts=np.unique(qs,return_index=True)
  for i,val in enumerate(uniq):
   if val<=0:continue
   end=starts[i+1] if i+1<len(starts) else len(qs)
   g.add(order[starts[i]:end].tolist(),float(val)/1000,'REPLACE')
 mod=o.modifiers.new('Shared skeletal deformation','ARMATURE');mod.object=rig;o['skin_region']=region
 return pts
bind(body,'body');bind(head,'Head')
for o,r in [(jaw,'Jaw'),(cavity,'Head'),(tongue,'Tongue'),(nose,'Nose')]:bind(o,r)
# Curved ear shells with pink inner membrane. Two things were wrong before: the shell was
# oversized (182 mm wide x 128 mm tall against a 350 mm head), and it started as a straight
# cylinder so it met the skull like a hat. Now it is smaller, and `flare` widens the base
# into a trumpet that blends into the skull instead of sitting on top of it.
ears=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R';vs=[];fs=[]
 for j in range(13):
  # Was 98mm tall but 166mm wide at the base (w/h 1.7) - a short flap sitting on the skull,
  # which is why it read as "too small". A cat ear is a TALL narrow triangle: 135mm tall,
  # 112mm across the base (w/h .83), set further back and further out on the skull.
  t=j/12;flare=1+.30*math.exp(-(t/.17)**2);wid=.040*(1-t**1.35)*flare+.009
  for k in range(13):
   u=k/6-1;vs.append((s*(.102+.024*t)+wid*u,-.238+.024*t+.020*(1-u*u)*math.sin(math.pi*t),.612+.115*t))
 for j in range(12):
  for k in range(12):a=j*13+k;fs.append((a,a+1,a+14,a+13))
 me=bpy.data.meshes.new('Ear');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('LX_Ear.'+suf,me);scene.collection.objects.link(o);me.materials.append(earmat)
 # UV: u across the width, v from base to tip - matches ear_fur.png's flow convention.
 uv=me.uv_layers.new()
 for p in me.polygons:
  for li in p.loop_indices:
   vi=me.loops[li].vertex_index
   uv.data[li].uv=((vi%13)/12,(vi//13)/12)
 for p in me.polygons:p.use_smooth=True
 mod=o.modifiers.new('Ear shell','SOLIDIFY');mod.thickness=.0075
 bind(o,'Ear.'+suf);ears.append(o)
 outer_mesh=me.copy();outer=bpy.data.objects.new('LX_EarOuter.'+suf,outer_mesh);scene.collection.objects.link(outer)
 outer_mesh.materials.clear();outer_mesh.materials.append(softmat('EarOuterTabby',(.46,.34,.27),.82,.05))
 for v in outer_mesh.vertices:v.co.y+=.012
 outer.modifiers.new('Soft ear back','SOLIDIFY').thickness=.018
 bind(outer,'Ear.'+suf)
 # Fine white furnishings fan past the inner rim; one converted object per ear stays rigged.
 cu=bpy.data.curves.new('Ear furnishings','CURVE');cu.dimensions='3D';cu.bevel_depth=.00065;cu.bevel_resolution=1
 for i in range(75):
  u=rng.uniform(-.75,.75);t=rng.uniform(.18,.73);sp=cu.splines.new('POLY');sp.points.add(3)
  for j,p in enumerate(sp.points):
   f=j/3;p.co=(s*(.102+.024*t)+u*.027+s*.016*f,-.251-.009*f,.612+.115*t+.040*f,1);p.radius=1-.85*f
 furnish=bpy.data.objects.new('LX_EarFurnish.'+suf,cu);scene.collection.objects.link(furnish);cu.materials.append(cream)
 bpy.ops.object.select_all(action='DESELECT');furnish.select_set(True);bpy.context.view_layer.objects.active=furnish
 bpy.ops.object.convert(target='MESH');bind(furnish,'Ear.'+suf)
# Eyes: photo-derived iris mapped on front disk, shallow corneal cap, actual eyelid shape keys.
eyelids=[];eye_shapes=[]
def add_eye_blink(obj,center_z):
 """Squash the eye part to 3.5% of its height, so the closing lids have nothing to clip through.

 The pivot is `center_z`. It used to be `obj.data.vertices[i].co.z` - the basis vertex's own z -
 and a new shape key starts as a copy of the basis, so that bracket was identically zero and
 every vertex landed on `center_z`. The eye did not squash, it collapsed into one horizontal
 plane wider than the socket: the white stripe across the face in every frame where Blink
 approached 1. Only Sleep ever held Blink at 1, and the pose sheet sampled every other clip
 near a sine zero crossing, so it showed up exactly once and read as a lighting artefact.
 """
 obj.shape_key_add(name='Basis');key=obj.shape_key_add(name='Blink')
 for i,v in enumerate(key.data):v.co.z=center_z+(obj.data.vertices[i].co.z-center_z)*.035
 # Squint keeps 55% of the eye's height - the lid comes down over it rather than the whole
 # eyeball collapsing, which is what a real half-closed eye does.
 sq=obj.shape_key_add(name='Squint')
 for i,v in enumerate(sq.data):v.co.z=center_z+(obj.data.vertices[i].co.z-center_z)*.55
 eye_shapes.append(obj)
# Eyes: one shallow LENS per eye, set into the face along the skull's surface normal.
# The old eye was a stack - eyeball, iris cone, pupil, catchlight, cornea - whose pupil and
# catchlight floated 2cm proud of the iris, with fur cleared from a window wider than the eye:
# from any angle but dead-on it read as goggles on a bare socket. Now the pupil and the limbal
# ring are painted in the lens material and the only separate parts are two catchlights that
# sit ON the lens surface. The pupil is round and dilated (72% of the iris): that, not a slit,
# is what the logo kitten's gaze is made of.
PUPIL=.36      # pupil radius in iris-UV units; the visible disk has radius .5
def lens_material():
 m=iris.copy();m.name='LX_EyeLens';nt=m.node_tree;p=nt.nodes.get('Principled BSDF')
 link=p.inputs['Base Color'].links
 if link:src=link[0].from_socket
 else:
  rgb=nt.nodes.new('ShaderNodeRGB');rgb.outputs[0].default_value=(.22,.26,.13,1);src=rgb.outputs[0]
 uvn=nt.nodes.new('ShaderNodeUVMap')
 dist=nt.nodes.new('ShaderNodeVectorMath');dist.operation='DISTANCE';dist.inputs[1].default_value=(.5,.5,0)
 nt.links.new(uvn.outputs['UV'],dist.inputs[0])
 def ramp(lo,hi):
  r=nt.nodes.new('ShaderNodeMapRange');r.inputs['From Min'].default_value=lo;r.inputs['From Max'].default_value=hi
  nt.links.new(dist.outputs['Value'],r.inputs['Value']);return r.outputs['Result']
 limbal=nt.nodes.new('ShaderNodeMixRGB');limbal.inputs[2].default_value=(.035,.028,.018,1)
 nt.links.new(ramp(.40,.50),limbal.inputs['Fac']);nt.links.new(src,limbal.inputs[1])
 pupil=nt.nodes.new('ShaderNodeMixRGB');pupil.inputs[1].default_value=(.004,.004,.005,1)
 nt.links.new(ramp(PUPIL-.012,PUPIL+.006),pupil.inputs['Fac']);nt.links.new(limbal.outputs['Color'],pupil.inputs[2])
 nt.links.new(pupil.outputs['Color'],p.inputs['Base Color'])
 p.inputs['Roughness'].default_value=.05;p.inputs['Subsurface Weight'].default_value=0
 try:p.inputs['Coat Weight'].default_value=1.0;p.inputs['Coat Roughness'].default_value=.02
 except KeyError:pass
 return m
lensmat=lens_material();glintmat=mat('LX_Catchlight',(1,.98,.93),.2)
tear=mat('LX_TearDuct',(.55,.32,.30),.45)
for s in [-1,1]:
 suf='L' if s<0 else 'R';cx=s*EYE_X;cz=EYE_Z;r=EYE_R;ys=cranium_front(cx,cz);cy=ys
 phi=s*math.radians(12)            # turned half-way toward the skull normal (~20 degrees)
 def W(lx,ly,lz,cx=cx,ys=ys,cz=cz,phi=phi):
  return (cx+lx*math.cos(phi)-ly*math.sin(phi),ys+lx*math.sin(phi)+ly*math.cos(phi),cz+lz)
 def Wd(dx,dy,dz,phi=phi):return (dx*math.cos(phi)-dy*math.sin(phi),dx*math.sin(phi)+dy*math.cos(phi),dz)
 # Lens: an ellipsoid .0095 deep. Its centre sits .31 of that BEHIND the face, so it meets the
 # surface at .95r and its apex stands .0066 proud - a wet dome, not a marble.
 rd=.0095;yc=.31*rd
 eye=sphere('LX_Eye.'+suf,(0,0,0),(r,rd,r),lensmat);me=eye.data
 loc=np.array([v.co[:] for v in me.vertices])
 uv=me.uv_layers.active
 for poly in me.polygons:
  for li in poly.loop_indices:
   v=loc[me.loops[li].vertex_index];uv.data[li].uv=(v[0]/r/2+.5,v[2]/r/2+.5)
 for i,v in enumerate(me.vertices):v.co=W(loc[i][0],loc[i][1]+yc,loc[i][2])
 bind(eye,'Eye.'+suf);add_eye_blink(eye,cz)
 def on_lens(lx,lz,lift=.0005):
  q=max(0,1-(lx/r)**2-(lz/r)**2);return yc-rd*math.sqrt(q)-lift
 # Catchlights: a big soft one upper-left (the key light's side) and a small one lower-right,
 # both lying on the lens. The logo's eyes are mostly these two highlights.
 for n,(lx,lz,sx,sz) in enumerate([(-.011,.012,.0060,.0068),(.012,-.011,.0022,.0024)]):
  g=sphere('LX_Catchlight%d.'%n+suf,(0,0,0),(sx,.0008,sz),glintmat);gl=np.array([v.co[:] for v in g.data.vertices])
  for i,v in enumerate(g.data.vertices):v.co=W(lx+gl[i][0],on_lens(lx,lz)+gl[i][1],lz+gl[i][2])
  bind(g,'Eye.'+suf);add_eye_blink(g,cz)
 for upper in [True,False]:
  vs=[];fs=[];blink=[];squint=[]
  for j in range(9):
   t=j/8
   for i in range(41):
    # A thin dark rim: inner edge on the lens rim (.96r), outer edge tucked into the fur.
    a=math.pi*i/40+(0 if upper else math.pi);rad=r*(.96+.16*t)
    lx,lz=math.cos(a)*rad,math.sin(a)*rad;ly=-.0012+.006*t
    vs.append(W(lx,ly,lz))
    # Blink: the rim slides across the lens and forward over its apex (.0066 proud).
    dz=-math.sin(a)*r*(1-t)*1.02;dy=-.009*(1-t)
    blink.append(Wd(0,dy,dz));squint.append(Wd(0,dy*.45,dz*.45))
  for j in range(8):
   for i in range(40):a=j*41+i;fs.append((a,a+1,a+42,a+41))
  me=bpy.data.meshes.new('Eyelid');me.from_pydata(vs,[],fs);me.update();uv=me.uv_layers.new()
  for poly in me.polygons:
   for li in poly.loop_indices:
    vi=me.loops[li].vertex_index;uv.data[li].uv=((vi%41)/40,(vi//41)/8)
  o=bpy.data.objects.new('LX_Lid'+('Upper' if upper else 'Lower')+'.'+suf,me);scene.collection.objects.link(o)
  me.materials.append(lidmat)
  for p in me.polygons:p.use_smooth=True
  lidmod=o.modifiers.new('Lid shell','SOLIDIFY');lidmod.thickness=.0015;lidmod.offset=0
  bind(o,'Head');o.shape_key_add(name='Basis')
  for kname,delta in [('Blink',blink),('Squint',squint)]:
   key=o.shape_key_add(name=kname)
   for ix,d in enumerate(delta):
    c=key.data[ix].co;key.data[ix].co=(c.x+d[0],c.y+d[1],c.z+d[2])
  eyelids.append(o)
 # Tear duct at the inner corner: the small pink caruncle every cat has. Without it the
 # eye is a perfect circle floating in fur, which is most of the "uncanny" read.
 duct=sphere('LX_TearDuct.'+suf,W(-s*r*.98,.0005,-.007),(.0060,.004,.005),tear);bind(duct,'Head')
 # Eyebrow tufts: four short pale hairs fanning up and out above the eye. A bare dome of
 # fur gives the face nothing to emote with; these are what a raised brow actually moves.
 for i in range(4):
  cu=bpy.data.curves.new('Brow','CURVE');cu.dimensions='3D';cu.bevel_depth=.00030;cu.bevel_resolution=2
  sp=cu.splines.new('POLY');sp.points.add(6);ox=(i-1.5)*.012
  for j,p in enumerate(sp.points):
   t=j/5;p.co=(cx+ox+s*.007*t,cy+.006+.010*t,cz+.028+.011*t,1);p.radius=1-.7*t
  o=bpy.data.objects.new('LX_Brow',cu);scene.collection.objects.link(o);cu.materials.append(cream)
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  bpy.ops.object.convert(target='MESH');bind(o,'Head')
# Paws: four toes, retractable claws, pink pads; miniature teeth have separate geometry.
claws=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R'
 for pre,y,x in [('Front',-.17,s*.108),('Rear',.26,s*.12)]:
  pad=sphere('LX_'+pre+'Pad.'+suf,(x,y-.022,.009),(.035,.046,.009),pink);planar_uv(pad,0,1);bind(pad,pre+'Paw.'+suf);pad.hide_render=True
  for i in range(4):
   toe=sphere('LX_'+pre+f'Toe{i}.'+suf,(x+(i-1.5)*.020,y-.065,.038),(.016,.020,.014),cream);bind(toe,pre+f'Toe{i}.'+suf)
   p=sphere('LX_'+pre+f'Bean{i}.'+suf,(x+(i-1.5)*.023,y-.078,.017),(.011,.012,.004),pink);planar_uv(p,0,1);bind(p,pre+f'Toe{i}.'+suf);p.hide_render=True
   c=sphere('LX_'+pre+f'Claw{i}.'+suf,(x+(i-1.5)*.023,y-.070,.030),(.003,.012,.003),toothmat);bind(c,pre+f'Toe{i}.'+suf);c.shape_key_add(name='Basis');k=c.shape_key_add(name='Extend')
   for v in k.data:v.co.y-=.045
   claws.append(c)
 for i in range(0):
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
def srgb_lin(c):
 """Authored palette values are display-space numbers; a FLOAT_COLOR attribute is
  read as scene-linear, so writing .47 raw made a "dark" stripe render like .75 and
  the whole coat washed out to paper white. Convert, once, on the way into Blender."""
 c=np.clip(c,0,1)
 return np.where(c<=.04045,c/12.92,np.power((c+.055)/1.055,2.4))
def fur_color(p,reg):
 # A real mackerel tabby, painted in world space (cat faces -Y, z up).
 # dark saddle stripes run HEAD-TO-TAIL along the spine (not rings around the body),
 # the forehead carries an M-mark, cheeks carry horizontal side bars, and the white
 # parts (muzzle, chin, brow dots, belly, socks) are what makes it read as gentle.
 # Palette matched to the approved reference: warm cream body, SOFT grey-brown tabby
 # (the old near-black brown read as harsh), whiter chest/belly/socks/muzzle.
 # Deeper than the turnaround-matched pass on purpose: at .42/.80 the coat measured a
 # median of 188/255 and the user read it as "太浅了". Same warm golden-tabby hue, one
 # step down in value - dark bands ~.32, base ~.70, white markings ~.88.
 dark=np.array([.29,.235,.205]);light=np.array([.70,.625,.565]);white=np.array([.96,.945,.915])
 x,y,z=p.T
 if reg=='tail':
  # ring markings, which tail tabbies genuinely have
  s=(np.sin(y*150+np.sin(x*30)*.5)+1)/2
  col=light[None,:]*(1-s[:,None])+dark[None,:]*s[:,None]
  return col
 if reg=='Head':
  # forehead M: a few wide bars over the brow plus a narrow centre line,
  # fading out on the crown instead of striping the whole top of the head
  forehead=np.clip((z-.495)/.05,0,1)*np.clip((-.305-y)/.05,0,1)*np.clip((.63-z)/.06,0,1)
  m1=(np.sin(x*220+np.sign(x)*y*58+np.sin(z*55)*.7)+1)/2
  centre=np.exp(-(x/.013)**2)*np.clip((-.315-y)/.05,0,1)
  # cheek side bars: soft horizontal bands on the flanks behind the eye line
  cheek=np.clip((.535-z)/.04,0,1)*np.clip((.50-z)/.04,0,1)*np.clip((abs(x)-.050)/.03,0,1)*np.clip((-.335-y)/.04,0,1)
  m2=(np.sin((y+.40)*170+np.sin(x*60)*.6)+1)/2
  stripe=np.clip(1.0*forehead*m1+.85*cheek*m2+.35*centre,0,1)[:,None]
  col=light[None,:]*(1-stripe)+dark[None,:]*stripe
  # white muzzle/chin (a narrow oval around the mouth, not the whole lower face),
  # plus two round brow dots (the "gentle" signature)
  blaze_width=.008+.58*np.maximum(0,.565-z)
  blaze=np.clip((blaze_width-np.abs(x))/.010,0,1)*np.clip((-.325-y)/.035,0,1)
  muzzle=np.clip((-.358-y)/.026,0,1)*np.clip((.510-z)/.025,0,1)*np.clip((.105-np.abs(x))/.025,0,1)
  wmask=np.maximum(blaze,muzzle)
  for sx in [-1,1]:
   wmask=np.maximum(wmask,np.exp(-(((np.abs(x)-sx*.045)/.013)**2+((z-.588)/.012)**2+((y+.385)/.014)**2)))
  return col*(1-wmask[:,None])+white[None,:]*wmask[:,None]
 if reg=='body':
  # spine stripes: phase across x (left-right), bending as they run down the back
  warp=1.3*np.sin(y*13+.7*z*20)
  s=(np.sin((y-.1)*39+z*46+warp)+1)/2
  up=np.clip((z-.27)/.13,0,1)          # stripes live on the back, fade low on the flanks
  stripe=(s*(.18+.82*up))[:,None]
  col=light[None,:]*(1-stripe)+dark[None,:]*stripe
  # belly white; a small chest patch; socks high up the legs like the reference
  wmask=np.maximum(np.clip((.25-z)/.06,0,1),np.clip((-.23-y)/.055,0,1))
  return col*(1-wmask[:,None])+white[None,:]*wmask[:,None]
 # jaw/fallback: soft cream
 return np.tile(white,(len(p),1))

# Keep the groom and the underlying continuous surfaces on the same authored coat map.
# Every coat material reads the fur_color attribute, so stripes line up with the strands.
for obj,region,mtl in [(body,'body',bodycoat),(head,'Head',headcoat),(tail,'tail',coat)]:
 colors=srgb_lin(fur_color(np.array([obj.data.vertices[loop.vertex_index].co[:] for loop in obj.data.loops]),region))
 attr=obj.data.attributes.new('fur_color','FLOAT_COLOR','CORNER')
 attr.data.foreach_set('color',np.column_stack((colors,np.ones(len(colors)))).astype('f').ravel())
 att=mtl.node_tree.nodes.new('ShaderNodeVertexColor');att.layer_name='fur_color'
 mtl.node_tree.links.new(att.outputs['Color'],mtl.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
furs=[]
def fur_direction(root,reg):
 """Per-strand growth direction. One global vector made the coat read as felt;
  the real thing changes across the body: down the belly and limbs, along the
  tail, radiating outward from the face."""
 x,y,z=root.T;n=len(root)
 if reg=='body':
  d=np.tile([0,1,-.22],(n,1))
  low=np.clip((.21-z)/.15,0,1)[:,None]            # belly + upper legs: gravity wins
  d=d*(1-low)+np.array([[0,.20,-1.0]])*low
  d[:,0]+=np.sign(x)*.30                          # outward on the flanks keeps it soft
 elif reg=='tail':
  d=np.tile([0,1,-.12],(n,1))
 elif reg=='Head':
  centre=np.array([0,-.47,.505])                  # radiate away from the nose
  d=root-centre;d/=np.maximum(np.linalg.norm(d,axis=1)[:,None],1e-8);d[:,1]-=.18
 else:
  d=np.tile([0,-.5,-.6],(n,1))
 return d
# guard hairs sit above a thinner, shorter undercoat and carry most of the colour;
# the undercoat lifts the silhouette and fills the visible gaps between strands.
# Radius must survive rasterisation: at the old .00042 root a strand was under half a
# pixel wide in a 900px portrait, which is why the coat vanished into the skin.
RADII={'guard':[.00078,.00056,.00030,.00006],'under':[.00045,.00032,.00018,.00004]}
def groom(o,n,length,reg,layer='guard'):
 me=o.data;me.calc_loop_triangles();v=np.array([v.co[:] for v in me.vertices]);norm=np.array([v.normal[:] for v in me.vertices]);tri=np.array([t.vertices[:] for t in me.loop_triangles]);corn=v[tri];area=np.linalg.norm(np.cross(corn[:,1]-corn[:,0],corn[:,2]-corn[:,0]),axis=1);ids=rng.choice(len(tri),n,p=area/area.sum());b=rng.random((n,2));b[b.sum(1)>1]=1-b[b.sum(1)>1];b=np.column_stack((1-b.sum(1),b));root=(corn[ids]*b[:,:,None]).sum(1);normal=(norm[tri[ids]]*b[:,:,None]).sum(1);normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-8)
 if reg=='Head':
  keep=np.ones(n,dtype=bool)
  for s in [-1,1]:keep &= ~((((root[:,0]-s*EYE_X)/(EYE_R*.97))**2+((root[:,2]-EYE_Z)/(EYE_R*.97))**2<1)&(root[:,1]<-.395))
  keep &= ~((abs(root[:,0])<.024)&(root[:,1]<-.427)&(root[:,2]<.503))
  root=root[keep];normal=normal[keep];n=len(root)
 direction=fur_direction(root,reg)
 tangent=direction-(direction*normal).sum(1)[:,None]*normal;tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-8)
 scale=.55 if layer=='under' else 1.0
 t=np.linspace(0,1,4)[None,:,None];ln=length*scale*rng.uniform(.6,1.35,(n,1,1))
 if reg=='Head':
  # Around the eye the coat is short, rising to full length 1.9 eye-radii out: a hair rooted at
  # the inner corner points across the lens, and at full length it veils half the eye.
  ed=np.min([np.hypot(root[:,0]-s*EYE_X,root[:,2]-EYE_Z) for s in (-1,1)],axis=0)/EYE_R
  ln*=np.where(root[:,1]<-.37,np.clip(.18+.82*(ed-1)/.9,.18,1),1)[:,None,None]
  ruff=1+1.6*np.clip((np.abs(root[:,0])-.085)/.065,0,1)*np.clip((.54-root[:,2])/.075,0,1)
  bib=1+1.4*np.clip((.50-root[:,2])/.08,0,1)
  ln*=np.maximum(ruff,bib)[:,None,None]
 elif reg=='tail':ln*=2.1
 elif reg=='body':
  bib=1+1.6*np.clip((-.10-root[:,1])/.14,0,1)*np.clip((.42-root[:,2])/.17,0,1)
  ln*=bib[:,None,None]
 # Fluff physics: the strand hugs the skin at the root, lifts away through the middle,
 # and the tip drifts along the coat direction - then two wave frequencies (a slow
 # bend plus a faster kink) give the micro-curl a long-haired kitten actually has.
 lift=(.78*t-.34*t*t);drift=(.50*t*t)
 wave=normal[:,None,:]*(.0024*rng.uniform(.5,1.5,(n,1,1))*(np.sin(t*4.2+rng.random((n,1,1))*6.28)+.55*np.sin(t*9.0+rng.random((n,1,1))*6.28)))
 pts=root[:,None,:]+ln*(normal[:,None,:]*lift+tangent[:,None,:]*drift)+wave
 edges=np.column_stack((np.arange(n*4).reshape(n,4)[:,:-1].ravel(),np.arange(n*4).reshape(n,4)[:,1:].ravel()))
 mesh=bpy.data.meshes.new('FurStrands')
 # Raw geometry API instead of from_pydata: from_pydata materialises one Python
 # tuple per strand point (millions of them at hero counts), which is what drove
 # the build-only memory spikes. Array-in, no per-point Python objects.
 mesh.vertices.add(n*4);mesh.vertices.foreach_set('co',pts.astype('f').ravel())
 mesh.edges.add(edges.shape[0]);mesh.edges.foreach_set('vertices',edges.astype(np.int32).ravel())
 mesh.update();ob=bpy.data.objects.new('LX_Fur_'+layer+'_'+o.name,mesh);scene.collection.objects.link(ob);bind(ob,reg)
 # The strand mesh is only a deformation source for the render curves. It carries no
 # material of its own, so in Cycles it came out as default-white fluff and buried both
 # the striped skin and the coloured curves. Never let it render directly.
 ob.hide_render=True
 del pts,edges
 colors=np.repeat(srgb_lin(fur_color(root,reg)),4,axis=0)
 # per-strand variation, plus a few pale hairs; a single flat colour reads as plastic fur.
 # jit must stay (n,1): repeating it must yield one scalar per POINT, because a
 # second trailing axis broadcasts (4n,3) against (4n,1,1) into a 4n x 4n x 3 monster
 # and OOM-kills the build.
 jit=1+rng.normal(0,.05,(n,1))+((rng.random((n,1))<.025)*.22)
 # Darker at the root, catching light at the tip: without this the four points of a
 # strand are one flat colour and the coat reads as tinted skin rather than fur.
 # One scalar per point, so the per-strand 4 points stay aligned with (4n,3).
 taper=np.tile([.84,.94,1.08,1.26],n)[:,None]
 colors=np.clip(colors*np.repeat(jit,4,axis=0)*taper*(1.06 if layer=='under' else 1.0),0,1)
 a=mesh.attributes.new('fur_color','FLOAT_COLOR','POINT');a.data.foreach_set('color',np.column_stack((colors,np.ones(len(colors)))).astype('f').ravel())
 radius=mesh.attributes.new('fur_radius','FLOAT','POINT');radius.data.foreach_set('value',np.tile(RADII[layer],n).astype('f'))
 ng=bpy.data.node_groups.new('Skin strands to render curves','GeometryNodeTree');ng.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');ng.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');nodes=ng.nodes;links=ng.links;inp=nodes.new('NodeGroupInput');out=nodes.new('NodeGroupOutput');cv=nodes.new('GeometryNodeMeshToCurve');rr=nodes.new('GeometryNodeSetCurveRadius');at=nodes.new('GeometryNodeInputNamedAttribute');at.data_type='FLOAT';at.inputs['Name'].default_value='fur_radius';sm=nodes.new('GeometryNodeSetMaterial');sm.inputs['Material'].default_value=furmat;links.new(inp.outputs['Geometry'],cv.inputs['Mesh']);links.new(cv.outputs['Curve'],rr.inputs['Curve']);links.new(at.outputs['Attribute'],rr.inputs['Radius']);links.new(rr.outputs['Curve'],sm.inputs['Geometry']);links.new(sm.outputs['Geometry'],out.inputs['Geometry']);mod=ob.modifiers.new('Render native short hairs','NODES');mod.node_group=ng;ob['strand_count']=n;furs.append(ob)
# Strand budget. Every downstream cost - skin weights, the native-curve conversion,
# the Cycles hair BVH and each pose's re-evaluation - scales with this number, so it
# is a dial and not a constant. `hero` doubles the coat and roughly doubles all of
# those costs; leave it opt-in.
#   LINGXI_QUALITY=preview   quick iteration, ~1/8 the strands and a tiny render
#   LINGXI_QUALITY=standard  the default; what review renders have been built with
#   LINGXI_QUALITY=hero      adds a second undercoat layer
QUALITY=(dict(os.environ).get('LINGXI_QUALITY') or 'standard').lower()
SCALE={'preview':.25,'standard':1.0,'hero':1.0}.get(QUALITY,1.0)
# Lengths were sized as literal "short fur" (13 mm on a ~700 mm cat) and rendered as
# barely 3% of pixels - the coat was technically there and visually absent. Longer
# and thicker reads as fur at portrait scale; tip taper below does the rest.
# Lengths matched to the long-haired reference: the coat must VISIBLY cover the whole
# body with a fluffy silhouette, not tint the skin. Face stays shorter so the features
# survive; belly/tail carry the longest hair, like a real long-haired kitten.
GUARD=[(body,80000,.052,'body'),(head,90000,.029,'Head'),(tail,15000,.070,'tail'),(jaw,4000,.011,'Jaw')]
for o,n,l,r in GUARD:groom(o,max(1,int(n*SCALE)),l,r,'guard')
# A shorter, denser, slightly lighter undercoat is what makes the silhouette read as
# fluffy instead of spiky - the reference kitten has one, so it is ON by default now.
# `hero` multiplies it further; memory stays safe since the broadcast bug is gone.
if QUALITY in ('standard','hero'):
 f=(1.4 if QUALITY=='hero' else 1.0)
 for o,n,l,r in [(body,50000,.035,'body'),(head,48000,.018,'Head'),(tail,9000,.045,'tail'),(jaw,2500,.008,'Jaw')]:
  groom(o,max(1,int(n*f)),l,r,'under')
scene['fur_quality']=QUALITY
# Belly breathing applies identically to body surface and ALL its bound hairs. With only the
# guard layer keyed, the expanding flank swallowed the 7mm undercoat on every inhale.
breathers=[body]+[o for o in furs if o['skin_region']=='body']
for o in breathers:
 o.shape_key_add(name='Basis');k=o.shape_key_add(name='Breath')
 for v in k.data:
  p=v.co;fac=math.exp(-((p.y-.06)/.22)**4)*max(0,min(1,(p.z-.13)/.15));p.x*=1+.022*fac;p.z+=.003*fac
# Whiskers as skinned bevelled curves converted to mesh.
for s in [-1,1]:
 suf='L' if s<0 else 'R'
 for i in range(5):
  cu=bpy.data.curves.new('Whisker','CURVE');cu.dimensions='3D';cu.bevel_depth=.00045;cu.bevel_resolution=2;sp=cu.splines.new('POLY');sp.points.add(7)
  for j,p in enumerate(sp.points):t=j/7;p.co=(s*(.048+.09*t),-.431+.016*t*t,.475+(i-2)*.008+.014*(i-2)*t,1);p.radius=1-.9*t
  o=bpy.data.objects.new('LX_Whisker',cu);scene.collection.objects.link(o);cu.materials.append(cream);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');bind(o,'Whisker.'+suf)
# Resting omega, recessed under the short muzzle fur.
for side in [-1,1]:
 cu=bpy.data.curves.new('Resting smile','CURVE');cu.dimensions='3D';cu.bevel_depth=.00075;cu.bevel_resolution=2
 sp=cu.splines.new('POLY');sp.points.add(11)
 for j,point in enumerate(sp.points):
  u=j/11;point.co=(side*.019*u,-.451+.006*u,.453-.008*math.sin(math.pi*u),1)
 smile=bpy.data.objects.new('LX_Smile.'+('L' if side<0 else 'R'),cu);scene.collection.objects.link(smile);cu.materials.append(dark)
 bpy.ops.object.select_all(action='DESELECT');smile.select_set(True);bpy.context.view_layer.objects.active=smile
 bpy.ops.object.convert(target='MESH');bind(smile,'Head')
# --- Head proportion -----------------------------------------------------------------
# The authored head is 316mm long against a 710mm torso (45%) and 350mm WIDE against a
# 320mm torso - wider than the body, which is why it reads as "头太大了" / bobblehead.
# A real cat sits at 25-30% (a kitten is allowed a little more, so this lands at ~33%).
#
# Everything above stays authored in its original space; the whole head assembly -
# meshes, shape keys, its bones, the whiskers and the fur groomed on it - is scaled
# about the neck joint here, at the end. Doing it last is what keeps the world-space
# pattern masks in fur_color() and the groom's eye-exclusion windows valid: the painted
# colours and the strand roots were both authored against the un-scaled head, and they
# move with their vertices.
HEAD_S=1.15;HEAD_SCALE=np.array([HEAD_S,HEAD_S,1.04]);HEAD_PIVOT=np.array([0,-.16,.48])
def head_xf(p):return tuple(HEAD_PIVOT+HEAD_SCALE*(np.asarray(p,dtype='f')-HEAD_PIVOT))
def head_xf_obj(o):
 for v in o.data.vertices:v.co=head_xf(v.co)
 sk=o.data.shape_keys
 if sk:
  for kb in sk.key_blocks:
   for d in kb.data:d.co=head_xf(d.co)
 for m in o.modifiers:
  if m.type=='SOLIDIFY':m.thickness*=HEAD_S      # the ear/lid shells must thin with the head
HEAD_TAGS=('LX_Head','LX_Jaw','LX_MouthCavity','LX_Tongue','LX_Nose','LX_Ear.','LX_Eyeball.',
           'LX_EarFurnish.','LX_EarOuter.','LX_Eye.','LX_Catchlight','LX_Lid','LX_TearDuct.',
           'LX_Brow','LX_Whisker','LX_Smile.')
for o in scene.objects:
 if o.type=='MESH' and (o.name.startswith(HEAD_TAGS) or '_LX_Head' in o.name or '_LX_Jaw' in o.name):
  head_xf_obj(o)
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
for bn in ['Head','Jaw','Tongue','Nose','Ear.L','Ear.R','Eye.L','Eye.R','Whisker.L','Whisker.R']:
 eb=ad.edit_bones.get(bn)
 if eb:eb.head=head_xf(eb.head);eb.tail=head_xf(eb.tail)
bpy.ops.object.mode_set(mode='OBJECT')
# Named actions with synchronized shape key actions. One timeline demonstrates all clips.
clips=[('Idle',72),('Walk',48),('Run',32),('Jump',48),('LieDown',48),('SideLie',48),('Sleep',72),('Curious',48),('Happy',48),('Yawn',60),('Lick',48),('Bite',48),('Knead',48),('Stretch',60),('PawPlay',48)]
eyelids=[o for o in eyelids if o.data.shape_keys];eye_shapes=[o for o in eye_shapes if o.data.shape_keys];claws=[o for o in claws if o.data.shape_keys];breathers=[o for o in breathers if o.data.shape_keys]
shapeobs=eyelids+eye_shapes+claws+breathers;offset=1;manifest=[]
def pose(name,u):
 for p in rig.pose.bones:p.location=(0,0,0);p.rotation_euler=(0,0,0);p.scale=(1,1,1)
 for o in shapeobs:
  for k in o.data.shape_keys.key_blocks[1:]:k.value=0
 phase=u*math.tau;pb=rig.pose.bones
 # Idle is the baseline every other clip is measured against, so it stays small on purpose.
 pb['Head'].rotation_euler[1]=.035*math.sin(phase);pb['Ear.L'].rotation_euler[1]=.10*math.sin(phase);pb['Tail3'].rotation_euler[0]=.12*math.sin(phase)
 blink=max(0,1-abs(u-.65)/.065);squint=0
 if name in ['Walk','Run']:
  amp=.38 if name=='Walk' else .68
  for suf,ph in [('L',0),('R',math.pi)]:
   for pre,extra in [('Front',0),('Rear',math.pi if name=='Walk' else .7)]:
    a=math.sin(phase+ph+extra);pb[pre+'Upper.'+suf].rotation_euler[0]=amp*a;pb[pre+'Lower.'+suf].rotation_euler[0]=amp*.65*max(0,-a);pb[pre+'Paw.'+suf].rotation_euler[0]=-amp*.4*a
  # PoseBone.location is in the root bone's local basis. Its local Y axis is world Z here.
  pb['Root'].location.y=.015*abs(math.sin(phase))*(2 if name=='Run' else 1)
 if name=='Jump':
  lift=math.sin(math.pi*u)**2;pb['Root'].location.y=.32*lift;pb['Spine'].rotation_euler[0]=-.12*math.sin(phase)
  for suf in ['L','R']:
   pb['FrontUpper.'+suf].rotation_euler[0]=-.65*lift;pb['RearUpper.'+suf].rotation_euler[0]=.7*lift;pb['RearLower.'+suf].rotation_euler[0]=-.9*lift
 if name in ['LieDown','SideLie','Sleep','Stretch']:
  # The body has to come DOWN with the legs. Folding them 117 degrees while dropping the root
  # 11cm left the silhouette 0.721 tall against Idle's 0.755 - a 4cm difference on a 75cm cat,
  # which is why "lying down" looked like "standing with odd legs".
  f=min(1,u*3) if name!='Sleep' else 1;pb['Root'].location.y=-.11*f
  pb['Spine'].rotation_euler[0]=.10*f
  for suf in ['L','R']:
   pb['FrontUpper.'+suf].rotation_euler[0]=-1.05*f;pb['FrontLower.'+suf].rotation_euler[0]=2.05*f;pb['RearUpper.'+suf].rotation_euler[0]=.95*f;pb['RearLower.'+suf].rotation_euler[0]=-2.05*f
  if name=='SideLie':pb['Root'].rotation_euler[2]=1.25*f;pb['Root'].location.y=-.025*f
  if name=='Sleep':
   # A real sleep pose lies on the flank, with a relaxed head and closed lids.
   pb['Root'].rotation_euler[2]=1.15;pb['Root'].location.y=-.025
   blink=1;pb['Head'].rotation_euler[0]=.20
  if name=='Stretch':pb['Spine'].rotation_euler[0]=.18*math.sin(math.pi*u);pb['Head'].rotation_euler[0]=-.15
 if name=='Curious':
  # Leaning in, head cocked, weight forward. The old version rotated the head 13 degrees at its
  # peak and moved nothing else, which is inside the noise of the idle wobble.
  lean=.5-.5*math.cos(phase)
  pb['Head'].rotation_euler[1]=.52*math.sin(phase);pb['Head'].rotation_euler[0]=-.28*lean
  pb['Neck'].rotation_euler[0]=-.20*lean
  pb['Spine'].rotation_euler[0]=-.16*lean
  pb['Root'].location.y=-.030*lean
  for suf in ['L','R']:
   pb['Ear.'+suf].rotation_euler[0]=-.34*lean
   pb['FrontUpper.'+suf].rotation_euler[0]=.22*lean;pb['RearUpper.'+suf].rotation_euler[0]=-.26*lean
  pb['Eye.L'].rotation_euler[2]=.1*math.sin(phase);pb['Eye.R'].rotation_euler[2]=.1*math.sin(phase)
  pb['Tail2'].rotation_euler[0]=.30*math.sin(phase*1.5)
 if name=='Happy':
  # Tail up, chest lifted, ears forward, a small bounce. Was a 5-degree jaw and a 4-degree tail
  # swish around an otherwise untouched standing pose.
  bounce=.5-.5*math.cos(phase*2)
  # A happy cat slow-blinks and half-closes its eyes; a fully open stare reads as alarmed.
  blink=.30+.20*bounce;squint=.55+.30*bounce;pb['Jaw'].rotation_euler[0]=-.20
  pb['Root'].location.y=.022*bounce
  pb['Spine'].rotation_euler[0]=-.14*bounce;pb['Head'].rotation_euler[0]=-.22*bounce
  for suf in ['L','R']:pb['Ear.'+suf].rotation_euler[0]=-.26
  pb['Tail1'].rotation_euler[0]=-.85;pb['Tail2'].rotation_euler[0]=-.35+.42*math.sin(phase*2)
  pb['Tail3'].rotation_euler[0]=.30*math.sin(phase*2+1)
 if name in ['Yawn','Bite','Lick']:
  fac=math.sin(math.pi*u)**2 if name=='Yawn' else (.5-.5*math.cos(phase*2))
  pb['Jaw'].rotation_euler[0]=-1*(.65 if name=='Yawn' else .25)*fac
  if name=='Yawn':blink=.85*fac
  if name=='Lick':pb['Tongue'].location.y=.035*fac;pb['Tongue'].rotation_euler[0]=-.4*fac
  if name=='Bite':
   # Airplane ears. The ears are the clearest mood signal a cat has, and Bite previously
   # played with exactly the same face as Lick - only the jaw differed.
   for suf in ['L','R']:
    sgn=-1 if suf=='L' else 1
    pb['Ear.'+suf].rotation_euler[0]=-.90*fac;pb['Ear.'+suf].rotation_euler[2]=sgn*.35*fac
   squint=.25*fac
 if name in ['Knead','PawPlay']:
  for suf,ph in [('L',0),('R',math.pi)]:
   a=.5+.5*math.sin(phase*2+ph);pb['FrontUpper.'+suf].rotation_euler[0]=-.25*a;pb['FrontLower.'+suf].rotation_euler[0]=.35*a
   for i in range(4):pb[f'FrontToe{i}.'+suf].rotation_euler[0]=.35*a
  if name=='PawPlay':pb['FrontUpper.L'].rotation_euler[0]=-.8*(.5+.5*math.sin(phase))
  # Kneading is the blissed-out clip; without the squint it was just paws moving.
  if name=='Knead':squint=.45+.30*math.sin(phase)
 # Squint and Blink are additive off the same basis, so a full blink must cancel the squint
 # or the lid overshoots through the eye.
 squint=squint*(1-blink)
 for o in eyelids:o.data.shape_keys.key_blocks['Blink'].value=blink
 for o in eye_shapes:o.data.shape_keys.key_blocks['Blink'].value=blink
 for o in eyelids:o.data.shape_keys.key_blocks['Squint'].value=squint
 for o in eye_shapes:o.data.shape_keys.key_blocks['Squint'].value=squint
 for o in breathers:o.data.shape_keys.key_blocks['Breath'].value=.5+.5*math.sin(phase*2)
 for o in claws:o.data.shape_keys.key_blocks['Extend'].value=.7*(.5+.5*math.sin(phase*2)) if name=='Knead' else 0

for name,duration in clips:
 rig.animation_data_clear()
 for o in shapeobs:
  if o.data.shape_keys:o.data.shape_keys.animation_data_clear()
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
# Gentle-healing look: warm wraparound light, a soft cream ground, and a long lens with
# shallow depth of field so the floor falls away and the kitten sits in its own soft pool
# of light. An orthographic camera cannot do DOF, which is why this is a portrait lens.
world=bpy.data.worlds.new('Warm studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.70,.60,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55
floor=sphere('Studio ground',(0,0,-.045),(200,200,.04),mat('Ground',(.96,.87,.77),.95))
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
# Fill/Bounce were 40/22W: they lifted the dark tabby bands until the coat measured a
# contrast of 56/255 against the reference turnaround's 74 - the pattern was there but
# read as flat cream. 30/15 keeps the soft wrap and puts contrast back at ~72.
for n,loc,power,size,col in [('Key',(-1,-1.2,1.7),72,1.6,(1.0,.93,.83)),('Fill',(1.2,-.6,1.0),30,1.4,(.90,.94,1.0)),('Rim',(0,1.3,1.4),58,1.2,(1.0,.86,.76)),('Bounce',(0,-1.6,.35),15,1.8,(1.0,.95,.88))]:
 d=bpy.data.lights.new(n,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=col;o=bpy.data.objects.new(n,d);scene.collection.objects.link(o);o.location=loc;aim(o,(0,0,.35))
target=(0,-.03,.42)
d=bpy.data.cameras.new('Portrait');cam=bpy.data.objects.new('Portrait',d);scene.collection.objects.link(cam)
cam.location=(.62,-1.35,.62);aim(cam,target)
d.type='PERSP';d.lens=105;d.sensor_width=36
d.dof.use_dof=True;d.dof.focus_distance=(Vector(cam.location)-Vector(target)).length
d.dof.aperture_fstop=5.6 if QUALITY!='preview' else 8.0
scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=(12 if QUALITY=='preview' else 72);scene.cycles.use_denoising=True;SIDE=(480 if QUALITY=='preview' else 1200);scene.render.resolution_x=SIDE;scene.render.resolution_y=SIDE;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.frame_set(1);bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
scene['quality_status']='Editable animated reconstruction; likeness requires visual review, not approved reference equivalence.'
scene['controls']='Named NLA clips and pose bones; Blink / Breath / Extend shape keys.'
for im in bpy.data.images:
 if im.source=='FILE':im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True)
(OUT/'animations.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False))
import resource
PEAK_GB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024**3 if sys.platform=='darwin' else 1024**2),2)
result={'file':str(OUT/'lingxi-short-fur-rig-v5.blend'),'bones':len(ad.bones),'actions':len(bpy.data.actions),'clips':len(clips),'hairs':sum(o['strand_count'] for o in furs),'frames':scene.frame_end,'quality':QUALITY,'peak_rss_gb':PEAK_GB}
(OUT/'build-report.json').write_text(json.dumps(result,indent=2))
scene.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
