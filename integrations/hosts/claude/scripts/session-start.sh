#!/usr/bin/env bash
# SessionStart: make sure 灵犀 is installed and running, then tell it a session began.
#
# Returns in milliseconds whatever it finds - a SessionStart hook blocks the session, and
# neither a 16 MB download nor a GUI app booting may do that. Anything slow runs detached and
# delivers this session's event itself when it is done.
#
#   installed, running      post the event
#   installed, not running  start it (without taking focus), wait, post              [auto_open]
#   not installed           install it in the background, open it in front, show the
#                           Claude page, post                                        [auto_install]
#
# It prints only when there is something the user or the model needs to know - a first
# install under way, an install that failed, the app missing with installs turned off - and
# says each of those at most once a day. A session where everything simply works prints nothing.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PAYLOAD="$(cat)"
SOURCE="$(sed -n 's/.*"source" *: *"\([a-z]*\)".*/\1/p' <<<"$PAYLOAD" | sed -n 1p)"
mkdir -p "$LX_STATE_DIR" 2>/dev/null

MESSAGE=""; CONTEXT=""
emit() {
  [ -n "$MESSAGE$CONTEXT" ] || exit 0
  printf '{'
  [ -n "$MESSAGE" ] && printf '"systemMessage":"%s"' "$(lx_json_escape "$MESSAGE")"
  if [ -n "$CONTEXT" ]; then
    [ -n "$MESSAGE" ] && printf ','
    printf '"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}' "$(lx_json_escape "$CONTEXT")"
  fi
  printf '}\n'
  exit 0
}

# A compaction is not a new session - nothing to tell the cat, and the app was checked when the
# session actually started.
[ "$SOURCE" = compact ] && exit 0

# The "一键接入" hooks in settings.json post this same event; do not make the cat hear it twice.
POST=1
lx_oneclick_hooks_installed && POST=0
reactions="$(lx_option reactions all)"
[ "$reactions" = off ] && POST=0

# Everything slow goes through here: detached, stdio closed, so the hook returns immediately.
detach() { ( "$@" ) </dev/null >/dev/null 2>&1 & }
post_when_up() {
  lx_wait_bridge "${1:-20}" || return 0
  [ "$POST" = 1 ] && printf '%s' "$PAYLOAD" | lx_post /task-event >/dev/null
  return 0
}

APP="$(lx_app_path)"

# --- not installed --------------------------------------------------------------------------------
if [ -z "$APP" ]; then
  if [ -d "$LX_STATE_DIR/install.lock" ] && [ -z "$(find "$LX_STATE_DIR/install.lock" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    CONTEXT="The 灵犀 desktop-cat app is still being installed in the background. Skip lingxi commands this session unless the user asks."
    emit
  fi
  if lx_may_install; then
    REPLAY=""
    if [ "$POST" = 1 ]; then REPLAY="$LX_STATE_DIR/pending-session-start.json"; printf '%s' "$PAYLOAD" > "$REPLAY"; fi
    detach "$LX_PLUGIN_ROOT/scripts/install-app.sh" --open ${REPLAY:+--replay "$REPLAY"}
    MESSAGE="灵犀：第一次使用，正在后台下载安装桌面猫（约 16 MB），装好会自动打开。进度可以用 /lingxi:status 查看。"
    CONTEXT="The 灵犀 desktop-cat app is being installed in the background right now. Do not run lingxi commands this session unless the user asks; /lingxi:status shows progress."
  elif lx_once_per not-installed 86400; then
    MESSAGE="灵犀：这台 Mac 上还没有安装桌面猫。运行 /lingxi:setup 安装（已关闭自动安装）。"
    CONTEXT="The 灵犀 desktop-cat app is not installed, so lingxi commands will fail. Mention /lingxi:setup only if the user asks about the cat."
  fi
  emit
fi

# An install that failed last time is worth one mention: otherwise the user never learns why the
# cat never appeared.
if [ "$(lx_state | cut -f1)" = failed ] && lx_once_per install-failed 86400; then
  MESSAGE="灵犀：上次自动更新没有完成（$(lx_state | cut -f2)）。运行 /lingxi:setup 重试。"
fi

# --- installed ------------------------------------------------------------------------------------
if lx_bridge_up; then
  [ "$POST" = 1 ] && detach post_when_up 3
elif lx_may_start; then
  detach bash -c '
    . "$1/scripts/lib.sh"
    lx_open_app "$2" background
    lx_wait_bridge 20 || exit 0
    [ "$3" = 1 ] && printf "%s" "$4" | lx_post /task-event >/dev/null
    exit 0' _ "$LX_PLUGIN_ROOT" "$APP" "$POST" "$PAYLOAD"
fi
emit
