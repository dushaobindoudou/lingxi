"""v6 look-dev -- sweep surface shading and display transform WITHOUT rebuilding the model.

Opens the blend once and renders N variants back to back, so a shading idea is judged in
seconds instead of a five-minute rebuild.

  V6_VARIANTS='[{"name":"a","fur":{"sheen":0.7}},{"name":"b","view_transform":"Standard"}]' \
    Blender -b <blend> --python v6_look_experiment.py

Variant fields (all optional, anything omitted is left exactly as the blend has it):
  name, view_transform, look, exposure, bg
  fur  {sheen, sheen_rough, rough, sss, spec}      -> the strand material
  skin {sheen, rough, bump}                        -> the coat materials under the strands
"""
import bpy
import json
import math
import os
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('V6_OUT', ROOT / 'assets/characters/lingxi/v6/sweep'))
OUT.mkdir(parents=True, exist_ok=True)

RES = int(os.environ.get('V6_RES', '512'))
SAMPLES = int(os.environ.get('V6_SAMPLES', '16'))
VIEWS = [v for v in os.environ.get('V6_VIEWS', 'face').split(',') if v]
FOCAL = float(os.environ.get('V6_FOCAL', '85'))
SENSOR = 36.0
MARGIN = float(os.environ.get('V6_MARGIN', '1.10'))
BG = float(os.environ.get('V6_BG', '0.548'))
VARIANTS = json.loads(os.environ.get('V6_VARIANTS', '[{"name":"base"}]'))

s = bpy.context.scene
s.render.resolution_x = s.render.resolution_y = RES
s.cycles.samples = SAMPLES
s.cycles.use_denoising = True

for o in list(s.objects):
    if 'ground' in o.name.lower():
        o.hide_render = True

s.world.node_tree.nodes['Background'].inputs['Color'].default_value = (BG, BG, BG * 0.995, 1.0)

BASE_VT = s.view_settings.view_transform
BASE_LOOK = s.view_settings.look
BASE_EXPOSURE = s.view_settings.exposure


def principled(mat):
    return next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


FUR_MATS = [m for m in bpy.data.materials if 'Strand' in m.name and m.use_nodes]
SKIN_MATS = [m for m in bpy.data.materials
             if m.use_nodes and m.name.startswith('LX_ShortFur_') and m not in FUR_MATS]

BASE_FUR = {}
for m in FUR_MATS:
    b = principled(m)
    BASE_FUR[m.name] = {k: (float(b.inputs[k].default_value) if k in b.inputs else None)
                        for k in ('Sheen Weight', 'Sheen Roughness', 'Roughness',
                                  'Subsurface Weight', 'Specular IOR Level')}
BASE_SKIN_BUMP = {}
for m in SKIN_MATS:
    bumps = [n for n in m.node_tree.nodes if n.type == 'BUMP']
    if bumps:
        BASE_SKIN_BUMP[m.name] = [float(n.inputs['Strength'].default_value) for n in bumps]


def set_in(node, name, value):
    if name in node.inputs:
        node.inputs[name].default_value = value
        return True
    return False


def remove_fuzz():
    for m in SKIN_MATS:
        nt = m.node_tree
        for n in [n for n in nt.nodes if n.name.startswith('V6_FUZZ')]:
            nt.nodes.remove(n)


