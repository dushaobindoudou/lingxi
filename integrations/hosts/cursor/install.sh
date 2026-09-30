#!/usr/bin/env bash
# 灵犀 · Cursor 专用安装器。
#
# Cursor 有确定性的一半：用户级 hooks 在会话开始、提交 prompt、回合结束时必触发。
# 模型主动的一半是 skill + MCP。身份写在 MCP / hook 的 env 里（LINGXI_AGENT=cursor），
# 不改 ~/.lingxi/agent.json——那是机器级共享文件，这台机器上已经签给了别的宿主。
#
#   ./install.sh
#   ./install.sh --dry-run
#   ./install.sh --uninstall
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CURSOR_DIR="${LINGXI_CURSOR_DIR:-${HOME}/.cursor}"
MCP_JSON="${CURSOR_DIR}/mcp.json"
HOOKS_JSON="${CURSOR_DIR}/hooks.json"
HOOKS_DIR="${CURSOR_DIR}/hooks"
SKILLS_DIR="${CURSOR_DIR}/skills"
HOOK_LINK="${HOOKS_DIR}/lingxi-cursor.sh"
HOOK_SRC="${REPO}/integrations/hosts/cursor/lingxi-cursor.sh"
SERVER="${REPO}/packages/mcp-server/src/index.mjs"
SKILL_SRC="${REPO}/integrations/skills"
HOST_SKILL_SRC="${REPO}/integrations/hosts/cursor/skills"
SKILL_NAMES="lingxi lingxi-authoring lingxi-cursor"
skill_src() {
  case "$1" in
    lingxi-cursor) printf '%s' "${HOST_SKILL_SRC}/$1" ;;
    *) printf '%s' "${SKILL_SRC}/$1" ;;
  esac
}
MARK="${REPO}/integrations/hosts/cursor/cursor-mark.svg"
APP_BIN_DIR="${HOME}/Library/Application Support/com.dushaobin.lingxi-desktop"
AGENT_ID="cursor"
AGENT_NAME="Cursor"
AGENT_BADGE="▸"
AGENT_COLOR="#14120B"
HOOK_EVENTS="sessionStart beforeSubmitPrompt stop"

DRY_RUN=0
UNINSTALL=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    *) echo "unknown option: ${arg}" >&2; exit 1 ;;
  esac
done

log()  { if [ "${DRY_RUN}" = 1 ]; then echo "  [dry] $*"; else echo "  ✓ $*"; fi; }
note() { echo "  · $*"; }

[ -d "${CURSOR_DIR}" ] || { echo "✗ ${CURSOR_DIR} 不存在——先打开一次 Cursor 再来" >&2; exit 1; }
[ -f "${SERVER}" ] || { echo "✗ 找不到 ${SERVER}" >&2; exit 1; }
[ -f "${HOOK_SRC}" ] || { echo "✗ 找不到 ${HOOK_SRC}" >&2; exit 1; }
[ -f "${MARK}" ] || { echo "✗ 找不到 ${MARK}" >&2; exit 1; }

backup_once() {
  local src="$1"
  [ -f "${src}" ] || return 0
  if ls "${src}".bak-lingxi-* >/dev/null 2>&1; then
    note "已有备份，不覆盖（保留最早的 pre-lingxi 快照）"
    return 0
  fi
  local dest="${src}.bak-lingxi-$(date +%Y%m%d-%H%M%S)"
  if [ "${DRY_RUN}" = 1 ]; then note "会备份 ${src} → ${dest}"; return 0; fi
  cp "${src}" "${dest}"
  echo "  ✓ 已备份 ${src} → ${dest}"
}

if [ "${UNINSTALL}" = 1 ]; then
  echo "撤销 Cursor 接入："
  if [ "${DRY_RUN}" = 1 ]; then
    note "会从 ${MCP_JSON} 删掉 mcpServers.lingxi（仅当 args 指向本仓库）"
    note "会从 ${HOOKS_JSON} 删掉命令里含 lingxi-cursor.sh 的条目"
    note "会删除软链 ${HOOK_LINK} 与 ${SKILLS_DIR}/{lingxi,lingxi-authoring,lingxi-cursor}"
  else
    python3 - "${MCP_JSON}" "${SERVER}" "${HOOKS_JSON}" <<'PY'
