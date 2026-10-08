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
    # round L (2026-10-08, codex image_gen - see TONGUE-PAW-PROMPTS.md): a kitten's smooth bubblegum tongue
    # and soft baby-pink pads in place of the adult tongue's red barbs and the pebbled brown pad leather,
    # and a seamless short-fur height tile for the toes and the bald sole
    'tongue_v2': (1024, 1024),
    'pad_skin_v2': (1024, 1024),
    'paw_fur_tile': (1024, 1024),
    'pad_main_mask': (1024, 1024),   # the main pad's three-lobed shape, alpha on its oval
}


def derived_bumps(out):
    """Height maps for the round-L albedos, made here rather than painted: a second generation would not
    register with the first. Tongue: the centre groove (the albedo's own darker line, x=512) as a soft valley
    plus the albedo's fine papilla speckle; pad: the fine skin speckle only. Mid-grey = flat."""
    from PIL import ImageFilter
    made = []
    for name, groove in (('tongue_v2', True), ('pad_skin_v2', False)):
        f = out / f'{name}.png'
        if not f.exists():
            continue
        lum = np.asarray(Image.open(f).convert('L'), dtype='f')
        fine = lum - np.asarray(Image.fromarray(lum.astype('uint8')).filter(ImageFilter.GaussianBlur(6)), dtype='f')
        fine = fine / max(1e-6, float(np.abs(fine).std())) * 10.0          # unit speckle, ~10 grey levels
        h = 128.0 + fine
        if groove:
            x = np.arange(lum.shape[1], dtype='f') - lum.shape[1] / 2
            h -= 55.0 * np.exp(-(x / 26.0) ** 2)[None, :]                   # the groove, ~5% of the width
        Image.fromarray(np.clip(h, 0, 255).astype('uint8'), mode='L').save(out / f'{name}_bump.png', optimize=True)
        made.append(f'{name}_bump.png')
    return made


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
    ap.add_argument('--only', nargs='*', help='stage just these map names (e.g. tongue_v2 pad_skin_v2 paw_fur_tile)')
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
        if args.only and name not in args.only:
            continue
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

    bumps = derived_bumps(out)
    print(json.dumps({'out': str(out), 'staged': len(staged), 'derived': bumps,
                      'missing': missing, 'maps': staged}, ensure_ascii=False))


if __name__ == '__main__':
    main()
