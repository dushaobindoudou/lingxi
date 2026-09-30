"""Rebuild an editable short-fur character with shared skin weights and named actions.
Materials are self-contained so the rig can be rebuilt from a clean checkout.
"""
import bpy, math, json, os, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('LINGXI_OUT',ROOT/'assets/characters/lingxi/v5'));OUT.mkdir(parents=True,exist_ok=True)
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

TEXDIR=ROOT/'assets/characters/lingxi/v5/textures'
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
if earmat.name.startswith('LX_Tex_'):                      # tint the pale painted ear to the references' pink
 _nt=earmat.node_tree;_p=_nt.nodes.get('Principled BSDF');_src=_p.inputs['Base Color'].links[0].from_socket
 _mx=_nt.nodes.new('ShaderNodeMixRGB');_mx.blend_type='MULTIPLY';_mx.inputs['Fac'].default_value=1;_mx.inputs[2].default_value=(1.0,.62,.64,1)
 _nt.links.new(_src,_mx.inputs[1]);_nt.links.new(_mx.outputs['Color'],_p.inputs['Base Color'])
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
lidmat=softmat('ThinEyeLine',(.18,.13,.105),.72,.04)
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
head=merge([sphere('Cranium',(0,-.285,.518),(.165,.147,.142)),sphere('CheekL',(-.095,-.340,.466),(.070,.082,.064)),sphere('CheekR',(.095,-.340,.466),(.070,.082,.064)),sphere('MuzzleL',(-.031,-.408,.472),(.052,.047,.032)),sphere('MuzzleR',(.031,-.408,.472),(.052,.047,.032))],'LX_Head',.005)
head.data.materials.clear();head.data.materials.append(headcoat)
# --- Head sculpt ---------------------------------------------------------------------------------
# The skull was a union of ellipsoids: every feature a kitten's face has in relief - brow over
# the eye, the dip of the stop between the eyes, the round whisker pads, the full lower cheeks, a
# small chin - was missing, so fur lay on a ball. These brushes push the skin along its normal
# (metres; + is outward), sized from the face close-up reference.
SCULPT=[((0,-.418,.528),.022,-.0045),                                  # stop: the dip between the eyes
        ((0,-.395,.575),.030,+.0030),                                  # forehead dome above it
        ((-.060,-.395,.570),.020,+.0035),((.060,-.395,.570),.020,+.0035),   # brow over each eye
        ((-.026,-.448,.463),.018,+.0050),((.026,-.448,.463),.018,+.0050),   # whisker pads
        ((-.105,-.355,.455),.040,+.0070),((.105,-.355,.455),.040,+.0070),   # full lower cheeks
        ((0,-.430,.428),.020,+.0030),                                  # chin
        ((0,-.26,.66),.080,-.0060)]                                    # a lower, flatter crown
def sculpt(o):
 me=o.data;me.update();bpy.context.view_layer.update();mw=o.matrix_world.copy()   # merged mesh: local != world
 for v in me.vertices:
  d=0.0;p=mw@v.co
  for c,rad,amt in SCULPT:d+=amt*math.exp(-((p.x-c[0])**2+(p.y-c[1])**2+(p.z-c[2])**2)/rad**2)
  if d:v.co=v.co+v.normal*d      # displace the LOCAL coordinate; p (world) only locates the brush
 me.update()
sculpt(head)
# Eye placement, shared by the Eye bones, the lens, the lids and the groom's eye window.
# Eyelids are spherical shells around a centre far behind the eye, rotated shut by their own bones
# (see "Face rig" below). LID_APEX is how far the lid stands in front of the cornea's plane.
LID_APEX=.0048   # .0040 left the lower lid's corner (with its 2mm shell) coincident with the cornea
EYE_X=.064;EYE_Z=.523;EYE_R=.038   # .039 read bug-eyed on the bare skull; .034 read small inside the fuller coat
LID_YC=(EYE_R**2-LID_APEX**2)/(2*LID_APEX);LID_R=LID_YC+LID_APEX   # sphere through the eye's rim, LID_APEX proud at its centre
LIP0=.4575      # lip-line centre: 16mm under the nose leather (24mm read as a long, sad philtrum)
MOUTH_W=.024   # half-width of the mouth: about the nose's width, as in the references (was .046, .036)
GAPE_W=.036    # half-width of the actual cut: closed at rest (so the drawn omega stays small), but a
               # yawn opens the corners back to here - a cat's gape runs well past its visible lips
def lip_z(x):
 """Height of the upper-lip line at x: the two arcs of the omega meeting under the philtrum,
  rising at the corners. The mouth opens along this line."""
 u=np.minimum(np.abs(x)/MOUTH_W,1)
 return LIP0+.0035*np.sin(np.pi*np.minimum(u/.78,1))+.006*np.maximum(0,u-.78)/.22
def jaw_share(x,y,z,below):
 """How much of a head point the jaw carries: the lip, whisker-pad bottoms and chin in front,
  fading out toward the throat and the mouth corners so the skin there stretches, not tears."""
 # The chin only: the whisker pads belong to the UPPER jaw. Giving their lower halves to the jaw bone
 # (width .056) tore the skin between them vertically on every open mouth - white bars beside the nose.
 wmax=GAPE_W+.8*np.clip(LIP0-.004-z,0,.05)            # the lower lip out to the gape corners, the full chin lower down
 return below*np.clip((-.345-y)/.045,0,1)*np.clip((wmax-np.abs(x))/.016,0,1)   # soft edge: stretches, never tears
def eye_frame(s,lx,ly,lz):
 """Eye-local (x across, y into the head, z up) to world, for the eye on side s."""
 cx=s*EYE_X;ys=cranium_front(cx,EYE_Z);phi=s*math.radians(12)
 return (cx+lx*math.cos(phi)-ly*math.sin(phi),ys+lx*math.sin(phi)+ly*math.cos(phi),EYE_Z+lz)
def cranium_front(x,z):
 """Front surface (y) of the Cranium ellipsoid above - where an eye set into it must sit."""
 q=1-(x/.165)**2-((z-.518)/.142)**2
 return -.285-.147*math.sqrt(max(q,0))
# Eye sockets. The eyes turn 12 degrees outward, so their nasal edge sits behind the skull's
# surface and the skin painted over half the iris (a D-shaped pupil). Cut the skin away where
# an eye is; nothing can then cover it, and the coat around the hole frames it.
import bmesh
# (Until bind() applies transforms the mesh is in the object's local space - test in world.)
bpy.context.view_layer.update();hw=head.matrix_world.copy()
bm=bmesh.new();bm.from_mesh(head.data)
def _in_socket(p):return p.y<-.39 and min(((p.x-s*EYE_X)/EYE_R)**2+((p.z-EYE_Z)/EYE_R)**2 for s in (-1,1))<1.0
bmesh.ops.delete(bm,geom=[v for v in bm.verts if _in_socket(hw@v.co)],context='VERTS')
# Mouth: split the skin along the lip line (no gap at rest, it only separates). Faces below the
# line then belong to the jaw (see jaw_share / HEAD_JAW below), so opening the jaw swings the
# lower lip, chin and their coat down and shows the mouth behind - it no longer opens INSIDE a
# fixed muzzle, which is why it used to show nothing.
def _below(f):c=hw@f.calc_center_median();return c.z<float(lip_z(c.x))
cut=[e for e in bm.edges if len(e.link_faces)==2 and all((hw@f.calc_center_median()).y<-.405 and abs((hw@f.calc_center_median()).x)<GAPE_W for f in e.link_faces) and _below(e.link_faces[0])!=_below(e.link_faces[1])]
bmesh.ops.split_edges(bm,edges=cut)
bm.verts.ensure_lookup_table();bm.verts.index_update()
HEAD_BELOW=np.array([1.0 if v.link_faces and all(_below(f) for f in v.link_faces) else 0.0 for v in bm.verts])
# The voxel remesh leaves a saw-toothed hole. Press the skin around it back into a shallow
# socket (7mm at the rim, easing out by 1.35 eye-radii) so the lid rim sits in front of those
# teeth and the coat closes over them - which is also the shape a real eye socket has.
for v in bm.verts:
 p=hw@v.co
 if p.y<-.37:
  ed=min(math.hypot(p.x-s*EYE_X,p.z-EYE_Z) for s in (-1,1))/EYE_R
  if ed<1.35:v.co.y+=.004*(1-(max(ed,1)-1)/.35)**2
bm.to_mesh(head.data);bm.free()
# Muzzle remains divided from lower jaw; dark recessed opening gives a real oral interior.
# --- Mouth ------------------------------------------------------------------------------------
# The head's muzzle used to run down over the chin, so opening the jaw revealed nothing and the
# "mouth" was a black omega drawn on the fur. The skin below the upper lip is now cut away (see
# the socket/mouth carve above); the jaw below is the chin, and between them sits a real mouth.
# The jaw is the lower half of the muzzle: two whisker-pad lobes and a chin, the same volume the
# carve took off the head, so a closed mouth is a closed mouth (a single sphere left a slot).
jaw=merge([sphere('JawL',(-.029,-.402,.446),(.047,.045,.026)),sphere('JawR',(.029,-.402,.446),(.047,.045,.026)),
           sphere('Chin',(0,-.386,.431),(.054,.056,.022))],'LX_Jaw',.004)
jaw.data.materials.clear();jaw.data.materials.append(dark);jaw.hide_render=True   # chin skin is the head's now
# The mouth bag: big enough to fill the whole gap when the jaw drops (otherwise the gap shows the
# white inside of the head shell), and 15mm+ behind the skin everywhere so it never shows shut.
mouthpink=mat('LX_MouthPink',(.30,.07,.08),.5)   # rosy, like the yawn reference - near-black read as a hole
cavity=sphere('LX_MouthCavity',(0,-.392,.455),(.034,.032,.016),mouthpink)
floor=sphere('LX_MouthFloor',(0,-.394,.447),(.026,.028,.006),mouthpink)          # floor, on the jaw
# Tongue: a flat blade with a centre groove, root at y=-.380, tip at -.431. Its "Out" key is the
# lick: it slides forward 32mm, dips, and the last third curls up into a spoon - how a cat
# actually laps and how it scoops a paw.
tongue=sphere('LX_Tongue',(0,0,0),(.0135,.0255,.0042),mouthmat)
for v in tongue.data.vertices:v.co=(v.co.x,v.co.y-.3975,v.co.z+.444)
for v in tongue.data.vertices:
 if v.co.z>.444:v.co.z-=.0014*math.exp(-(v.co.x/.0045)**2)                 # centre groove
planar_uv(tongue,0,1,flip_v=True)  # tip at v=1
tongue.shape_key_add(name='Basis');tk=tongue.shape_key_add(name='Out')
for v,k in zip(tongue.data.vertices,tk.data):
 t=min(1,max(0,(-.372-v.co.y)/.051))
 k.co=(v.co.x*(1+.30*t),v.co.y-.058*t,v.co.z-.012*t*t+.016*max(0,t-.62)**2/.1444)
