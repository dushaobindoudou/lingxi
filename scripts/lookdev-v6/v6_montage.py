"""v6 look-dev -- tile images into one contact sheet so a sweep can be judged at a glance.

  python v6_montage.py --out sheet.png --cols 3 "label=path" ...

Labels render with PingFang so Chinese stays legible.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = ['/System/Library/Fonts/PingFang.ttc',
                   '/System/Library/Fonts/Helvetica.ttc']


def font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--height', type=int, default=400)
    ap.add_argument('--cols', type=int, default=0)
    ap.add_argument('--pad', type=int, default=10)
    ap.add_argument('items', nargs='+')
    a = ap.parse_args()

    pairs = []
    for it in a.items:
        label, _, path = it.partition('=')
        if not path:
            label, path = Path(it).stem, it
        pairs.append((label, path))

    tiles = []
    for label, path in pairs:
        im = Image.open(path).convert('RGB')
        w = max(1, int(round(im.width * a.height / im.height)))
        tiles.append((label, im.resize((w, a.height), Image.LANCZOS)))

    cols = a.cols or len(tiles)
    rows = (len(tiles) + cols - 1) // cols
    f = font(22)
    bar = 30
    col_w = [max(tiles[i][1].width for i in range(len(tiles)) if i % cols == c) for c in range(cols)]
    W = a.pad + sum(w + a.pad for w in col_w)
    H = a.pad + rows * (a.height + bar + a.pad)
    sheet = Image.new('RGB', (W, H), (250, 250, 250))
    d = ImageDraw.Draw(sheet)

    for i, (label, im) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = a.pad + sum(col_w[:c]) + a.pad * c
        y = a.pad + r * (a.height + bar + a.pad)
        sheet.paste(im, (x, y))
        d.text((x + 2, y + a.height + 4), label, fill=(20, 20, 20), font=f)

    sheet.save(a.out)
    print(f'wrote {a.out}  {sheet.size[0]}x{sheet.size[1]}  ({len(tiles)} tiles)')


if __name__ == '__main__':
    main()
