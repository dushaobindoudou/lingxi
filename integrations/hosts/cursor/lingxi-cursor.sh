#!/bin/sh
# Cursor user hook. Prints the hook's required stdout immediately, then reports the
# lifecycle event to 灵犀 in the background. A pet must never block or fail a turn.
#
#   lingxi-cursor.sh sessionStart|beforeSubmitPrompt|afterAgentResponse|stop [--response-hook]
# stdin: the Cursor hook JSON
set -u

EVENT="${1:-}"
RESPONSE_HOOK="${2:-}"
SELF="$0"
if [ -L "${SELF}" ]; then
  SELF="$(readlink "${SELF}")"
fi
REPO="$(CDPATH= cd "$(dirname "${SELF}")/../../.." && pwd)"
EMIT="${REPO}/integrations/adapters/lingxi-emit.mjs"
PAYLOAD="$(cat || true)"

case "${EVENT}" in
  beforeSubmitPrompt) printf '%s\n' '{"continue":true}' ;;
  *) printf '%s\n' '{}' ;;
esac

(
  if [ "${EVENT}" = "sessionStart" ]; then
    lx_up() { curl -s -m 1 --noproxy '*' -o /dev/null http://127.0.0.1:47811/health; }
    lx_up || {
      case "${LINGXI_AUTOSTART:-1}" in
        0|false|no) exit 0 ;;
      esac
      # By path first: `open -b` lets Launch Services pick any registered copy, build outputs
      # in src-tauri/target included (see integrations/hosts/PLUGIN-STANDARD.md, A2).
      app=""
      for candidate in "/Applications/灵犀.app" "${HOME}/Applications/灵犀.app"; do
        [ -d "${candidate}" ] && { app="${candidate}"; break; }
      done
      if [ -n "${app}" ]; then open -g "${app}" || exit 0; else open -g -b com.dushaobin.lingxi-desktop || exit 0; fi
      i=0
      until lx_up; do
        i=$((i + 1))
        [ "${i}" -gt 50 ] && exit 0
        sleep 0.3
      done
    }
  fi
  [ -n "${PAYLOAD}" ] || exit 0
  N=""
  for candidate in "${LINGXI_NODE:-}" "$(command -v node 2>/dev/null)" \
    /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node \
    /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node; do
    [ -n "${candidate}" ] && [ -x "${candidate}" ] || continue
    N="${candidate}"; break
  done
  [ -n "${N}" ] || exit 0
  [ -f "${EMIT}" ] || exit 0
  STAMPED="$(printf '%s' "${PAYLOAD}" | EVENT="${EVENT}" RESPONSE_HOOK="${RESPONSE_HOOK}" python3 -c '
import json, os, sys
raw = sys.stdin.read().strip()
try:
    data = json.loads(raw) if raw else {}
except Exception:
    sys.exit(0)
if not isinstance(data, dict):
    sys.exit(0)
data["hook_event_name"] = os.environ.get("EVENT", "")
data["response_hook_enabled"] = os.environ.get("RESPONSE_HOOK") == "--response-hook"
sys.stdout.write(json.dumps(data, ensure_ascii=False))
')" || exit 0
  [ -n "${STAMPED}" ] || exit 0
  printf '%s' "${STAMPED}" | LINGXI_AGENT=cursor \
  LINGXI_AGENT_NAME=Cursor \
  LINGXI_AGENT_BADGE='▸' \
  LINGXI_AGENT_COLOR='#14120B' \
    "${N}" "${EMIT}" --host cursor
) </dev/null >/dev/null 2>&1 &

exit 0