# Canines: two up, two down, only seen when the mouth opens.
teeth=[]
for s in [-1,1]:
 for up,(x,y,z,region) in [(True,(s*.015,-.436,.458,'HeadRigid')),(False,(s*.012,-.434,.452,'Jaw'))]:
  tt=sphere('LX_Tooth',(0,0,0),(.0021,.0021,.0055 if up else .0042),toothmat)
  for v in tt.data.vertices:v.co=(v.co.x+x,v.co.y+y,v.co.z+z)
  for v in tt.data.vertices:                                                # taper to a point
   f=(z-v.co.z)/.0055 if up else (v.co.z-z)/.0042
   if f>0:v.co.x=x+(v.co.x-x)*(1-.8*min(f,1));v.co.y=y+(v.co.y-y)*(1-.8*min(f,1))
  teeth.append((tt,region))
# Nose: a rounded inverted-triangle leather with a flat front, comma nostrils on the lower
# sides and a groove down its centre - it was a squashed sphere, which read as rubber.
nose=sphere('LX_Nose',(0,0,0),(1,1,1),nosemat);NC=(0,-.447,.487);NW,ND,NH=.0215,.0105,.0135
shade=[]
for v in nose.data.vertices:
 nx,ny,nz=v.co.x,v.co.y,v.co.z
 taper=.34+.66*((nz+1)/2)**.75                                             # wide top, narrow tip
 fy=-(abs(ny)**.45) if ny<0 else ny                                         # flat front plate
 y=fy*ND+.004*max(nz,0)**2                                                  # top eases into the bridge
 g=max(math.exp(-(((nx*taper)-sx*.36)/.16)**2-((nz+.10)/.20)**2) for sx in (-1,1))*(ny<-.2)
 y+=.0038*g+.0010*math.exp(-(nx/.07)**2)*(nz<0)*(ny<0)                     # nostril pits, centre groove
 shade.append(1-.82*g)
 v.co=(NC[0]+nx*NW*taper,NC[1]+y,NC[2]+nz*NH)
planar_uv(nose,0,2)  # seen from the front
na=nose.data.attributes.new('nose_shade','FLOAT_COLOR','CORNER')
na.data.foreach_set('color',np.array([[shade[l.vertex_index]]*3+[1] for l in nose.data.loops],dtype='f').ravel())
if nosemat.name.startswith('LX_'):
 nt=nosemat.node_tree;pp=nt.nodes.get('Principled BSDF');src=pp.inputs['Base Color'].links[0].from_socket if pp.inputs['Base Color'].links else None
 att=nt.nodes.new('ShaderNodeAttribute');att.attribute_name='nose_shade';mul=nt.nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs['Fac'].default_value=1
 if src:nt.links.new(src,mul.inputs[1])
 else:mul.inputs[1].default_value=pp.inputs['Base Color'].default_value
 nt.links.new(att.outputs['Color'],mul.inputs[2]);nt.links.new(mul.outputs['Color'],pp.inputs['Base Color'])
# Lips: a thin dark line - the philtrum from the nose down, the two upper-lip arcs out to the
# corners (the real omega), and a short lower lip on the jaw. Mostly hidden in the muzzle fur.
# Pink-mauve like the nose leather (the logo's mouth), not a black line.
lipmat=mat('LX_Lip',(.42,.16,.17),.42)
def lip_curve(name,pts,region):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=.0010;cu.bevel_resolution=2
 sp=cu.splines.new('POLY');sp.points.add(len(pts)-1)
 for pt,c in zip(sp.points,pts):pt.co=(c[0],c[1],c[2],1)
 o=bpy.data.objects.new(name,cu);scene.collection.objects.link(o);cu.materials.append(lipmat)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
 bpy.ops.object.convert(target='MESH');return (o,region)
lips=[lip_curve('LX_LipPhiltrum',[(0,-.4525,.4735),(0,-.4525,.466),(0,-.4515,LIP0)],'HeadRigid')]
for side in (-1,1):
 pts=[]
 for j in range(14):
  u=j/13;x=side*MOUTH_W*u
  z=float(lip_z(x))
  pts.append((x,-.4515+.020*u*u,z))
 lips.append(lip_curve('LX_LipUpper.'+('L' if side<0 else 'R'),pts,'HeadRigid'))
lips.append(lip_curve('LX_LipLower',[(x,-.4500+.010*(x/.016)**2,float(lip_z(x))-.0016) for x in np.linspace(-.016,.016,9)],'Jaw'))
# Skeleton: common bind space shared by body, separate face parts, and fur vertices.
ad=bpy.data.armatures.new('LingxiSkeleton');rig=bpy.data.objects.new('LX_Rig',ad);scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(n,a,b,parent=None):
 x=ad.edit_bones.new(n);x.head=a;x.tail=b
 if parent:x.parent=ad.edit_bones[parent]
 return x
# Jaw hinge at the TMJ, under the ear's front: hinged inside the muzzle it jutted the chin forward instead of dropping it.
bone('Root',(0,0,0),(0,0,.1));bone('Pelvis',(0,.24,.30),(0,.08,.33),'Root');bone('Spine',(0,.08,.33),(0,-.16,.36),'Pelvis');bone('Neck',(0,-.16,.36),(0,-.27,.48),'Spine');bone('Head',(0,-.27,.48),(0,-.38,.53),'Neck');bone('Jaw',(0,-.312,.470),(0,-.42,.436),'Head');bone('Tongue',(0,-.39,.438),(0,-.448,.438),'Jaw');bone('Nose',(0,-.43,.48),(0,-.45,.49),'Head')
segments=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R'
 # Legs, rebuilt on a cat's actual skeleton (2026-09-28). Before, the hind leg had no knee: its
 # "upper" bone ran from the hip straight BACK-down to the hock, so the leg bent the wrong way and
 # every walk looked like a toy's. And the foreleg hung off the spine with no shoulder blade, so a
 # raised paw could only swing from a fixed socket - dragging the chest skin into a flap.
 #   fore: Scap (shoulder blade, slides on the ribs) > humerus (back-down) > radius (down-forward) > paw
 #   hind: femur (FORWARD-down to the knee) > tibia (back-down to the hock) > metatarsus > toes
 for front in (True,False):
  pre='Front' if front else 'Rear';x=s*(.108 if front else .12);y=-.17 if front else .24
  if front:
   bone('Scap.'+suf,(s*.078,-.105,.425),(x,-.185,.300),'Spine')
   chain=[(x,-.185,.300),(x,-.145,.175),(x,-.190,.065),(x,-.250,.035)];par='Scap.'+suf
  else:
   chain=[(x,.225,.305),(x,.172,.195),(x,.300,.115),(x,.205,.036)];par='Pelvis'
  bone(pre+'Upper.'+suf,chain[0],chain[1],par);bone(pre+'Lower.'+suf,chain[1],chain[2],pre+'Upper.'+suf);bone(pre+'Paw.'+suf,chain[2],chain[3],pre+'Lower.'+suf)
  for i in range(4):bone(pre+f'Toe{i}.'+suf,(x+(i-1.5)*.023,y-.06,.04),(x+(i-1.5)*.023,y-.10,.033),pre+'Paw.'+suf)
 bone('Ear.'+suf,(s*.100,-.250,.604),(s*.166,-.240,.760),'Head')  # matches the new ear shell
 ey=cranium_front(s*EYE_X,EYE_Z);bone('Eye.'+suf,(s*EYE_X,ey+.012,EYE_Z),(s*EYE_X,ey-.020,EYE_Z),'Head')
 # --- Face rig: eyelid bones ---------------------------------------------------------------------
 # A lid is a patch of a sphere concentric with its bone's head, so rotating the bone slides the
 # lid over the eye while it stays on that sphere - always in front of the cornea, never stretched.
 # The shape-key blink it replaces moved every vertex in a straight line: the lid stretched, dipped
 # behind the eyeball and bulged out as a goggle when shut.
 for nm,Rr in (('LidUpper.'+suf,LID_R+.0008),('LidLower.'+suf,LID_R)):
  bone(nm,eye_frame(s,0,LID_YC,0),eye_frame(s,0,LID_YC-.03,0),'Head')
 bone('Whisker.'+suf,(s*.048,-.43,.477),(s*.21,-.43,.48),'Head')
tailpoints=[(0,.36,.33),(.02,.44,.29),(.03,.51,.24),(.04,.57,.20),(.05,.63,.17),(.05,.69,.16)]
for i in range(5):bone('Tail'+str(i),tailpoints[i],tailpoints[i+1],'Pelvis' if i==0 else 'Tail'+str(i-1))
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for p in rig.pose.bones:p.rotation_mode='XYZ'

# Weight algorithm: piecewise smooth anatomical regions, normalized per vertex.
def _bseg(name):
 b=ad.bones[name];return np.array(b.head_local[:]),np.array(b.tail_local[:])
def _segd(p,a,b):
 ab=b-a;t=np.clip(((p-a)@ab)/(ab@ab),0,1);return np.linalg.norm(p-(a+t[:,None]*ab),axis=1)
def weights(points,region):
 n=len(points);w={}
 def add(k,v):w[k]=np.asarray(v if np.ndim(v) else np.full(n,v),dtype=float)
 if region.startswith('Lid:'):
  # Lid bone weight: full on the lid's inner half, fading to the head at its outer edge, and less
  # toward the corners (canthi), which a real lid does not move.
  _,ul,sf=region.split(':');sg=-1 if sf=='L' else 1;phi=sg*math.radians(12)
  cx=sg*EYE_X;ys=cranium_front(cx,EYE_Z);x,y,z=points.T
  lx=(x-cx)*math.cos(phi)+(y-ys)*math.sin(phi);lz=z-EYE_Z
  rho=np.hypot(lx,lz)/EYE_R;base,span=(.93,.37) if ul=='U' else (.97,.33)
  t=np.clip((rho-base)/span,0,1);sa=np.abs(lz)/np.maximum(np.hypot(lx,lz),1e-9)
  wl=np.clip(1.6*(1-t),0,1)*(.25+.75*sa**.6)
  add(('LidUpper.' if ul=='U' else 'LidLower.')+sf,wl);add('Head',1-wl);return w
 if region=='HeadRigid':           # upper-lip parts: never split between head and jaw
  add('Head',1);return w
 if region=='Head':
  x,y,z=points.T;j=jaw_share(x,y,z,(z<lip_z(x)-.0005).astype(float))
  add('Head',1-j)
  if (j>0).any():add('Jaw',j)
  return w
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
   # Inside the leg, each point follows the bones it is nearest to (by distance to the bone
   # SEGMENT, softly blended) - a height band cannot follow a knee that points forward.
   names=[pre+'Upper.'+suf,pre+'Lower.'+suf,pre+'Paw.'+suf]
   g=np.array([np.exp(-(_segd(points,*_bseg(nm))/.030)**2) for nm in names])+1e-9;g/=g.sum(0)
   for nm,gi in zip(names,g):add(nm,mask*gi)
  # Shoulder blade: the flank over the shoulder, above the leg.
  sc=np.clip((s*x-.02)/.05,0,1)*np.exp(-(_segd(points,*_bseg('Scap.'+suf))/.050)**2)
  for k in list(w):w[k]*=(1-sc)
  add('Scap.'+suf,sc)
 total=sum(w.values());return {k:v/total for k,v in w.items()}

