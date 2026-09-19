"""Round the actual eyelid aperture, remap calm irises, retain eyelid skin weights."""
import bpy,math,shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6';backup=OUT/'lingxi-v6-before-eyes3.blend'
if not backup.exists():shutil.copy2(OUT/'lingxi-v6.blend',backup)
bpy.ops.wm.open_mainfile(filepath=str(backup));s=bpy.context.scene;rig=bpy.data.objects['Lingxi_Rig_v6'];rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
for p in rig.pose.bones:p.matrix_basis.identity()
for name in ['Lingxi_Coat','Lingxi_ShortFur']:
 o=bpy.data.objects[name];deltas=[]
 for v in o.data.vertices:
  p=v.co;weights={o.vertex_groups[g.group].name:g.weight for g in v.groups};up=sum(w for n,w in weights.items() if 'upper_eyelid' in n);lo=sum(w for n,w in weights.items() if 'lower_eyelid' in n)
  arc=math.exp(-((abs(p.y)-1.70)/.86)**4)
  # More circular opening, especially the upper lid. Keep inner/outer corners anchored.
  dz=(.38*up-.26*lo)*arc
  deltas.append(Vector((0,0,dz)))
 if o.data.shape_keys:
  for key in o.data.shape_keys.key_blocks:
   for v,d in zip(key.data,deltas):v.co+=d
 else:
  for v,d in zip(o.data.vertices,deltas):v.co+=d
 # A corrective eyelid closure offsets the wider aperture during existing blink animation.
 for side,label in [(1,'L'),(-1,'R')]:
  key=o.shape_key_add(name='EyeApertureClose'+label)
  for idx,(v,d) in enumerate(zip(key.data,deltas)):
   if o.data.vertices[idx].co.y*side>0:v.co-=d
  key.value=0
 o['eye_aperture_correction']='Drive EyeApertureClose by blink strength alongside eyelid bones'
eyes=bpy.data.objects['Lingxi_Eyes']
for v in eyes.data.vertices:v.co.z=13.9162+(v.co.z-13.9162)*1.18
uv=eyes.data.uv_layers.active.data
for loop in eyes.data.loops:
 p=eyes.data.vertices[loop.vertex_index].co;side=1 if p.y>0 else -1
 uv[loop.index].uv=(.5+(side*p.y-1.78)/2.5,.5+(p.z-13.96)/2.5)
mat=eyes.data.materials[0];p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.10;p.inputs['Coat Weight'].default_value=1;p.inputs['Coat Roughness'].default_value=.055;p.inputs['IOR'].default_value=1.38
img=bpy.data.images.load(str(OUT/'textures/iris-sage-source.png'));img.pack()
for node in mat.node_tree.nodes:
 if node.type=='TEX_IMAGE':node.image=img
# Subdivision makes small corneal highlights smooth in the realtime export as well.
bpy.context.view_layer.objects.active=eyes;bpy.ops.object.select_all(action='DESELECT');eyes.select_set(True)
sub=eyes.modifiers.new('Smooth eye curvature','SUBSURF');sub.levels=2
for mod in eyes.modifiers:
 if mod.type=='ARMATURE':mod.show_viewport=False
bpy.ops.object.modifier_apply(modifier=sub.name)
for mod in eyes.modifiers:
 if mod.type=='ARMATURE':mod.show_viewport=True
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6.blend'))
print('EYES3_DONE')
