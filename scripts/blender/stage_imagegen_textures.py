#!/usr/bin/env python3
"""Stage the AI-generated五官 textures into a build texture directory.

Reads (never writes) assets/characters/lingxi/v5-imagegen-sources/ and produces the
files the build actually loads:
  - first runs make_skin_textures.py so the procedural/tileable maps exist too
  - then resizes every AI map to a power of two and flattens its alpha channel

The sources are read-only: nothing in v5-imagegen-sources is modified.

usage: stage_imagegen_textures.py [--out DIR] [--sources DIR]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SRC = ROOT / 'assets/characters/lingxi/v5-imagegen-sources'
DEFAULT_OUT = ROOT / 'assets/characters/lingxi/v5-texdev/textures'

# name -> target power-of-two size (w, h)
AI_MAPS = {
    'iris_albedo': (1024, 1024),
    'iris_bump': (1024, 1024),
    'iris_occlusion': (1024, 1024),
    'lid_skin': (1024, 512),     # the lid fan is 2:1 - u around the arc, v inner->outer
    'lid_bump': (1024, 512),
    'nose_skin': (1024, 1024),
    'nose_bump': (1024, 1024),
    'ear_fur': (1024, 1024),
    'ear_bump': (1024, 1024),
    'pad_skin': (1024, 1024),
    'pad_bump': (1024, 1024),
    'tongue': (1024, 1024),
    'tongue_bump': (1024, 1024),
    'mouth_dark': (1024, 1024),
}


def flatten_alpha(im):
    """AI exports carry a partly transparent border (alpha min ~167). Compositing over
    white is right for these: they were generated on a light background."""
    if im.mode != 'RGBA':
        return im.convert('RGB')
    a = np.asarray(im)
    alpha = a[:, :, 3:4].astype('f') / 255.
    rgb = a[:, :, :3].astype('f')
    out = rgb * alpha + 255. * (1. - alpha)
    return Image.fromarray(np.clip(out, 0, 255).astype('uint8'), mode='RGB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    ap.add_argument('--sources', default=str(DEFAULT_SRC))
    ap.add_argument('--skip-procedural', action='store_true')
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    src = Path(args.sources)

    if not args.skip_procedural:
        gen = ROOT / 'scripts/blender/make_skin_textures.py'
        if gen.exists():
            subprocess.run([sys.executable, str(gen), '--out', str(out)], check=True)

    staged, missing = [], []
    for name, size in AI_MAPS.items():
        f = src / f'{name}.png'
        if not f.exists():
            missing.append(name)
            continue
        im = flatten_alpha(Image.open(f))
        if im.size != size:
            im = im.resize(size, Image.LANCZOS)
        dst = out / f'{name}.png'
        im.save(dst, optimize=True)
        arr = np.asarray(im, dtype='f') / 255.
        staged.append({'name': f'{name}.png', 'size': size,
                       'mean': round(float(arr.mean()), 3),
                       'std': round(float(arr.std()), 3)})

    print(json.dumps({'out': str(out), 'staged': len(staged),
                      'missing': missing, 'maps': staged}, ensure_ascii=False))


if __name__ == '__main__':
    main()
