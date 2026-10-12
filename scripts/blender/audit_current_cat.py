"""Read-only audit of the saved Blender v5 cat. Never saves the source .blend."""
import bpy, json, sys, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/evidence/blender-cat-audit-2026-10-10'
OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
manifest=json.loads((ROOT/'assets/characters/lingxi/v5/animations.json').read_text())
original_frame=scene.frame_current
# Avoid evaluating dense fur while measuring bare skin and the actual pad meshes.
for o in scene.objects:
    if 'Fur' in o.name:o.hide_viewport=True
def bounds(o):
    ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    if ev.type!='MESH' or not ev.data.vertices:return None
    ps=[ev.matrix_world@v.co for v in ev.data.vertices]
    lo=[min(p[i] for p in ps) for i in range(3)]
    hi=[max(p[i] for p in ps) for i in range(3)]
    return {'min':lo,'max':hi}
report={'source':bpy.data.filepath,'blender':bpy.app.version_string,'original_frame':original_frame,
    'ground':[{'name':o.name,'bounds':bounds(o),'location':list(o.location)}for o in scene.objects if o.type=='MESH' and any(s in o.name.lower()for s in ['ground','floor'])],
    'rig':{'name':rig.name,'matrix_world':[list(r) for r in rig.matrix_world],
    'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'connected':b.use_connect,
        'head':list(b.head_local),'tail':list(b.tail_local),'inherit_scale':b.inherit_scale,
        'constraints':[{'type':c.type,'name':c.name}for c in rig.pose.bones[b.name].constraints]}
        for b in rig.data.bones]},
    'objects':[{'name':o.name,'type':o.type,'hide_render':o.hide_render,'parent':o.parent.name if o.parent else None,
        'modifiers':[{'name':m.name,'type':m.type,'viewport':m.show_viewport,'render':m.show_render,
            'target':getattr(getattr(m,'object',None),'name',None)}for m in o.modifiers],
        'vertices':len(o.data.vertices) if o.type=='MESH' else None}
        for o in scene.objects if o.name.startswith('LX_') or o.type=='MESH'], 'samples':[]}
for name in ['Idle','LieDown','SideLie','Sleep','Lick','Yawn']:
    clip=next(c for c in manifest if c['name']==name)
    frame=round(clip['start']+(clip['end']-clip['start'])*(.5 if name=='Yawn' else .65))
    scene.frame_set(frame);bpy.context.view_layer.update()
    measured={o.name:bounds(o)for o in scene.objects if o.type=='MESH' and
        (o.name in ['LX_Body','LX_Head','LX_Jaw','LX_MouthCavity','LX_MouthFloor','LX_Tongue'] or
         any(x in o.name for x in ['Pad.','Bean','LX_FrontToe','LX_RearToe']))}
    bones={p.name:{'head_world':list(rig.matrix_world@p.head),'tail_world':list(rig.matrix_world@p.tail),
        'basis_scale':list(p.scale),'basis_rotation':list(p.rotation_euler),
        'segment_length':(rig.matrix_world@p.tail-rig.matrix_world@p.head).length}
        for p in rig.pose.bones if any(t in p.name for t in ['Front','Rear','Scap','Spine','Pelvis','Jaw','Tongue','Head','Root'])}
    report['samples'].append({'clip':name,'frame':frame,'range':[clip['start'],clip['end']],
        'objects':measured,'bones':bones})
    print('SAMPLE',name,frame,flush=True)
(OUT/'inspection.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
print('INSPECTION',str(OUT/'inspection.json'),flush=True)
# Sharp diagnostic: the named lie-down should bring the bare chest closer to the support
# plane than the standing chest. Threshold will be refined from inspected coordinates.
stand=report['samples'][0]['objects']['LX_Body']
lie=report['samples'][1]['objects']['LX_Body']
checks=[('lie-down body underside below standing underside',lie['min'][2]<stand['min'][2]-.01),
        ('lie-down limb scales remain one',all(abs(v-1)<1e-4 for p in report['samples'][1]['bones'].values() for v in p['basis_scale'])),
        ('lie-down bare skin does not penetrate support plane',lie['min'][2]>=-.002),
        ('side-lying bare skin does not penetrate support plane',report['samples'][2]['objects']['LX_Body']['min'][2]>=-.002)]
for name,ok in checks:print(('PASS' if ok else 'FAIL'),name,flush=True)
if not all(ok for _,ok in checks):sys.exit(2)
