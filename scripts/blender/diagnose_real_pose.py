"""Memory forensics on the REAL v5 rig, at deliberately harmless render settings.

Unlike diagnose_fur_cost.py (a clean synthetic scene), this opens the actual
production .blend so the things that only exist there are part of the measurement:
the stranded source meshes left behind by native_fur, their Armature skinning, the
geometry-nodes follow target each pose re-evaluates, and the 495 actions.

It never writes anything (no save_as_mainfile) and renders at 256px / low samples,
so the peak stays around 1 GB instead of 50 GB - while still answering which stage
is responsible.

    blender --background assets/.../lingxi-short-fur-rig-v5.blend \
        --python scripts/blender/diagnose_real_pose.py -- --frame=1 --res=256 --samples=4
"""
import bpy, json, sys, time, ctypes

def cli(name, default):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return next((int(a.split('=', 1)[1]) for a in argv if a.startswith(f'--{name}')), default)

FRAME = cli('--frame', 1)
RES = cli('--res', 256)
SAMPLES = cli('--samples', 4)

# ru_maxrss is a peak and never goes down, which would make "did deleting help"
# impossible to answer. Ask the kernel for current resident size instead.
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
report = {'frame': FRAME, 'res': RES, 'samples': SAMPLES, 'gb': {}}
report['gb']['after_open'] = rss_gb()

def frame_character():
    """The exact bound-box evaluation render_lingxi_v5_poses.py does per clip."""
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    pts = 0
    for obj in scene.objects:
        if not obj.name.startswith('LX_') or obj.type not in {'MESH', 'CURVES', 'CURVE'}:
            continue
        ev = obj.evaluated_get(deps)
        pts += len(getattr(ev.data, 'vertices', [])) if ev.type == 'MESH' else 0
    return pts

scene.frame_set(FRAME)
t = time.time()
evaluated_verts = frame_character()
report['frame_character_seconds'] = round(time.time() - t, 2)
report['evaluated_mesh_verts'] = evaluated_verts
report['gb']['after_evaluate'] = rss_gb()

scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = RES
t = time.time()
bpy.ops.render.render(write_still=True)
report['render_seconds'] = round(time.time() - t, 2)
report['gb']['after_render'] = rss_gb()

# Now apply the suspected fix on a copy in memory only: drop the strand source
# meshes that native_fur converted but never removed, then repeat both stages.
sources = [o for o in scene.objects if o.name.startswith('LX_Fur_') and o.type == 'MESH']
report['source_meshes_removed'] = [o.name for o in sources]
report['source_mesh_verts_removed'] = sum(len(o.data.vertices) for o in sources)
for o in list(sources):
    me = o.data
    bpy.data.objects.remove(o)
    bpy.data.meshes.remove(me)
import gc; gc.collect()
report['gb']['after_removing_sources'] = rss_gb()

t = time.time()
try:
    frame_character()
    report['evaluate_without_sources_seconds'] = round(time.time() - t, 2)
except Exception as exc:
    report['evaluate_without_sources_error'] = str(exc)

t = time.time()
bpy.ops.render.render(write_still=True)
report['render_seconds_after_cleanup'] = round(time.time() - t, 2)
report['gb']['after_render_cleanup'] = rss_gb()

print(json.dumps(report, indent=2, ensure_ascii=False))
