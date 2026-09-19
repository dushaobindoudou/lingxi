import bpy,math,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';scene=bpy.context.scene;rig=bpy.data.objects['LX_Rig'];body=bpy.data.objects['LX_Body'];furs=[bpy.data.objects[n] for n in ['LX_Fur_LX_Body','LX_Fur_LX_Head','LX_Fur_LX_Tail','LX_Fur_LX_Jaw']];eyelids=[o for o in scene.objects if o.name.startswith('LX_Lid')];claws=[o for o in scene.objects if 'Claw' in o.name]
# Separate pupils with adjustable dilation, inside the corneal surface.
pupils=[]
for side,cx in [('L',-.072),('R',.072)]:
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=(cx,-.439,.543));o=bpy.context.object;o.name='LX_Pupil.'+side;o.scale=(.020,.002,.020);bpy.ops.object.transform_apply(location=True,rotation=False,scale=True);o.data.materials.append(bpy.data.materials['LX_Pupil'])
 for p in o.data.polygons:p.use_smooth=True
 g=o.vertex_groups.new(name='Eye.'+side);g.add(list(range(len(o.data.vertices))),1,'REPLACE');m=o.modifiers.new('Pupil follows eye','ARMATURE');m.object=rig;o.shape_key_add(name='Basis');k=o.shape_key_add(name='Dilate')
 for v in k.data:v.co.x=cx+(v.co.x-cx)*1.4;v.co.z=.543+(v.co.z-.543)*1.4
 pupils.append(o)
# Close the relaxed mouth, with lower lip and tongue moving together when jaw opens.
for n in ['LX_Jaw','LX_Fur_LX_Jaw','LX_Tongue']:
 for v in bpy.data.objects[n].data.vertices:v.co.z+=.010
# Regenerate all animation tracks, now checking actual jaw-tip world motion.
for data in [rig]+[o.data.shape_keys for o in eyelids+claws+[body,furs[0]]]:data.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
scene.timeline_markers.clear();src=(ROOT/'scripts/blender/build_lingxi_v5.py').read_text();code=src[src.index('clips=['):src.index('# Studio suitable')]
code=code.replace("('PawPlay',48)]","('PawPlay',48),('Sniff',48),('Alert',48),('SlowBlink',72)]")
code=code.replace("shapeobs=eyelids+claws+[body,furs[0]]","shapeobs=eyelids+claws+pupils+[body,furs[0]]")
code=code.replace("pb['Jaw'].rotation_euler[0]=-1*(.65", "pb['Jaw'].rotation_euler[0]=1*(.85")
code=code.replace("pb['FrontUpper.'+suf].rotation_euler[0]=-.65*f;pb['FrontLower.'+suf].rotation_euler[0]=1.1*f;pb['RearUpper.'+suf].rotation_euler[0]=.7*f;pb['RearLower.'+suf].rotation_euler[0]=-1.0*f", "pb['FrontUpper.'+suf].rotation_euler[0]=-1.2*f;pb['FrontLower.'+suf].rotation_euler[0]=1.5*f;pb['FrontPaw.'+suf].rotation_euler[0]=-.3*f;pb['RearUpper.'+suf].rotation_euler[0]=1.25*f;pb['RearLower.'+suf].rotation_euler[0]=-1.7*f;pb['RearPaw.'+suf].rotation_euler[0]=.45*f")
code=code.replace("pb['Root'].location.y=.035*f", "pb['Root'].location.y=.035*f;pb['Root'].location.x=.36*f")
code=code.replace(" for o in eyelids:o.data.shape_keys.key_blocks['Blink'].value=blink", """ if name=='Sniff':pb['Nose'].location.y=.002*math.sin(phase*4);pb['Head'].rotation_euler[0]=.08*math.sin(phase)
 if name=='Alert':pb['Ear.L'].rotation_euler[0]=-.2;pb['Ear.R'].rotation_euler[0]=-.2
 if name=='SlowBlink':blink=math.sin(math.pi*u)**2
 for o in pupils:o.data.shape_keys.key_blocks['Dilate'].value=.75 if name=='Alert' else .25
 for o in eyelids:o.data.shape_keys.key_blocks['Blink'].value=blink""")
exec(code)
# Update clip manifest to reflect the rebuilt timeline.
(OUT/'animations.json').write_text(json.dumps(manifest,indent=2))
scene.frame_set(1);deps=bpy.context.evaluated_depsgraph_get();jaw=bpy.data.objects['LX_Jaw'];base=np.mean([v.co[:] for v in jaw.evaluated_get(deps).data.vertices],axis=0)
yc=next(c for c in manifest if c['name']=='Yawn');scene.frame_set((yc['start']+yc['end'])//2);opened=np.mean([v.co[:] for v in jaw.evaluated_get(deps).data.vertices],axis=0)
check={'jaw_rest_center':base.tolist(),'jaw_open_center':opened.tolist(),'jaw_downward_delta':float(base[2]-opened[2]),'clips':len(manifest)}
assert check['jaw_downward_delta']>.025,check
(OUT/'jaw-verification.json').write_text(json.dumps(check,indent=2))
scene.frame_set(1);scene.view_settings.exposure=-1.4;scene.camera.data.ortho_scale=1.3
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True);scene.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
result=check
