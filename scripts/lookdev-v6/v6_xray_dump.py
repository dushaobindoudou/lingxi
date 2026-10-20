# Skeleton x-ray, part 1 (round X): run in Blender on a built rig.
"""Dump, per frame, the deformed bald skin (body, head, tail) with each vertex's dominant bone, and the posed bones.
env FRAMES='36,85,...' OUT=xray.npz"""
import bpy, os, numpy as np
sc=bpy.context.scene;rig=bpy.data.objects['LX_Rig'];frames=[int(f) for f in os.environ['FRAMES'].split(',')]
objs=[bpy.data.objects[n] for n in ('LX_Body','LX_Head','LX_Tail')]
dom={}
for o in objs:
 gn={g.index:g.name for g in o.vertex_groups};d=[]
 for v in o.data.vertices:
  best=max(v.groups,key=lambda g:g.weight,default=None);d.append(gn[best.group] if best else '-')
 dom[o.name]=d
names=sorted({n for d in dom.values() for n in d});out={'names':np.array(names),'bones':np.array([b.name for b in rig.data.bones])}
for o in objs:out['dom_'+o.name]=np.array([names.index(n) for n in dom[o.name]],dtype=np.int16)
for fr in frames:
 sc.frame_set(fr);dg=bpy.context.evaluated_depsgraph_get()
 for o in objs:
  e=o.evaluated_get(dg);me=e.to_mesh();co=np.empty(len(me.vertices)*3,'f');me.vertices.foreach_get('co',co);co=co.reshape(-1,3)
  M=np.array(e.matrix_world);co=co@M[:3,:3].T+M[:3,3];out['co_%s_%d'%(o.name,fr)]=co.astype(np.float32);e.to_mesh_clear()
 out['bn_%d'%fr]=np.array([[*(rig.matrix_world@pb.head),*(rig.matrix_world@pb.tail)] for pb in rig.pose.bones],dtype=np.float32)
np.savez_compressed(os.environ['OUT'],**out);print('XRAY done',len(frames))
