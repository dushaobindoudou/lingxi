"""Fail if a review render has the old full-width black ground strip.

Usage: python3 check_review_ground.py stand-side.png sit-side.png ...
"""

import sys

import numpy as np
from PIL import Image


if len(sys.argv) < 2:
    raise SystemExit(__doc__.strip())

failed = False
for path in sys.argv[1:]:
    image = np.asarray(Image.open(path).convert("RGB"))
    dark_fraction = (image.max(axis=2) < 25).mean(axis=1)
    band_rows = int((dark_fraction > .85).sum())
    print(f"{path}: {band_rows} black strip rows")
    failed |= band_rows > 2
raise SystemExit(1 if failed else 0)
