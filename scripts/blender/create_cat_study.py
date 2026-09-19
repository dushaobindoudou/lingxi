"""Anatomy + groom study, not production topology. Executed through official MCP."""
import bpy
import math
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.new('Lingxi • Anatomy and Groom Study')
bpy.context.window.scene=scene
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=900
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene['stage']='WIP anatomy and groom study — not production topology or accepted final visual'
scene['rig_contract']='lingxi-cat-v1-study'
scene['reference']='Original concept hero; grey-brown tabby and warm white'
scene.unit_settings.system='METRIC'
scene.world=bpy.data.worlds.new('Study_world')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.76,.69,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
scene.view_settings.view_transform='AgX'

col=bpy.data.collections.new('Lingxi_Cat_Study');scene.collection.children.link(col)
def move(obj):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    col.objects.link(obj)
    return obj

def mat(name,color,roughness=.55):
    m=bpy.data.materials.new('LX_'+name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=roughness
    m.diffuse_color=(*color,1)
    return m
cream=mat('Cream',(.80,.73,.62))
white=mat('White',(.92,.87,.76))
rose=mat('Rose',(.56,.23,.19),.36)
dark=mat('Pupil',(.008,.009,.006),.09)
lid=mat('Eyelid',(.11,.08,.058),.5)
iris=mat('Iris',(.30,.29,.11),.19)
# Fibrous radial iris texture.
n=iris.node_tree.nodes;ln=iris.node_tree.links;p=n.get('Principled BSDF')
noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=25;noise.inputs['Detail'].default_value=3
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.07,.06,.017,1);ramp.color_ramp.elements[1].color=(.43,.39,.14,1)
ln.new(noise.outputs['Fac'],ramp.inputs[0]);ln.new(ramp.outputs['Color'],p.inputs['Base Color'])
coat=mat('Tabby',(.39,.30,.23))
n=coat.node_tree.nodes;ln=coat.node_tree.links;p=n.get('Principled BSDF')
tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=5;tex.inputs['Detail'].default_value=2
wave=n.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction='Z';wave.inputs['Scale'].default_value=5;wave.inputs['Distortion'].default_value=5;wave.inputs['Detail Scale'].default_value=2
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.28;ramp.color_ramp.elements[0].color=(.13,.09,.065,1);ramp.color_ramp.elements[1].position=.62;ramp.color_ramp.elements[1].color=(.50,.39,.29,1)
ln.new(wave.outputs['Color'],ramp.inputs[0]);ln.new(ramp.outputs['Color'],p.inputs['Base Color'])

parts=[]
def ellipsoid(name,loc,scale,material,fur=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=32,location=loc)
    o=move(bpy.context.object);o.name='LX_'+name;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for f in o.data.polygons:f.use_smooth=True
    o.data.materials.append(material)
    if fur:
        bpy.ops.object.particle_system_add()
        s=o.particle_systems[-1].settings;s.type='HAIR';s.count=1100;s.hair_length=fur;s.hair_step=3
        s.child_type='INTERPOLATED';s.child_percent=6;s.rendered_child_count=28
        s.root_radius=.00023;s.tip_radius=.000025;s.radius_scale=1
        s.clump_factor=.10;s.roughness_1=.007;s.roughness_1_size=.18;s.roughness_2=.004
    parts.append(o)
    return o
body=ellipsoid('Torso',(0,.035,.108),(.11,.185,.085),coat,.010)
ellipsoid('Chest',(0,-.100,.106),(.087,.072,.07),white,.009)
for side in [-1,1]:
    ellipsoid('Haunch_'+str(side),(side*.082,.132,.073),(.059,.076,.052),coat,.009)
    ellipsoid('FrontLeg_'+str(side),(side*.049,-.122,.064),(.028,.090,.033),white,.005)
    ellipsoid('FrontPaw_'+str(side),(side*.047,-.213,.039),(.039,.05,.03),white,.004)
