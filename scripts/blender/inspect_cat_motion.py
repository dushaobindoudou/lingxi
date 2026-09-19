import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/model-evaluation'
for name in ['animated','lowpoly','munchkin']:
 bpy.ops.wm.open_mainfile(filepath=str(OUT/(name+'-original.blend')))
 s=bpy.context.scene;meshes=[o for o in s.objects if o.type=='MESH' and o.name!='Icosphere']
 pts=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box];lo=Vector(tuple(min(p[i] for p in pts) for i in range(3)));hi=Vector(tuple(max(p[i] for p in pts) for i in range(3)));center=(lo+hi)/2;span=max(hi-lo)
 s.render.engine='CYCLES';s.cycles.samples=12;s.render.resolution_x=420;s.render.resolution_y=420;s.render.resolution_percentage=100
 s.world=bpy.data.worlds.new('Studio');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.65,.65,1)
 for pos,power,size in [((1,-2,3),130,2),((-2,1,2),100,2)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(pos)*span);l=bpy.context.object;l.data.energy=power*span*span;l.data.size=size*span;l.rotation_euler=(center-l.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=center+Vector((1.3,-1.8,.85))*span);cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=span*1.3;cam.data.clip_end=10000;s.camera=cam
 maxf=int(max(a.frame_range[1] for a in bpy.data.actions))
 for frame in [1]+[round(maxf*i/7) for i in range(1,8)]:
  s.frame_set(frame);s.render.filepath=str(OUT/f'{name}-frame-{frame}.png');bpy.ops.render.render(write_still=True)
 if name=='animated':
  rig=next(o for o in s.objects if o.type=='ARMATURE');rig.animation_data_clear()
  for p in rig.pose.bones:p.matrix_basis.identity()
  bpy.context.view_layer.update()
  (OUT/'animated-bones.json').write_text(json.dumps({'matrix':list(map(list,rig.matrix_world)), 'bones':[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'world':list(rig.matrix_world@b.head_local),'parent':b.parent.name if b.parent else None} for b in rig.data.bones],'objects':[{'name':o.name,'matrix':list(map(list,o.matrix_world))} for o in meshes]},indent=2))
  s.render.filepath=str(OUT/'animated-rest.png');bpy.ops.render.render(write_still=True)
  bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'animated-studio.blend'))
