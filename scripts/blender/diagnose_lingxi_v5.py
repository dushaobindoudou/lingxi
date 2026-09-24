"""Measure how different the v5 clips actually are, instead of looking at them and guessing.

The contact sheet shows fifteen cards and about five distinct poses: Idle, Walk, Run, Curious,
Happy, Yawn, Lick, Bite, Knead and PawPlay are indistinguishable. `build-report.json` says
"actions: 495, clips: 15, frames: 776" and every one of those numbers is true, because they
count containers rather than poses.

So this prints, per clip and at the exact frame the pose sheet samples:

  * how far every pose bone has moved from rest, and which bone moved most
  * every shape key that is non-zero (the face - a Yawn with a shut mouth is a binding failure,
    not an animation choice)
  * the silhouette: the evaluated bounding box, which is what actually separates "lying down"
    from "standing" at a glance

and then the pairwise distance between clips in that space, so "these two clips are the same
pose" is a number rather than an impression.

    blender --background <blend> --python scripts/blender/diagnose_lingxi_v5.py
"""
import bpy
import json
import math
from pathlib import Path

from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/characters/lingxi/v5'

scene = bpy.context.scene
rig = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
if rig is None:
    raise SystemExit('no armature in this file')

manifest = json.loads((OUT / 'animations.json').read_text())

# The same frame render_lingxi_v5_poses.py picks, so the numbers describe the pictures that
# were actually judged rather than some other moment.
def departure(frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    total = 0.0
    for bone in rig.pose.bones:
        total += sum(abs(math.degrees(a)) for a in bone.rotation_euler)
        total += bone.location.length * 400
    for obj in scene.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if keys:
            total += sum(abs(b.value) * 45 for b in keys.key_blocks[1:]
                         if b.name not in ('Breath', 'Blink'))
    return total


def sampled_frame(clip):
    """The frame the pose sheet renders - its extreme, matching render_lingxi_v5_poses.py."""
    return max(range(clip['start'], clip['end'] + 1), key=departure)


def shape_key_values():
    values = {}
    for obj in scene.objects:
        keys = getattr(obj.data, 'shape_keys', None)
        if not keys:
            continue
        for block in keys.key_blocks[1:]:
            if abs(block.value) > 1e-4:
                values[f'{obj.name}.{block.name}'] = round(block.value, 3)
    return values


def bone_pose():
    """Every bone's departure from rest, in degrees and metres."""
    out = {}
    for bone in rig.pose.bones:
        rot = max(abs(math.degrees(a)) for a in bone.rotation_euler)
        loc = bone.location.length
        if rot > 0.5 or loc > 1e-3:
            out[bone.name] = (round(rot, 1), round(loc, 4))
    return out


def silhouette():
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in scene.objects:
        if not obj.name.startswith('LX_') or obj.type not in {'MESH', 'CURVES', 'CURVE'}:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(c) for c in evaluated.bound_box)
    if not points:
        return None
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return high - low


samples = []
for clip in manifest:
    frame = sampled_frame(clip)
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    span = silhouette()
    bones = bone_pose()
    biggest = max(bones.items(), key=lambda kv: kv[1][0], default=('-', (0, 0)))
    samples.append({
        'name': clip['name'],
        'frame': frame,
        'moved_bones': len(bones),
        'largest': f'{biggest[0]} {biggest[1][0]}°',
        'max_deg': biggest[1][0],
        'span': None if span is None else [round(v, 3) for v in span],
        'shape_keys': shape_key_values(),
        'bones': bones,
    })

print('\n===== per clip, at the frame the pose sheet renders =====')
print(f"{'clip':10} {'frame':>6} {'bones':>6} {'largest rotation':>22} {'silhouette WxDxH':>26}  face")
for s in samples:
    span = 'n/a' if s['span'] is None else '×'.join(f'{v:.3f}' for v in s['span'])
    face = ', '.join(f'{k.split(".")[-1]}={v}' for k, v in list(s['shape_keys'].items())[:4]) or '—'
    print(f"{s['name']:10} {s['frame']:6d} {s['moved_bones']:6d} {s['largest']:>22} {span:>26}  {face}")

# --- how different is each clip from Idle, and from its neighbours? ------------------------
def distance(a, b):
    """Degrees of difference across every bone, plus shape keys scaled to be comparable."""
    names = set(a['bones']) | set(b['bones'])
    rot = sum(abs(a['bones'].get(n, (0, 0))[0] - b['bones'].get(n, (0, 0))[0]) for n in names)
    keys = set(a['shape_keys']) | set(b['shape_keys'])
    face = sum(abs(a['shape_keys'].get(k, 0) - b['shape_keys'].get(k, 0)) for k in keys) * 45
    return rot + face


idle = next(s for s in samples if s['name'] == 'Idle')
print('\n===== distance from Idle (degrees of total bone travel + weighted face) =====')
for s in sorted(samples, key=lambda x: distance(idle, x)):
    d = distance(idle, s)
    verdict = 'SAME POSE' if d < 25 else ('barely different' if d < 60 else 'distinct')
    print(f'  {s["name"]:10} {d:8.1f}   {verdict}')

print('\n===== pairs that are the same pose (< 25) =====')
pairs = []
for i, a in enumerate(samples):
    for b in samples[i + 1:]:
        d = distance(a, b)
        if d < 25:
            pairs.append((d, a['name'], b['name']))
for d, a, b in sorted(pairs):
    print(f'  {a:10} ≈ {b:10} {d:6.1f}')
print(f'\n{len(pairs)} identical pairs out of {len(samples) * (len(samples) - 1) // 2}')

# --- is the face wired up at all? -----------------------------------------------------------
print('\n===== shape key bindings =====')
holders = [o for o in scene.objects if getattr(o.data, 'shape_keys', None)]
print(f'{len(holders)} objects carry shape keys')
for obj in holders[:40]:
    keys = obj.data.shape_keys
    animated = bool(keys.animation_data and (keys.animation_data.action or keys.animation_data.nla_tracks))
    tracks = len(keys.animation_data.nla_tracks) if keys.animation_data else 0
    names = [b.name for b in keys.key_blocks[1:]]
    print(f'  {obj.name:28} keys={names!s:40} animated={animated} nla_tracks={tracks}')

print('\n===== armature NLA =====')
ad = rig.animation_data
print(f'tracks={len(ad.nla_tracks) if ad else 0}')
if ad:
    for track in ad.nla_tracks:
        for strip in track.strips:
            print(f'  {track.name:10} strip {strip.frame_start:6.0f}–{strip.frame_end:6.0f} '
                  f'action={strip.action.name if strip.action else None} '
                  f'action_range={strip.action_frame_start:.0f}–{strip.action_frame_end:.0f} '
                  f'extrapolation={strip.extrapolation} influence={strip.influence:.2f}')