# Head layered organic forms. Muzzle stays short; cheeks are full.
head=ellipsoid('Head',(0,-.180,.168),(.096,.076,.085),coat,.008)
ellipsoid('Cheek_L',(-.071,-.205,.131),(.039,.041,.042),white,.010)
ellipsoid('Cheek_R',(.071,-.205,.131),(.039,.041,.042),white,.010)
ellipsoid('Muzzle_L',(-.023,-.251,.126),(.033,.023,.025),white,.003)
ellipsoid('Muzzle_R',(.023,-.251,.126),(.033,.023,.025),white,.003)
ellipsoid('Chin',(0,-.247,.108),(.035,.022,.015),white,.003)
ellipsoid('Blaze',(0,-.242,.177),(.025,.015,.050),white,.003)
# Rounded triangular ears, with inset skin.
def ear(name,side,inner=False):
    if inner:
        verts=[(side*.041,-.196,.220),(side*.086,-.171,.220),(side*.084,-.160,.280)]
    else:
        verts=[(side*.032,-.193,.206),(side*.101,-.173,.202),(side*.087,-.154,.291),(side*.070,-.136,.230)]
    faces=[(0,1,2)] if inner else [(0,1,2),(0,3,1),(1,3,2),(2,3,0)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new('LX_'+name,mesh);col.objects.link(obj);obj.data.materials.append(rose if inner else coat)
    solid=obj.modifiers.new('Soft thickness','SOLIDIFY');solid.thickness=.0015 if inner else .003
    bevel=obj.modifiers.new('Rounded edge','BEVEL');bevel.width=.004;bevel.segments=4
    for f in mesh.polygons:f.use_smooth=True
    parts.append(obj)
for side in [-1,1]:
    ear('Ear_'+str(side),side);ear('InnerEar_'+str(side),side,True)
    ellipsoid('EyeRim_'+str(side),(side*.046,-.249,.180),(.030,.016,.031),lid)
    ellipsoid('Iris_'+str(side),(side*.046,-.261,.180),(.027,.008,.028),iris)
    ellipsoid('Pupil_'+str(side),(side*.046,-.268,.181),(.019,.006,.023),dark)
    # Clear coat makes reflections follow actual lights, rather than painted highlights.
    for material in [iris,dark]:
        p=material.node_tree.nodes.get('Principled BSDF');p.inputs['Coat Weight'].default_value=.9;p.inputs['Coat Roughness'].default_value=.04
# Triangular pink nose.
mesh=bpy.data.meshes.new('NoseMesh');mesh.from_pydata([(-.011,-.277,.141),(.011,-.277,.141),(0,-.282,.130),(0,-.268,.140)],[],[(0,1,2),(0,3,1),(1,3,2),(2,3,0)]);mesh.update()
obj=bpy.data.objects.new('LX_Nose',mesh);col.objects.link(obj);obj.data.materials.append(rose)
b=obj.modifiers.new('Round nose','BEVEL');b.width=.003;b.segments=3
parts.append(obj)

def curve(name,points,radius,material):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=3
    sp=data.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
    for i,(p,co) in enumerate(zip(sp.bezier_points,points)):
        p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO';p.radius=1-i/(len(points)+.5)
    o=bpy.data.objects.new('LX_'+name,data);col.objects.link(o);data.materials.append(material);parts.append(o);return o
curve('Tail',[(.07,.185,.09),(.146,.15,.055),(.166,.025,.04),(.125,-.08,.041),(.09,-.105,.045)],.029,coat)
for side in [-1,1]:
    for i in range(5):
        z=.122+i*.004
        curve('Whisker_'+str(side)+'_'+str(i),[(side*.026,-.270,z),(side*.071,-.279,z+.004),(side*(.118+i*.006),-.277+i*.009,z+(i-2)*.008)],.00024,white)
curve('Mouth_L',[(0,-.279,.130),(0,-.278,.123),(-.012,-.271,.118)],.00065,lid)
curve('Mouth_R',[(0,-.279,.130),(0,-.278,.123),(.012,-.271,.118)],.00065,lid)
# Subtle breath study, additive object scale only; no claim of finished deform rig.
for f,m in [(1,1),(40,1.012),(80,1)]:
    body.scale=(1,m,m);body.keyframe_insert(data_path='scale',frame=f)
scene.frame_start=1;scene.frame_end=80;scene.render.fps=24;scene.frame_set(1)
# Real studio illumination, no photographed cat plane.
def aim(o,t):o.rotation_euler=(Vector(t)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,energy,size,color in [('Key',(-.4,-.55,.7),40,.6,(1,.87,.72)),('Fill',(.4,-.5,.35),20,.5,(.9,.94,1)),('Rim',(.1,.4,.65),45,.4,(1,.9,.77))]:
    d=bpy.data.lights.new('Study_'+name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new('Study_'+name,d);scene.collection.objects.link(o);o.location=loc;aim(o,(0,-.1,.13))
d=bpy.data.cameras.new('Study_Camera');d.type='ORTHO';d.ortho_scale=.52
cam=bpy.data.objects.new('Study_Camera',d);scene.collection.objects.link(cam);cam.location=(.32,-.85,.33);aim(cam,(0,-.05,.14));scene.camera=cam
scene.render.filepath=str(ROOT/'assets/characters/lingxi/reference/anatomy-study-render.png')
text=bpy.data.texts.new('WIP_README');text.write('Production-in-progress anatomy / fur study. Primitive-based component meshes, not finished deformation topology. Hair is a Blender groom study and not a runtime GLB claim. Compare against original identity; next steps: sculpt eye sockets and ear roots, unify anatomy, correct blaze and tabby masks, retopologize, rig, modern curves groom and runtime cards.')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/characters/lingxi/source/lingxi-anatomy-study.blend'))
result={'file':bpy.data.filepath,'scene':scene.name,'mesh_count':len([o for o in scene.objects if o.type=='MESH']),'hair_systems':sum(len(o.particle_systems) for o in parts),'stage':scene['stage']}
