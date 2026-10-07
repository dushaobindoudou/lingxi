#!/usr/bin/env bash
# SessionStart for every host plugin except Claude's (which has its own, with Claude-only
# commands in its messages): make sure 灵犀 is installed and running, then hand this session's
# event to the plugin's own event.sh, if it has one.
#
#   installed, running      deliver the event
#   installed, not running  start it without taking focus, wait, deliver
#   not installed           download the latest release from GitHub in the background, verify it,
#                           install it, open it in front on this host's page
#
# LINGXI_HOST names the host (codex, workbuddy, …); the plugin's hook command sets it. Returns in
# milliseconds whatever it finds: a SessionStart hook holds the session, and neither a 16 MB
# download nor a GUI app booting may do that. It prints only when there is something to know - a
# first install under way, the app missing with installs turned off - and says a lasting condition
# once a day. LINGXI_AUTOINSTALL=0 / LINGXI_AUTOSTART=0 turn the two halves off.
#
# The source is integrations/shared/ensure-app.sh; plugins carry byte-for-byte copies.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PAYLOAD="$(cat)"
SOURCE="$(sed -n 's/.*"source" *: *"\([a-z]*\)".*/\1/p' <<<"$PAYLOAD" | sed -n 1p)"
mkdir -p "$LX_STATE_DIR" 2>/dev/null
EVENT="$LX_PLUGIN_ROOT/scripts/event.sh"

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

# A compaction is not a new session.
[ "$SOURCE" = compact ] && exit 0

# Everything slow goes through here: detached, stdio closed, so the hook returns immediately.
detach() { ( "$@" ) </dev/null >/dev/null 2>&1 & }
deliver_when_up() { # seconds
  [ -x "$EVENT" ] || return 0
  lx_wait_bridge "${1:-20}" || return 0
  printf '%s' "$PAYLOAD" | "$EVENT" >/dev/null 2>&1
  return 0
}

APP="$(lx_app_path)"

if [ -z "$APP" ]; then
  if [ -d "$LX_INSTALL_LOCK" ] && [ -z "$(find "$LX_INSTALL_LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    CONTEXT="The 灵犀 desktop-cat app is still being installed in the background. Skip lingxi commands this session unless the user asks."
    emit
  fi
  if lx_may_install; then
    # Once installed (and opened in front by the installer), run this check again so the session's
    # event is delivered. With installs off for that second pass: a failed install is reported by
    # its state file, never retried in a loop.
    detach bash -c '"$1/scripts/install-app.sh" --open && LINGXI_AUTOINSTALL=0 "$1/scripts/ensure-app.sh" <<<"$2"' \
      _ "$LX_PLUGIN_ROOT" "$PAYLOAD"
    MESSAGE="灵犀：第一次使用，正在从 GitHub 后台下载安装桌面猫（约 16 MB），装好会自动打开。"
    CONTEXT="The 灵犀 desktop-cat app is being installed in the background right now. Do not run lingxi commands this session unless the user asks."
  elif lx_once_per not-installed 86400; then
    MESSAGE="灵犀：这台 Mac 上还没有安装桌面猫（已关闭自动安装）。去 https://github.com/${LX_REPO}/releases 下载，或去掉 LINGXI_AUTOINSTALL=0 后开新会话。"
    CONTEXT="The 灵犀 desktop-cat app is not installed, so lingxi commands will fail. Mention it only if the user asks about the cat."
  fi
  emit
fi

if [ "$(lx_state | cut -f1)" = failed ] && lx_once_per install-failed 86400; then
  MESSAGE="灵犀：上次自动安装没有完成（$(lx_state | cut -f2)）。日志在 ${LX_STATE_DIR}/install.log。"
fi

if lx_bridge_up; then
  # Up already: deliver now, not detached. It is one loopback round trip, and a detached delivery
  # lost the race to the session's first prompt - the row went running -> queued, backwards.
  deliver_when_up 1
elif lx_may_start; then
  detach bash -c '
    . "$1/scripts/lib.sh"
    lx_open_app "$2" background
    lx_wait_bridge 20 || exit 0
    [ -x "$1/scripts/event.sh" ] && printf "%s" "$3" | "$1/scripts/event.sh" >/dev/null 2>&1
    exit 0' _ "$LX_PLUGIN_ROOT" "$APP" "$PAYLOAD"
fi
emit
