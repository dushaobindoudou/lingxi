import bpy, json, os, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('LINGXI_OUT', ROOT / 'assets/characters/lingxi/v5'))
POSES = OUT / 'poses'
POSES.mkdir(exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = scene.render.resolution_y = 480
scene.cycles.samples = 12
camera = scene.camera
camera.data.type = 'ORTHO'
# The portrait camera's depth of field is focused for the portrait's distance; carried over to
# these per-pose framings it put every cat out of focus. A review sheet has to be sharp.
camera.data.dof.use_dof = False
rig = next(o for o in scene.objects if o.type == 'ARMATURE')

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

def departure_from_rest():
    """How far this frame's pose is from the rest pose - degrees of bone travel plus face."""
    total = 0.0
    for bone in rig.pose.bones:
        total += sum(abs(math.degrees(a)) for a in bone.rotation_euler)
        total += bone.location.length * 400  # metres are small; weight them into the same units
    for obj in scene.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if not keys:
            continue
        # The face carries a clip's whole meaning at a fraction of a degree of geometry, so it
        # is weighted up - but only the keys that DISTINGUISH a clip.
        #
        # Breath and Blink are excluded because they run in every clip. Blink in particular is
        # carried by fourteen separate objects, so a full blink added 14 x 45 to the score and
        # won every comparison: the sheet picked the blink frame of Idle, Walk, Run, Lick, Bite,
        # Knead and PawPlay, and the cat looked half asleep in all of them. A blink is a
        # transient that happens in every clip; it is not what a clip looks like. Sleep still
        # renders with its eyes shut, because it holds Blink at 1 for its whole length and a
        # constant cannot change which frame is the extreme.
        total += sum(abs(b.value) * 45 for b in keys.key_blocks[1:]
                     if b.name not in ('Breath', 'Blink'))
    return total


def most_expressive_frame(clip):
    """The frame in this clip that is furthest from rest.

    A fixed fraction cannot find it. Every clip here drives its feature with sin(phase), where
    phase runs a full turn across the clip - so the old fixed 0.55 landed on sin(198°) = -0.31,
    within a third of the zero crossing of every one of them. Curious's 13° head tilt rendered
    as 4.3°, Happy's tail swish as 4°, and the contact sheet showed ten cards of the same
    standing cat. The clips were not the problem; the sampler was picking the one moment in each
    that looks like Idle.

    Sampling every frame instead. A contact sheet exists to answer "what does this clip look
    like", and the honest answer is its extreme, not its average.
    """
    best, best_score = clip['start'], -1.0
    for frame in range(clip['start'], clip['end'] + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        score = departure_from_rest()
        if score > best_score:
            best, best_score = frame, score
    return best, best_score


manifest = json.loads((OUT / 'animations.json').read_text())
picked = []
for clip in manifest:
    frame, score = most_expressive_frame(clip)
    scene.frame_set(frame)
    frame_character()
    scene.render.filepath = str(POSES / f"{clip['name']}.png")
    bpy.ops.render.render(write_still=True)
    picked.append({'name': clip['name'], 'frame': frame, 'departure': round(score, 1)})

print(json.dumps({'pose_renders': len(manifest), 'camera': 'per-pose evaluated bounds',
                  'frames': picked}, ensure_ascii=False, indent=2))
