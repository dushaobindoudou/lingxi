#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
MODEL="$ROOT/assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend"
TEXDIR="$ROOT/assets/characters/lingxi/v5/textures"

# The generated PBR maps live outside Git (see .gitignore), so rebuild them first.
# Without numpy/Pillow the build still works: every texmat() falls back to flat colour.
PY="${PYTHON_BIN:-python3}"
if "$PY" -c 'import numpy, PIL' >/dev/null 2>&1; then
  "$PY" "$ROOT/scripts/blender/make_skin_textures.py" --out "$TEXDIR"
else
  echo "warning: numpy/Pillow unavailable via $PY - building with flat fallback materials" >&2
fi

"$BLENDER_BIN" --background --python "$ROOT/scripts/blender/build_lingxi_v5.py"
"$BLENDER_BIN" --background "$MODEL" --python "$ROOT/scripts/blender/native_fur_lingxi_v5.py"
"$BLENDER_BIN" --background "$MODEL" --python "$ROOT/scripts/blender/render_lingxi_v5_poses.py"
python3 "$ROOT/scripts/blender/make_lingxi_v5_pose_sheet.py"
