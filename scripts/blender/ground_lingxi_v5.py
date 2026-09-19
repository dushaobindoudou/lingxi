import bpy,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';s=bpy.context.scene;rig=bpy.data.objects['LX_Rig'];clips=json.loads((OUT/'animations.json').read_text())
# Evaluate only contact-bearing meshes. Rendering hair need not be evaluated here.
hidden=[]
for o in s.objects:
 if o.name.startswith(('LX_Fur_','LX_RenderFur_')):hidden.append((o,o.hide_viewport));o.hide_viewport=True
meshes=[o for o in s.objects if o.type=='MESH' and o.name.startswith('LX_') and not o.name.startswith(('LX_Fur_','LX_RenderFur_','LX_Whisker'))]
fixes={}
for c in clips:
 values=[]
 for frame in range(c['start'],c['end']+1):
  s.frame_set(frame);deps=bpy.context.evaluated_depsgraph_get();minz=10
  for o in meshes:
   me=o.evaluated_get(deps).data;co=np.empty(len(me.vertices)*3,dtype='f');me.vertices.foreach_get('co',co)
   if len(co):minz=min(minz,float(co[2::3].min()))
  lift=max(0,.003-minz);values.append((frame-c['start']+1,float(rig.pose.bones['Root'].location.y)+lift))
 fixes[c['name']]=values
for c in clips:
 action=bpy.data.actions['LX_'+c['name']];bag=action.layers[0].strips[0].channelbag(action.slots[0]);fc=next(f for f in bag.fcurves if f.data_path=='pose.bones["Root"].location' and f.array_index==1)
 while len(fc.keyframe_points):fc.keyframe_points.remove(fc.keyframe_points[-1],fast=True)
 vals=fixes[c['name']];fc.keyframe_points.add(len(vals));fc.keyframe_points.foreach_set('co',np.array(vals,dtype='f').ravel())
 for p in fc.keyframe_points:p.interpolation='LINEAR'
 fc.update()
for o,old in hidden:o.hide_viewport=old
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True)
result={'corrected_clips':len(fixes),'method':'per-frame floor clearance; no IK stance lock'}
(OUT/'ground-correction.json').write_text(json.dumps(result,indent=2))
