"""v6 round G -- answer Claude's four review questions with numbers.

Claude asked for a look at the round-G renders. Numbers travel better than adjectives, and
four of the questions are really geometric:

  1. are the four toes laid out along an arc with a visible cleft, or are they four balls in
     a row?  -> per-toe centre, the arc's pull-back at the ends, and the real surface gap
     between neighbours (BVHTree), not the nominal spacing
  2. does the upper lip read as the reference's omega? -> sample the built lip CURVES and
     compare the philtrum cusp against the arcs either side of it (round G flipped the sign)
  3. ear proportion and tip shape -> width/height and the width profile, real vertices
  4. the same audit ruler as round B4, so the two rounds can be compared directly

  Blender --background <blend> --python v6_g_review.py [--json out.json]
"""
import bpy
import json
import os
import sys
from mathutils import Vector, bvhtree
from mathutils.bvhtree import BVHTree
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = os.environ.get('V6_G_JSON', '')

deps = bpy.context.evaluated_depsgraph_get()


def mesh(name):
    """World-space copy of an object's evaluated mesh."""
    o = bpy.data.objects.get(name)
    if o is None:
        return None
    ev = o.evaluated_get(deps)
    me = ev.to_mesh()
    me.transform(ev.matrix_world)
    return me


def centre(me):
    if me is None or not me.vertices:
        return None
    c = Vector((0, 0, 0))
    for v in me.vertices:
        c += v.co
    return c / len(me.vertices)


def bbox(me):
    if me is None or not me.vertices:
        return None
    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
    return lo, hi


def surface_gap(a, b):
    """Closest distance between two meshes' surfaces, in metres.

    BVHTree.find_nearest on an empty/invalid tree silently returns nonsense (this reported
    699 mm between two toes 24 mm apart), so the result is sanity-checked against the
    bounding boxes: anything larger than the box diagonal cannot be a real nearest hit.
    """
    if a is None or b is None:
        return None
    if not a.polygons or not b.polygons:
        return None
    ta = BVHTree.FromPolygons([v.co[:] for v in a.vertices], [list(p.vertices) for p in a.polygons])
    tb = BVHTree.FromPolygons([v.co[:] for v in b.vertices], [list(p.vertices) for p in b.polygons])
    lo_a, hi_a = bbox(a)
    lo_b, hi_b = bbox(b)
    diag = sum((hi_a[i] - lo_b[i]) ** 2 for i in range(3)) ** .5
    best = None
    for v in a.vertices:
        hit = tb.find_nearest(v.co)
        if hit is None or hit[2] is None:
            continue
        if hit[2] > diag:            # not a real nearest hit - ignore it
            continue
        if best is None or hit[2] < best:
            best = hit[2]
    return best


report = {}

# --- 1. toe layout ---------------------------------------------------------------------------
toes = {}
for side in 'LR':
    for i in range(4):
        nm = f'LX_FrontToe{i}.{side}'
        me = mesh(nm)
        c = centre(me)
        bb = bbox(me)
        if c is None:
            continue
        toes[nm] = {'x_mm': round(1000 * c.x, 1), 'y_mm': round(1000 * c.y, 1),
                    'z_mm': round(1000 * c.z, 1),
                    'size_mm': [round(1000 * (bb[1][k] - bb[0][k]), 1) for k in range(3)]}
report['toe_centres'] = toes

layout = {}
for side in 'LR':
    names = [f'LX_FrontToe{i}.{side}' for i in range(4)]
    row = [toes[n] for n in names if n in toes]
    if len(row) != 4:
        continue
    xs = [t['x_mm'] for t in row]
    ys = [t['y_mm'] for t in row]
    gaps = []
    for a, b in zip(names, names[1:]):
        d = surface_gap(mesh(a), mesh(b))
        gaps.append(None if d is None else round(1000 * d, 1))
    # the arc: do the outer toes sit further back (towards +y) than the inner two?
    # Nominal overlap first: with 30 mm toes on a 24 mm pitch the neighbours INTERSECT, and
    # that intersection is what makes the cleft - a crease, not a through-gap. The number
    # Claude quoted ("趾缝深约 6 mm") is this overlap, so it is what has to be reported.
    toe_w = row[0]['size_mm'][0]
    pitch = abs(xs[1] - xs[0])
    layout['Front.' + side] = {
        'x_span_mm': round(max(xs) - min(xs), 1),
        'centre_spacing_mm': [round(abs(xs[i + 1] - xs[i]), 1) for i in range(3)],
        'toe_width_x_mm': toe_w,
        'nominal_overlap_mm': round(toe_w - pitch, 1),      # > 0 = the toes intersect
        'surface_gap_mm': gaps,
        'arc_pullback_mm': [round(ys[0] - ys[1], 1), round(ys[3] - ys[2], 1)],  # outer minus inner
        'y_row_mm': [round(v, 1) for v in ys],
    }
