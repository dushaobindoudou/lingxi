import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/characters/lingxi/model-evaluation';OUT.mkdir(exist_ok=True)
files=[('animated',next((ROOT/'model/extracted/an-animated-cat').rglob('*.gltf'))),('motion',next((ROOT/'model/extracted/cat-in-motion-3d-model-free').rglob('*.glb'))),('lowpoly',next((ROOT/'model/extracted/cat-low-poly-rigged-animated-textured').rglob('*.fbx'))),('toon',next((ROOT/'model/extracted/toon-cat-free').rglob('*.fbx'))),('munchkin',ROOT/'model/munchkin_cat.glb')]
reports=[]
for name,path in files:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 if path.suffix=='.fbx':bpy.ops.import_scene.fbx(filepath=str(path))
 else:bpy.ops.import_scene.gltf(filepath=str(path))
 scene=bpy.context.scene;scene.frame_set(1)
 meshes=[o for o in scene.objects if o.type=='MESH']
 # Repair FBX texture paths from supplied archive.
 for img in bpy.data.images:
  matches=list(path.parents[1].rglob(Path(img.filepath.replace('\\','/')).name)) if img.filepath else []
  if matches:
   img.filepath=str(matches[0]);img.reload()
 report={'id':name,'source':str(path.relative_to(ROOT)),'meshes':[{'name':o.name,'vertices':len(o.data.vertices),'triangles':sum(len(p.vertices)-2 for p in o.data.polygons),'uv_layers':len(o.data.uv_layers),'shape_keys':list(o.data.shape_keys.key_blocks.keys()) if o.data.shape_keys else [],'materials':[m.name for m in o.data.materials if m]} for o in meshes], 'rigs':[{'name':o.name,'bones':[b.name for b in o.data.bones]} for o in scene.objects if o.type=='ARMATURE'],'actions':[{'name':a.name,'frames':list(a.frame_range),'slots':[s.identifier for s in a.slots]} for a in bpy.data.actions]}
 pts=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
 lo=Vector(tuple(min(p[i] for p in pts) for i in range(3)));hi=Vector(tuple(max(p[i] for p in pts) for i in range(3)));center=(lo+hi)/2;span=max(hi-lo)
 report['bounds']=[list(lo),list(hi)];reports.append(report)
 (OUT/'inspection.json').write_text(json.dumps(reports,indent=2))
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'-original.blend')))
 scene.render.engine='CYCLES';scene.cycles.samples=16
 scene.render.resolution_x=600;scene.render.resolution_y=600;scene.render.resolution_percentage=100
 scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.55,.55,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
 for pos,power,size in [((1,-2,3),130,2),((-2,-1,1),70,2),((0,2,2),100,1.5)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(pos)*span);l=bpy.context.object;l.data.energy=power*span*span;l.data.shape='DISK';l.data.size=size*span;l.rotation_euler=(center-l.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=center+Vector((1.3,-1.8,.85))*span);cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=span*1.25;cam.data.clip_end=max(1000,span*20);scene.camera=cam
 scene.view_settings.view_transform='AgX';scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
print('EVALUATION_DONE')
