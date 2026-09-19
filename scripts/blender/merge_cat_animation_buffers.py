"""Reuse verified animation samples by node name; geometry/skin rest rig is unchanged."""
from pathlib import Path
import json,struct,copy,math
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6'
def read(path):
 b=path.read_bytes();assert b[:4]==b'glTF';n=struct.unpack_from('<I',b,12)[0];doc=json.loads(b[20:20+n]);off=20+n;size=struct.unpack_from('<I',b,off)[0];return doc,bytearray(b[off+8:off+8+size])
def write(path,doc,data):
 data+=b'\0'*((-len(data))%4);doc['buffers']=[{'byteLength':len(data)}];j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(data))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(data),b'BIN\0')+data)
old,olddata=read(OUT/'lingxi-v6-before-soft2.glb');reports=[]
assert len(old['animations'])==43
for source,dest in [('soft2-static.glb','lingxi-v6.glb'),('soft2-static-lite.glb','lingxi-v6-lite.glb')]:
 new,data=read(OUT/source);names={n['name']:i for i,n in enumerate(new['nodes']) if 'name' in n};accessors={};views={}
 # Ensure copying samples will target the exact same joint hierarchy and bind matrices.
 oldskin=old['skins'][0];newskin=new['skins'][0]
 assert [old['nodes'][i]['name'] for i in oldskin['joints']]==[new['nodes'][i]['name'] for i in newskin['joints']]
 def raw(d,b,idx):
  a=d['accessors'][idx];v=d['bufferViews'][a['bufferView']];off=v.get('byteOffset',0)+a.get('byteOffset',0);return b[off:off+a['count']*64]
 assert raw(old,olddata,oldskin['inverseBindMatrices'])==raw(new,data,newskin['inverseBindMatrices']), 'Bind pose changed: resampling is required'
 def accessor(idx,scale=False):
  key=(idx,scale)
  if key in accessors:return accessors[key]
  a=copy.deepcopy(old['accessors'][idx]);assert 'sparse' not in a
  v=copy.deepcopy(old['bufferViews'][a['bufferView']]);vi=(a['bufferView'],scale)
  if vi not in views:
   chunk=bytearray(olddata[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])
   if scale:
    assert a['componentType']==5126 and a['type']=='VEC3';offset=a.get('byteOffset',0);stride=v.get('byteStride',12)
    for i in range(a['count']):
     vals=struct.unpack_from('<3f',chunk,offset+i*stride);struct.pack_into('<3f',chunk,offset+i*stride,*[x*1.10 for x in vals])
   data.extend(b'\0'*((-len(data))%4));v['buffer']=0;v['byteOffset']=len(data);data.extend(chunk);views[vi]=len(new['bufferViews']);new['bufferViews'].append(v)
  a['bufferView']=views[vi]
  if scale:
   for field in ['min','max']:
    if field in a:a[field]=[x*1.10 for x in a[field]]
  accessors[key]=len(new['accessors']);new['accessors'].append(a);return accessors[key]
 animations=[]
 for orig in old['animations']:
  a=copy.deepcopy(orig);headsamplers=set()
  for c in a['channels']:
   name=old['nodes'][c['target']['node']]['name'];assert name in names
   if name=='j_head_08' and c['target']['path']=='scale':headsamplers.add(c['sampler'])
   c['target']['node']=names[name]
  for i,s in enumerate(a['samplers']):s['input']=accessor(s['input']);s['output']=accessor(s['output'],i in headsamplers)
  animations.append(a)
 new['animations']=animations;new.setdefault('extras',{})['lingxiRevision']='soft2, verified samples retained; head scale 1.10'
 write(OUT/dest,new,data)
 attrs=[p['attributes'] for m in new['meshes'] for p in m['primitives'] if '_FUR_ROOT' in p['attributes']]
 if source=='soft2-static.glb':assert attrs and all('_FUR_FLEX' in p for p in attrs)
 reports.append({'file':dest,'animations':len(animations),'bytes':(OUT/dest).stat().st_size,'sameBindMatrices':True,'furAttributePrimitives':len(attrs),'headScale':1.10})
(OUT/'soft2-export-verification.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports,indent=2))
