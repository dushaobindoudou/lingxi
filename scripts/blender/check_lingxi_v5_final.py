import bpy,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';s=bpy.context.scene;rig=bpy.data.objects['LX_Rig'];clips=json.loads((OUT/'animations.json').read_text())
report={'bones':len(rig.data.bones),'clips':len(clips),'actions':len(bpy.data.actions),'packed_images':sum(bool(i.packed_file) for i in bpy.data.images),'checks':[],'visual_status':'NOT_APPROVED: does not yet match the approved photographic kitten reference'}
for c in clips:
 s.frame_set(c['start']+int((c['end']-c['start'])*.35));deps=bpy.context.evaluated_depsgraph_get();err=0
 for o in [o for o in s.objects if o.name.startswith('LX_RenderFur_')]:
  src=bpy.data.objects[o['deformation_source']];a=src.evaluated_get(deps).data;b=o.evaluated_get(deps).data
  ap=np.empty(len(a.vertices)*3,dtype='f');a.vertices.foreach_get('co',ap);bp=np.empty(len(b.points)*3,dtype='f');b.attributes['position'].data.foreach_get('vector',bp)
  assert len(ap)==len(bp);e=float(np.max(np.abs(ap-bp)));err=max(err,e)
 assert err<1e-5,(c['name'],err)
 body=bpy.data.objects['LX_Body'].evaluated_get(deps);minz=min(v.co.z for v in body.data.vertices)
 report['checks'].append({'clip':c['name'],'curve_follow_max_error':err,'body_min_z':float(minz)})
assert len(clips)==18
assert all(any(t.name==c['name'] for t in rig.animation_data.nla_tracks) for c in clips)
report['shape_keys']={o.name:[k.name for k in o.data.shape_keys.key_blocks] for o in s.objects if o.type=='MESH' and o.data.shape_keys}
report['native_hair_strands']=sum(len(o.data.curves) for o in s.objects if o.type=='CURVES')
(OUT/'final-verification.json').write_text(json.dumps(report,indent=2));result={k:v for k,v in report.items() if k not in ['checks','shape_keys']}
