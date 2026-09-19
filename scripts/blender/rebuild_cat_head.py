"""Head study 1: rebuild spherical eyes and cornea, replace damaged nose surface."""
import bpy,math,shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6';backup=OUT/'lingxi-v6-before-head4.blend'
if not backup.exists():shutil.copy2(OUT/'lingxi-v6.blend',backup)
bpy.ops.wm.open_mainfile(filepath=str(backup));s=bpy.context.scene;rig=bpy.data.objects['Lingxi_Rig_v6'];rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
for p in rig.pose.bones:p.matrix_basis.identity()
bpy.context.view_layer.update()
# Coordinate sculpt is shared by all morph targets and hair roots.
def headshape(p):
 x,y,z=p;d=Vector((0,0,0))
 if x>8:
  cheek=math.exp(-((x-11.1)/1.4)**4-((z-12.9)/1.2)**4)
  d.y=(1 if y>0 else -1)*.22*cheek*min(1,abs(y)/1.7)
  snout=max(0,min(1,(x-12.2)/.7))*math.exp(-((z-12.5)/.9)**4)
  d.x=-.20*snout
 return p+d
for name in ['Lingxi_Coat','Lingxi_ShortFur','Lingxi_FineWhiskers']:
 o=bpy.data.objects[name]
 if o.data.shape_keys:
  for key in o.data.shape_keys.key_blocks:
   for v in key.data:v.co=headshape(v.co)
 else:
  for v in o.data.vertices:v.co=headshape(v.co)
# Proper smooth spherical volume, separate raised clear cornea, same eye bones.
old=bpy.data.objects['Lingxi_Eyes'];bpy.data.objects.remove(old,do_unlink=True)
verts=[];faces=[];uvs=[];groups=[];materials=[]
iris=bpy.data.materials.new('LX_Head4_DeepSageEyes');iris.use_nodes=True;p=iris.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.19;p.inputs['IOR'].default_value=1.38;p.inputs['Coat Weight'].default_value=.25
tex=iris.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/'textures/iris-sage-source.png'));iris.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
cornea=bpy.data.materials.new('LX_Head4_ClearCornea');cornea.use_nodes=True;p=cornea.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.98,.99,1,1);p.inputs['Roughness'].default_value=.025;p.inputs['IOR'].default_value=1.38;p.inputs['Transmission Weight'].default_value=1;p.inputs['Coat Weight'].default_value=1;p.inputs['Coat Roughness'].default_value=.025
# Pupil/iris front surface faces +X; back is hidden inside the skull. Radius is bounded by the socket.
for side,bone in [(1,'j_l_eye_014'),(-1,'j_r_eye_021')]:
 center=Vector((10.72,side*1.73,14.02));radius=1.20
 for layer in [0,1]:
  offset=len(verts);rings=32;segments=64
  for a in range(rings+1):
   theta=math.pi*a/rings
   for b in range(segments+1):
    phi=math.tau*b/segments;direction=Vector((math.cos(theta),math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi)))
    bulge=(.022+.10*max(0,direction.x)**5) if layer else 0
    point=center+direction*(radius+bulge)
    verts.append(point);groups.append(bone)
    # Concentric pupil centered on the forward surface, no diagonal projection or eye drift.
    uvs.append((.5+direction.y*radius/2.30,.5+direction.z*radius/2.30))
  for a in range(rings):
   for b in range(segments):
    k=offset+a*(segments+1)+b
    faces.append((k,k+1,k+segments+2,k+segments+1));materials.append(layer)
mesh=bpy.data.meshes.new('Lingxi spherical iris and cornea');mesh.from_pydata(verts,[],faces);mesh.update();eye=bpy.data.objects.new('Lingxi_Eyes',mesh);s.collection.objects.link(eye);eye.data.materials.append(iris);eye.data.materials.append(cornea)
uv=mesh.uv_layers.new(name='UVMap')
for loop in mesh.loops:uv.data[loop.index].uv=uvs[loop.vertex_index]
# Winding above must point outwards for corneal normals and physically meaningful highlights.
for poly,mi in zip(mesh.polygons,materials):poly.material_index=mi;poly.use_smooth=True
for bone in set(groups):eye.vertex_groups.new(name=bone)
for idx,bone in enumerate(groups):eye.vertex_groups[bone].add([idx],1,'REPLACE')
eye.modifiers.new('Eye bones','ARMATURE').object=rig
# Recalculate normals consistently on the closed spherical shells.
bpy.context.view_layer.objects.active=eye;bpy.ops.object.select_all(action='DESELECT');eye.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
# Replace the pink UV slivers under the nose with neutral short-fur material.
body=bpy.data.objects['Lingxi_Coat'];cream=bpy.data.materials.new('LX_Head4_MuzzleCream');cream.use_nodes=True;p=cream.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.72,.67,.59,1);p.inputs['Roughness'].default_value=.9;body.data.materials.append(cream);idx=len(body.data.materials)-1
for poly in body.data.polygons:
 c=poly.center
 if c.x>12.30 and abs(c.y)<.63 and 12.1<c.z<13.25:poly.material_index=idx
# Small rounded triangular pink nose, skinned to head; original mouth remains articulated.
nosemat=bpy.data.materials.new('LX_Head4_RoseNose');nosemat.use_nodes=True;p=nosemat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.52,.225,.20,1);p.inputs['Roughness'].default_value=.46
nv=[(12.97,-.40,12.89),(12.97,.40,12.89),(13.04,0,12.42),(12.74,-.40,12.89),(12.74,.40,12.89),(12.78,0,12.42)];nf=[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)]
nm=bpy.data.meshes.new('Soft triangular nose');nm.from_pydata(nv,[],nf);nm.update();nose=bpy.data.objects.new('Lingxi_Nose',nm);s.collection.objects.link(nose);nm.materials.append(nosemat)
bpy.context.view_layer.objects.active=nose;bpy.ops.object.select_all(action='DESELECT');nose.select_set(True);bevel=nose.modifiers.new('Rounded nose edges','BEVEL');bevel.width=.085;bevel.segments=4;bpy.ops.object.modifier_apply(modifier=bevel.name)
for poly in nm.polygons:poly.use_smooth=True
nose.vertex_groups.new(name='j_head_08').add(list(range(len(nose.data.vertices))),1,'REPLACE');nose.modifiers.new('Head skin','ARMATURE').object=rig
# Join nose to fine whiskers, preserving material and vertex-group bindings for established exporter.
whisk=bpy.data.objects['Lingxi_FineWhiskers'];whisk.select_set(True);bpy.context.view_layer.objects.active=whisk;bpy.ops.object.join()
for image in bpy.data.images:
 if image.has_data and image.type!='RENDER_RESULT':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6.blend'));print('HEAD4_REBUILT')
