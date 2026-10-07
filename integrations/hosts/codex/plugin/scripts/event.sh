#!/usr/bin/env bash
# Codex lifecycle events -> the cat, credited to Codex.
#
# Codex's plugin hooks hand over the same payload Claude Code's do (hook_event_name, session_id,
# cwd, last_assistant_message …), but the bridge credits a RAW hook payload to Claude
# (normalize_claude_hook_event in lib.rs). So this puts the generic task-event fields in front of
# the payload - provider/agent codex, a state - and the bridge reads it as Codex's event:
#
#   SessionStart      -> queued          "会话开始"
#   UserPromptSubmit  -> running         "新一轮对话开始"
#   PermissionRequest -> needs_approval  "Codex 想用 <tool>"
#   Stop              -> completed, with the reply as `result`: the bridge turns its first sentence
#                        into the cat's line, and a reply that ends on a question into needs_input
#
# The payload itself is never parsed beyond a few plain identifiers: its keys are kept as they are
# (the bridge ignores the ones it does not know) except last_assistant_message, renamed to result.
# Codex writes one compact line, so the rename only ever matches the real key - inside a string
# value the quotes around that name would be escaped.
#
# The per-turn events (prompt, turn end) are left to `notify` when the app's one-click or
# integrations/hosts/codex/install.sh already reports them, so the cat hears each turn once.
# Delivery only: a closed app stays closed (ensure-app.sh starts it, at session start). Always
# exits 0. The post is a loopback round trip with a 3-second cap, made before returning: Codex has
# no async hooks, and a post left running in the background could be killed with the hook.
LINGXI_HOST=codex
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PAYLOAD="$(cat)"
field() { sed -n "s/.*\"$1\" *: *\"\\([A-Za-z0-9_.:@/ -]*\\)\".*/\\1/p" <<<"$PAYLOAD" | sed -n 1p; }
EVENT="$(field hook_event_name)"
SESSION="$(field session_id)"
CWD="$(sed -n 's/.*"cwd" *: *"\([^"\\]*\)".*/\1/p' <<<"$PAYLOAD" | sed -n 1p)"
LABEL="$(basename "${CWD:-codex}")"

case "$EVENT" in
  SessionStart) STATE=queued; SUMMARY="会话开始" ;;
  UserPromptSubmit) lx_oneclick_hooks_installed && exit 0; STATE=running; SUMMARY="新一轮对话开始" ;;
  PermissionRequest)
    TOOL="$(field tool_name)"
    STATE=needs_approval; SUMMARY="Codex 想用 ${TOOL:-一个工具}，等你批准" ;;
  Stop) lx_oneclick_hooks_installed && exit 0; STATE=completed; SUMMARY="Codex 回复结束" ;;
  *) exit 0 ;;
esac
lx_bridge_up || exit 0

HEAD="$(printf '"provider":"codex","agent":"codex","origin":"hook","kind":"chat","state":"%s","taskId":"%s","session":"%s","label":"%s","summary":"%s"' \
  "$STATE" "${SESSION:-codex-session}" "${SESSION:-codex-session}" "$(lx_json_escape "$LABEL")" "$(lx_json_escape "$SUMMARY")")"
REST="$(sed -e 's/^[[:space:]]*{//' -e 's/"last_assistant_message":/"result":/' <<<"$PAYLOAD")"
case "$REST" in
  "}"*|"") BODY="{${HEAD}}" ;;
  *) BODY="{${HEAD},${REST}" ;;
esac
printf '%s' "$BODY" | lx_post /task-event >/dev/null
exit 0
