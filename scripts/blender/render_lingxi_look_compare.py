"""Render neutral orthographic views of the current LINGXI_OUT model."""
import bpy, os, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('LINGXI_OUT',ROOT/'assets/characters/lingxi/v5'))
s=bpy.context.scene
s.frame_set(1)
# Keep timeline clips available for the fourth view.

for o in s.objects:
 if o.type=='MESH' and o.data.shape_keys:
  for k in o.data.shape_keys.key_blocks[1:]:k.value=0
cam=bpy.data.objects.get('LookCamera')
if not cam:
 d=bpy.data.cameras.new('LookCamera');cam=bpy.data.objects.new('LookCamera',d);s.collection.objects.link(cam)
cam.data.type='ORTHO';cam.data.ortho_scale=.95;s.camera=cam
s.render.resolution_x=520;s.render.resolution_y=520;s.render.resolution_percentage=100
s.cycles.samples=20 if os.environ.get('LINGXI_QUALITY')=='preview' else 48
s.render.image_settings.file_format='PNG';s.render.film_transparent=False
s.world.node_tree.nodes['Background'].inputs[0].default_value=(.70,.68,.68,1)
s.world.node_tree.nodes['Background'].inputs[1].default_value=.7
floor=bpy.data.objects.get('Studio ground')
if floor:
 p=floor.data.materials[0].node_tree.nodes.get('Principled BSDF')
 if p:p.inputs['Base Color'].default_value=(.70,.68,.68,1)
for o in s.objects:
 if o.type=='LIGHT':o.data.color=(1,1,1)
def render(name,loc,target=(0,0,.36),wide=False):
 s.render.resolution_x=800 if wide else 520
 cam.data.ortho_scale=1.46 if wide else .95
 cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 s.render.filepath=str(OUT/name);bpy.ops.render.render(write_still=True)
render('look-front.png',(0,-2,.36))
render('look-side.png',(2,0,.36),wide=True)
render('look-back.png',(0,2,.36))
import json
clips=json.loads((OUT/'animations.json').read_text())
lie=next(c for c in clips if c['name']=='LieDown')
s.frame_set(int(lie['start']+(lie['end']-lie['start'])*.72))
render('look-threequarter.png',(1.6,-1.6,.45),wide=True)
