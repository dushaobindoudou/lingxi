#!/usr/bin/env python3
"""Generate every shipped icon from the two brand masters.

Run: python3 scripts/build-icons.py     (needs Pillow: python3 -m pip install pillow)

This exists because the icon set was previously produced by hand, one file at a time, and the
sizes disagreed with each other in ways that only showed up on screen:

  * the app icon's rounded card covered 84% of the canvas at 512px but 100% at 32px and 16px,
    because the small ones had been cropped rather than scaled - so the corner radius, which is
    a fraction of the card, shrank to 11.5% at 32px and to ZERO at 16px. The icon was a rounded
    square when it was large and a hard-cornered square when it was small.
  * the tray glyph filled 48% of its canvas height, the rest transparent padding. The macOS
    tray backend (tray-icon 0.24, platform_impl/macos/mod.rs) scales whatever it is given so the
    IMAGE is exactly 18pt tall - padding included - so half that budget was spent on empty space
    and the cat rendered at roughly 8.7pt next to 16-18pt system glyphs.

Both are geometry, so both are fixed by deriving every output from one master with one set of
proportions, instead of by re-exporting individual files until they look right.
"""
import os
import subprocess
import sys
import tempfile

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("需要 Pillow：python3 -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_MASTER = os.path.join(ROOT, "assets/brand/lingxi-icon-v3.png")
TRAY_MASTER = os.path.join(ROOT, "assets/brand/lingxi-tray-icon-v2.png")
ICONS = os.path.join(ROOT, "apps/lingxi/src-tauri/icons")
PUBLIC_ICON = os.path.join(ROOT, "apps/lingxi/public/icon.png")

# Apple's macOS app-icon grid: the rounded square is 824pt inside a 1024pt canvas, with a corner
# radius of 185.4pt. Expressed as fractions so every size derives from the same shape rather than
# from a resize of a resize.
CARD_FRACTION = 824 / 1024   # 80.5% of the canvas
RADIUS_FRACTION = 185.4 / 824  # 22.5% of the card
# Rendering the mask at 8x and downsampling is what keeps the curve clean at 16px, where the
# radius is under 3px and a directly-rasterised arc turns into stair-steps or disappears.
SUPERSAMPLE = 8
# The corner curve, as the exponent of |x|^n + |y|^n = r^n.
#
# n=2 is a quarter circle. n=5 approximates the continuous-corner superellipse macOS itself uses,
# which is subtly SQUARER - it hugs the corner and only falls away near the diagonal. That makes
# it the wrong choice here, which is worth recording because it is counter-intuitive: the shape
# that is "more macOS" is the one that reads as 直角. Rendered at 32px the difference is stark -
# the alpha along the corner diagonal goes [1, 15, 255] at n=2 and [8, 255, 249] at n=5, i.e. a
# squircle at this size cuts barely one pixel and the corner looks square.
#
# The report this file is answering was specifically "展示成了直角，而不圆角", so the corner is a
# circle: unambiguously round at 1024px and still visibly round at 16px, which is where the old
# icon set had gone square.
CORNER_EXPONENT = 2.0


def solid_bbox(image, threshold=200):
    """Bounding box of the genuinely opaque pixels.

    Not Image.getbbox(), which counts the soft drop shadow outside the card and therefore reports
    a box several percent larger than the card - measure the radius against that and every number
    comes out wrong.
    """
    alpha = image.getchannel("A")
    mask = alpha.point(lambda a: 255 if a >= threshold else 0)
    box = mask.getbbox()
    if box is None:
        raise SystemExit("母版里找不到不透明像素")
    return box


def card_background(card):
    """The card's flat background colour, sampled just inside its top edge.

    Taken from the middle of the top edge rather than averaged: the corners are the only place
    this shows, the background there is the same flat cream, and an average would pull in the
    cat's fur.
    """
    w, _ = card.size
    band = [card.getpixel((x, max(2, w // 64))) for x in range(w // 2 - w // 20, w // 2 + w // 20)]
    opaque = [p for p in band if p[3] > 250]
    if not opaque:
        opaque = band
    n = len(opaque)
    return tuple(sum(p[i] for p in opaque) // n for i in range(3)) + (255,)


def squircle_mask(size, radius):
    """A continuous-corner rounded square, antialiased."""
    big = size * SUPERSAMPLE
    r = radius * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle([r, 0, big - r, big], fill=255)
    draw.rectangle([0, r, big, big - r], fill=255)
    # Each corner is one quadrant of |x|^n + |y|^n = r^n, drawn as a filled polygon.
    steps = max(64, int(r))
    for cx, cy, sx, sy in (
        (r, r, -1, -1),
        (big - r, r, 1, -1),
        (big - r, big - r, 1, 1),
        (r, big - r, -1, 1),
    ):
        points = [(cx, cy)]
        for i in range(steps + 1):
            t = i / steps
            # Walk the quadrant by parameterising x, solving for y on the superellipse.
            x = t
            y = (1 - x ** CORNER_EXPONENT) ** (1 / CORNER_EXPONENT)
            points.append((cx + sx * x * r, cy + sy * y * r))
        draw.polygon(points, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def build_app_icon(size):
    """One canonical app icon at `size`, built from the master's card artwork."""
    master = Image.open(APP_MASTER).convert("RGBA")
    box = solid_bbox(master)
    card = master.crop(box)

    # Everything is laid out at 1024 and scaled once at the end, so a 16px icon has exactly the
    # same proportions as a 1024px one.
    canvas_side = 1024
    card_side = round(canvas_side * CARD_FRACTION)
    radius = round(card_side * RADIUS_FRACTION)

    card = card.resize((card_side, card_side), Image.LANCZOS)

    # Lay the card on an opaque plate of its own background colour BEFORE masking.
    #
    # The master's corners are cut with a circular arc; a superellipse of the same nominal radius
    # hugs the corner more closely, so the new mask keeps a thin sliver that the master had
    # already made transparent. Replacing the alpha channel there - putalpha on its own - turns
    # those pixels opaque while their RGB is still the (0,0,0) that PNG stores under full
    # transparency, which paints a black wedge into all four corners. Compositing onto the card's
    # own cream first means whatever the wider curve re-exposes is the colour the card's edge
    # already is.
    plate = Image.new("RGBA", (card_side, card_side), card_background(card))
    plate.alpha_composite(card)
    card = plate
    card.putalpha(squircle_mask(card_side, radius))

    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    offset = (canvas_side - card_side) // 2
    canvas.paste(card, (offset, offset), card)
    return canvas if size == canvas_side else canvas.resize((size, size), Image.LANCZOS)


def build_tray_icon(height=128, fill=0.88):
    """The menu-bar glyph, cropped so it actually fills the 18pt the backend gives it.

    The canvas deliberately is NOT square. tray-icon scales by height alone
    (`icon_width = width / (height / 18.0)`), so any padding above or below is subtracted
    directly from how tall the cat can be, while extra width costs nothing but a slightly wider
    status item - which is the right trade for a face that is wider than it is tall.
    """
    master = Image.open(TRAY_MASTER).convert("RGBA")
    glyph = master.crop(solid_bbox(master, threshold=40))
    gw, gh = glyph.size

    canvas_h = round(gh / fill)
    margin = (canvas_h - gh) // 2
    canvas_w = gw + margin * 2
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas.paste(glyph, (margin, margin), glyph)

    width = round(height * canvas_w / canvas_h)
    return canvas.resize((width, height), Image.LANCZOS)


def write(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path)
    print(f"  {os.path.relpath(path, ROOT):<48} {image.size[0]}x{image.size[1]}")


def main():
    print("应用图标：")
    for name, size in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]:
        write(build_app_icon(size), os.path.join(ICONS, name))

    write(build_app_icon(512), PUBLIC_ICON)

    # .ico keeps the sizes Windows asks for; Pillow writes them all into one file.
    ico_path = os.path.join(ICONS, "icon.ico")
    build_app_icon(256).save(
        ico_path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]
    )
    print(f"  {os.path.relpath(ico_path, ROOT):<48} 16/24/32/48/64/256")

    # .icns via iconutil, which is the only thing that writes the modern compressed reps macOS
    # actually prefers. Every rep is rendered from the 1024 layout, so the 16px one is the same
    # shape as the 1024px one - which is precisely what was not true before.
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for name, size in [
            ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
            ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
            ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
            ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
            ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
        ]:
            build_app_icon(size).save(os.path.join(iconset, name))
        icns = os.path.join(ICONS, "icon.icns")
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
        print(f"  {os.path.relpath(icns, ROOT):<48} 16…1024")

    print("托盘图标：")
    write(build_tray_icon(), os.path.join(ICONS, "tray-icon.png"))


if __name__ == "__main__":
    main()
