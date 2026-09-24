#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
MODEL="$ROOT/assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend"

"$BLENDER_BIN" --background --python "$ROOT/scripts/blender/build_lingxi_v5.py"
"$BLENDER_BIN" --background "$MODEL" --python "$ROOT/scripts/blender/native_fur_lingxi_v5.py"
"$BLENDER_BIN" --background "$MODEL" --python "$ROOT/scripts/blender/render_lingxi_v5_poses.py"
python3 "$ROOT/scripts/blender/make_lingxi_v5_pose_sheet.py"