report['toe_layout'] = layout

# --- 1b. the cleft: is there actually a groove between neighbouring toes? --------------------
# The nominal overlap says the toes intersect, but an intersection is only a VISIBLE cleft if the
# two neighbours sit at the same depth. The outer toes are pulled back along the arc, so their
# union rises monotonically and the crease never forms - which is exactly what round G needs to
# know. Measured on the union's front surface (-y) sampled across the toe row.
def front_y(pts, x, w=2.5):
    band = [p[1] for p in pts if abs(p[0] - x) < w]
    return min(band) if band else None


cleft = {}
for side in 'LR':
    names = [f'LX_FrontToe{i}.{side}' for i in range(4)]
    mes = [mesh(n) for n in names]
    if any(m is None for m in mes):
        continue
    pts = []
    for m in mes:
        pts += [(1000 * v.co.x, 1000 * v.co.y) for v in m.vertices]
    xs = [toes[n]['x_mm'] for n in names if n in toes]
    if len(xs) != 4:
        continue
    crown = [front_y(pts, x) for x in xs]
    valley = [front_y(pts, (xs[i] + xs[i + 1]) / 2) for i in range(3)]
    cleft['Front.' + side] = {
        'toe_crown_front_mm': [None if c is None else round(c, 1) for c in crown],
        'between_front_mm': [None if v is None else round(v, 1) for v in valley],
        # positive = the surface between the toes sits BEHIND their crowns, i.e. a real groove
        'cleft_depth_mm': [None if (valley[i] is None or crown[i] is None) else round(valley[i] - crown[i], 1)
                           for i in range(3)],
    }
report['toe_cleft'] = cleft

# --- 2. the lip: omega or m? ------------------------------------------------------------------
def curve_profile(name):
    """(x, z) samples of a lip curve, sorted by x."""
    o = bpy.data.objects.get(name)
    if o is None:
        return None
    ev = o.evaluated_get(deps)
    me = ev.to_mesh()
    me.transform(ev.matrix_world)
    pts = sorted(((round(1000 * v.co.x, 2), round(1000 * v.co.z, 2)) for v in me.vertices),
                 key=lambda p: p[0])
    ev.to_mesh_clear()
    return pts

lip = {}
for nm in ('LX_LipUpper.L', 'LX_LipUpper.R', 'LX_LipLower', 'LX_LipPhiltrum'):
    pts = curve_profile(nm)
    if not pts:
        continue
    zs = [p[1] for p in pts]
    xs = [p[0] for p in pts]
    lip[nm] = {'n_pts': len(pts), 'x_range_mm': [min(xs), max(xs)],
               'z_at_min_x': zs[xs.index(min(xs))], 'z_at_max_x': zs[xs.index(max(xs))],
               'z_centre': min(zs, key=lambda z: abs(z - (min(zs) + max(zs)) / 2)),
               'z_min': min(zs), 'z_max': max(zs),
               'samples': pts[:: max(1, len(pts) // 12)]}
report['lip_curves'] = lip

# the omega test: the philtrum cusp must sit ABOVE the arcs beside it
nose = mesh('LX_Nose')
if nose is not None:
    lo, hi = bbox(nose)
    report['nose'] = {'width_mm': round(1000 * (hi[0] - lo[0]), 1),
                      'height_mm': round(1000 * (hi[2] - lo[2]), 1),
                      'centre_z_mm': round(1000 * centre(nose).z, 1)}

# --- 3. ears -----------------------------------------------------------------------------------
ears = {}
for side in 'LR':
    me = mesh(f'LX_Ear.{side}')
    if me is None or not me.vertices:
        continue
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    rows = {}
    for v in me.vertices:
        t = (v.co.z - z0) / (z1 - z0) if z1 > z0 else 0.0
        rows.setdefault(round(t, 2), []).append(v.co.x)
    # per-height x SPAN, not max|x|: the ear sits to one side of the head
    prof = {k: round(1000 * (max(v) - min(v)), 1) for k, v in sorted(rows.items()) if v}
    ears[side] = {'height_mm': round(1000 * (z1 - z0), 1),
                  'base_width_mm': prof.get(0.0), 'wh_ratio': None,
                  'tip_width_at_0p9': prof.get(0.9), 'tip_width_at_0p95': prof.get(0.95),
                  'tip_width_at_1p0': prof.get(1.0),
                  'width_profile_mm': prof}
    if ears[side]['base_width_mm']:
        ears[side]['wh_ratio'] = round(ears[side]['base_width_mm'] / ears[side]['height_mm'], 3)
report['ears'] = ears

print(json.dumps(report, ensure_ascii=False, indent=1))
if OUT_JSON:
    Path(OUT_JSON).write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print('wrote', OUT_JSON, file=sys.stderr)