def bind(o,region,wpts=None):
 bpy.context.view_layer.update()
 # apply all transforms so meshes and fur use common world-space skin coordinates
 mw=o.matrix_world.copy()
 for v in o.data.vertices:v.co=mw@v.co
 o.matrix_world.identity()
 pts=np.array([v.co[:] for v in o.data.vertices]);w=weights(pts if wpts is None else wpts,region)
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
# The split duplicates the lip-line vertices at one position, so weights by position cannot tell
# the two lips apart; weight the head by which side of the mouth each vertex's faces are on.
_hp=np.array([v.co[:] for v in head.data.vertices]);_hj=jaw_share(_hp[:,0],_hp[:,1],_hp[:,2],HEAD_BELOW)
_gh=head.vertex_groups['Head'];_gj=head.vertex_groups.get('Jaw') or head.vertex_groups.new(name='Jaw')
for i,j in enumerate(_hj):
 _gh.add([i],1-float(j),'REPLACE')
 if j>0:_gj.add([i],float(j),'REPLACE')
 else:_gj.remove([i])
for o,r in [(jaw,'Jaw'),(cavity,'HeadRigid'),(floor,'Jaw'),(tongue,'Tongue'),(nose,'Nose')]+teeth+lips:bind(o,r)
# Lip lines lie ON the skin (they floated as dark wings in front of the muzzle): move each lip
# vertex to just in front of the nearest skin point, matched in the front (x,z) projection.
_sk=np.array([v.co[:] for v in head.data.vertices]);_sk=_sk[_sk[:,1]<-.40]
for o,_ in lips:
 for v in o.data.vertices:
  d=(_sk[:,0]-v.co.x)**2+(_sk[:,2]-v.co.z)**2;k=np.argsort(d)[:4]
  v.co.y=float(_sk[k,1].min())-.0007+(v.co.y-float(np.mean([vv.co.y for vv in o.data.vertices])))*0
# Curved ear shells with pink inner membrane. Two things were wrong before: the shell was
# oversized (182 mm wide x 128 mm tall against a 350 mm head), and it started as a straight
# cylinder so it met the skull like a hat. Now it is smaller, and `flare` widens the base
# into a trumpet that blends into the skull instead of sitting on top of it.
ears=[];ear_outers=[]
for s in [-1,1]:
 suf='L' if s<0 else 'R';vs=[];fs=[]
 for j in range(13):
  # Was 98mm tall but 166mm wide at the base (w/h 1.7) - a short flap sitting on the skull,
  # which is why it read as "too small". A cat ear is a TALL narrow triangle: 135mm tall,
  # 112mm across the base (w/h .83), set further back and further out on the skull.
  t=j/12;flare=1+.30*math.exp(-(t/.17)**2);wid=.054*(1-t**1.35)*flare+.011*(1-t)**.7
  for k in range(13):
   u=k/6-1;vs.append((s*(.100+.066*t)+wid*u,-.250+.010*t+.024*(1-u*u)*math.sin(math.pi*t),.604+.156*t))
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
 # ONE solid ear. It used to be two shells 12mm apart - an inner pink one and a tabby back -
 # which from any side angle read as two slices of card with a gap. Now a single shell: the
 # front keeps the pink inner-ear material, and Solidify gives the back and the rim slot 1.
 me.materials.append(softmat('EarOuterTabby',(.46,.36,.29),.82,.05))
 ny=np.mean([pl.normal.y for pl in me.polygons])
 mod=o.modifiers.new('Ear shell','SOLIDIFY');mod.thickness=.0065
 mod.offset=-1 if ny<0 else 1          # always grow toward the back of the head (+y)
 mod.material_offset=1;mod.material_offset_rim=1
 bind(o,'Ear.'+suf);ears.append(o)
 # The groom needs the BACK surface to root on; the shell's back only exists after the
 # modifier, so a hidden copy sits exactly there and carries the ear's short tabby coat.
 back_mesh=me.copy();back=bpy.data.objects.new('LX_EarOuter.'+suf,back_mesh);scene.collection.objects.link(back)
 for v in back_mesh.vertices:v.co.y+=.0065
 # Blender 5 keeps vertex-group names on the mesh, so the copy arrives with the shell's
 # 'Ear.X' group already; binding again would add an orphan 'Ear.X.001'.
 back.vertex_groups.clear();back.hide_render=True;bind(back,'Ear.'+suf);ear_outers.append((back,'Ear.'+suf))
 # Furnishings: white hairs rooted ON the inner ear surface in its lower half, flaring out
 # and up past the outer rim, the way a long-haired kitten's ear tufts spill out sideways.
 cu=bpy.data.curves.new('Ear furnishings','CURVE');cu.dimensions='3D';cu.bevel_depth=.00042;cu.bevel_resolution=1
 for i in range(140):
  u=rng.uniform(-.55,.85);t=rng.uniform(.03,.50);fl=rng.uniform(.024,.046);sp=cu.splines.new('POLY');sp.points.add(3)
  wid=.054*(1-t**1.35)*(1+.30*math.exp(-(t/.17)**2))+.011*(1-t)**.7
  rx=s*(.100+.066*t)+wid*u;ry=-.250+.010*t+.024*(1-u*u)*math.sin(math.pi*t)-.002;rz=.604+.156*t
  for j,p in enumerate(sp.points):
   f=j/3;p.co=(rx+s*fl*.75*f,ry-fl*.25*f,rz+fl*(.45*f+.20*f*f),1);p.radius=1-.85*f
 furnish=bpy.data.objects.new('LX_EarFurnish.'+suf,cu);scene.collection.objects.link(furnish);cu.materials.append(cream)
 bpy.ops.object.select_all(action='DESELECT');furnish.select_set(True);bpy.context.view_layer.objects.active=furnish
 bpy.ops.object.convert(target='MESH');bind(furnish,'Ear.'+suf)
# Eyes: photo-derived iris mapped on front disk, shallow corneal cap, actual eyelid shape keys.
eyelids=[];eye_shapes=[]
def add_eye_blink(obj,center_z):
 """Blink / Squint keys for an eye part - identical to its basis.

 The eye used to be squashed to 3.5% (Blink) and 55% (Squint) of its height so the lids had
 nothing to clip through, which is exactly what read as "the eye gets compressed when the cat
 closes it". A real lid slides over an unchanging eyeball; the lids now do that (see the lid
 keys), so the eye keeps its shape. The keys stay so every clip can still drive them by name.
 """
 obj.shape_key_add(name='Basis');obj.shape_key_add(name='Blink');obj.shape_key_add(name='Squint')
 eye_shapes.append(obj)
# Eyes: one shallow LENS per eye, set into the face along the skull's surface normal.
# The old eye was a stack - eyeball, iris cone, pupil, catchlight, cornea - whose pupil and
# catchlight floated 2cm proud of the iris, with fur cleared from a window wider than the eye:
# from any angle but dead-on it read as goggles on a bare socket. Now the pupil and the limbal
# ring are painted in the lens material and the only separate parts are two catchlights that
# sit ON the lens surface. The pupil is round and dilated (72% of the iris): that, not a slit,
# is what the logo kitten's gaze is made of.
PUPIL=.33      # pupil radius in iris-UV units (the iris disk has radius .5): 56% - the reference
               # face's pupil. 64% with the limbal ring read as an all-black bug eye; 52% as startled.
               # small enough that the iris fibres show - at 72% the eye read as a black button
def iris_material():
 """Matte iris under the cornea. The pupil and the dark limbal ring are painted here so the
  pupil is always round and centred whatever the texture's own pupil size is."""
 m=iris.copy();m.name='LX_IrisLayer';nt=m.node_tree;p=nt.nodes.get('Principled BSDF')
 link=p.inputs['Base Color'].links
 if link:src=link[0].from_socket
 else:
  rgb=nt.nodes.new('ShaderNodeRGB');rgb.outputs[0].default_value=(.20,.19,.08,1);src=rgb.outputs[0]
 uvn=nt.nodes.new('ShaderNodeUVMap')
 dist=nt.nodes.new('ShaderNodeVectorMath');dist.operation='DISTANCE';dist.inputs[1].default_value=(.5,.5,0)
 nt.links.new(uvn.outputs['UV'],dist.inputs[0])
 def ramp(lo,hi):
  r=nt.nodes.new('ShaderNodeMapRange');r.inputs['From Min'].default_value=lo;r.inputs['From Max'].default_value=hi
  nt.links.new(dist.outputs['Value'],r.inputs['Value']);return r.outputs['Result']
 limbal=nt.nodes.new('ShaderNodeMixRGB');limbal.inputs[2].default_value=(.10,.085,.04,1)   # a soft olive rim, not a black outline
 nt.links.new(ramp(.48,.50),limbal.inputs['Fac']);nt.links.new(src,limbal.inputs[1])
 pupil=nt.nodes.new('ShaderNodeMixRGB');pupil.inputs[1].default_value=(.003,.003,.004,1)
 nt.links.new(ramp(PUPIL-.010,PUPIL+.008),pupil.inputs['Fac']);nt.links.new(limbal.outputs['Color'],pupil.inputs[2])
 nt.links.new(pupil.outputs['Color'],p.inputs['Base Color'])
 p.inputs['Roughness'].default_value=.45;p.inputs['Subsurface Weight'].default_value=0;p.inputs['Specular IOR Level'].default_value=.15
 # No bump under a cornea: it speckled the pupil, and the two eyes caught the light differently.
 for l in list(p.inputs['Normal'].links):nt.links.remove(l)
 return m
