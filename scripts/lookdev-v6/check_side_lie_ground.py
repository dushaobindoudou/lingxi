"""Check the evaluated SideLie mesh at every frame, including unkeyed frames.

Usage: python3 scripts/lookdev-v6/check_side_lie_ground.py MODEL.blend
"""

import os
import re
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    model = Path(sys.argv[1]).resolve()
    script = Path(__file__).with_name("v6_clip_lowscan.py")
    env = {**os.environ, "FRAMES": "249,296,1"}
    run = subprocess.run(
        [os.environ.get("BLENDER_BIN", "/Applications/Blender.app/Contents/MacOS/Blender"),
         "-b", str(model), "--python", str(script)],
        env=env, text=True, capture_output=True,
    )
    lines = [line for line in run.stdout.splitlines() if line.startswith("LOW ")]
    if run.returncode or len(lines) != 1 or "Traceback" in run.stderr:
        print(run.stdout + run.stderr, file=sys.stderr)
        return 2
    readings = [(int(frame), float(mm)) for frame, mm in re.findall(r"(\d+):(-?\d+(?:\.\d+)?)", lines[0])]
    if len(readings) != 48:
        print(f"Expected 48 SideLie frames, got {len(readings)}", file=sys.stderr)
        return 2
    bad = [(frame, mm) for frame, mm in readings if mm < -2.5]
    worst = min(readings, key=lambda item: item[1])
    print(f"SideLie frames 249–296: worst {worst[1]:.1f} mm at frame {worst[0]}; {len(bad)} below -2.5 mm")
    if bad:
        print("Penetrating frames:", bad)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
