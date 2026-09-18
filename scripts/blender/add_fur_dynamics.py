"""Store strand-root data for skin-aware GPU fur bending; enlarge head consistently across clips."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'lingxi-v6.blend'));s=bpy.context.scene;rig=bpy.data.objects['Lingxi_Rig_v6'];fur=bpy.data.objects['Lingxi_ShortFur']
# Each generated tapered strand has three pairs of vertices. Exported indices can reorder freely:
# explicit point attributes carry root position and bending weight with each exported vertex.
assert len(fur.data.vertices)%6==0
for name in ['_FUR_ROOT','_FUR_FLEX']:
 if name in fur.data.attributes:fur.data.attributes.remove(fur.data.attributes[name])
roots=fur.data.attributes.new('_FUR_ROOT','FLOAT_VECTOR','POINT');flex=fur.data.attributes.new('_FUR_FLEX','FLOAT','POINT')
r=[];w=[]
for i in range(0,len(fur.data.vertices),6):
 root=(fur.data.vertices[i].co+fur.data.vertices[i+1].co)*.5
 for j in range(6):r.extend(root);w.append((j//2/2)**2)
roots.data.foreach_set('vector',r);flex.data.foreach_set('value',w)
if not rig.get('LX_head_soft2'):
 for action in bpy.data.actions:
  for layer in action.layers:
   for strip in layer.strips:
    for bag in strip.channelbags:
     for curve in bag.fcurves:
      if curve.data_path=='pose.bones["j_head_08"].scale':
       for k in curve.keyframe_points:k.co.y*=1.10;k.handle_left.y*=1.10;k.handle_right.y*=1.10
 rig['LX_head_soft2']=1.10
fur['dynamics']='Skin-space tapered strand bending, root fixed, two low-amplitude waves. Implemented in fur-dynamics.js.'
fur['strand_count']=len(fur.data.vertices)//6
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6.blend'))
(OUT/'fur-dynamics.json').write_text(json.dumps({'strands':len(fur.data.vertices)//6,'attributes':['_FUR_ROOT','_FUR_FLEX'],'rootWeight':0,'tipWeight':1,'headScaleMultiplier':1.10,'implementation':'WebGL vertex displacement before skinning; not physical strand collision simulation'},indent=2))
print('FUR_DYNAMICS_READY',len(fur.data.vertices)//6)