irismat=iris_material()
# Cornea: a clear bulging dome that REFLECTS the studio lights with the cornea's Fresnel
# (IOR 1.376) but does not refract. Those reflections are where believable catchlights come
# from - the white stickers they replace read as cartoon. Real refraction was tried: the dome's
# back half sits inside the skull, so it bent the view onto skin and cut the pupil into a D.
corneamat=bpy.data.materials.new('LX_Cornea');corneamat.use_nodes=True;cn=corneamat.node_tree.nodes;cl=corneamat.node_tree.links
for n in list(cn):cn.remove(n)
co_out=cn.new('ShaderNodeOutputMaterial');co_mix=cn.new('ShaderNodeMixShader');co_fr=cn.new('ShaderNodeFresnel');co_fr.inputs['IOR'].default_value=1.45  # a touch above the physical 1.376: visible glint, pupil still black
co_tr=cn.new('ShaderNodeBsdfTransparent');co_gl=cn.new('ShaderNodeBsdfGlossy');co_gl.inputs['Roughness'].default_value=.02
# Half-strength mirror: the lamps are far brighter than the grey studio, so their glints survive
# while the grey veil the studio cast over the pupil halves.
co_gl.inputs['Color'].default_value=(.34,.34,.34,1)
cl.new(co_fr.outputs[0],co_mix.inputs[0]);cl.new(co_tr.outputs[0],co_mix.inputs[1]);cl.new(co_gl.outputs[0],co_mix.inputs[2]);cl.new(co_mix.outputs[0],co_out.inputs['Surface'])
# Eyelid skin: coloured per vertex after the coat is known (see "lid colour" below) - a thin
# dark rim against the eye, the surrounding coat beyond it. As a flat beige it was the pale
# goggle ring around each eye, and a beige plate sliding down whenever the cat squinted.
lidskin=bpy.data.materials.new('LX_LidSkin');lidskin.use_nodes=True
lp=lidskin.node_tree.nodes.get('Principled BSDF');la=lidskin.node_tree.nodes.new('ShaderNodeAttribute');la.attribute_name='lid_color'
lidskin.node_tree.links.new(la.outputs['Color'],lp.inputs['Base Color']);lp.inputs['Roughness'].default_value=.85;lp.inputs['Specular IOR Level'].default_value=.12
tear=mat('LX_TearDuct',(.55,.32,.30),.45)
for s in [-1,1]:
 suf='L' if s<0 else 'R';cx=s*EYE_X;cz=EYE_Z;r=EYE_R;ys=cranium_front(cx,cz);cy=ys
 phi=s*math.radians(12)            # turned half-way toward the skull normal (~20 degrees)
 def W(lx,ly,lz,cx=cx,ys=ys,cz=cz,phi=phi):
  return (cx+lx*math.cos(phi)-ly*math.sin(phi),ys+lx*math.sin(phi)+ly*math.cos(phi),cz+lz)
 def Wd(dx,dy,dz,phi=phi):return (dx*math.cos(phi)-dy*math.sin(phi),dx*math.sin(phi)+dy*math.cos(phi),dz)
 def dome(name,rx,depth,back,material):
  """An ellipsoid of radius rx, `depth` deep, its centre `back` behind the face: it meets the
   face near rx and its apex stands (depth-back) proud. UVs are the front projection."""
  o=sphere(name,(0,0,0),(rx,depth,rx),material);me=o.data;loc=np.array([v.co[:] for v in me.vertices]);uv=me.uv_layers.active
  for poly in me.polygons:
   for li in poly.loop_indices:
    v=loc[me.loops[li].vertex_index];uv.data[li].uv=(v[0]/r/2+.5,v[2]/r/2+.5)
  for i,v in enumerate(me.vertices):v.co=W(loc[i][0],loc[i][1]+back,loc[i][2])
  bind(o,'Eye.'+suf);add_eye_blink(o,cz);return o
 dome('LX_Eye.'+suf,r,.0045,.0040,irismat)          # iris: flush with the face
 dome('LX_Cornea.'+suf,r*1.01,.0065,.0040,corneamat) # cornea: apex 2.5mm proud
 for upper in [True,False]:
  vs=[];fs=[];blink=[];squint=[]
  for j in range(9):
   t=j/8
   for i in range(41):
    # The upper lid rests a touch over the top of the iris (.93r) - a fully exposed ring of
    # iris is the startled look - and both run out to 1.30r, under the fur.
    a=math.pi*i/40+(0 if upper else math.pi);rad=r*((.93 if upper else .97)+(.37 if upper else .33)*t)
    lx,lz=math.cos(a)*rad,math.sin(a)*rad;Rl=LID_R+.0008 if upper else LID_R   # the upper lid in front where they meet
    ly=LID_YC-math.sqrt(Rl*Rl-lx*lx-lz*lz)          # on the lid sphere; beyond the eye it recedes under the coat
    vs.append(W(lx,ly,lz))
  for j in range(8):
   for i in range(40):a=j*41+i;fs.append((a,a+1,a+42,a+41))
  me=bpy.data.meshes.new('Eyelid');me.from_pydata(vs,[],fs);me.update();uv=me.uv_layers.new()
  for poly in me.polygons:
   for li in poly.loop_indices:
    vi=me.loops[li].vertex_index;uv.data[li].uv=((vi%41)/40,(vi//41)/8)
  o=bpy.data.objects.new('LX_Lid'+('Upper' if upper else 'Lower')+'.'+suf,me);scene.collection.objects.link(o)
  me.materials.append(lidskin)
  for p in me.polygons:p.use_smooth=True
  lidmod=o.modifiers.new('Lid shell','SOLIDIFY');lidmod.thickness=.0020;lidmod.offset=0
  bind(o,'Lid:%s:%s'%('U' if upper else 'L',suf))
  # Blink / Squint keys stay (identity) so every consumer can still find them by name; the lid
  # bones do the closing now.
  o.shape_key_add(name='Basis');o.shape_key_add(name='Blink');o.shape_key_add(name='Squint')
  eyelids.append(o)
 # Tear duct at the inner corner: the small pink caruncle every cat has. Without it the
 # eye is a perfect circle floating in fur, which is most of the "uncanny" read.
 duct=sphere('LX_TearDuct.'+suf,W(-s*r*.98,.0005,-.007),(.0060,.004,.005),tear);bind(duct,'Head');duct.hide_render=True
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
  pad=sphere('LX_'+pre+'Pad.'+suf,(x,y-.026,.010),(.022,.026,.007),pink);planar_uv(pad,0,1);bind(pad,pre+'Paw.'+suf)   # a kitten-sized main pad
  for i in range(4):
   toe=sphere('LX_'+pre+f'Toe{i}.'+suf,(x+(i-1.5)*.020,y-.065,.038),(.016,.020,.014),cream);bind(toe,pre+f'Toe{i}.'+suf)
   p=sphere('LX_'+pre+f'Bean{i}.'+suf,(x+(i-1.5)*.020,y-.068,.026),(.009,.010,.0035),pink);planar_uv(p,0,1);bind(p,pre+f'Toe{i}.'+suf)   # flush with the toe sole: seen when the paw is raised
   c=sphere('LX_'+pre+f'Claw{i}.'+suf,(x+(i-1.5)*.023,y-.070,.030),(.003,.012,.003),toothmat);bind(c,pre+f'Toe{i}.'+suf);c.shape_key_add(name='Basis');k=c.shape_key_add(name='Extend')
   for v in k.data:v.co.y-=.045
   claws.append(c)
# Tail tubular mesh, smoothly weighted over five bones.
vs=[];fs=[]
for j in range(41):
 t=j/40*5;idx=min(int(t),4);f=t-idx;c=np.array(tailpoints[idx])*(1-f)+np.array(tailpoints[idx+1])*f;rad=.042*(1-j/70)
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
# --- Painted coat -------------------------------------------------------------------------
# The logo's markings are soft irregular patches - a white inverted-V blaze, an M on the brow,
# mackerel bands that break up down the flanks. Sine stripes could only ever make barcodes.
# So the coat is painted (v5-imagegen-sources/coat_*.png, cleaned into textures/ by
# make_coat_maps.py) as four orthographic projections of THIS model in authored space, and
# sampled back through the same frames here. Frames mirror make_coat_templates.FRAMES.
COAT_FRAMES={'coat_head_front':(0,(-.21,.21),2,(.76,.34)),'coat_head_top':(0,(-.21,.21),1,(-.04,-.46)),
             'coat_body_top':(0,(-.44,.44),1,(.48,-.40)),'coat_body_side':(1,(-.40,.48),2,(.72,-.16))}
def load_coat():
 maps={}
 for n in COAT_FRAMES:
  f=TEXDIR/(n+'.png')
  if not f.exists():return None          # all four or none: half a painted coat is worse than none
  im=bpy.data.images.load(str(f),check_existing=True);im.colorspace_settings.name='sRGB'
  w,h=im.size;a=np.empty(w*h*4,dtype='f');im.pixels.foreach_get(a)
  # Blender stores rows bottom-up; byte images come back as the stored (display) values.
  maps[n]=a.reshape(h,w,4)[::-1,:,:3].copy();bpy.data.images.remove(im)
 return maps
COAT=load_coat()
def coat_sample(name,p):
 img=COAT[name];N=img.shape[0];ha,(h0,h1),va,(v0,v1)=COAT_FRAMES[name]
 u=np.clip((p[:,ha]-h0)/(h1-h0)*N-.5,0,N-1.001);v=np.clip((p[:,va]-v0)/(v1-v0)*N-.5,0,N-1.001)
 iu=u.astype(int);iv=v.astype(int);fu=(u-iu)[:,None];fv=(v-iv)[:,None]
 return (img[iv,iu]*(1-fu)*(1-fv)+img[iv,iu+1]*fu*(1-fv)+img[iv+1,iu]*(1-fu)*fv+img[iv+1,iu+1]*fu*fv)
def painted_coat(p,reg):
 """Blend the projections by which way the surface faces. The meshes are unions of
  ellipsoids, so the direction from the part's centre, scaled by its radii, is a good
  enough normal for choosing a projection - and it is also defined for strand roots."""
 if reg=='Head':
  n=(p-np.array([0,-.285,.525]))/np.array([.165,.147,.156])
  n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-8)
  wf=np.clip(-n[:,1],0,1)**2+.35*n[:,0]**2          # face, and the cheeks seen from the front
  wt=np.clip(n[:,2],0,1)**2+np.clip(n[:,1],0,1)**2   # crown and the back of the head
  a=coat_sample('coat_head_front',p);b=coat_sample('coat_head_top',p)
 else:
  n=np.column_stack((p[:,0]/.15,np.zeros(len(p)),(p[:,2]-.30)/.16))
  n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-8)
  wf=n[:,0]**2+np.clip(-n[:,2],0,1)**2               # flanks and belly: the side view
  # the back: the top view. Above the shoulder line it always wins - the side view's white
  # neck ruff otherwise wraps up over the withers, and the reference is tabby there.
  wt=np.clip(n[:,2],0,1)**2+2.5*np.clip((p[:,2]-.40)/.07,0,1)*np.clip((p[:,1]+.30)/.08,0,1)
  a=coat_sample('coat_body_side',p);b=coat_sample('coat_body_top',p)
 # Sharp hand-over: two paintings of the same stripe never line up exactly, so a wide 50/50
 # zone averages both into mush. Cubing the weights keeps one projection in charge.
 wf,wt=wf**3,wt**3
 w=(wf/np.maximum(wf+wt,1e-9))[:,None]
 col=a*w+b*(1-w)
 return coat_grade(col)
# Colour grade shared by head, body (and matched by the tail). The painted maps carry the
# pattern; their tabby came out a pale grey-beige under the studio light, where the references
# are a warm caramel with dark-brown stripes. Map tabby luminance onto that ramp; leave white.
GRADE_DARK=np.array([.31,.23,.17]);GRADE_MID=np.array([.58,.45,.34]);GRADE_LIGHT=np.array([.82,.69,.56])
def _tabby_range():
 """10th/90th luminance percentile of the painted tabby (not the white): the maps' stripes
  span only a narrow band, so ramping the raw luminance left every stripe a mid-tone."""
 if COAT is None:return .35,.65
 L=np.concatenate([(m.reshape(-1,3)@np.array([.30,.59,.11])) for m in COAT.values()]);L=L[L<.70]
 return float(np.percentile(L,10)),float(np.percentile(L,90))
