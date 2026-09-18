"""Build an appendable material library from generated texture sources.
No existing cat mesh, UV layout or skinning weights are changed.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/characters/lingxi/materials/short-fur-v1'
images={}
for key,name in [('fur','fur-basecolor-source.png'),('iris','iris-basecolor-source.png'),('pink','pink-tissue-basecolor-source.png')]:
    im=bpy.data.images.load(str(OUT/'textures'/name),check_existing=False)
    im.colorspace_settings.name='sRGB';im.pack();images[key]=im

materials={}
def make(key,color,roughness,texture=None,texture_mix=1,subsurface=0):
    m=bpy.data.materials.new('LX_ShortFur_'+key);m.use_nodes=True
    m.use_fake_user=True;m.asset_mark()
    m.asset_data.description='Short-fur look-development material. UV mapping and final character validation required.'
    nt=m.node_tree;p=nt.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness
    p.inputs['Subsurface Weight'].default_value=subsurface
    p.inputs['Subsurface Radius'].default_value=(.9,.45,.25)
    p.inputs['Subsurface Scale'].default_value=.0008
    if texture:
        uv=nt.nodes.new('ShaderNodeTexCoord');uv.location=(-700,100)
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=images[texture];tex.location=(-500,100)
        tex.extension='REPEAT' if texture!='iris' else 'EXTEND'
        nt.links.new(uv.outputs['UV'],tex.inputs['Vector'])
        mix=nt.nodes.new('ShaderNodeMixRGB');mix.inputs[0].default_value=texture_mix
        mix.inputs[1].default_value=(*color,1);mix.location=(-230,100)
        nt.links.new(tex.outputs['Color'],mix.inputs[2]);nt.links.new(mix.outputs[0],p.inputs['Base Color'])
    materials[key]=m
    return m,p

fur,p=make('CoatBase',(.42,.34,.26),.8,'fur',.65)
p.inputs['Sheen Weight'].default_value=.18
white,p=make('WhiteDownBase',(.82,.77,.69),.84)
p.inputs['Sheen Weight'].default_value=.20
pads,p=make('PinkPawPads',(.65,.32,.30),.50,'pink',.30,.12)
nose,p=make('PinkNose',(.56,.24,.23),.36,'pink',.22,.10)
mouth,p=make('PinkMouth',(.46,.14,.17),.40,'pink',.12,.16)
iris,p=make('HazelIris',(.16,.13,.05),.42,'iris')
cornea,p=make('ClearCornea',(1,1,1),.035)
p.inputs['Transmission Weight'].default_value=1;p.inputs['IOR'].default_value=1.376
hair=bpy.data.materials.new('LX_ShortFur_Strand');hair.use_nodes=True;hair.use_fake_user=True;hair.asset_mark()
nt=hair.node_tree;nt.nodes.clear();out=nt.nodes.new('ShaderNodeOutputMaterial');h=nt.nodes.new('ShaderNodeBsdfHairPrincipled')
h.parametrization='COLOR';h.inputs['Color'].default_value=(.45,.36,.28,1);h.inputs['Roughness'].default_value=.38
nt.links.new(h.outputs[0],out.inputs['Surface']);materials['Strand']=hair

# Save only the new materials and packed dependencies, not the older cat scenes.
bpy.data.libraries.write(str(OUT/'lingxi-short-fur-materials.blend'),set(materials.values()),fake_user=True,compress=True)

scene=bpy.data.scenes.new('Lingxi Short Fur Material Samples');bpy.context.window.scene=scene
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.world=bpy.data.worlds.new('LX_SwatchWorld');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.69,.64,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45

def sphere(name,loc,scale,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=40,location=loc)
    o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(material)
    for poly in o.data.polygons:poly.use_smooth=True
    return o

sphere('Coat Base — flat surface material',(-.18,0,.16),(.065,.065,.065),fur)
sphere('White Down Base',(0,0,.16),(.065,.065,.065),white)
sphere('Paw Pad',(.18,0,.16),(.065,.028,.06),pads)
sphere('Nose tissue sample',(-.18,0,-.015),(.048,.030,.045),nose)
sphere('Mouth tissue sample',(0,0,-.015),(.048,.030,.045),mouth)
# Front-facing UV disk: the iris image is not stretched around an entire sphere.
verts=[(0,0,0)]+[(math.cos(i*2*math.pi/96)*.062,0,math.sin(i*2*math.pi/96)*.062) for i in range(96)]
faces=[(0,i+1,(i+1)%96+1) for i in range(96)]
mesh=bpy.data.meshes.new('IrisDisk');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Iris — cornea added separately in final eye',mesh);scene.collection.objects.link(obj);obj.location=(.18,0,-.015);mesh.materials.append(iris)
uv=mesh.uv_layers.new(name='UVMap')
for poly in mesh.polygons:
    for loop in poly.loop_indices:
        v=mesh.vertices[mesh.loops[loop].vertex_index].co
        uv.data[loop].uv=(.5+v.x/.124,.5+v.z/.124)

def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size in [('Key',(-.3,-.5,.6),18,.6),('Fill',(.4,-.3,.2),8,.5)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;aim(o,(0,0,.07))
camdata=bpy.data.cameras.new('Samples');camdata.type='ORTHO';camdata.ortho_scale=.57
cam=bpy.data.objects.new('Samples',camdata);scene.collection.objects.link(cam);cam.location=(0,-.9,.14);aim(cam,(0,0,.07));scene.camera=cam
scene.render.filepath=str(OUT/'material-samples.png')
bpy.ops.render.render(write_still=True)
result={'library':str(OUT/'lingxi-short-fur-materials.blend'),'preview':str(OUT/'material-samples.png'),'materials':list(materials),'packed_images':len(images),'status':'Look-development library; no UV-fitted character skin or bone weights'}
(OUT/'library-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
