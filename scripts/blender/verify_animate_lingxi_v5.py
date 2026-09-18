import bpy,math,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';scene=bpy.context.scene;rig=bpy.data.objects['LX_Rig'];body=bpy.data.objects['LX_Body'];furs=[bpy.data.objects[n] for n in ['LX_Fur_LX_Body','LX_Fur_LX_Head','LX_Fur_LX_Tail','LX_Fur_LX_Jaw']];eyelids=[o for o in scene.objects if o.name.startswith('LX_Lid')];claws=[o for o in scene.objects if 'Claw' in o.name]
for data in [rig]+[o.data.shape_keys for o in eyelids+claws+[body,furs[0]]]:data.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
scene.timeline_markers.clear()
src=(ROOT/'scripts/blender/build_lingxi_v5.py').read_text();code=src[src.index("clips=["):src.index('# Studio suitable')];exec(code)
# Inspect real evaluated bone transformations, weighted geometry and deformation of fur roots.
checks={};scene.frame_set(1);deps=bpy.context.evaluated_depsgraph_get()
basehead=np.array(rig.pose.bones['Head'].matrix);basejaw=np.array(rig.pose.bones['Jaw'].matrix)
for c in manifest:
 scene.frame_set(c['start']+(c['end']-c['start'])//2)
 checks[c['name']]={'frame':scene.frame_current,'root_world_z':float(rig.pose.bones['Root'].matrix.translation.z),'jaw_angle_x':float(rig.pose.bones['Jaw'].rotation_euler.x),'body_vertices':len(body.data.vertices)}
# Check armature-only deformation for fur, before curve conversion; no disconnected static groom.
for o in furs:
 assert o.vertex_groups and [m.type for m in o.modifiers][:2]==['ARMATURE','NODES']
 assert all(len(v.groups)>0 for v in o.data.vertices)
assert checks['Jump']['root_world_z']>.25
assert checks['Yawn']['jaw_angle_x']<-.5
checks['structural']={'bones':len(rig.data.bones),'clips':len(manifest),'fur_weighted_vertices':sum(len(o.data.vertices) for o in furs),'packed_images':sum(bool(i.packed_file) for i in bpy.data.images)}
(OUT/'verification.json').write_text(json.dumps(checks,indent=2))
scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True)
result=checks['structural']
