import bpy, json
from pathlib import Path

s = bpy.context.scene
w = s.world
bg = None
try:
    bg = [round(float(x), 4) for x in w.node_tree.nodes['Background'].inputs['Color'].default_value[:3]]
except Exception as e:
    bg = f'<{e}>'

objs = [(o.name, o.type, bool(o.hide_render)) for o in s.objects]
fur = [o for o in objs if o[0].startswith('LX_RenderFur_')]
other = [o for o in objs if not o[0].startswith('LX_RenderFur_')]

cam = s.camera
print(json.dumps({
    'blender': bpy.app.version_string,
    'engine': s.render.engine,
    'view_transform': s.view_settings.view_transform,
    'look': s.view_settings.look,
    'exposure': s.view_settings.exposure,
    'res': [s.render.resolution_x, s.render.resolution_y],
    'film_transparent': s.render.film_transparent,
    'cycles': {'samples': s.cycles.samples, 'device': s.cycles.device,
               'use_denoising': s.cycles.use_denoising},
    'world_bg_linear': bg,
    'world_strength': (round(float(w.node_tree.nodes['Background'].inputs['Strength'].default_value), 3)
                       if bg is not None else None),
    'camera': cam.name if cam else None,
    'camera_loc': [round(float(v), 4) for v in cam.location] if cam else None,
    'camera_type': cam.data.type if cam else None,
    'camera_ortho_scale': round(float(cam.data.ortho_scale), 4) if cam else None,
    'n_objects': len(objs),
    'n_render_curves': len(fur),
    'objects': sorted(other),
}, indent=1, ensure_ascii=False))