def add_fuzz(m, scale, strength, distance):
    """A procedural pile layer on top of whatever bump the coat already carries.

    At review scale a strand is about half a pixel wide, so the surface BETWEEN the strands
    is what the eye actually judges. Authored noise at millimetre scale reads as pile where a
    smooth billboard reads as plastic.
    """
    nt = m.node_tree
    b = principled(m)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    tc.name = 'V6_FUZZ_coord'
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.name = 'V6_FUZZ_noise'
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Detail'].default_value = 8.0
    tex.inputs['Roughness'].default_value = 0.62
    bump = nt.nodes.new('ShaderNodeBump')
    bump.name = 'V6_FUZZ_bump'
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = distance
    nt.links.new(tc.outputs['Object'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    if b.inputs['Normal'].is_linked:
        nt.links.new(b.inputs['Normal'].links[0].from_socket, bump.inputs['Normal'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])


def apply_variant(v):
    # `look` is owned by the view transform: carrying AgX's contrast look onto Standard is
    # rejected, so switching transform without naming a look falls back to 'None'.
    if 'view_transform' in v or 'look' in v:
        s.view_settings.view_transform = v.get('view_transform', BASE_VT)
        s.view_settings.look = v.get('look', 'None' if 'view_transform' in v else BASE_LOOK)
    s.view_settings.exposure = float(v.get('exposure', BASE_EXPOSURE))

    if 'bg' in v:
        s.world.node_tree.nodes['Background'].inputs['Color'].default_value = (v['bg'], v['bg'], v['bg'], 1.0)

    fur = v.get('fur', {})
    if fur:
        for m in FUR_MATS:
            b = principled(m)
            for label, key in (('sheen', 'Sheen Weight'), ('sheen_rough', 'Sheen Roughness'),
                               ('rough', 'Roughness'), ('sss', 'Subsurface Weight'),
                               ('spec', 'Specular IOR Level')):
                if label in fur:
                    set_in(b, key, float(fur[label]))

    skin = v.get('skin', {})
    if skin:
        remove_fuzz()
        for m in SKIN_MATS:
            b = principled(m)
            fz = skin.get('fuzz')
            if fz:
                add_fuzz(m, float(fz.get('scale', 320)), float(fz.get('strength', 0.55)),
                         float(fz.get('distance', 0.0006)))
            if 'sheen' in skin:
                set_in(b, 'Sheen Weight', float(skin['sheen']))
            if 'rough' in skin:
                set_in(b, 'Roughness', float(skin['rough']))
            if 'bump' in skin:
                base = BASE_SKIN_BUMP.get(m.name)
                if base:
                    for n, st in zip([n for n in m.node_tree.nodes if n.type == 'BUMP'], base):
                        n.inputs['Strength'].default_value = st * float(skin['bump'])


def subject_bounds(prefixes=None):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in s.objects:
        if o.hide_render or o.type not in {'MESH', 'CURVES', 'CURVE'}:
            continue
        if not o.name.startswith('LX_'):
            continue
        if prefixes and not any(o.name.startswith(p) for p in prefixes):
            continue
        ev = o.evaluated_get(deps)
        pts.extend(ev.matrix_world @ Vector(c) for c in ev.bound_box)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def place(cam, centre, cover, direction):
    dist = cover * FOCAL / SENSOR * MARGIN
    cam.location = Vector(centre) + Vector(direction).normalized() * dist
    cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat('-Z', 'Y').to_euler()


cam = s.camera
cam.data.type = 'PERSP'
cam.data.angle = 2 * math.atan(SENSOR / 2 / FOCAL)
cam.data.dof.use_dof = False

s.frame_set(1)
bpy.context.view_layer.update()
lo, hi = subject_bounds()
body_c, body_cover = (lo + hi) * .5, max(hi.x - lo.x, hi.z - lo.z)
hlo, hhi = subject_bounds(['LX_Head', 'LX_Jaw', 'LX_Ear', 'LX_Nose', 'LX_Eye', 'LX_Whisker'])
head_c, head_cover = (hlo + hhi) * .5, max(hhi.x - hlo.x, hhi.z - hlo.z)
VIEW_SPEC = {
    'front': (body_c, body_cover, (0, -1, 0.0)),
    'side': (body_c, body_cover, (-1, 0, 0.0)),
    'face': (head_c, head_cover, (0, -1, 0.0)),
}

made = []
for v in VARIANTS:
    apply_variant(v)
    name = v.get('name', 'variant')
    for view in VIEWS:
        c, cover, d = VIEW_SPEC[view]
        place(cam, c, cover, d)
        path = OUT / f'{name}_{view}.png'
        s.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        made.append(str(path))

print('V6_SWEEP ' + json.dumps({
    'out': str(OUT), 'rendered': made,
    'base': {'vt': BASE_VT, 'look': BASE_LOOK, 'exposure': BASE_EXPOSURE,
             'fur': BASE_FUR, 'skin_bump': BASE_SKIN_BUMP},
}, indent=1, ensure_ascii=False))
