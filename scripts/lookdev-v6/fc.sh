#!/usr/bin/env bash
# Final check (2026-10-13; tracked copy - the working copy lives in v6/round-v-test): $1 = model dir, $2 = out dir. Renders ours from the camera of every body / pose / action ref codex made,
# at the current clip frames (animations.json: Run 121-152, Jump 153-200, LieDown 201-248, SideLie 249-296, Sleep 297-368, Lick 525-572,
# Stretch 669-728, Sit 777-824, Loaf 825-884, BellyUp 885-944, ScratchEar 945-1004, WashFace 1005-1064, GroomSide 1065-1124, Turn 1125-1172),
# four at a time. Each line: key frame view [focus span].
M=$1/lingxi-short-fur-rig-v5.blend; O=$2; mkdir -p $O; B=/Applications/Blender.app/Contents/MacOS/Blender; RT=$(cd $(dirname $0) && pwd)/render_target.py
run(){ local k=$1 f=$2 v=$3 fo=${4:-} sp=${5:-}; if [ -n "$fo" ]; then FOCUS=$fo SPAN=$sp FRAME=$f VIEW=$v OUT=$O/$k.png RES=${RES:-420} SAMPLES=${SAMPLES:-24} $B -b $M --python $RT > $O/$k.log 2>&1
 else FRAME=$f VIEW=$v OUT=$O/$k.png RES=${RES:-420} SAMPLES=${SAMPLES:-24} $B -b $M --python $RT > $O/$k.log 2>&1; fi; grep -q "^Traceback" $O/$k.log && echo "FAIL $k"; }
n=0
while read k f v fo sp; do [ -z "$k" ] && continue; run $k $f $v $fo $sp & n=$((n+1)); [ $((n%4)) -eq 0 ] && wait; done <<LIST
stand-side 1 side
stand-app 1 app
paw-front 1 front FrontPaw.R .14
paw-side 1 side FrontPaw.L .14
run-ext 134 side
run-gat 150 side
jump-crouch 162 side
jump-takeoff 167 side
jump-air 177 side
jump-land 189 side
liedown-side 240 side
liedown-app 240 app
liedown-top 240 top
lie-front-low 240 front
lie-back 240 back
sidelie-app 288 app
sidelie-top 288 top
sleep-app 330 app
sleep-top 330 top
lick-paw 550 app
stretch 700 side
sit-front 805 front
sit-side 805 side
sit-back 805 back
sit-hindfoot 805 side RearPaw.L .16
loaf 860 app
belly-up 915 app
scratch-ear 975 app
wash-face 1035 app
groom-side 1095 app
turn 1150 app
LIST
wait; echo FC_DONE
