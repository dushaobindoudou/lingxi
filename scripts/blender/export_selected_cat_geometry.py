import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'lingxi-v6.blend'));rig=bpy.data.objects['Lingxi_Rig_v6']
rig.animation_data_clear()
for p in rig.pose.bones:p.matrix_basis.identity()
bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT')
for name in ['Lingxi_Rig_v6','Lingxi_Coat','Lingxi_Eyes','Lingxi_ShortFur','Lingxi_FineWhiskers']:bpy.data.objects[name].select_set(True)
bpy.context.view_layer.objects.active=rig
args=dict(export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_morph=True,export_yup=True,export_apply=False,export_cameras=False,export_lights=False,export_all_influences=False,export_attributes=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'soft2-static.glb'),**args)
bpy.data.objects['Lingxi_ShortFur'].select_set(False)
bpy.ops.export_scene.gltf(filepath=str(OUT/'soft2-static-lite.glb'),**args)
print('STATIC_EXPORT_DONE')