import json, os, sys
mcp_path, server, hooks_path = sys.argv[1:4]

def load(path):
    if not os.path.exists(path):
        return None
    raw = open(path, encoding='utf-8').read().strip()
    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit(f'✗ {path} 的顶层不是一个对象')
    return data

mcp = load(mcp_path)
if mcp is not None:
    servers = mcp.get('mcpServers') or {}
    entry = servers.get('lingxi')
    args = (entry or {}).get('args') or []
    if entry is not None and server in [str(a) for a in args]:
        servers.pop('lingxi', None)
        if not servers:
            mcp.pop('mcpServers', None)
        with open(mcp_path, 'w', encoding='utf-8') as f:
            json.dump(mcp, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'  ✓ {mcp_path}: 已删除 mcpServers.lingxi')
    else:
        print(f'  · {mcp_path}: lingxi 不是本仓库的 server，不碰')

hooks = load(hooks_path)
if isinstance(hooks, dict) and isinstance(hooks.get('hooks'), dict):
    changed = False
    for name, items in list(hooks['hooks'].items()):
        if not isinstance(items, list):
            continue
        kept = [item for item in items if 'lingxi-cursor.sh' not in str((item or {}).get('command', ''))]
        if len(kept) != len(items):
            changed = True
            if kept:
                hooks['hooks'][name] = kept
            else:
                del hooks['hooks'][name]
    if changed:
        with open(hooks_path, 'w', encoding='utf-8') as f:
            json.dump(hooks, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'  ✓ {hooks_path}: 已删除 lingxi-cursor.sh')
    else:
        print(f'  · {hooks_path}: 没有 lingxi hook')
PY
    if [ -L "${HOOK_LINK}" ]; then rm -f "${HOOK_LINK}"; log "已删除软链 ${HOOK_LINK}"; fi
    for s in ${SKILL_NAMES}; do
      if [ -L "${SKILLS_DIR}/${s}" ]; then rm -f "${SKILLS_DIR}/${s}"; log "已删除软链 ${SKILLS_DIR}/${s}"; fi
    done
  fi
  echo
  echo "未改 ~/.lingxi/agent.json。新开一个 Cursor 会话后 MCP 才会从列表里消失。"
  exit 0
fi

echo "1. MCP server（${MCP_JSON}）"
backup_once "${MCP_JSON}"
if [ "${DRY_RUN}" = 1 ]; then
  note "会合并 mcpServers.lingxi，env.LINGXI_AGENT=cursor（不改 ~/.lingxi/agent.json）"
else
  python3 - "${MCP_JSON}" "${SERVER}" "${AGENT_ID}" "${AGENT_NAME}" "${AGENT_BADGE}" "${AGENT_COLOR}" <<'PY'
import json, os, sys
path, server, ident, name, badge, color = sys.argv[1:7]
data = {}
if os.path.exists(path):
    raw = open(path, encoding='utf-8').read().strip()
    if raw:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise SystemExit(f'✗ {path} 的顶层不是一个对象')
servers = data.setdefault('mcpServers', {})
servers['lingxi'] = {
    'command': 'node',
    'args': [server],
    'env': {
        'LINGXI_AGENT': ident,
        'LINGXI_AGENT_NAME': name,
        'LINGXI_AGENT_BADGE': badge,
        'LINGXI_AGENT_COLOR': color,
    },
}
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
  log "mcpServers.lingxi → node ${SERVER}（LINGXI_AGENT=${AGENT_ID}）"
fi

echo "2. hooks（${HOOKS_JSON}）"
backup_once "${HOOKS_JSON}"
if [ "${DRY_RUN}" = 1 ]; then
  note "会软链 ${HOOK_LINK} → ${HOOK_SRC}"
  note "会写入 ${HOOK_EVENTS}，命令指向 ./hooks/lingxi-cursor.sh"
