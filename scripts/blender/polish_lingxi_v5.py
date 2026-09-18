import bpy,numpy as np,math,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';s=bpy.context.scene
palette=np.array([(.16,.115,.08),(.23,.175,.13),(.32,.25,.19),(.43,.35,.27),(.56,.48,.38),(.78,.73,.65)])
for o in [o for o in s.objects if o.name.startswith('LX_RenderFur_')]:
 src=bpy.data.objects[o['deformation_source']];n=len(o.data.curves);col=np.empty(n*16,dtype='f');src.data.attributes['fur_color'].data.foreach_get('color',col);col=col.reshape(n,4,4)[:,0,:3];tone=np.argmin(((col[:,:,None]-palette.T[None,:,:])**2).sum(1),axis=1)
 o.data.materials.clear()
 for i in range(6):o.data.materials.append(bpy.data.materials['LX_FurTone'+str(i)])
 a=o.data.attributes.get('material_index') or o.data.attributes.new('material_index','INT','CURVE');a.data.foreach_set('value',tone.astype('i'))
# Remove the spherical chin underneath the mouth, on both surface and hair deformation source.
for name in ['LX_Head','LX_Fur_LX_Head']:
 o=bpy.data.objects[name]
 for v in o.data.vertices:
  p=v.co
  if p.z<.47:p.z=.47+(p.z-.47)*.32
 o.data.update()
# Eyelid surface blends into the facial color; eyes project cleanly from the facial surface.
for o in s.objects:
 if o.type!='MESH':continue
 if any(o.name.startswith(n) for n in ['LX_Iris','LX_Cornea','LX_Eyeball','LX_Lid']):
  if o.data.shape_keys:
   for k in o.data.shape_keys.key_blocks:
    for v in k.data:v.co.y-=.012
  else:
   for v in o.data.vertices:v.co.y-=.012
 if o.name.startswith('LX_Lid'):
  m=bpy.data.materials['LX_ShortFur_CoatBase'].copy();m.name=o.name+'_WarmRim';p=m.node_tree.nodes.get('Principled BSDF')
  for l in list(p.inputs['Base Color'].links):m.node_tree.links.remove(l)
  p.inputs['Base Color'].default_value=(.36,.27,.20,1);o.data.materials.clear();o.data.materials.append(m)
# Smooth rose-to-taupe inner ears using a continuous vertex mask, no jagged face assignment.
for o in [o for o in s.objects if o.name.startswith('LX_Ear.')]:
 me=o.data;cols=[]
 for v in me.vertices:
  z=v.co.z;t=(z-.616)/.155;center=(-1 if '.L' in o.name else 1)*(.112+.03*t);u=abs(v.co.x-center)/max(.006,.072*(1-t)+.004);f=max(0,min(1,(.75-u)/.3))*max(0,min(1,(t-.1)/.2))*max(0,min(1,(.96-t)/.15));cols.append(tuple(np.array([.42,.33,.25])*(1-f)+np.array([.64,.36,.34])*f)+(1,))
 at=me.color_attributes.new(name='EarTint',type='FLOAT_COLOR',domain='POINT');at.data.foreach_set('color',np.array(cols,dtype='f').ravel());m=bpy.data.materials['LX_ShortFur_PinkNose'].copy();m.name='LX_EarSoftPink';nt=m.node_tree;p=nt.nodes.get('Principled BSDF');a=nt.nodes.new('ShaderNodeAttribute');a.attribute_name='EarTint';nt.links.new(a.outputs['Color'],p.inputs['Base Color']);p.inputs['Roughness'].default_value=.65;me.materials.clear();me.materials.append(m)
 for p in me.polygons:p.material_index=0
 mod=o.modifiers.new('Rounded ear edges','SUBSURF');mod.levels=2;mod.render_levels=2
# Warm image is exposed softly without washing out the coat.
s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=-.55
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-short-fur-rig-v5.blend'),compress=True);s.render.filepath=str(OUT/'portrait.png');bpy.ops.render.render(write_still=True)
result={'status':'native per-strand materials, eye rims and chin refined'}