TAB_LO,TAB_HI=_tabby_range()
def coat_grade(col):
 lum=col@np.array([.30,.59,.11])
 tab=np.clip(1-(lum-.66)/.14,0,1)[:,None]            # 1 on tabby, 0 on the white blaze/bib/socks
 t=np.clip((lum-(TAB_LO-.04))/max(TAB_HI-TAB_LO+.08,1e-3),0,1)[:,None]   # stretched, but not to zebra
 ramp=np.where(t<.55,GRADE_DARK+(GRADE_MID-GRADE_DARK)*(t/.55),GRADE_MID+(GRADE_LIGHT-GRADE_MID)*((t-.55)/.45))
 return np.clip(col*(1-tab)+ramp*tab,0,1)
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
 if COAT is not None and reg in ('Head','body'):return painted_coat(p,reg)
 if COAT is not None and reg=='Jaw':return np.tile(white,(len(p),1))
 if COAT is not None and reg.startswith('Ear'):return coat_sample('coat_head_front',p)
 if COAT is not None and reg=='tail':
  # Tail palette measured off the painted back (10th / 85th luminance percentile of the
  # tabby), soft rings, and a tip that darkens like the turnaround's.
  dk=np.array([.27,.19,.14]);lt=np.array([.78,.64,.51])   # the coat grade's ramp
  along=np.clip((y-.36)/.40,0,1)
  ring=((np.sin(y*95+np.sin(x*30)*.5)+1)/2)**1.6
  s=np.clip(ring*.8+.55*along**2,0,1)[:,None]
  return lt[None,:]*(1-s)+dk[None,:]*s
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
# Lid colour: the coat the lid sits in, darkening to a narrow near-black rim at the eye - the
# line every cat's eye has. Evaluated on the authored (pre head-scale) basis, like the coat.
for o in eyelids:
 me=o.data;co=np.array([me.vertices[l.vertex_index].co[:] for l in me.loops]);ring=np.array([(l.vertex_index//41)/8 for l in me.loops])
 col=fur_color(co,'Head');rim=np.clip((ring-.03)/.07,0,1)[:,None]
 col=np.array([.07,.05,.04])*(1-rim)+col*.78*rim   # skin under the coat is a shade darker than the coat
 at=me.attributes.new('lid_color','FLOAT_COLOR','CORNER');at.data.foreach_set('color',np.column_stack((srgb_lin(col),np.ones(len(col)))).astype('f').ravel())
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
 elif reg.startswith('Ear'):
  d=np.tile([.45*np.sign(root[0,0]),.15,1],(n,1))
 elif reg=='Head':
  centre=np.array([0,-.47,.505])                  # radiate away from the nose
  d=root-centre;d/=np.maximum(np.linalg.norm(d,axis=1)[:,None],1e-8);d[:,1]-=.18
  d[:,2]-=.35*np.clip((.49-z)/.07,0,1)            # the lower cheeks and chin droop softly
  # ...except around the eyes, where the coat radiates away from the EYE: rooted at the rim
  # and pointing outward it frames the eye instead of combing across it, so it can run right
  # up to the lens and cover the bare skin ring that otherwise shows around it.
  for s in (-1,1):
   out=np.column_stack((x-s*EYE_X,np.zeros(n)+.35*np.hypot(x-s*EYE_X,z-EYE_Z),z-EYE_Z))
   out/=np.maximum(np.linalg.norm(out,axis=1)[:,None],1e-8)
   k=(np.clip((1.8-np.hypot(x-s*EYE_X,z-EYE_Z)/EYE_R)/.8,0,1)*(y<-.37))[:,None]
   d=d*(1-k)+out*k
 else:
  d=np.tile([0,-.5,-.6],(n,1))
 return d
# guard hairs sit above a thinner, shorter undercoat and carry most of the colour;
# the undercoat lifts the silhouette and fills the visible gaps between strands.
# Radius must survive rasterisation: at the old .00042 root a strand was under half a
# pixel wide in a 900px portrait, which is why the coat vanished into the skin.
RADII={'guard':[.00078,.00056,.00030,.00006],'under':[.00045,.00032,.00018,.00004]}
# Points per strand. Four made every hair a straight stick - the coat read as combed. Six lets
# a strand arc and its tip gather into a clump, which is most of what "fluffy" looks like.
NP=6
CLUMP={'Head':.0095,'body':.011,'tail':.013}
def groom(o,n,length,reg,layer='guard',root_filter=None,bind_as=None):
 me=o.data;me.calc_loop_triangles();v=np.array([v.co[:] for v in me.vertices]);norm=np.array([v.normal[:] for v in me.vertices]);tri=np.array([t.vertices[:] for t in me.loop_triangles]);corn=v[tri];area=np.linalg.norm(np.cross(corn[:,1]-corn[:,0],corn[:,2]-corn[:,0]),axis=1);ids=rng.choice(len(tri),n,p=area/area.sum());b=rng.random((n,2));b[b.sum(1)>1]=1-b[b.sum(1)>1];b=np.column_stack((1-b.sum(1),b));root=(corn[ids]*b[:,:,None]).sum(1);normal=(norm[tri[ids]]*b[:,:,None]).sum(1);normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-8)
 if reg=='Head' and not o.name.startswith('LX_Lid'):
  keep=np.ones(n,dtype=bool)
  for s in [-1,1]:keep &= ~((((root[:,0]-s*EYE_X)/(EYE_R*.90))**2+((root[:,2]-EYE_Z)/(EYE_R*.90))**2<1)&(root[:,1]<-.395))
  # Keep the coat off the nose leather only. This window used to run from the nose all the way
  # down (z<.503), shaving a 48mm-wide bald strip over the mouth and chin.
  keep &= ~((abs(root[:,0])<.024)&(root[:,1]<-.427)&(root[:,2]<.503)&(root[:,2]>.470))
  root=root[keep];normal=normal[keep];n=len(root)
 if root_filter is not None:
  m=root_filter(root);root=root[m];normal=normal[m];n=len(root)
 if reg.startswith('Ear'):normal*=np.where(normal[:,1]<0,-1,1)[:,None]
 if o.name.startswith('LX_Lid'):normal*=np.where(normal[:,1]>0,-1,1)[:,None]
 direction=fur_direction(root,reg)
 tangent=direction-(direction*normal).sum(1)[:,None]*normal;tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-8)
 scale=.55 if layer=='under' else 1.0
 t=np.linspace(0,1,NP)[None,:,None];ln=length*scale*rng.uniform(.6,1.35,(n,1,1))
 stray=rng.random(n)<.025;ln[stray]*=1.4                       # a few long flyaway hairs
 if reg=='Head':
  # Around the eye the coat is short, rising to full length 1.9 eye-radii out: a hair rooted at
  # the inner corner points across the lens, and at full length it veils half the eye.
  ed=np.min([np.hypot(root[:,0]-s*EYE_X,root[:,2]-EYE_Z) for s in (-1,1)],axis=0)/EYE_R
  ln*=np.where(root[:,1]<-.37,np.clip(.70+.30*(ed-1)/.7,.70,1),1)[:,None,None]
  # ...and short around the mouth, so the upper-lip coat does not hang over an open mouth.
  dm=np.hypot(root[:,0],(root[:,2]-LIP0)*1.4)
  # Upper lip only: below the lip the coat is the chin's and hangs away from the mouth anyway;
  # shortening it too left a bare white plate under the mouth.
  ln*=np.where((root[:,1]<-.40)&(root[:,2]>=lip_z(root[:,0])),np.clip(.22+.78*(dm-.016)/.050,.22,1),1)[:,None,None]
  # The muzzle (nose, whisker pads) stays short and dense so the features read inside the
  # longer head coat; it grows to full length ~6cm out from the nose.
  dmz=np.hypot(root[:,0],(root[:,2]-.466)*1.25)
  ln*=np.where(root[:,1]<-.39,np.clip(.42+.58*(dmz-.018)/.055,.42,1),1)[:,None,None]
  # The face that looks at you is short and smooth (stripes and features stay crisp); the long
  # fluff grows where the head turns away - cheeks' outer edge, crown, back of the head. A single
  # length everywhere turned the head into a featureless puffball.
  hn=(root-np.array([0,-.285,.525]))/np.array([.165,.147,.156]);hn/=np.maximum(np.linalg.norm(hn,axis=1)[:,None],1e-8)
  facing=np.clip(-hn[:,1],0,1)**2
  ln*=(1-.55*facing)[:,None,None]
  crown=np.clip(hn[:,2],0,1)**2;ln*=(1-.40*crown)[:,None,None]     # a sleek crown: the ball shape was mostly crown fluff
  # Tufts: a low-frequency length field (+-25%), so the head's outline breaks into soft locks
  # instead of a clipped sphere - uniform length is what made it read as a ball.
  tq=root*np.array([41.,37.,43.]);tuft=.5+.5*np.sin(tq[:,0]+1.7*np.sin(tq[:,2]))*np.sin(tq[:,1]*1.3+tq[:,2]*.7)
  ln*=(.78+.44*tuft)[:,None,None]
  ruff=1+.75*np.clip((np.abs(root[:,0])-.080)/.060,0,1)*np.clip((.54-root[:,2])/.075,0,1)   # cheek fluff widens the lower face
  bib=1+.5*np.clip((.50-root[:,2])/.08,0,1)
  ln*=np.maximum(ruff,bib)[:,None,None]
 elif reg=='body':
  bib=1+.8*np.clip((-.10-root[:,1])/.14,0,1)*np.clip((.42-root[:,2])/.17,0,1)*np.clip((root[:,2]-.18)/.08,0,1)
  legs=np.clip(.30+.70*(root[:,2]-.08)/.20,.30,1)   # short on the lower legs and paws - a raised paw is a paw, not a mitten
  ln*=(bib*legs)[:,None,None]
 # Fluff physics: the strand hugs the skin at the root, lifts away through the middle,
 # and the tip drifts along the coat direction - then two wave frequencies (a slow
 # bend plus a faster kink) give the micro-curl a long-haired kitten actually has.
 stand={'tail':1.7,'body':1.15,'Head':1.12}.get(reg,1.0)
 if o.name.startswith('LX_Lid'):stand=.28     # lid coat lies flat: a furry lid, not a brush of lashes
 lift=(.78*t-.34*t*t)*stand;drift=(.50*t*t)/stand
 wave=normal[:,None,:]*(.0024*rng.uniform(.5,1.5,(n,1,1))*(np.sin(t*4.2+rng.random((n,1,1))*6.28)+.55*np.sin(t*9.0+rng.random((n,1,1))*6.28)))
 pts=root[:,None,:]+ln*(normal[:,None,:]*lift+tangent[:,None,:]*drift)+wave
 # Clumping: strands rooted in the same small patch pull their tips toward the patch's mean
 # tip. Evenly spaced independent hairs read as velvet; real long fur parts into tufts.
 cs=CLUMP.get(reg)
 if cs and n>8:
  cell=np.floor(root/cs).astype(np.int64);_,inv=np.unique(cell,axis=0,return_inverse=True);inv=inv.ravel()
  cnt=np.bincount(inv);ctip=np.zeros((cnt.size,3));np.add.at(ctip,inv,pts[:,-1,:]);ctip/=cnt[:,None]
  pull=(.38 if layer=='guard' else .18)*(cnt[inv]>2)
  pts+=(ctip[inv]-pts[:,-1,:])[:,None,:]*(pull[:,None,None]*t**2)
 # Frizz: a little per-point scatter growing toward the tip - no two hairs lie parallel.
 pts+=rng.normal(0,1,(n,NP,3))*(ln*(.038 if reg=='Head' else .045))*t**1.5   # one coat: the head frizzes like the body
 edges=np.column_stack((np.arange(n*NP).reshape(n,NP)[:,:-1].ravel(),np.arange(n*NP).reshape(n,NP)[:,1:].ravel()))
 mesh=bpy.data.meshes.new('FurStrands')
 # Raw geometry API instead of from_pydata: from_pydata materialises one Python
 # tuple per strand point (millions of them at hero counts), which is what drove
 # the build-only memory spikes. Array-in, no per-point Python objects.
 mesh.vertices.add(n*NP);mesh.vertices.foreach_set('co',pts.astype('f').ravel())
 mesh.edges.add(edges.shape[0]);mesh.edges.foreach_set('vertices',edges.astype(np.int32).ravel())
 mesh.update();ob=bpy.data.objects.new('LX_Fur_'+layer+'_'+o.name,mesh);scene.collection.objects.link(ob);bind(ob,bind_as or reg,wpts=np.repeat(root,NP,axis=0))
 # The strand mesh is only a deformation source for the render curves. It carries no
 # material of its own, so in Cycles it came out as default-white fluff and buried both
 # the striped skin and the coloured curves. Never let it render directly.
 ob.hide_render=True
 del pts,edges
 colors=np.repeat(srgb_lin(fur_color(root,reg)),NP,axis=0)
 # per-strand variation, plus a few pale hairs; a single flat colour reads as plastic fur.
 # jit must stay (n,1): repeating it must yield one scalar per POINT, because a
 # second trailing axis broadcasts (4n,3) against (4n,1,1) into a 4n x 4n x 3 monster
 # and OOM-kills the build.
 jit=1+rng.normal(0,.05,(n,1))+((rng.random((n,1))<.025)*.22)
 # Darker at the root, catching light at the tip: without this the four points of a
 # strand are one flat colour and the coat reads as tinted skin rather than fur.
 # One scalar per point, so the per-strand 4 points stay aligned with (4n,3).
 # Gentle root-to-tip lift (.86 -> 1.10). It was .84 -> 1.26, but only the root colour ever
 # reached the render; now the whole gradient does (native_fur keeps per-point colour).
 taper=np.tile(np.interp(np.linspace(0,1,NP),[0,1],[.86,1.10]),n)[:,None]
 colors=np.clip(colors*np.repeat(jit,NP,axis=0)*taper*(1.06 if layer=='under' else 1.0),0,1)
 a=mesh.attributes.new('fur_color','FLOAT_COLOR','POINT');a.data.foreach_set('color',np.column_stack((colors,np.ones(len(colors)))).astype('f').ravel())
 rs=.78 if reg=='Head' else 1.0   # finer hair on the face: coarse strands read as a brush up close
 radius=mesh.attributes.new('fur_radius','FLOAT','POINT');radius.data.foreach_set('value',(rs*np.tile(np.interp(np.linspace(0,1,NP),np.linspace(0,1,4),RADII[layer]),n)).astype('f'))
 ng=bpy.data.node_groups.new('Skin strands to render curves','GeometryNodeTree');ng.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');ng.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');nodes=ng.nodes;links=ng.links;inp=nodes.new('NodeGroupInput');out=nodes.new('NodeGroupOutput');cv=nodes.new('GeometryNodeMeshToCurve');rr=nodes.new('GeometryNodeSetCurveRadius');at=nodes.new('GeometryNodeInputNamedAttribute');at.data_type='FLOAT';at.inputs['Name'].default_value='fur_radius';sm=nodes.new('GeometryNodeSetMaterial');sm.inputs['Material'].default_value=furmat;links.new(inp.outputs['Geometry'],cv.inputs['Mesh']);links.new(cv.outputs['Curve'],rr.inputs['Curve']);links.new(at.outputs['Attribute'],rr.inputs['Radius']);links.new(rr.outputs['Curve'],sm.inputs['Geometry']);links.new(sm.outputs['Geometry'],out.inputs['Geometry']);mod=ob.modifiers.new('Render native short hairs','NODES');mod.node_group=ng;ob['strand_count']=n;ob['strand_points']=NP;furs.append(ob)
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
GUARD=[(body,80000,.085,'body'),(head,90000,.064,'Head'),(tail,24000,.150,'tail')]
# Coat density x1.5 (the user accepted up to 2x cost for a softer, denser coat).
DENSITY=1.5
for o,n,l,r in GUARD:groom(o,max(1,int(n*SCALE*DENSITY)),l,r,'guard')
# A shorter, denser, slightly lighter undercoat is what makes the silhouette read as
# fluffy instead of spiky - the reference kitten has one, so it is ON by default now.
# `hero` multiplies it further; memory stays safe since the broadcast bug is gone.
if QUALITY in ('standard','hero'):
 f=(1.4 if QUALITY=='hero' else 1.0)
 for o,n,l,r in [(body,50000,.055,'body'),(head,60000,.042,'Head'),(tail,14000,.100,'tail')]:
  groom(o,max(1,int(n*f*DENSITY)),l,r,'under')
