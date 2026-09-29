"""Export the v5 look-dev cat to glTF for the three.js preview (apps/lingxi/v5-demo.html).

    blender --background assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend \
        --python scripts/blender/export_lingxi_v5_glb.py

Writes apps/lingxi/public/v5/lingxi-v5.glb (git-ignored; rebuild it from the .blend).

What goes in: the armature and every mesh the Cycles render shows, with skin weights, shape
keys, the painted coat (the `fur_color` / `lid_color` / `nose_shade` color attributes) and one
glTF animation per clip - each clip is an NLA track of the same name on the rig and on every
shape-key block, which is exactly what the exporter's NLA_TRACKS mode merges into one action.

What stays out: the 500k render-hair curves and their strand source meshes. Real-time fur is
done in the browser with shells over the Body / Head / Tail skin (see src/v5-demo.ts).
"""
import bpy, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('LINGXI_GLB', ROOT / 'apps/lingxi/public/v5/lingxi-v5.glb'))
OUT.parent.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
# Drop the render hair first. Nothing of it is exported, but it is geometry-node driven, and the
# exporter's per-frame sampling re-evaluated all ~500k curves on every one of the 776 frames
# (an export that had not finished after 35 minutes).
for o in [o for o in scene.objects if o.type == 'CURVES' or o.name.startswith('LX_Fur_')]:
    bpy.data.objects.remove(o, do_unlink=True)
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
keep = [o for o in scene.objects
        if o.type == 'MESH' and not o.hide_render and o.name.startswith('LX_')
        and not o.name.startswith('LX_Fur_')]

# The coat lives in color attributes; make the one each material reads the active/render one so
# the exporter writes it as COLOR_0.
for o in keep:
    attrs = o.data.color_attributes
    for name in ('fur_color', 'lid_color', 'nose_shade'):
        if name in attrs:
            attrs.active_color = attrs[name]
            attrs.render_color_index = attrs.find(name)
            break

bpy.ops.object.select_all(action='DESELECT')
for o in keep + [rig]:
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = rig

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format='GLB',
    use_selection=True,
    export_apply=True,                 # ear Solidify etc.; skipped by Blender on shape-keyed meshes
    export_yup=True,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_anim_slide_to_zero=True,
    export_force_sampling=True,
    export_frame_step=1,
    export_vertex_color='ACTIVE',
    export_all_vertex_colors=False,
    export_image_format='AUTO',
    export_extras=False,
    export_lights=False,
    export_cameras=False,
)
size = OUT.stat().st_size
clips = [t.name for t in rig.animation_data.nla_tracks]
print('GLB_EXPORT', json.dumps({'file': str(OUT), 'mb': round(size / 1e6, 1), 'meshes': len(keep), 'clips': clips}))
