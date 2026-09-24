import bpy, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/characters/lingxi/v5'
POSES = OUT / 'poses'
POSES.mkdir(exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = scene.render.resolution_y = 480
scene.cycles.samples = 12
camera = scene.camera
camera.data.type = 'ORTHO'

def frame_character():
    """Recenter and fit each evaluated pose so lying/rolled poses do not clip."""
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in scene.objects:
        if not obj.name.startswith('LX_') or obj.type not in {'MESH', 'CURVES', 'CURVE'}:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not points:
        return
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (low + high) * .5
    span = high - low
    camera.data.ortho_scale = max(span.x, span.y, span.z) * 1.35
    direction = Vector((.9, -1.8, .54)).normalized()
    camera.location = center + direction * 2.8
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()

manifest = json.loads((OUT / 'animations.json').read_text())
for clip in manifest:
    fraction = .25 if clip['name'] in ['Lick', 'Bite', 'Walk', 'Run'] else .55
    scene.frame_set(clip['start'] + round((clip['end'] - clip['start']) * fraction))
    frame_character()
    scene.render.filepath = str(POSES / f"{clip['name']}.png")
    bpy.ops.render.render(write_still=True)

print(json.dumps({'pose_renders': len(manifest), 'camera': 'per-pose evaluated bounds'}, ensure_ascii=False))
