import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6';bpy.ops.wm.open_mainfile(filepath=str(OUT/'lingxi-v6.blend'))
s=bpy.context.scene;rig=bpy.data.objects['Lingxi_Rig_v6'];body=bpy.data.objects['Lingxi_Coat'];manifest=json.loads((OUT/'animations.json').read_text());report=[]
for info in manifest['clips']:
 a=bpy.data.actions[info['id']];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];ends=[];grounds=[];bounds=[]
 for t in [0,.25,.5,.75,1]:
  s.frame_set(round(1+t*info['duration']*30));bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());pts=[ev.matrix_world@v.co for v in ev.data.vertices];grounds.append(min(p.z for p in pts));bounds.append([[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]])
  if t in [0,1]:ends.append({p.name:p.matrix.copy() for p in rig.pose.bones})
 loop_delta=max((ends[0][n].translation-ends[1][n].translation).length for n in ends[0]);loop_rotation=max(ends[0][n].to_quaternion().rotation_difference(ends[1][n].to_quaternion()).angle for n in ends[0]);report.append({'id':info['id'],'minGround':min(grounds),'maxGround':max(grounds),'loopPositionDelta':loop_delta if info['loop'] else None,'loopAngleDelta':loop_rotation if info['loop'] else None,'bounds':bounds,'hasFiniteGeometry':all(math.isfinite(x) for bb in bounds for p in bb for x in p)})
 info['bounds']=bounds;info['safeExitSeconds']=[info['duration']];info['review']='sampled-in-blender'
# Only explicitly inventoried actions are exported; do not leak the unretargeted source take.
rig.animation_data_clear()
for a in list(bpy.data.actions):
 if a.name not in {i['id'] for i in manifest['clips']}:bpy.data.actions.remove(a)
rig.animation_data_create()
for info in manifest['clips']:
 a=bpy.data.actions[info['id']];track=rig.animation_data.nla_tracks.new();track.name=info['id'];strip=track.strips.new(a.name,1,a);strip.action_slot=a.slots[0];track.mute=True
for p in rig.pose.bones:p.matrix_basis.identity()
bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT')
objects=[rig]+[bpy.data.objects[n] for n in ['Lingxi_Coat','Lingxi_Eyes','Lingxi_ShortFur','Lingxi_FineWhiskers']]
for o in objects:
 if o!=rig:
  world=o.matrix_world.copy();o.parent=rig;o.matrix_world=world
 o.select_set(True)
bpy.context.view_layer.objects.active=rig
kwargs=dict(export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_force_sampling=True,export_frame_range=False,export_skins=True,export_morph=True,export_yup=True,export_apply=False,export_cameras=False,export_lights=False,export_all_influences=False,export_attributes=True)
props=bpy.ops.export_scene.gltf.get_rna_type().properties
kwargs={k:v for k,v in kwargs.items() if k in props}
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'lingxi-v6.glb'),**kwargs)
# A geometry-only lower-cost tier reuses the exact same rig and clip names.
bpy.data.objects['Lingxi_ShortFur'].select_set(False)
bpy.ops.export_scene.gltf(filepath=str(OUT/'lingxi-v6-lite.glb'),**kwargs)
(OUT/'animations.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(OUT/'verification.json').write_text(json.dumps({'clips':report,'images':[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file),'filepath':i.filepath} for i in bpy.data.images if i.type!='RENDER_RESULT'],'runtimeGeometry':'Original smooth-shaded topology; Blender subdivision is not baked into glTF.','limitations':['Five-frame geometric checks are not continuous collision or sliding certification.','Subsurface/groom appearance still below approved reference.']},ensure_ascii=False,indent=2))
print('EXPORT_DONE',len(report))
