"""Rebuild the Blink shape key on the eye parts, and prove the fix with a before/after render.

`add_eye_blink` in build_lingxi_v5.py wrote:

    key = obj.shape_key_add(name='Blink')
    for i, v in enumerate(key.data):
        v.co.z = center_z + (v.co.z - obj.data.vertices[i].co.z) * .035

A new shape key starts as a copy of the basis, so `key.data[i].co` IS
`obj.data.vertices[i].co` at that moment: the bracket is identically zero, and every vertex of
the eyeball, iris, pupil, catchlight and cornea gets `z = center_z`. The eye does not squash to
3.5% of its height - it collapses to a single horizontal plane, wider than the eye socket, which
is the white stripe across the face in every frame where Blink is near 1.

The intended pivot was `center_z`:

    v.co.z = center_z + (v.co.z - center_z) * .035

This applies that to the saved file rather than rebuilding 184k hairs to test a one-line fix,
and renders the same head at Blink 0 and Blink 1 so the result can be looked at.

    blender --background <blend> --python scripts/blender/fix_eye_blink_v5.py -- [--save]
"""
import bpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/characters/lingxi/v5'
SAVE = '--save' in sys.argv

scene = bpy.context.scene

# The five parts that make up one eye. The lids are NOT in this list: their own Blink key sweeps
# them across the eye and it is correct - sin(a) is positive over the upper arc and negative
# over the lower one, so the upper lid comes down and the lower one comes up.
EYE_PARTS = ('LX_Eyeball', 'LX_Iris', 'LX_Pupil', 'LX_Catchlight', 'LX_Cornea')

repaired = []
for obj in scene.objects:
    if not obj.name.startswith(EYE_PARTS):
        continue
    keys = getattr(obj.data, 'shape_keys', None)
    if not keys or 'Blink' not in keys.key_blocks:
        continue
    basis = keys.key_blocks['Basis']
    blink = keys.key_blocks['Blink']

    # The eye's own centre, taken from the basis rather than passed in: this script runs against
    # a built file, and re-deriving it here means the repair cannot disagree with the geometry.
    center_z = sum(v.co.z for v in basis.data) / len(basis.data)

    before = max(abs(b.co.z - a.co.z) for a, b in zip(basis.data, blink.data))
    for source, target in zip(basis.data, blink.data):
        target.co.x = source.co.x
        target.co.y = source.co.y
        target.co.z = center_z + (source.co.z - center_z) * .035
    after = max(abs(b.co.z - a.co.z) for a, b in zip(basis.data, blink.data))
    height = max(v.co.z for v in basis.data) - min(v.co.z for v in basis.data)
    repaired.append((obj.name, height, before, after))

print('\n===== Blink shape key, per eye part =====')
print(f"{'object':22} {'height':>9} {'was':>9} {'now':>9}   verdict")
for name, height, before, after in repaired:
    # A correct squash moves the extreme vertices by just under half the height (from ±h/2 to
    # ±0.035·h/2). Collapsing to a plane moves them by exactly half.
    expected = height / 2 * (1 - .035)
    verdict = 'ok' if abs(after - expected) < height * .02 else 'UNEXPECTED'
    print(f'{name:22} {height:9.4f} {before:9.4f} {after:9.4f}   {verdict}')
print(f'\n{len(repaired)} eye parts repaired')

if not repaired:
    raise SystemExit('no eye parts found - is this the right file?')

# --- look at it -----------------------------------------------------------------------------
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
head = next(o for o in scene.objects if o.name.startswith('LX_Eyeball'))
camera = scene.camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = .30
camera.location = (.10, -1.30, .58)
camera.rotation_euler = (1.5708, 0, .077)
scene.render.resolution_x = scene.render.resolution_y = 520
scene.cycles.samples = 32

# Mute the NLA on every shape-key datablock first. Without this, `view_layer.update()`
# re-evaluates the animation for the current frame and puts back the value it drives - the
# manual assignment below would be silently overwritten and both renders would show the same
# open eye, which is exactly what happened the first time this ran.
for obj in scene.objects:
    keys = getattr(obj.data, 'shape_keys', None)
    if keys and keys.animation_data:
        for track in keys.animation_data.nla_tracks:
            track.mute = True

for value in (0.0, 1.0):
    for obj in scene.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if keys and 'Blink' in keys.key_blocks:
            keys.key_blocks['Blink'].value = value
    bpy.context.view_layer.update()
    scene.render.filepath = str(OUT / f'eye-blink-{int(value)}.png')
    bpy.ops.render.render(write_still=True)
    print(f'rendered {scene.render.filepath}')

if SAVE:
    for obj in scene.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if keys and keys.animation_data:
            for track in keys.animation_data.nla_tracks:
                track.mute = False
    for obj in scene.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if keys and 'Blink' in keys.key_blocks:
            keys.key_blocks['Blink'].value = 0.0
    bpy.ops.wm.save_mainfile(compress=True)
    print('saved')