# Short tabby fur on the back of each ear: bare shells read as plastic cut-outs from the side.
for o,r in ear_outers:groom(o,max(1,int(6000*SCALE)),.022,r,'guard')
# Short coat ON the lids. Without it a squint slid a bare skin-coloured plate over the eye.
# The strands get the lids' own Blink/Squint keys - each strand moves with the lid vertex
# nearest its root - so the fur closes with the eye.
# Upper lids only: the lower lid sits under the cheek coat, and its own fur - white, from the blaze -
# stood up as white bars beside the nose when it rose to close the eye.
for lid in [o for o in eyelids if o.name.startswith('LX_LidUpper')]:
 s_=-1 if lid.name.endswith('.L') else 1
 groom(lid,max(1,int(8000*SCALE)),.030,'Head','guard',root_filter=lambda r,s_=s_:(np.hypot(r[:,0]-s_*EYE_X,r[:,2]-EYE_Z)<EYE_R*1.18)&(np.hypot(r[:,0]-s_*EYE_X,r[:,2]-EYE_Z)>EYE_R*.985),   # all of the lid but its dark rim row
       bind_as='Lid:%s:%s'%('U' if 'Upper' in lid.name else 'L','L' if s_<0 else 'R'))
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
  cu=bpy.data.curves.new('Whisker','CURVE');cu.dimensions='3D';cu.bevel_depth=.00055;cu.bevel_resolution=2;sp=cu.splines.new('POLY');sp.points.add(7)
  for j,p in enumerate(sp.points):t=j/7;p.co=(s*(.040+.20*t),-.436+.05*t*t,.470+(i-2)*.006+.030*(i-2)*t-.012*t*t,1);p.radius=1-.9*t
  o=bpy.data.objects.new('LX_Whisker',cu);scene.collection.objects.link(o);cu.materials.append(cream)
  # Deselect first: convert() acts on the whole selection, so without this every earlier
  # whisker was converted again - which APPLIES its armature modifier and leaves it frozen
  # in rest pose while the head moves (visible as whiskers across the brow when lying down).
  bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');bind(o,'Whisker.'+suf)
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
# 1.15 (a bigger skull) made the head read too big once it wore a coat. The skull is back at its
# authored size and the head's fluffy outline comes from longer fur, the way the body's does.
HEAD_S=.90;HEAD_SCALE=np.array([HEAD_S,HEAD_S,HEAD_S]);HEAD_PIVOT=np.array([0,-.16,.48])
# Body length. Side-on the torso ran ~3.3 head-lengths where the turnaround's kitten is ~2.2 - a
# dachshund under a kitten's head, and half of why the head "looked big" from the front. The body
# (everything but the head) is compressed nose-to-tail about y=.06, and the head rides back with
# the neck by the same amount, so nothing else has to know.
BODY_K=.86;BODY_Y0=.06
def body_xf(p):p=np.asarray(p,dtype='f');return (float(p[0]),float(BODY_Y0+BODY_K*(p[1]-BODY_Y0)),float(p[2]))
HEAD_SHIFT=np.array([0,body_xf(HEAD_PIVOT)[1]-HEAD_PIVOT[1],0])
def head_xf(p):return tuple(HEAD_PIVOT+HEAD_SCALE*(np.asarray(p,dtype='f')-HEAD_PIVOT)+HEAD_SHIFT)
def body_xf_obj(o):
 for v in o.data.vertices:v.co=body_xf(v.co)
 sk=o.data.shape_keys
 if sk:
  for kb in sk.key_blocks:
   for d in kb.data:d.co=body_xf(d.co)
def head_xf_obj(o):
 for v in o.data.vertices:v.co=head_xf(v.co)
 sk=o.data.shape_keys
 if sk:
  for kb in sk.key_blocks:
   for d in kb.data:d.co=head_xf(d.co)
 for m in o.modifiers:
  if m.type=='SOLIDIFY':m.thickness*=HEAD_S      # the ear/lid shells must thin with the head
HEAD_TAGS=('LX_Head','LX_Jaw','LX_MouthCavity','LX_Tongue','LX_Nose','LX_Ear.','LX_Eyeball.',
           'LX_EarFurnish.','LX_EarOuter.','LX_Eye.','LX_Cornea.','LX_Lid','LX_TearDuct.',
           'LX_Brow','LX_Whisker','LX_Lip','LX_Tooth','LX_MouthFloor')
for o in scene.objects:
 if o.type=='MESH' and (o.name.startswith(HEAD_TAGS) or '_LX_Head' in o.name or '_LX_Jaw' in o.name or '_LX_EarOuter' in o.name or '_LX_Lid' in o.name):
  head_xf_obj(o)
 elif o.type=='MESH' and o.name.startswith('LX_'):
  body_xf_obj(o)
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
HEAD_BONES=['Head','Jaw','Tongue','Nose','Ear.L','Ear.R','Eye.L','Eye.R','Whisker.L','Whisker.R','LidUpper.L','LidUpper.R','LidLower.L','LidLower.R']
for eb in ad.edit_bones:
 if eb.name in HEAD_BONES:eb.head=head_xf(eb.head);eb.tail=head_xf(eb.tail)
 else:eb.head=body_xf(eb.head);eb.tail=body_xf(eb.tail)
tailpoints=[body_xf(p) for p in tailpoints]
bpy.ops.object.mode_set(mode='OBJECT')
# Named actions with synchronized shape key actions. One timeline demonstrates all clips.
clips=[('Idle',72),('Walk',48),('Run',32),('Jump',48),('LieDown',48),('SideLie',48),('Sleep',72),('Curious',48),('Happy',48),('Yawn',60),('Lick',48),('Bite',48),('Knead',48),('Stretch',60),('PawPlay',48)]
eyelids=[o for o in eyelids if o.data.shape_keys];eye_shapes=[o for o in eye_shapes if o.data.shape_keys];claws=[o for o in claws if o.data.shape_keys];breathers=[o for o in breathers if o.data.shape_keys]
tongues=[tongue];shapeobs=eyelids+eye_shapes+claws+breathers+tongues;offset=1;manifest=[]
# --- Paw-lick solve -------------------------------------------------------------------------
# The lick pose used hand-set angles and the paw ended beside the face (it sits 10cm off the
# midline) - "misplaced". Here the rig's own rest matrices are chained by hand (the same
# parent-rest-basis product Blender evaluates) and a small search finds neck / head / leg
# angles that put the paw PAD in front of the mouth, facing it, with as little bending as
# possible. Solved once; the clip scales the angles by its ease-in / ease-out.
from mathutils import Matrix,Euler
def _fk(rots,locs=None):
 locs=locs or {};cache={}
 def m(name):
  if name in cache:return cache[name]
  b=ad.bones[name];basis=Matrix.Translation(Vector(locs.get(name,(0,0,0))))@Euler(rots.get(name,(0,0,0)),'XYZ').to_matrix().to_4x4()
  r=(m(b.parent.name)@(b.parent.matrix_local.inverted()@b.matrix_local) if b.parent else b.matrix_local)@basis
  cache[name]=r;return r
 return m
