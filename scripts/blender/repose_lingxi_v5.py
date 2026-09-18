import bpy,math,json,ast
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';scene=bpy.context.scene;rig=bpy.data.objects['LX_Rig'];body=bpy.data.objects['LX_Body'];furs=[bpy.data.objects[n] for n in ['LX_Fur_LX_Body','LX_Fur_LX_Head','LX_Fur_LX_Tail','LX_Fur_LX_Jaw']];eyelids=[o for o in scene.objects if o.name.startswith('LX_Lid')];claws=[o for o in scene.objects if 'Claw' in o.name];pupils=[o for o in scene.objects if o.name.startswith('LX_Pupil.')]
for data in [rig]+[o.data.shape_keys for o in eyelids+claws+pupils+[body,furs[0]]]:data.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
scene.timeline_markers.clear()
# Reuse the final expression/clip configuration, without recreating any geometry.
for node in ast.parse((ROOT/'scripts/blender/finalize_lingxi_v5.py').read_text()).body:
 if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['src','code'] for t in node.targets):exec(compile(ast.Module(body=[node],type_ignores=[]),'config','exec'))
a=code.index(" if name in ['LieDown'");b=code.index(" if name=='Curious'",a)
code=code[:a]+''' if name in ['LieDown','SideLie','Sleep','Stretch']:
  f=min(1,u*3) if name=='LieDown' else 1
  pb['Root'].location.y=-.165*f
  for suf in ['L','R']:
   for pre in ['Front','Rear']:
    pb[pre+'Upper.'+suf].scale.y=1-.62*f
    pb[pre+'Lower.'+suf].scale.y=1-.62*f
  pb['Tail0'].rotation_euler[0]=-.35*f
  if name=='SideLie':
   f=min(1,u*3);pb['Root'].rotation_euler[2]=1.47*f;pb['Root'].location.x=.33*f;pb['Root'].location.y=.13*f
  if name=='Sleep':blink=1;pb['Head'].rotation_euler[0]=.10
  if name=='Stretch':pb['Head'].rotation_euler[0]=-.12*math.sin(math.pi*u)
''' +code[b:]
code=code.replace("p.keyframe_insert('rotation_euler',frame=f)","p.keyframe_insert('rotation_euler',frame=f);p.keyframe_insert('scale',frame=f)").replace("p.keyframe_insert('rotation_euler',frame=duration)","p.keyframe_insert('rotation_euler',frame=duration);p.keyframe_insert('scale',frame=duration)")
for b in rig.data.bones:
 if any(x in b.name for x in ['Lower.','Paw.','Toe']):b.inherit_scale='NONE'
exec(code)
(OUT/'animations.json').write_text(json.dumps(manifest,indent=2));scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True)
result={'resting_poses':'limb-fold approximation with segment shortening; anatomical retopology still needed'}
