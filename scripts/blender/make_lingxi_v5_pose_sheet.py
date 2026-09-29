"""Build a labeled contact sheet from the v5 pose-review renders."""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
POSES = Path(os.environ.get("LINGXI_OUT", ROOT / "assets/characters/lingxi/v5")) / "poses"
NAMES = [
    "Idle", "Walk", "Run", "Jump", "LieDown", "SideLie", "Sleep", "Curious",
    "Happy", "Yawn", "Lick", "Bite", "Knead", "Stretch", "PawPlay",
]
CELL, LABEL, COLS = 300, 34, 5
ROWS = (len(NAMES) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * CELL, ROWS * (CELL + LABEL)), (238, 233, 224))
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default()
for i, name in enumerate(NAMES):
    path = POSES / f"{name}.png"
    with Image.open(path) as src:
        thumb = src.convert("RGB"); thumb.thumbnail((CELL, CELL), Image.Resampling.LANCZOS)
    x, y = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL)
    sheet.paste(thumb, (x + (CELL - thumb.width) // 2, y))
    draw.text((x + 12, y + CELL + 9), name, fill=(66, 55, 48), font=font)
out = POSES / "contact-sheet.png"
sheet.save(out, optimize=True)
print(out)