else
  mkdir -p "${HOOKS_DIR}"
  chmod 755 "${HOOK_SRC}"
  ln -sfn "${HOOK_SRC}" "${HOOK_LINK}"
  python3 - "${HOOKS_JSON}" <<'PY'
import json, os, sys
path = sys.argv[1]
data = {"version": 1, "hooks": {}}
if os.path.exists(path):
    raw = open(path, encoding='utf-8').read().strip()
    if raw:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise SystemExit(f'✗ {path} 的顶层不是一个对象')
data.setdefault('version', 1)
hooks = data.setdefault('hooks', {})
events = {
    'sessionStart': './hooks/lingxi-cursor.sh sessionStart',
    'beforeSubmitPrompt': './hooks/lingxi-cursor.sh beforeSubmitPrompt',
    'stop': './hooks/lingxi-cursor.sh stop',
}
for name, command in events.items():
    items = [item for item in (hooks.get(name) or []) if 'lingxi-cursor.sh' not in str((item or {}).get('command', ''))]
    items.append({'command': command, 'timeout': 5})
    hooks[name] = items
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
  log "${HOOK_LINK} → ${HOOK_SRC}"
  log "${HOOKS_JSON}: ${HOOK_EVENTS}"
fi

echo "3. skill（${SKILLS_DIR}/）"
# 两层都装（integrations/hosts/PLUGIN-STANDARD.md 六）：系统层 lingxi、lingxi-authoring 来自共享目录，
# 宿主层 lingxi-cursor 只写 Cursor 才成立的事（身份、hooks 报了什么、MCP 信任）。
for s in ${SKILL_NAMES}; do
  dest="${SKILLS_DIR}/${s}"
  src="$(skill_src "${s}")"
  if [ -e "${dest}" ] && [ ! -L "${dest}" ]; then
    echo "✗ ${dest} 是普通目录，安装器不覆盖它" >&2
    exit 1
  fi
  if [ "${DRY_RUN}" = 1 ]; then
    note "会软链 ${dest} → ${src}"
  else
    mkdir -p "${SKILLS_DIR}"
    ln -sfn "${src}" "${dest}"
    log "${dest} → ${src}"
  fi
done

echo "4. 注册身份（不改 ~/.lingxi/agent.json）"
note "机器级署名保持不动；Cursor 的 MCP 与 hook 用 LINGXI_AGENT=${AGENT_ID}"
CLI="$(command -v lingxi 2>/dev/null || true)"
[ -n "${CLI}" ] || CLI="${APP_BIN_DIR}/bin/lingxi"
if [ ! -x "${CLI}" ]; then
  note "找不到 lingxi CLI，跳过注册"
elif ! "${CLI}" health >/dev/null 2>&1; then
  note "灵犀没在跑，跳过注册。启动后补一次："
  note "LINGXI_AGENT=${AGENT_ID} lingxi register ${AGENT_ID} --logo \"${MARK}\" --name \"${AGENT_NAME}\" --color ${AGENT_COLOR} --badge \"${AGENT_BADGE}\""
elif [ "${DRY_RUN}" = 1 ]; then
  note "会注册 ${AGENT_BADGE} ${AGENT_NAME}"
else
  LINGXI_AGENT="${AGENT_ID}" "${CLI}" register "${AGENT_ID}" --logo "${MARK}" \
    --name "${AGENT_NAME}" --color "${AGENT_COLOR}" --badge "${AGENT_BADGE}" >/dev/null
  log "已注册 ${AGENT_BADGE} ${AGENT_NAME}"
fi

echo
echo "完成。新开一个 Cursor Agent 会话后生效。验收："
echo "  ${HOOK_SRC} stop <<'EOF'"
echo "  {\"conversation_id\":\"cursor-e2e\",\"status\":\"completed\"}"
echo "  EOF"
echo "  lingxi events    # provider=cursor，summary=本轮回复结束"
echo
echo "Cursor 会在首次使用这个 MCP 时问你是否信任，点允许之后 13 个工具才会出现。"