def _tip(f,name):return f(name)@Vector((0,ad.bones[name].length,0))
def _search(cost,x0,lo,hi,samples,seed):
 """Random multi-start around x0, then shrinking coordinate descent. Deterministic."""
 r_=np.random.default_rng(seed);lo=np.asarray(lo,float);hi=np.asarray(hi,float)
 best=(cost(x0),np.asarray(x0,float))
 for v in lo+(hi-lo)*r_.random((samples,len(lo))):
  c_=cost(v)
  if c_<best[0]:best=(c_,v.copy())
 v=best[1];step=(hi-lo)/12
 for _ in range(90):
  improved=False
  for i in range(len(v)):
   for d in (-1,1):
    w=v.copy();w[i]=np.clip(w[i]+d*step[i],lo[i],hi[i]);cw=cost(w)
    if cw<best[0]:best=(cw,w);v=w;improved=True
  if not improved:step=step*.5
 return best
# --- Leg IK ------------------------------------------------------------------------------------
# Every clip now places FEET, and the legs are solved to reach them, instead of hand-set joint
# angles. That is what makes a planted paw stay planted, a knee bend forward and an elbow back.
# Each leg is a planar 2-bone chain (upper + lower) plus a paw whose angle is set directly; the
# plane is the leg's own rest plane, so the solve is done in rest space: the target is carried
# back through the parent's pose delta (spine, pelvis, shoulder blade, root roll) first.
def _ang(v):return math.atan2(v[2],v[1])
def _wrap(a):return (a+math.pi)%math.tau-math.pi
LEGS={}
for _s in 'LR':
 LEGS['F'+_s]=('Scap.'+_s,'FrontUpper.'+_s,'FrontLower.'+_s,'FrontPaw.'+_s,+1)   # elbow points back
 LEGS['H'+_s]=('Pelvis','RearUpper.'+_s,'RearLower.'+_s,'RearPaw.'+_s,-1)          # knee points forward
LREST={}
for k,(par,up,lo,pw,bend) in LEGS.items():
 r={}
 for n in (up,lo,pw):r[n]=_ang(Vector(ad.bones[n].tail_local)-Vector(ad.bones[n].head_local))
 sg={}
 for n in (up,lo,pw):                       # which way a +X local rotation turns the bone in the plane
  f=_fk({n:(.1,0,0)});v=_tip(f,n)-f(n).translation;sg[n]=1.0 if _wrap(_ang(v)-r[n])>0 else -1.0
 LREST[k]=dict(ang=r,sign=sg,L1=ad.bones[up].length,L2=ad.bones[lo].length,foot=Vector(ad.bones[pw].head_local),x=ad.bones[up].head_local.x)
def leg_ik(rots,locs,key,target,paw_ang):
 """Solve one leg to put its wrist/hock at `target` (world) with the paw at world angle
  `paw_ang` in its plane. Returns (rotations, off-plane distance, over-reach)."""
 par,up,lo,pw,bend=LEGS[key];R=LREST[key]
 f=_fk(rots,locs);D=f(par)@ad.bones[par].matrix_local.inverted()
 t=D.inverted()@Vector(target);h=Vector(ad.bones[up].head_local)
 d=Vector((0,t.y-h.y,t.z-h.z));L1,L2=R['L1'],R['L2']
 over=max(0,d.length-(L1+L2)*.995);dist=min(max(d.length,abs(L1-L2)+1e-3),(L1+L2)*.995)
 A=math.acos(max(-1,min(1,(L1*L1+dist*dist-L2*L2)/(2*L1*dist))))
 ua=_ang(d)+bend*A;knee=h+L1*Vector((0,math.cos(ua),math.sin(ua)))
 la=_ang(t-knee);pitch=_ang(D.to_3x3()@Vector((0,1,0)))
 du=_wrap(ua-R['ang'][up]);dl=_wrap(la-(R['ang'][lo]+du));dp=_wrap((paw_ang-pitch)-(R['ang'][pw]+du+dl))
 return ({up:(du*R['sign'][up],0,0),lo:(dl*R['sign'][lo],0,0),pw:(dp*R['sign'][pw],0,0)},abs(t.x-R['x']),over)
def _paw_rest(key):return LREST[key]['ang'][LEGS[key][3]]
def _root_delta(f):return f('Root')@ad.bones['Root'].matrix_local.inverted()
mouth_l=ad.bones['Head'].matrix_local.inverted()@Vector((0,-.4515,LIP0))
# Lick is groomed SITTING, like reference/lingxi-ref-lick-paw.png: haunches down, chest up, left
# forepaw planted, right paw raised pad-to-mouth. Two solves: the sit, then the paw and shoulder.
def _sit_rots(v):
 rx,ly,lz,sp,n,h=v
 return {'Root':(rx,0,0),'Spine':(sp,0,0),'Neck':(n,0,0),'Head':(h,0,0)},{'Root':(0,ly,lz)}
def _sit_targets(f):
 T={}
 for k in LEGS:
  if k[0]=='H':hip=f(LEGS[k][1]).translation;T[k]=(Vector((LREST[k]['x'],hip.y+.035,.046)),math.radians(-176))
  else:sh=f(LEGS[k][1]).translation;T[k]=(Vector((LREST[k]['x'],sh.y-.012,.066)),_paw_rest(k))
 return T
def solve_sit():
 def cost(v):
  rots,locs=_sit_rots(v);f=_fk(rots,locs);c=0.0
  hip=f('RearUpper.L').translation;c+=25*abs(hip.z-.105)
  for k,(tg,pa) in _sit_targets(f).items():
   _,off,over=leg_ik(rots,locs,k,tg,pa);c+=60*over
   if k[0]=='F':c+=20*max(0,(LREST[k]['L1']+LREST[k]['L2'])*.62-(tg-f(LEGS[k][1]).translation).length)   # no crouched forelegs
  sp0=f('Spine').translation;sp1=_tip(f,'Spine');pitch=math.atan2(sp1.z-sp0.z,abs(sp1.y-sp0.y))
  c+=12*abs(pitch-math.radians(62))
  mz=(f('Head')@mouth_l).z;c+=15*max(0,.50-mz)
  hd0=f('Head').translation;hd1=_tip(f,'Head');c+=3*abs(math.atan2(hd1.z-hd0.z,-(hd1.y-hd0.y))-math.radians(12))
  return c+.01*float(np.dot(v,v))
 c_,v=_search(cost,[-.45,-.12,0,-.5,.3,.4],[-1.3,-.4,-.4,-1.0,-.6,-.6],[0,.4,.4,1.0,1.0,1.0],4000,11)
 rots,locs=_sit_rots(v);f=_fk(rots,locs)
 print('SIT_SOLVE',json.dumps({'cost':round(c_,4),'v':[round(float(x),3) for x in v],'hip_z':round(f('RearUpper.L').translation.z,3),
  'mouth_z':round((f('Head')@mouth_l).z,3)}))
 return rots,locs,_sit_targets(f)
def solve_lick(sit):
 rots0,locs,T0=sit;k='FR'
 def build(v):
  srx,srz,dn,dh,yaw,roll=v;r=dict(rots0)
  r['Scap.R']=(srx,0,srz);r['Neck']=(rots0['Neck'][0]+dn,0,yaw*.4);r['Head']=(rots0['Head'][0]+dh,roll,yaw*.6)
  f=_fk(r,locs);mouth=f('Head')@mouth_l;wrist=mouth+Vector((0,-.020,-.060))
  pa=_ang(mouth+Vector((0,-.010,-.006))-wrist)
  lr,off,over=leg_ik(r,locs,k,wrist,pa);r.update(lr);return r,mouth,off,over
 pw=ad.bones['FrontPaw.R'];palm_l=pw.matrix_local.inverted()@Vector((LREST['FR']['x'],-.215,.022))
 pad_n=(pw.matrix_local.inverted().to_3x3()@Vector((0,0,-1))).normalized()
 def cost(v):
  r,mouth,off,over=build(v);f=_fk(r,locs);pm=f('FrontPaw.R');palm=pm@palm_l;n_=(pm.to_3x3()@pad_n).normalized()
  facing=n_.dot((mouth-palm).normalized());srx,srz,dn,dh,yaw,roll=v
  # The face stays visible: the pad meets the mouth from BELOW (palm under the lip line).
  return (25*(palm-(mouth+Vector((0,-.012,-.012)))).length+40*off+60*over+(1-facing)*.5+15*max(0,palm.z-(mouth.z-.004))
          +.04*(srx*srx+srz*srz)+.25*(dn*dn+dh*dh)+.30*yaw*yaw+.10*roll*roll)
 c_,v=_search(cost,[-.3,.2,.1,.1,0,.1],[-1.2,-.9,-.3,-.3,-.15,-.25],[.6,.9,.4,.5,.15,.25],5000,7)   # small yaw: the face stays visible side-on
 r,mouth,off,over=build(v);f=_fk(r,locs);palm=f('FrontPaw.R')@palm_l
 print('LICK_SOLVE',json.dumps({'cost':round(c_,4),'v':[round(float(x),3) for x in v],'palm_to_mouth_mm':round((palm-mouth).length*1000,1),
  'offplane_mm':round(off*1000,1),'palm_below_mouth_mm':round((mouth.z-palm.z)*1000,1)}))
 return {n:r[n] for n in ('Scap.R','Neck','Head')}
# Eyelid bone angles. Closed, the upper rim comes down .81 eye-radii and the lower rises 1.13, so
# they meet just above the eye's centre with the upper lid in front: a closed eye reads as the
# upper rim's arch (the content kitten in reference/lingxi-ref-expressions.png), not a slit.
LID_TH={}
for _s in 'LR':
 for _ul,_dz in (('Upper',-.81),('Lower',1.13)):
  _nm='Lid'+_ul+'.'+_s;_b=ad.bones[_nm];_h=Vector(_b.head_local);_o=(Vector(_b.tail_local)-_h).normalized()
  _R=LID_R*HEAD_S;_pt=_h+_o*_R
  _f=_fk({_nm:(.05,0,0)});_moved=(_f(_nm)@(_b.matrix_local.inverted()@_pt)).z-_pt.z
  LID_TH[_nm]=math.copysign(abs(_dz*EYE_R*HEAD_S)/_R,_dz*_moved)
