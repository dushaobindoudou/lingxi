#!/usr/bin/env python3
"""v6 -- does the oral bag poke through the closed muzzle? Solve it before building.

The mouth interior (cavity / floor / tongue / canines) is a bag of spheres inside a muzzle of
spheres. Whether it shows with the mouth shut is a pure depth question - is the bag's front
surface in front of the skin's front surface, at the same (x, z) - and it can be answered from
the two ellipsoid sets without building, meshing or rendering anything.

That matters because the build is ~4 minutes and the failure is invisible in the numbers the
build prints: it only shows up as a patch of the wrong object in a render.

    python v6_preflight_mouth.py                 # current build values
    V6_MUZZLE_GROW=.008 V6_CHIN_RZ=.030 python v6_preflight_mouth.py
"""
from __future__ import annotations

import math
import os

import numpy as np


def env(name, default):
    return float(os.environ.get(name, default))


# --- the build's dials, mirrored -----------------------------------------------------------------
G = env('V6_MUZZLE_GROW', .008)                    # muzzle lobes grow down, top edge fixed
MOUTH_DZ = env('V6_MOUTH_DZ', -.0216)
MOUTH_W = .036 * env('V6_MOUTH_W', .49)
TB = env('V6_TOOTH_BACK', 0.0)                     # metres the canines move back (+y) into the mouth
HEAD_SX, HEAD_SZ = env('V6_HEAD_SX', 1.06), env('V6_HEAD_SZ', .95)
PIVOT = np.array([0.0, -.16, .48])
E = env('V6_E', .13568)
EYE_Z = env('V6_EYE_Z_WORLD', .5209)

# chin lobe (0 = none): if added to the head merge it is the thing that closes the gap
CHIN = (env('V6_CHIN_Y', -.398), env('V6_CHIN_Z', .424),
        env('V6_CHIN_RX', .050), env('V6_CHIN_RY', .042), env('V6_CHIN_RZ', .030),
        env('V6_CHIN', 0.0))

# An ellipsoid is (centre, radii, x-limit for the union). Only the FRONT hemisphere matters.
MUZZLES = [((-0.034, -.405, .462 - G), (.056, .044, .040 + G)),
           ((0.034, -.405, .462 - G), (.056, .044, .040 + G))]
BAG = [
    ('LX_MouthCavity', (0, -.392, .448 + MOUTH_DZ), (.034, .032, .016)),
    ('LX_MouthFloor', (0, -.394, .440 + MOUTH_DZ), (.026, .028, .006)),
    ('LX_Tongue', (0, -.3975, .437 + MOUTH_DZ), (.0135, .0255, .0042)),
]
for s in (-1, 1):
    BAG.append(('Tooth.up', (s * MOUTH_W * .57, -.436 + TB, .451 + MOUTH_DZ), (.0021, .0021, .0055)))
    BAG.append(('Tooth.dn', (s * MOUTH_W * .47, -.434 + TB, .445 + MOUTH_DZ), (.0021, .0021, .0042)))


def front(centre, radii, x, z):
    """Smallest y (nearest the camera) on the ellipsoid at this (x, z); +inf where it is absent.

    This is the front hemisphere, so it is exactly the surface the face camera sees: the
    ellipsoid only covers a plinth of the (x, z) plane, and outside that plinth there is no skin
    at all - which is precisely how a muzzle lobe stops covering the bag near its bottom edge.
    """
    dx = (x - centre[0]) / radii[0]
    dz = (z - centre[2]) / radii[2]
    q = 1 - dx * dx - dz * dz
    if q <= 0:
        return math.inf
    return centre[1] - radii[1] * math.sqrt(q)


def skin_front(x, z):
    y = min(front(c, r, x, z) for c, r in MUZZLES)
    if CHIN[5]:
        cy, cz, rx, ry, rz, on = CHIN
        y = min(y, front((0, cy, cz), (rx, ry, rz), x, z))
    return y


def bag_front(x, z):
    best, who = math.inf, None
    for name, c, r in BAG:
        y = front(c, r, x, z)
        # the canines taper to a point; near the tip they are much thinner than the sphere
        if y < best:
            best, who = y, name
    return best, who


def to_world_z(z):
    return PIVOT[2] + HEAD_SZ * (z - PIVOT[2])


def to_world_x(x):
    return HEAD_SX * x


print(f'MUZZLE_GROW {G:.4f}  CHIN {"off" if not CHIN[5] else CHIN[:5]}')
print(f'{"dy (E)":>7s} {"z (mm)":>8s}   per-x: skin front / bag front (mm)   verdict')
xs = [0.0, .005, .010, .014, .018]
bad = []
for dy in np.arange(0.50, 1.00, .02):
    zw = EYE_Z - dy * E
    z = PIVOT[2] + (zw - PIVOT[2]) / HEAD_SZ
    cells = []
    worst = None
    for x in xs:
        s = skin_front(x, z)
        b, who = bag_front(x, z)
        sx = to_world_x(x)
        # convert to mm for reading
        cells.append(f'{s * 1000:7.1f}/{b * 1000:7.1f}')
        if b < s - 1e-6:
            gap = (s - b) * 1000
            if worst is None or gap > worst[0]:
                worst = (gap, sx, who, s, b)
    if worst:
        bad.append((dy, worst))
        v = f'shows {worst[2]} at x={worst[1] * 1000:+.1f}mm by {worst[0]:.1f}mm'
    else:
        v = 'ok'
    print(f'{dy:>7.2f} {zw * 1000:>8.1f}   ' + '  '.join(cells) + f'  {v}')

if bad:
    print(f'\n=== {len(bad)} rows leak ===')
    print(f'  worst dy {" / ".join(f"{d:.2f}" for d, _ in bad[:6])}')
    lo = min(d for d, _ in bad)
    hi = max(d for d, _ in bad)
    print(f'  leaking band dy {lo:.2f}..{hi:.2f}  ({(hi - lo) * E * 1000:.1f} mm tall)')
else:
    print('\n=== closed mouth is tight: no bag surface in front of the skin ===')
