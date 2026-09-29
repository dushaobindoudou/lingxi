"""Is it actually a leak, or just a lot of work? Render every clip in sequence.

A real leak shows up as resident memory climbing monotonically across iterations
even though each iteration does the same amount of work. This walks the same clip
timeline render_lingxi_v5_poses.py walks - including the per-clip bounds evaluation
that touches every LX_ object - but at 128px / low samples so the whole thing stays
near 1 GB and takes under a minute.

    blender --background assets/.../lingxi-short-fur-rig-v5.blend \
        --python scripts/blender/diagnose_render_loop.py -- --res=128 --samples=2
"""
import bpy, json, sys, time, ctypes, gc
from pathlib import Path

def cli(name, default):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return next((int(a.split('=', 1)[1]) for a in argv if a.startswith(f'--{name}')), default)

RES = cli('--res', 128)
SAMPLES = cli('--samples', 2)
ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'assets/characters/lingxi/v5/animations.json'

libc = ctypes.CDLL('/usr/lib/libc.dylib')

class MachTaskBasicInfo(ctypes.Structure):
    _fields_ = [('virtual_size', ctypes.c_uint64), ('resident_size', ctypes.c_uint64),
                ('resident_size_max', ctypes.c_uint64), ('user_time', ctypes.c_uint64),
                ('system_time', ctypes.c_uint64), ('policy', ctypes.c_int32),
                ('suspend_count', ctypes.c_int32)]

def rss_gb():
    info = MachTaskBasicInfo()
    count = ctypes.c_uint32(ctypes.sizeof(info) // 4)
    libc.task_info(libc.mach_task_self(), ctypes.c_uint32(20), ctypes.byref(info), ctypes.byref(count))
    return round(info.resident_size / 1024 ** 3, 3)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.image_settings.file_format = 'PNG'

def frame_character():
    """Same bounds evaluation the pose renderer does - touches every LX_ object."""
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in scene.objects:
        if obj.name.startswith('LX_') and obj.type in {'MESH', 'CURVES', 'CURVE'}:
            obj.evaluated_get(deps)

manifest = json.loads(MANIFEST.read_text())
series = []
base = rss_gb()
for clip in manifest:
    frac = .25 if clip['name'] in ['Lick', 'Bite', 'Walk', 'Run'] else .55
    frame = clip['start'] + round((clip['end'] - clip['start']) * frac)
    scene.frame_set(frame)
    frame_character()
    bpy.ops.render.render(write_still=True)
    series.append({'clip': clip['name'], 'frame': frame, 'gb': rss_gb()})

first = series[0]['gb']
last = series[-1]['gb']
delta = round(last - first, 3)
increases = sum(1 for a, b in zip(series, series[1:]) if b['gb'] > a['gb'] + .02)
print(json.dumps({
    'res': RES, 'samples': SAMPLES,
    'baseline_gb': base,
    'per_clip_gb': series,
    'first_gb': first, 'last_gb': last, 'growth_gb': delta,
    'monotonic_increases': f'{increases}/{len(series) - 1}',
    'verdict': 'GROWING across clips - looks like accumulation' if delta > .3
               else ('mild creep' if delta > .08 else 'stable - no per-clip accumulation'),
}, indent=2, ensure_ascii=False))
