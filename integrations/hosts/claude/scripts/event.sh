#!/usr/bin/env bash
# Every lifecycle event after SessionStart: hand Claude Code's hook payload to the cat.
#
# Delivery only. A closed app is left closed - starting it belongs to the session boundary
# (session-start.sh), because relaunching on every prompt would fight someone who quit the cat
# on purpose. The bridge maps the raw payload itself (normalize_claude_hook_event in lib.rs):
#
#   UserPromptSubmit  -> running          Notification -> needs_approval / needs_input
#   Stop              -> completed        StopFailure  -> failed
#
# The `reactions` option trims the stream: `important` drops the per-prompt event (the most
# frequent, least informative one), `off` sends nothing. Always exits 0 - exit 2 on
# UserPromptSubmit would erase the user's prompt, and on Stop would keep Claude talking.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PAYLOAD="$(cat)"
case "$(lx_option reactions all)" in
  off) exit 0 ;;
  important) grep -q '"hook_event_name" *: *"UserPromptSubmit"' <<<"$PAYLOAD" && exit 0 ;;
esac
lx_oneclick_hooks_installed && exit 0
lx_bridge_up || exit 0
printf '%s' "$PAYLOAD" | lx_post /task-event >/dev/null
exit 0
