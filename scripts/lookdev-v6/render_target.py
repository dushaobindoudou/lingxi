"""Render one frame of the built cat from the camera a codex target image was shot from, WITH fur.
env FRAME, VIEW (side = true side, long lens, cat facing left like the refs | app = straight in front, 20 deg down | top = straight down, head at the bottom |
front / back = level from in front / behind), FOCUS (a bone: close-up SPAN m across, centre moved by SHIFT x,y,z),
OUT (png), RES (default 640), SAMPLES (default 64), FILL (fraction of the frame the cat spans, default .78)."""
import bpy, os, math
from mathutils import Vector
sc = bpy.context.scene
sc.frame_set(int(os.environ['FRAME']))
R = int(os.environ.get('RES', 640)); sc.render.resolution_x = sc.render.resolution_y = R
sc.render.engine = 'CYCLES'; sc.cycles.samples = int(os.environ.get('SAMPLES', 64)); sc.cycles.use_denoising = True
# The old 200 m flattened sphere puts the side camera inside its dark rim, drawing a
# thick black strip across the paws. A plane gives the toes a readable contact shadow.
ground = bpy.data.objects.get('Studio ground')
transparent = os.environ.get('V6_TRANSPARENT', '0') == '1'
if transparent:
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    if ground:
        ground.hide_render = True
elif ground and ground.dimensions.z > .01:  # older builds used a flattened sphere
    ground.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.002))
    plate = bpy.context.object
    plate.name = 'Studio floor for review'
    if ground.data.materials:
        material = ground.data.materials[0].copy()
        material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.43, .41, .40, 1)
        plate.data.materials.append(material)
bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in sc.objects:
    if o.name.startswith('LX_') and o.type == 'MESH' and not o.hide_render:
        e = o.evaluated_get(dg); pts += [e.matrix_world @ Vector(c) for c in e.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
c = (lo + hi) / 2; span = hi - lo
cam = sc.camera; cam.data.type = 'ORTHO'; cam.data.dof.use_dof = False
view = os.environ.get('VIEW', 'app'); fill = float(os.environ.get('FILL', .78))
d = {'side': Vector((1, 0, math.tan(math.radians(3)))).normalized(), 'sidel': Vector((-1, 0, math.tan(math.radians(3)))).normalized(), 'top': Vector((0, 0, 1)), 'front': Vector((0, -1, math.tan(math.radians(4)))).normalized(),
     'q34': Vector((.64, -.77, math.tan(math.radians(12)))).normalized(),
     'high': Vector((0, -1, math.tan(math.radians(float(os.environ.get('ELEV', 60)))))).normalized(),   # round ZZX: codex's belly-up is shot from high above
     'back': Vector((0, 1, math.tan(math.radians(8)))).normalized()}.get(view, Vector((0, -1, math.tan(math.radians(20)))).normalized())
# frame on the cat's projected extent (8 bbox corners of every part, on the camera's right / up axes)
if view == 'top': right = Vector((1, 0, 0)); upv = Vector((0, 1, 0))   # straight down, the head (-y) at the bottom, as codex's *-top refs
else: up0 = Vector((0, 0, 1)); right = d.cross(up0).normalized(); upv = right.cross(d).normalized()
xs = [(p - c).dot(right) for p in pts]; ys = [(p - c).dot(upv) for p in pts]
w = max(max(xs) - min(xs), max(ys) - min(ys)); c = c + right * (max(xs) + min(xs)) / 2 + upv * (max(ys) + min(ys)) / 2
cam.data.ortho_scale = w / fill
if os.environ.get('FOCUS'):   # a close-up on one bone's middle, SPAN metres across (codex's *-closeup refs)
    rig = bpy.data.objects['LX_Rig']; pbn = rig.pose.bones[os.environ['FOCUS']]
    c = rig.matrix_world @ ((pbn.head + pbn.tail) / 2) + Vector(tuple(float(v) for v in os.environ.get('SHIFT', '0,0,0').split(',')))
    cam.data.ortho_scale = float(os.environ.get('SPAN', .25))
cam.location = c + d * 3
cam.rotation_euler = (0, 0, 0) if view == 'top' else (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = os.environ['OUT']
bpy.ops.render.render(write_still=True)
print('TARGET_VIEW', view, 'span_mm', [round(1000 * v) for v in span])
