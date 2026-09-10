"""Create a nondestructive character design studio through official Blender MCP.
This is a reference/production setup, explicitly not a finished 3D cat.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes.new('Lingxi • Character Studio v1')
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 1200
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene['stage'] = 'Reference studio — not a completed cat model'
scene['identity'] = 'Warm grey-brown tabby, white blaze and paws, olive-hazel eyes, pink nose; source hero remains authority'
scene['rig_contract'] = 'lingxi-cat-v1'
scene['target_body_length_m'] = 0.30
scene['scale_note'] = 'Working scale only, not measured from AI sheet'

collections = {}
for name in ['01_REFERENCE', '02_BODY_MODEL_PENDING', '03_GROOM_PENDING', '04_RIG_PENDING', '05_LIGHTS', '06_CAMERAS', '07_MATERIAL_STUDIES']:
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    collections[name] = col

def image_reference(name, path, location, size):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.pack()
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'IMAGE'
    obj.data = image
    obj.empty_display_size = size
    obj.location = location
    obj.rotation_euler = (math.pi/2, 0, 0)
    obj.color[3] = 1
    obj.hide_render = True
    collections['01_REFERENCE'].objects.link(obj)
    return obj

image_reference('REF • character viewpoints • generated candidate', ROOT/'assets/characters/lingxi/reference/turnaround-v1.png', (0, 0.24, 0.24), 0.8)
image_reference('REF • original hero board • identity authority', ROOT/'docs/source/peipei-concept-board.png', (-0.85,0.24,0.24),0.8)
image_reference('REF • app icon v2 • framing only', ROOT/'assets/brand/lingxi-icon-v2.png',(0.85,0.24,0.24),0.65)

world = bpy.data.worlds.new('Lingxi soft studio environment')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8,0.76,0.7,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .25
scene.world = world

def aim(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,location,energy,size,color in [('Key',(-.6,-.5,.8),45,.65,(1,.88,.72)),('Fill',(.6,-.25,.45),20,.8,(.86,.91,1)),('Rim',(.1,.6,.65),35,.5,(1,.92,.8))]:
    data=bpy.data.lights.new('LGT_'+name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new('LGT_'+name,data);obj.location=location;aim(obj,(0,0,.14));collections['05_LIGHTS'].objects.link(obj)
for name,location,target in [('front',(0,-1.2,.22),(0,0,.22)),('side',(.95,0,.22),(0,0,.22)),('back',(0,1.2,.22),(0,0,.22)),('hero',(.45,-.8,.38),(0,0,.18))]:
    data=bpy.data.cameras.new('CAM_'+name);data.type='ORTHO';data.ortho_scale=.6
    obj=bpy.data.objects.new('CAM_'+name,data);obj.location=location;aim(obj,target);collections['06_CAMERAS'].objects.link(obj)
    if name=='hero': scene.camera=obj

for name,color,roughness in [('Fur_WarmWhite',(0.89,.82,.71,1),.65),('Fur_TabbedTaupe',(.27,.22,.17,1),.7),('Nose_Rose',(.64,.29,.25,1),.3),('Iris_OliveHazel',(.28,.27,.11,1),.25)]:
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=color;bsdf.inputs['Roughness'].default_value=roughness
    mat.use_fake_user=True
cornea=bpy.data.materials.new('Eye_Cornea');cornea.use_nodes=True;cornea.use_fake_user=True
shader=cornea.node_tree.nodes.get('Principled BSDF');shader.inputs['Transmission Weight'].default_value=1;shader.inputs['Roughness'].default_value=.03;shader.inputs['IOR'].default_value=1.38

brief=bpy.data.texts.new('START_HERE • 灵犀设计约束')
brief.write('灵犀角色设计工作场景\n\n当前阶段：参考图、相机、材质基线和资产分层；尚无成品角色网格、毛发、绑定或动作。\n原始主图是身份依据；AI多视图存在比例差异，不能直接当作精确正交测量图。\n按原图灰棕虎斑+暖白、圆脸、湿润眼睛、小粉鼻、并拢前爪和安静趴姿制作。\n先校正前/侧/背比例，再雕刻、重拓扑、绑定，最后做分层Groom与运行时毛发。\n禁止以图片平面冒充真实3D角色。\nSkinManifest与PersonalityManifest分离；毛色不改变性格。\n')
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=1.9
        area.spaces.active.region_3d.view_location=(0,0.2,0.25)
        area.spaces.active.region_3d.view_rotation=(math.cos(math.pi/4),math.sin(math.pi/4),0,0)
        area.spaces.active.region_3d.view_perspective='ORTHO'
        area.spaces.active.overlay.show_floor=False
        area.spaces.active.overlay.show_axis_x=False
        area.spaces.active.overlay.show_axis_y=False
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/characters/lingxi/source/lingxi-reference-studio.blend'))
result={'scene':scene.name,'objects':len(scene.objects),'references_packed':True,'stage':scene['stage'],'file':bpy.data.filepath}
