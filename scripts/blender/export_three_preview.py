"""Export the actual v3 scene to a small Three.js preview bundle.
Meshes preserve native geometry; hair curves are sampled for real-time display.
Procedural Blender colors are approximated, not claimed to be Cycles-equivalent.
"""
import bpy, json
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
dest=ROOT/'previews/threejs/dist/assets'
dest.mkdir(parents=True, exist_ok=True)
scene=bpy.context.scene
assert scene.get('stage','').startswith('Unapproved combed-hair'), scene.name
chunks=[]
offset=0
records=[]
hair_count=0

def write_array(a):
    global offset
    a=np.asarray(a,dtype='<f4').reshape(-1)
    info={'offset':offset,'count':len(a)//3}
    data=a.tobytes();chunks.append(data);offset+=len(data)
    return info

def part(name):
    if 'Groom_' in name:
        name=name.split('Groom_',1)[1]
    if 'Tail' in name:return 'tail'
    if any(s in name for s in ['Iris','Pupil','Eyelid']):
        return 'eyeLeft' if '-1' in name else 'eyeRight'
    if any(s in name for s in ['Head','Ear','Nose','Mouth','Whisker']):return 'head'
    if 'Front' in name:return 'feet'
    return 'body'

def colors(o, local, material):
    name=material.name if material else ''
    count=len(local)
    cream=np.array([.68,.57,.43])
    if any(k in name for k in ['Face','Coat','Tabby']):
        bounds=np.array(o.bound_box)
        normalized=(local-bounds.min(0))/np.maximum(bounds.max(0)-bounds.min(0),1e-5)
        axis=0 if 'Face' in name else 1
        phase=normalized[:,axis]*34+np.sin(normalized[:,2]*15+normalized[:,1]*9)*1.1
        fac=np.clip((np.sin(phase)+.35)*1.25,0,1)
        col=np.array([.055,.031,.020])[None,:]*(1-fac[:,None])+np.array([.30,.20,.125])[None,:]*fac[:,None]
        if 'Face' in name:
            z=local[:,2]+.168;y=local[:,1]-.180
            white=((np.abs(local[:,0]) < (.229-z)*.54)|(z<.152))&(y<-.189)
            col[white]=cream
        return col
    if 'White' in name or 'Cream' in name:return np.tile(cream,(count,1))
    if 'Iris' in name:return np.tile([.16,.115,.039],(count,1))
    if 'Pupil' in name:return np.tile([.008,.009,.006],(count,1))
    if 'Lid' in name or 'Eyelid' in name:return np.tile([.065,.035,.02],(count,1))
    if 'Rose' in name:return np.tile([.56,.23,.19],(count,1))
    return np.tile([.68,.57,.43],(count,1))

def world(o, points, normals=False):
    m=np.array(o.matrix_world)
    if normals:
        result=points@np.linalg.inv(m[:3,:3])
        result/=np.maximum(np.linalg.norm(result,axis=1)[:,None],1e-8)
    else:result=points@m[:3,:3].T+m[:3,3]
    return result[:,[0,2,1]]*np.array([1,1,-1])

deps=bpy.context.evaluated_depsgraph_get()
for o in list(scene.objects):
    if not o.name.startswith('LX_') or o.hide_render:continue
    if o.type=='CURVES':
        data=o.data
        points=np.empty(len(data.points)*3,dtype=np.float32)
        data.attributes['position'].data.foreach_get('vector',points)
        points=points.reshape(-1,7,3)
        step=max(1,int(np.ceil(len(points)/12000)))
        roots=points[::step]
        hair_count+=len(roots)
        # Three segments per sampled strand, while preserving the actual combed path.
        local=roots[:,[0,2,2,4,4,6],:].reshape(-1,3)
        source=next((s for s in scene.objects if s.name==o.get('source_surface')),o)
        material=o.data.materials[0]
        col=colors(source,local,material)
        records.append({'name':o.name,'part':part(o.name),'type':'hair','position':write_array(world(o,local)),'color':write_array(col)})
        continue
    if o.type not in ['MESH','CURVE']:continue
    evaluated=o.evaluated_get(deps)
    mesh=evaluated.to_mesh()
    mesh.calc_loop_triangles()
    v=np.empty(len(mesh.vertices)*3,dtype=np.float32);mesh.vertices.foreach_get('co',v);v=v.reshape(-1,3)
    n=np.empty_like(v);mesh.vertices.foreach_get('normal',n.ravel())
    tri=np.empty(len(mesh.loop_triangles)*3,dtype=np.int32);mesh.loop_triangles.foreach_get('vertices',tri);tri=tri.reshape(-1,3)
    mats=np.empty(len(mesh.loop_triangles),dtype=np.int32);mesh.loop_triangles.foreach_get('material_index',mats)
    for mi in np.unique(mats):
        ids=tri[mats==mi].reshape(-1)
        material=mesh.materials[mi] if mi<len(mesh.materials) else None
        label=material.name if material else 'default'
        col=colors(o,v[ids],material)
        record={'name':o.name,'part':part(o.name),'type':'mesh','material':label,
                'position':write_array(world(o,v[ids])),'normal':write_array(world(o,n[ids],True)),'color':write_array(col),
                'roughness':.15 if any(x in label for x in ['Iris','Pupil']) else .72}
        # Both lid objects have generic names; determine their side geometrically.
        if 'Eyelid' in o.name:record['part']='eyeLeft' if np.mean(world(o,v)[:,0])<0 else 'eyeRight'
        records.append(record)
    evaluated.to_mesh_clear()

payload=b''.join(chunks)
buffers=[]
for i,start in enumerate(range(0,len(payload),16*1024*1024)):
    name=f'cat-{i}.bin'
    data=payload[start:start+16*1024*1024]
    (dest/name).write_bytes(data)
    buffers.append({'file':name,'bytes':len(data)})
manifest={'version':1,'source':'lingxi-anatomy-study-v3.blend','scene':scene.name,
          'records':records,'byteLength':offset,'buffers':buffers,'hairStrands':hair_count,
          'notes':['Original mesh geometry','Sampled native hair curves','Approximate procedural colors','Procedural motion preview; no production rig']}
(dest/'cat.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
result={'file':str(dest/'cat.json'),'bytes':offset,'records':len(records),'hairStrands':hair_count}