SIT=solve_sit()
LICK_UPPER=solve_lick(SIT)
WALK=dict(duty=.62,stride=.12,lift=.035,off={'HL':0,'FL':.25,'HR':.5,'FR':.75})
RUN=dict(duty=.40,stride=.20,lift=.060,off={'FL':0,'HR':0,'FR':.5,'HL':.5})
def _gait(g,u,k):
 ph=(u+g['off'][k])%1
 if ph<g['duty']:s_=ph/g['duty'];return g['stride']*(s_-.5),0.0,0.0
 s_=(ph-g['duty'])/(1-g['duty']);e=s_*s_*(3-2*s_);return g['stride']*(.5-e),g['lift']*math.sin(math.pi*s_),math.sin(math.pi*s_)
def place_legs(name,u,pb,hold=0.0):
 """Solve all four legs for this frame, after the body (root, spine, head) is posed."""
 names=['Root','Pelvis','Spine','Neck','Head','Scap.L','Scap.R']
 rots={n:tuple(pb[n].rotation_euler) for n in names};locs={'Root':tuple(pb['Root'].location)}
 f=_fk(rots,locs);RD=_root_delta(f)
 # Lying (sphinx): forearms flat on the ground ahead of the shoulders; hocks down behind the hips,
 # the hind feet flat forward. Targets are for a body lowered 11cm, in the body's own frame.
 lie={}
 for k in LEGS:
  hy=ad.bones[LEGS[k][1]].head_local.y
  lie[k]=(Vector((LREST[k]['x'],hy-.075,.045+.11)),math.radians(-170)) if k[0]=='F' else (Vector((LREST[k]['x'],hy+.045,.046+.11)),math.radians(-178))
 for k in LEGS:
  foot=LREST[k]['foot'].copy();pa=_paw_rest(k);tg=foot
  if name in ('Walk','Run'):
   dy,dz,flex=_gait(WALK if name=='Walk' else RUN,u,k);tg=foot+Vector((0,dy,dz));pa+=flex*(.9 if k[0]=='F' else .7)
  elif name=='Jump':
   lift=math.sin(math.pi*u)**2
   tg=foot+(Vector((0,-.09*lift,.30*lift)) if k[0]=='F' else Vector((0,.11*lift,.27*lift)));pa+=lift*(.9 if k[0]=='F' else 1.2)
  elif name in ('LieDown','SideLie','Sleep','Stretch'):
   fr=1.0 if name=='Sleep' else min(1,u*3);lt,la=lie[k]
   if name=='Stretch' and k[0]=='F':lt=lt+Vector((0,-.08*math.sin(math.pi*u),0))
   if name in ('SideLie','Sleep'):
    # On its side a cat's legs lie out loose and a little bent, one pair drawn up - not folded
    # under it as in the sphinx, which rolled over became four paws in the air.
    lt=foot+(Vector((0,-.035,.06)) if k[0]=='F' else Vector((0,-.05,.07)));la=pa+.5
   tg=RD@(foot.lerp(lt,fr));pa=pa+(la-pa)*fr
   if name in ('SideLie','Sleep'):pa=pa+_ang(RD.to_3x3()@Vector((0,1,0)))
  elif name=='Knead' and k[0]=='F':
   a=.5+.5*math.sin(u*math.tau*2+(0 if k=='FL' else math.pi));tg=foot+Vector((0,-.012*a,.035*a));pa+=.5*a
  elif name=='PawPlay' and k=='FL':
   a=.5+.5*math.sin(u*math.tau);tg=foot+Vector((0,-.10*a,.13*a));pa+=1.0*a
  elif name=='Lick':
   st,sa=SIT[2][k];tg=foot.lerp(st,hold);pa=pa+(sa-pa)*hold
   if k=='FR':
    mouth=f('Head')@mouth_l;wr=mouth+Vector((0,-.020,-.060));tg=tg.lerp(wr,hold)
    pa=pa+(_ang(mouth+Vector((0,-.010,-.006))-wr)-pa)*hold
  lr,_,_=leg_ik(rots,locs,k,tg,pa)
  for n,rv in lr.items():pb[n].rotation_euler=rv
def pose(name,u):
 for p in rig.pose.bones:p.location=(0,0,0);p.rotation_euler=(0,0,0);p.scale=(1,1,1)
 for o in shapeobs:
  for k in o.data.shape_keys.key_blocks[1:]:k.value=0
 phase=u*math.tau;pb=rig.pose.bones
 # Idle is the baseline every other clip is measured against, so it stays small on purpose.
 pb['Head'].rotation_euler[1]=.035*math.sin(phase);pb['Ear.L'].rotation_euler[1]=.10*math.sin(phase);pb['Tail3'].rotation_euler[0]=.12*math.sin(phase)
 blink=max(0,1-abs(u-.65)/.065);squint=0
 if name in ['Walk','Run']:
  # legs: foot-planted gait, solved in place_legs()
  # PoseBone.location is in the root bone's local basis. Its local Y axis is world Z here.
  pb['Root'].location.y=.015*abs(math.sin(phase))*(2 if name=='Run' else 1)
 if name=='Jump':
  lift=math.sin(math.pi*u)**2;pb['Root'].location.y=.32*lift;pb['Spine'].rotation_euler[0]=-.12*math.sin(phase)
 if name in ['LieDown','SideLie','Sleep','Stretch']:
  # The body has to come DOWN with the legs. Folding them 117 degrees while dropping the root
  # 11cm left the silhouette 0.721 tall against Idle's 0.755 - a 4cm difference on a 75cm cat,
  # which is why "lying down" looked like "standing with odd legs".
  f=min(1,u*3) if name!='Sleep' else 1;pb['Root'].location.y=-.11*f
  pb['Spine'].rotation_euler[0]=.10*f
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
  pb['Eye.L'].rotation_euler[2]=.1*math.sin(phase);pb['Eye.R'].rotation_euler[2]=.1*math.sin(phase)
  pb['Tail2'].rotation_euler[0]=.30*math.sin(phase*1.5)
 if name=='Happy':
  # Tail up, chest lifted, ears forward, a small bounce. Was a 5-degree jaw and a 4-degree tail
  # swish around an otherwise untouched standing pose.
  bounce=.5-.5*math.cos(phase*2)
  # A happy cat slow-blinks and half-closes its eyes; a fully open stare reads as alarmed.
  blink=1.0;squint=0;pb['Jaw'].rotation_euler[0]=-.04   # eyes closed in an arch, mouth closed in a smile - as the reference
  pb['Root'].location.y=.022*bounce
  pb['Spine'].rotation_euler[0]=-.14*bounce;pb['Head'].rotation_euler[0]=-.22*bounce
  for suf in ['L','R']:pb['Ear.'+suf].rotation_euler[0]=-.26
  pb['Tail1'].rotation_euler[0]=-.85;pb['Tail2'].rotation_euler[0]=-.35+.42*math.sin(phase*2)
  pb['Tail3'].rotation_euler[0]=.30*math.sin(phase*2+1)
 if name in ['Yawn','Bite','Lick']:
  fac=math.sin(math.pi*u)**2 if name=='Yawn' else (.5-.5*math.cos(phase*2))
  pb['Jaw'].rotation_euler[0]=-1*(1.35 if name=='Yawn' else .32)*fac
  if name=='Yawn':blink=.85*fac;pb['Head'].rotation_euler[0]+=-.48*fac   # a cat tips its head back to yawn
  if name=='Lick':
   # Paw grooming: the right forepaw comes up to the mouth (upper leg swings forward and up,
   # forearm folds back, paw curls), the head dips and turns to meet it, and the tongue laps
   # against it twice. `hold` eases the paw up over the first quarter and down over the last.
   hold=min(1,u/.25,(1-u)/.2);hold=hold*hold*(3-2*hold)
   # Sit down, raise the paw, lick, put it down: the body's solved angles ease in by `hold`;
   # the legs follow their targets through place_legs().
   for bn,rv in {**SIT[0],**LICK_UPPER}.items():pb[bn].rotation_euler=tuple(c*hold for c in rv)
   for bn,lc in SIT[1].items():pb[bn].location=tuple(c*hold for c in lc)
   for i in range(4):pb[f'FrontToe{i}.R'].rotation_euler[0]=.45*hold
   fac*=hold
   pb['Jaw'].rotation_euler[0]=-.32*fac;pb['Tongue'].rotation_euler[0]=-.25*fac;tongue.data.shape_keys.key_blocks['Out'].value=fac
   squint=0          # eyes open on the viewer, as in the reference
  if name=='Yawn':tongue.data.shape_keys.key_blocks['Out'].value=.30*fac   # the tongue curls at the top of a yawn
  if name=='Bite':
   # Airplane ears. The ears are the clearest mood signal a cat has, and Bite previously
   # played with exactly the same face as Lick - only the jaw differed.
   for suf in ['L','R']:
    sgn=-1 if suf=='L' else 1
    pb['Ear.'+suf].rotation_euler[0]=-.90*fac;pb['Ear.'+suf].rotation_euler[2]=sgn*.35*fac
   squint=.25*fac
 if name in ['Knead','PawPlay']:
  for suf,ph in [('L',0),('R',math.pi)]:
   a=.5+.5*math.sin(phase*2+ph)
   for i in range(4):pb[f'FrontToe{i}.'+suf].rotation_euler[0]=.35*a
  # Kneading is the blissed-out clip; without the squint it was just paws moving.
  if name=='Knead':squint=1.0+.10*math.sin(phase)   # the blissed-out half-closed eyes of the reference, throughout
 place_legs(name,u,pb,hold=(min(1,u/.25,(1-u)/.2)**2*(3-2*min(1,u/.25,(1-u)/.2))) if name=='Lick' else 0.0)
 # Squint and Blink are additive off the same basis, so a full blink must cancel the squint
 # or the lid overshoots through the eye.
 squint=max(squint,.14)     # the upper lid rests just over the iris rim: soft, not a stare (.16 with smaller eyes read as sad)
 squint=squint*(1-blink)
 for _nm,_th in LID_TH.items():pb[_nm].rotation_euler[0]=_th*min(1.0,blink+.55*squint)   # a full squint closes the lids 55%
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
# Catchlight: a soft window-shaped lamp that only reflections see. The logo's eyes are mostly
# two big soft highlights; the studio's own lamps sit too high and wide to put one on the eyes.
cl=bpy.data.lights.new('Catchlight','AREA');cl.energy=160;cl.shape='RECTANGLE';cl.size=1.0;cl.size_y=.75   # the big soft highlight of the reference eyes;cl.color=(1,.98,.94)
clo=bpy.data.objects.new('Catchlight',cl);scene.collection.objects.link(clo);clo.location=(.12,-2.1,1.05)   # centred above the lens axis: a highlight in BOTH eyes
clo.rotation_euler=(Vector((0,-.45,.55))-clo.location).to_track_quat('-Z','Y').to_euler()
for vis in ('visible_camera','visible_diffuse','visible_transmission','visible_volume_scatter'):
 if hasattr(clo,vis):setattr(clo,vis,False)
# ...and it reaches only the corneas: on the lids its reflection turned a closed eye into a
# shiny grey slit.
_rc=bpy.data.collections.new('CatchlightReceivers')
for o in scene.objects:
 if o.name.startswith('LX_Cornea.'):_rc.objects.link(o)
try:clo.light_linking.receiver_collection=_rc
except AttributeError:pass
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
