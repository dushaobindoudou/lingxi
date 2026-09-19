"""Second appearance pass. Start from a preserved first-pass master; keep all 43 actions."""
import bpy,math,shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6'
backup=OUT/'lingxi-v6-before-soft2.blend'
if not backup.exists():shutil.copy2(OUT/'lingxi-v6.blend',backup)
bpy.ops.wm.open_mainfile(filepath=str(backup));s=bpy.context.scene;rig=bpy.data.objects['Lingxi_Rig_v6']
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis.identity()
bpy.context.view_layer.update()
def soften(p):
 x,y,z=p;d=Vector((0,0,0))
 # Fuller cheeks below the eyes, less tall and sharp pinnae. Leave joints/feet intact.
 cheek=math.exp(-((x-11.0)/1.7)**4-((z-12.9)/1.1)**4)
 d.y=(1 if y>0 else -1)*.23*cheek*min(1,abs(y)/1.5)
 if x>7 and z>15.6:
  d.z=-.23*(z-15.6);d.y-=y*.035*min(1,(z-15.6)/2)
 # Open the tense narrow upper eye aperture slightly without moving eyelid pivots.
 for side in [-1,1]:
  e=Vector((11.45,side*1.8,14.0));r=((p-e)/1.2).length
  if z>14.0 and r<1.5:d.z+=.16*math.exp(-r*r*2)
 return p+d
for name in ['Lingxi_Coat','Lingxi_ShortFur']:
 o=bpy.data.objects[name];inv=o.matrix_world.inverted()
 if o.data.shape_keys:
  for key in o.data.shape_keys.key_blocks:
   for v in key.data:v.co=inv@soften(o.matrix_world@v.co)
 else:
  for v in o.data.vertices:v.co=inv@soften(o.matrix_world@v.co)
new=bpy.data.images.load(str(OUT/'textures/coat-soft-repaint.png'));new.name='LX_Own_Cream_ShortFur_Repaint';new.pack()
for name in ['LX_v6_UV_Coat','LX_v6_PinkTissue','LX_v6_Teeth']:
 m=bpy.data.materials.get(name)
 if not m:continue
 n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');old=p.inputs['Base Color'].links[0].from_socket
 tex=n.new('ShaderNodeTexImage');tex.image=new;tex.interpolation='Linear'
 # AI atlas edge drift must not introduce black seams: retain source UV padding there.
 lum=n.new('ShaderNodeRGBToBW');l.new(tex.outputs['Color'],lum.inputs[0]);valid=n.new('ShaderNodeMath');valid.operation='GREATER_THAN';valid.inputs[1].default_value=.035;l.new(lum.outputs[0],valid.inputs[0])
 mix=n.new('ShaderNodeMixRGB');l.new(valid.outputs[0],mix.inputs[0]);l.new(old,mix.inputs[1]);l.new(tex.outputs['Color'],mix.inputs[2]);l.new(mix.outputs[0],p.inputs['Base Color'])
 p.inputs['Roughness'].default_value=.91;p.inputs['Sheen Weight'].default_value=.22
 for node in n:
  if node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=.12
# Bake the repaint into the same UV atlas, including seam padding and original nose/pad placement.
body=bpy.data.objects['Lingxi_Coat'];s.render.engine='CYCLES';s.cycles.samples=1
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
for m in body.modifiers:m.show_render=False;m.show_viewport=False
baked=bpy.data.images.new('LX_Soft2_CoatUV',width=4096,height=4096,alpha=False)
for mat in body.data.materials:
 t=mat.node_tree.nodes.new('ShaderNodeTexImage');t.image=baked;mat.node_tree.nodes.active=t
s.render.bake.use_pass_direct=False;s.render.bake.use_pass_indirect=False;s.render.bake.use_pass_color=True;s.render.bake.margin=20
bpy.ops.object.bake(type='DIFFUSE');baked.filepath_raw=str(OUT/'coat-soft2-basecolor.png');baked.file_format='PNG';baked.save();baked.pack()
for mat in body.data.materials:
 p=mat.node_tree.nodes.get('Principled BSDF');t=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==baked);mat.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
for m in body.modifiers:m.show_render=True;m.show_viewport=True
# Correct iris projection in the sculpted mesh coordinates; larger dark pupil, softer gaze.
eyes=bpy.data.objects['Lingxi_Eyes'];uv=eyes.data.uv_layers.active.data
for loop in eyes.data.loops:
 p=eyes.matrix_world@eyes.data.vertices[loop.vertex_index].co;side=1 if p.y>0 else -1
 d=p-Vector((11.0267,side*1.6839,13.9162));horizontal=-.30*d.x+side*.954*d.y
 uv[loop.index].uv=(.5+horizontal/3.0,.5+d.z/2.8)
mat=eyes.data.materials[0];p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.23;p.inputs['Coat Weight'].default_value=.38
# Render eye-level portraits to assess actual geometry and material, not concept art.
s.cycles.samples=24;s.render.resolution_x=1100;s.render.resolution_y=850;s.render.resolution_percentage=100
cam=s.camera;cam.location=(35,-36,21);cam.rotation_euler=(Vector((0,0,7.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=36
for id in ['rest_loop','sit_idle','stand_idle']:
 a=bpy.data.actions[id];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];s.frame_set(1);s.render.filepath=str(OUT/(id+'-soft2.png'));bpy.ops.render.render(write_still=True)
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis.identity()
for i in bpy.data.images:
 if i.has_data and i.type!='RENDER_RESULT':i.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6.blend'))
print('SOFT2_DONE')
