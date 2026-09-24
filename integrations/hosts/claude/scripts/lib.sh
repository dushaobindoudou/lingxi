# shellcheck shell=bash
# Shared by every script in the 灵犀 Claude Code plugin. Sourced, never run.
#
# Plain bash 3.2 and tools every Mac has (curl, open, mdfind, PlistBuddy, hdiutil, codesign).
# No node, no python: a hook that needs a runtime the user never installed is a hook that fails
# silently on the first machine that matters. The one exception is the MCP server, which is node
# by nature and optional.

LX_BUNDLE_ID="com.dushaobin.lingxi-desktop"
LX_APP_NAME="灵犀"
LX_PORT="${LINGXI_PORT:-47811}"
LX_BASE="http://127.0.0.1:${LX_PORT}"

# The app's data home - settings, memory, reminders, the bridge token, custom assets. It is named
# after the bundle identifier, so every build and every reinstall of the app reads the SAME
# directory: deleting and reinstalling 灵犀 keeps everything. Nothing in this plugin writes here;
# it is listed so the scripts can say where the user's data is.
LX_CONFIG_DIR="${LINGXI_CONFIG_DIR:-$HOME/Library/Application Support/$LX_BUNDLE_ID}"
LX_TOKEN_FILE="${LINGXI_TOKEN_FILE:-$LX_CONFIG_DIR/bridge-token}"

# The plugin's own state (install progress, what it last told the user). Deliberately NOT
# ${CLAUDE_PLUGIN_DATA}: Claude Code deletes that directory when the plugin is uninstalled, and
# "reinstall the plugin" must not mean "forget that the app was already set up".
LX_STATE_DIR="${LINGXI_CLAUDE_STATE_DIR:-$HOME/.lingxi/claude}"

LX_REPO="${LINGXI_RELEASE_REPO:-dushaobindoudou/lingxi}"
LX_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LX_AGENT_ID="${LINGXI_CLAUDE_AGENT:-claude}"

# --- options ------------------------------------------------------------------------------------
# userConfig values arrive as CLAUDE_PLUGIN_OPTION_<KEY> (see .claude-plugin/plugin.json).
lx_option() {
  local var
  var="CLAUDE_PLUGIN_OPTION_$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
  printf '%s' "${!var:-$2}"
}
lx_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac
}
lx_falsy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in 0|false|no|off) return 0 ;; *) return 1 ;; esac
}
# LINGXI_AUTOSTART=0 is the machine-wide opt-out every 灵犀 integration honours; the plugin
# option is the Claude-specific one. Either saying no is enough.
lx_may_start() { ! lx_falsy "${LINGXI_AUTOSTART:-}" && lx_truthy "$(lx_option auto_open true)"; }
lx_may_install() { ! lx_falsy "${LINGXI_AUTOINSTALL:-}" && lx_truthy "$(lx_option auto_install true)"; }

# --- the app ------------------------------------------------------------------------------------
lx_bundle_id_of() { /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null; }
lx_version_of() { /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist" 2>/dev/null; }

# Where the installed app is, or nothing. The usual places first, then Spotlight - but never a
# copy on a mounted disk image, in a build directory or in the Trash: `open` on one of those
# would start a build nobody installed.
lx_app_path() {
  if [ -n "${LINGXI_APP_PATH:-}" ]; then
    [ -d "$LINGXI_APP_PATH" ] && printf '%s' "$LINGXI_APP_PATH"
    return 0
  fi
  local candidate
  for candidate in "/Applications/$LX_APP_NAME.app" "$HOME/Applications/$LX_APP_NAME.app" "/Applications/lingxi.app"; do
    if [ -d "$candidate" ] && [ "$(lx_bundle_id_of "$candidate")" = "$LX_BUNDLE_ID" ]; then
      printf '%s' "$candidate"; return 0
    fi
  done
  if command -v mdfind >/dev/null 2>&1; then
    while IFS= read -r candidate; do
      case "$candidate" in /Volumes/*|*/target/*|*/.Trash/*|*/node_modules/*|"") continue ;; esac
      [ -d "$candidate" ] && { printf '%s' "$candidate"; return 0; }
    done <<<"$(mdfind "kMDItemCFBundleIdentifier == '$LX_BUNDLE_ID'" 2>/dev/null)"
  fi
  return 0
}

lx_bridge_up() { curl -s -m 1 --noproxy '*' -o /dev/null "$LX_BASE/health" 2>/dev/null; }

lx_wait_bridge() { # seconds
  local tries=$(( ${1:-15} * 4 ))
  while [ "$tries" -gt 0 ]; do
    lx_bridge_up && return 0
    sleep 0.25; tries=$((tries - 1))
  done
  return 1
}

# Start the app. `background` keeps focus where the user is (a session starting should not
# pull a window in front of them); `foreground` is for a first install, where seeing it IS the
# point.
#
# By PATH, not by bundle id: `open -b` lets Launch Services choose among every copy it has ever
# seen, and a developer's machine has several - it was observed starting the one in
# src-tauri/target/…/bundle rather than the installed app. lx_app_path already chose the right
# copy; -b is only the fallback.
lx_open_app() { # path [background|foreground]
  local flag="-g"; [ "${2:-background}" = foreground ] && flag=""
  # shellcheck disable=SC2086
  open $flag "$1" 2>/dev/null || open $flag -b "$LX_BUNDLE_ID" 2>/dev/null
}

# --- the bridge ---------------------------------------------------------------------------------
# POST a JSON body read from stdin. The token goes through a -K config file, never argv: an
# expanded -H lands in `ps` for every local user to read. --noproxy because curl hands even
# 127.0.0.1 to an exported http_proxy, and a local proxy answers 502.
lx_post() { # path
  local token header status
  token="$(tr -d '[:space:]' < "$LX_TOKEN_FILE" 2>/dev/null)"
  header="$(mktemp)" || return 1
  printf 'header = "Authorization: Bearer %s"\nheader = "X-Lingxi-Agent: %s"\n' "$token" "$LX_AGENT_ID" > "$header"
  curl -s -m 3 --noproxy '*' -K "$header" -X POST "$LX_BASE$1" \
    -H 'Content-Type: application/json' --data-binary @- -o /dev/null -w '%{http_code}' 2>/dev/null
  status=$?
  rm -f "$header"
  return $status
}

# "一键接入" in the app writes its own hooks into ~/.claude/settings.json. Claude Code does not
# deduplicate a plugin's hook against a settings hook, so with both installed every event would
# reach the cat twice. The plugin is the one that steps aside: those hooks already post, and
# the app keeps them upgraded.
lx_oneclick_hooks_installed() {
  grep -q '127.0.0.1:47811/task-event' "$HOME/.claude/settings.json" 2>/dev/null
}

# --- output -------------------------------------------------------------------------------------
lx_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\t'/\\t}"; s="${s//$'\r'/}"
  printf '%s' "$s"
}

# Say something at most once per `seconds` under a given key, so a condition that persists
# (not installed, install failed) is mentioned, not nagged about in every session.
lx_once_per() { # key seconds
  local stamp="$LX_STATE_DIR/said.$1" now last
  now="$(date +%s)"
  last="$(cat "$stamp" 2>/dev/null || echo 0)"
  [ $((now - last)) -ge "$2" ] || return 1
  mkdir -p "$LX_STATE_DIR" && printf '%s' "$now" > "$stamp"
}

lx_state() { cat "$LX_STATE_DIR/install.state" 2>/dev/null; }
