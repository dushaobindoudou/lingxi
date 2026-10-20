"""Compose a face sheet from v6_face_apply.py's output: python3 v6_face_sheet.py <dir> [cols] -> <dir>/sheet.jpg (labelled grid)."""
import json, sys
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 7; S = 220
items = json.load(open(d + '/items.json'))
font = ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', 16)
rows = (len(items) + cols - 1) // cols
c = Image.new('RGB', (cols * S, rows * (S + 22)), (255, 255, 255)); dr = ImageDraw.Draw(c)
for i, (name, fn) in enumerate(items):
    x = (i % cols) * S; y = (i // cols) * (S + 22)
    c.paste(Image.open(fn).convert('RGB').resize((S, S)), (x, y + 22)); dr.text((x + 4, y + 2), name, fill=(0, 0, 0), font=font)
c.save(d + '/sheet.jpg', quality=86); print(d + '/sheet.jpg', len(items))
