"""Round ZZG: the furred head's side silhouette on a fixed orthographic camera (0.42 m / 1024 px, like codex's head_side template;
the cat faces left), transparent, the floor hidden - so variants of one rig compare row by row. Camera centre = the Head bone's middle
at FRAME (variants that only re-sculpt skin share it). Prints the nose tip's image row. Env: OUT (png), FRAME (1), RES (1024),
SCALE (.42), SAMPLES (8), AZ (deg, 0 = side), COLOR=1 (opaque, denoised - a look, not a silhouette)."""
import bpy, os, math
from mathutils import Vector
sc = bpy.context.scene; sc.frame_set(int(os.environ.get('FRAME', 1)))
for o in sc.objects:
    if o.name == 'Studio ground': o.hide_render = True
rig = bpy.data.objects['LX_Rig']; W = rig.matrix_world; pb = rig.pose.bones
c = W @ ((pb['Head'].head + pb['Head'].tail) / 2)
cam = bpy.data.objects.new('ProfileCam', bpy.data.cameras.new('ProfileCam')); sc.collection.objects.link(cam)
cam.data.type = 'ORTHO'; S = float(os.environ.get('SCALE', .42)); cam.data.ortho_scale = S
az = math.radians(float(os.environ.get('AZ', 0)))   # 0 = true side (the cat's left); 45 = three-quarter front-left
d = Vector((math.cos(az), -math.sin(az), 0)); cam.location = c + 2.0 * d; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); sc.camera = cam
R = int(os.environ.get('RES', 1024)); sc.render.resolution_x = sc.render.resolution_y = R; sc.render.resolution_percentage = 100
sc.render.engine = 'CYCLES'; sc.cycles.samples = int(os.environ.get('SAMPLES', 8)); sc.cycles.use_denoising = os.environ.get('COLOR') == '1'; sc.render.film_transparent = os.environ.get('COLOR') != '1'
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.filepath = os.environ['OUT']
nose = W @ pb['Nose'].tail
print('PROFILE centre_mm', [round(1000 * v, 1) for v in c], 'nose_row', round((c.z + S / 2 - nose.z) / S * R, 1), 'mm_per_px', round(1000 * S / R, 5))
bpy.ops.render.render(write_still=True)
