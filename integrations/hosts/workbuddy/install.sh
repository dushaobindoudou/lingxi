#!/usr/bin/env bash
# 灵犀 · WorkBuddy 专用安装器。
#
# WorkBuddy 这条路只有两个宿主自己的可配置面——它没有 Claude Code 那种 hooks 配置文件，
# 会话生命周期事件不外露，所以没有「确定性的一半」，只有模型主动那一半：
#
#   1. ~/.workbuddy/mcp.json 里的一个 mcpServers.lingxi   带类型的工具，逐工具授权
#   2. ~/.workbuddy/skills/ 下的 skill 软链                模型自己判断要不要用
#
#   5. ~/.workbuddy/settings.json 里的 hooks               确定性的一半（WorkBuddy 5.6+）
#      WorkBuddy 的 hooks 载荷与 Claude Code 兼容（hook_event_name/session_id/cwd/transcript_path），
#      且配置实时生效、无需重启会话。UserPromptSubmit→running、Stop→completed，
#      直接复用 adapters/lingxi-emit.mjs 的 claude 适配臂。
#
# 外加两个不属于任何宿主、但也必须配对的共享件：
#
#   3. ~/.lingxi/agent.json   署名（WorkBuddy 的 MCP 从它读身份）
#   4. POST /agents           用 workbuddy-mark.svg 注册身份，徽章才不会是"wb"两个字
#
#   ./install.sh                  # 正常安装，幂等
#   ./install.sh --dry-run        # 只打印将要做的变更
#   ./install.sh --set-identity   # 允许改写 ~/.lingxi/agent.json 里已有的署名（见 README）
#   ./install.sh --no-quota-guard # 只装生命周期 hooks，不装额度守卫（默认装）
#   ./install.sh --uninstall      # 把上面的都撤掉
#
# 约定：所有变量展开都写成 ${VAR}。紧跟中文/全角字符的裸 $VAR 会被 bash 当成变量名的一部分
# （UTF-8 locale 下全角标点的字节被判成字母），这是一个只在有中文提示的脚本里才会踩的坑。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WB_DIR="${LINGXI_WORKBUDDY_DIR:-${HOME}/.workbuddy}"
MCP_JSON="${WB_DIR}/mcp.json"
WB_SETTINGS="${WB_DIR}/settings.json"
SKILLS_DIR="${WB_DIR}/skills"
AGENT_FILE="${LINGXI_AGENT_FILE:-${HOME}/.lingxi/agent.json}"
APP_BIN_DIR="${HOME}/Library/Application Support/com.dushaobin.lingxi-desktop"
SERVER="${REPO}/packages/mcp-server/src/index.mjs"
SKILL_SRC="${REPO}/integrations/skills"
# WorkBuddy 私有的那份（lingxi-workbuddy）——不进共享目录，别的宿主不该看到它。
HOST_SKILLS="${REPO}/integrations/hosts/workbuddy/skills"
MARK="${REPO}/integrations/hosts/workbuddy/workbuddy-mark.svg"
AGENT_ID="workbuddy"
AGENT_NAME="WorkBuddy"
AGENT_BADGE="🐧"
AGENT_COLOR="#0AC89F"

DRY_RUN=0
SET_IDENTITY=0
UNINSTALL=0
# 额度守卫默认开：它读的是 WorkBuddy 自己的用量库，只读、不写宿主任何状态，
# 且所有失败路径都静默退出，所以默认装上比默认不装更有用。
QUOTA_GUARD=1
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    --set-identity) SET_IDENTITY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --no-quota-guard) QUOTA_GUARD=0 ;;
    *) echo "unknown option: ${arg}" >&2; exit 1 ;;
  esac
done

log()  { if [ "${DRY_RUN}" = 1 ]; then echo "  [dry] $*"; else echo "  ✓ $*"; fi; }
note() { echo "  · $*"; }

[ -d "${WB_DIR}" ] || { echo "✗ ${WB_DIR} 不存在——先装并跑一次 WorkBuddy 再来" >&2; exit 1; }
[ -f "${SERVER}" ] || { echo "✗ 找不到 ${SERVER}" >&2; exit 1; }
[ -f "${MARK}" ]   || { echo "✗ 找不到 ${MARK}" >&2; exit 1; }
[ -d "${SKILL_SRC}" ] || { echo "✗ 找不到 ${SKILL_SRC}" >&2; exit 1; }
[ -d "${HOST_SKILLS}" ] || { echo "✗ 找不到 ${HOST_SKILLS}" >&2; exit 1; }

# 第一份备份才是有价值的：它是 pre-lingxi 的原样快照。同秒重跑会撞时间戳，
# 覆盖它就等于删掉用户的退路。
backup_once() {
  local src="$1" tag="$2" dest
  [ -f "${src}" ] || return 0
  if ls "${src}".bak-lingxi-* >/dev/null 2>&1; then
    note "已有备份，不覆盖（保留最早的 pre-lingxi 快照）"
    return 0
  fi
  dest="${src}.bak-lingxi-${tag}"
  if [ "${DRY_RUN}" = 1 ]; then note "会备份 ${src} → ${dest}"; return 0; fi
  cp "${src}" "${dest}"
  echo "  ✓ 已备份 ${src} → ${dest}"
}

# ---------------------------------------------------------------- 卸载
if [ "${UNINSTALL}" = 1 ]; then
  echo "撤销 WorkBuddy 接入："
  if [ -f "${MCP_JSON}" ]; then
    if [ "${DRY_RUN}" = 1 ]; then
      note "会从 ${MCP_JSON} 删掉 mcpServers.lingxi"
    else
      python3 - "${MCP_JSON}" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    data = json.load(f)
servers = data.get('mcpServers') or {}
if servers.pop('lingxi', None) is not None:
    if not servers:
        data.pop('mcpServers', None)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
PY
      log "${MCP_JSON}: 已删除 mcpServers.lingxi"
    fi
  else
    note "${MCP_JSON} 不存在，跳过"
  fi
  for s in lingxi lingxi-authoring lingxi-workbuddy; do
    if [ -L "${SKILLS_DIR}/${s}" ]; then
      if [ "${DRY_RUN}" = 1 ]; then
        note "会删除软链 ${SKILLS_DIR}/${s}"
      else
        rm -f "${SKILLS_DIR}/${s}"
        log "已删除软链 ${SKILLS_DIR}/${s}"
      fi
    else
      note "${SKILLS_DIR}/${s} 不是软链，不碰"
    fi
  done
  # 只撤自己的署名：这个文件是机器级的，被别人改过就别动。
  if [ -f "${AGENT_FILE}" ] && AGENT_ID="${AGENT_ID}" python3 -c "
import json, os, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(data, dict) and data.get('id') == os.environ['AGENT_ID'] else 1)
" "${AGENT_FILE}"; then
    if [ "${DRY_RUN}" = 1 ]; then
      note "会删除 ${AGENT_FILE}（署名仍是 ${AGENT_ID}）"
    else
      rm -f "${AGENT_FILE}"
      log "${AGENT_FILE}: 已删除（署名仍是 ${AGENT_ID}）"
    fi
  else
    note "${AGENT_FILE} 不存在或署名已不是 ${AGENT_ID}，不碰"
  fi
  # hooks：只撤命令里带 lingxi-emit.mjs / lingxi-quota-guard.mjs 标记的条目，
  # 用户自己的 hook 一律不碰。
  if [ -f "${WB_SETTINGS}" ]; then
    if [ "${DRY_RUN}" = 1 ]; then
      note "会从 ${WB_SETTINGS} 的 hooks 里删掉命令含 lingxi-emit.mjs / lingxi-quota-guard.mjs 的条目"
    else
      python3 - "${WB_SETTINGS}" <<'PY'
import json, sys

path = sys.argv[1]
# 两个脚本都是 lingxi 装的：emit 和额度守卫。卸载要一起撤，否则会留下一条
# 每轮对话都跑、却没人认领的钩子。
MARKS = ('lingxi-emit.mjs', 'lingxi-quota-guard.mjs')
with open(path, encoding='utf-8') as f:
    data = json.load(f)
hooks = data.get('hooks') or {}
removed = []
for event in list(hooks):
    groups = hooks[event]
    kept = []
    for group in groups:
        entries = [h for h in group.get('hooks', [])
                   if not any(m in str(h.get('command', '')) for m in MARKS)]
        if len(entries) != len(group.get('hooks', [])):
            removed.append(event)
        if entries:
            group['hooks'] = entries
            kept.append(group)
    if kept:
        hooks[event] = kept
    else:
        hooks.pop(event, None)
if not hooks:
    data.pop('hooks', None)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f'  ✓ {path}: 已移除 {sorted(set(removed)) or "0 条"} lingxi hook' if removed else f'  · {path}: 没有发现 lingxi hook')
PY
      log "${WB_SETTINGS}: lingxi hooks 已撤销"
    fi
  else
    note "${WB_SETTINGS} 不存在，跳过"
  fi
  echo
  echo "注意：~/.workbuddy/mcp-approvals.json 里那条信任记录由 WorkBuddy 自己清理。"
  exit 0
fi

# ---------------------------------------------------------------- 1. mcp.json
echo "1. MCP server（~/.workbuddy/mcp.json）"
BACKUP_TAG="$(date +%Y%m%d-%H%M%S)"
backup_once "${MCP_JSON}" "${BACKUP_TAG}"
HASH=""
if [ "${DRY_RUN}" = 1 ]; then
  note "会合并 mcpServers.lingxi = { command: node, args: [${SERVER}] }（不带 env）"
else
  mkdir -p "${WB_DIR}"
  HASH="$(python3 - "${MCP_JSON}" "${SERVER}" <<'PY'
import hashlib, json, os, sys

path, server = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    raw = open(path, encoding='utf-8').read().strip()
    if raw:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise SystemExit(f'✗ {path} 的顶层不是一个对象')
servers = data.setdefault('mcpServers', {})

# 幂等 + 不碰别的 server：只覆盖 lingxi 这一个键。
# env 故意不写——WorkBuddy 的信任哈希含 env 的【键名】，多一个键就换一个哈希，
# 存量的信任记录立刻失效，宿主于是拒绝启动这个 server（见 README）。
if servers.get('lingxi') is not None:
    print('  · lingxi 条目已存在，更新为当前路径（env 保持不写）', file=sys.stderr)
servers['lingxi'] = {'command': 'node', 'args': [server]}

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')

entry = servers['lingxi']
joined = '|'.join([
    entry.get('command', ''),
    ','.join(sorted(str(a) for a in entry.get('args', []))),
    ','.join(sorted((entry.get('env') or {}).keys())),
])
print(hashlib.sha256(joined.encode()).hexdigest())
PY
)"
  log "${MCP_JSON}: mcpServers.lingxi → node ${SERVER}"
fi

# 闸门：把这次的哈希和 WorkBuddy 记下的信任对一遍。不是"配置写好了"就等于"能跑"。
if [ -n "${HASH}" ]; then
  if [ -f "${WB_DIR}/mcp-approvals.json" ] && HASH="${HASH}" python3 -c "
import json, os, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(data, dict) and os.environ['HASH'] + '::lingxi' in data else 1)
" "${WB_DIR}/mcp-approvals.json"; then
    log "闸门：这个哈希已被信任"
  else
    echo
    echo "  ⚠️  这个 server 还没被信任 —— 现在 MCP 那 13 个工具在会话里不会出现。"
    echo "      配置哈希：${HASH:0:16}…"
    echo "      放行方式：连接器管理页右上角 → 自定义连接器 → lingxi → 「信任」"
    echo "      （skill 那条路不受影响，现在就能用。）"
    echo
  fi
fi

# ---------------------------------------------------------------- 2. skill
echo "2. skill（~/.workbuddy/skills/）"
# 两份而不是一份：
#   lingxi           基础能力——怎么调用、mood、任务、提醒、记忆、预算。对所有宿主都一样，
#                    所以放在 integrations/skills/ 与各宿主共享，git pull 一次全都更新。
#   lingxi-workbuddy 只在这台机器上成立的事——信任闸门、env 毒药、hooks 与额度守卫已经装好、
#                    哪些权限只能由人给。那份是宿主私有的，别的宿主不该看到。
# 都是软链而不是拷贝：不存在"哪份是最新的"。
link_skill() {
  local name="$1" src="$2" dest="${SKILLS_DIR}/$1"
  if [ -e "${dest}" ] && [ ! -L "${dest}" ]; then
    echo "✗ ${dest} 是普通目录，安装器不覆盖它；请手动确认后重跑" >&2
    exit 1
  fi
  if [ "${DRY_RUN}" = 1 ]; then
    note "会软链 ${dest} → ${src}"
  else
    mkdir -p "${SKILLS_DIR}"
    ln -sfn "${src}" "${dest}"
    log "${dest} → ${src}"
  fi
}
for s in lingxi lingxi-authoring; do
  link_skill "${s}" "${SKILL_SRC}/${s}"
done
link_skill lingxi-workbuddy "${HOST_SKILLS}/lingxi-workbuddy"

# ---------------------------------------------------------------- 3. 署名
echo "3. 署名（${AGENT_FILE}）"
CURRENT_ID=""
if [ -f "${AGENT_FILE}" ]; then
  CURRENT_ID="$(python3 -c "
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
print(data.get('id', '') if isinstance(data, dict) and isinstance(data.get('id'), str) else '')
" "${AGENT_FILE}")"
fi

write_identity() {
  if [ "${DRY_RUN}" = 1 ]; then
    note "会写入 id=${AGENT_ID} name=${AGENT_NAME} color=${AGENT_COLOR}（保留文件里已有的其它键）"
    return 0
  fi
  backup_once "${AGENT_FILE}" "${BACKUP_TAG}"
  mkdir -p "$(dirname "${AGENT_FILE}")"
  python3 - "${AGENT_FILE}" "${AGENT_ID}" "${AGENT_NAME}" "${AGENT_BADGE}" "${AGENT_COLOR}" <<'PY'
import json, os, sys
path, ident, name, badge, color = sys.argv[1:6]
# 增量更新，不要整体覆盖：这个文件里除了署名还有应用/CLI 自己写进去的键（比如
# `logo`，一段 base64 PNG——bridge.mjs 会读它来决定气泡上显示谁的头像）。
# 一份只写四个键的 agent.json 会把 logo 静默抹掉：注册还在，头像没了。
data = {}
if os.path.exists(path):
    try:
        with open(path, encoding='utf-8') as f:
            cur = json.load(f)
        if isinstance(cur, dict):
            data = cur
    except Exception:
        pass
data.update({'id': ident, 'name': name, 'badge': badge, 'color': color})
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
  log "${AGENT_FILE} → ${AGENT_ID}"
}

if [ "${CURRENT_ID}" = "${AGENT_ID}" ]; then
  note "署名已经是 ${AGENT_ID}，跳过"
elif [ -z "${CURRENT_ID}" ]; then
  write_identity
elif [ "${SET_IDENTITY}" = 1 ]; then
  backup_once "${AGENT_FILE}" "${BACKUP_TAG}"
  note "覆盖已有署名「${CURRENT_ID}」→「${AGENT_ID}」（--set-identity）"
  write_identity
else
  echo
  echo "  ⚠️  这个文件是机器级的，现在签名的是「${CURRENT_ID}」，不是「${AGENT_ID}」。"
  echo "      WorkBuddy 的 MCP 会读它，所以不改的话，WorkBuddy 的反应会记在「${CURRENT_ID}」名下。"
  echo
  echo "      想让 WorkBuddy 用它、同时不改变别的宿主：先去那个宿主自己的 MCP env 里"
  echo "      钉住身份（Claude Code 是 ~/.claude.json → mcpServers.lingxi.env.LINGXI_AGENT），"
  echo "      然后：./install.sh --set-identity"
  echo "      或者接受共享身份，跳过这一步。"
  echo
fi

# ---------------------------------------------------------------- 4. 注册身份
echo "4. 注册身份与徽章"
CLI="$(command -v lingxi 2>/dev/null || true)"
[ -n "${CLI}" ] || CLI="${APP_BIN_DIR}/bin/lingxi"
if [ ! -x "${CLI}" ]; then
  note "找不到 lingxi CLI，跳过（应用启动后会把 CLI 写到 ${APP_BIN_DIR}/bin/lingxi）"
elif ! "${CLI}" health >/dev/null 2>&1; then
  note "灵犀没在跑，跳过——启动后手工补一次："
  note "lingxi register ${AGENT_ID} --logo \"${MARK}\" --name \"${AGENT_NAME}\" --color ${AGENT_COLOR} --badge \"${AGENT_BADGE}\""
elif [ "${DRY_RUN}" = 1 ]; then
  note "会注册 ${AGENT_ID}（${AGENT_BADGE} ${AGENT_NAME} ${AGENT_COLOR}）+ workbuddy-mark.svg"
else
  # 注册表是纯内存的，重启应用就没了——所以每次安装都重注册，代价是一次回环请求。
  # 注册失败【绝不能】中断安装：这一步只决定气泡上显示企鹅还是 "wb" 两个字，而后面还有
  # hooks（确定性的一半）。踩过：workbuddy-mark.svg 顶上有一段注释，被 logo 校验判成
  # "not an SVG" → register 返回 400 → set -e 在这里退出 → 用户看到"第 4 步"就没了，
  # 既没有报错，hooks 也一行没写。可选步骤要降级，不要连带。
  if REG_OUT="$("${CLI}" register "${AGENT_ID}" --logo "${MARK}" --name "${AGENT_NAME}" \
        --color "${AGENT_COLOR}" --badge "${AGENT_BADGE}" 2>&1)"; then
    log "已注册 ${AGENT_BADGE} ${AGENT_NAME}（${AGENT_ID} ${AGENT_COLOR}）"
  else
    echo "  ⚠️  注册失败——已装好的部分不受影响，hooks 会继续装："
    echo "      $(printf '%s' "${REG_OUT}" | tr '\n' ' ' | cut -c1-220)"
  fi
fi

# ---------------------------------------------------------------- 5. hooks（确定性的一半）
# WorkBuddy 5.6+ 暴露了与 Claude Code 兼容的 hooks：UserPromptSubmit / Stop 等事件，
# 载荷带 hook_event_name / session_id / cwd / transcript_path，配置实时生效、无需重启会话。
# 只装两条生命周期事件——PostToolUse 每次工具调用都触发，会让猫变成通知轰炸。
echo "5. hooks（${WB_SETTINGS}）"
HOOK_CMD=""
GUARD_CMD=""
EMIT="${REPO}/integrations/adapters/lingxi-emit.mjs"
GUARD="${REPO}/integrations/hosts/workbuddy/bin/lingxi-quota-guard.mjs"
if [ ! -f "${EMIT}" ]; then
  note "找不到 adapters/lingxi-emit.mjs，跳过 hooks"
else
  # 额度守卫读 WorkBuddy 自己的 ~/.workbuddy/workbuddy.db（session_usage 表），
  # 在会话上下文跨过 60/70/90% 时让猫说一句。它单独占一个 hook group：emit 那条以 exec
  # 结尾，同一条命令里排在它后面的东西永远不会执行，所以必须是独立的进程。
  # --no-warnings 是为了压掉 node:sqlite 的 ExperimentalWarning——那行警告会落进
  # 宿主的 hook 输出里。
  if [ "${QUOTA_GUARD}" = 1 ] && [ -f "${GUARD}" ]; then
    GUARD_CMD="N=\$(command -v node || true); [ -x \"\$N\" ] || N=\$(ls -t \"\$HOME\"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | head -1); [ -n \"\$N\" ] && exec \"\$N\" --no-warnings \"${GUARD}\""
  fi
  # node 在【运行时】解析，不把路径烤进配置。烤进去的版本号（22.22.2-3 之类）会在 WorkBuddy
  # 换一版托管 node 之后指向一个已经不存在的可执行文件——hooks 于是静默空转，而 hooks 是
  # "确定性的一半"，它挂了宿主不会报错，表象只有"猫怎么不反应了"，和别的故障无法区分。
  # 这条命令与 plugin/hooks/hooks.json 里那条同形，改一处就要改另一处。
  HOOK_CMD="N=\$(command -v node || true); [ -x \"\$N\" ] || N=\$(ls -t \"\$HOME\"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | head -1); [ -n \"\$N\" ] && exec \"\$N\" \"${EMIT}\" --host claude"
  if [ "${DRY_RUN}" != 1 ] && [ -z "$(command -v node 2>/dev/null || true)" ] \
     && [ -z "$(ls -t "${WB_DIR}"/binaries/node/versions/*/bin/node 2>/dev/null | head -1 || true)" ]; then
    note "这台机器上现在找不到 node：hooks 照样装上，但运行时会静默空转"
  fi
  backup_once "${WB_SETTINGS}" "${BACKUP_TAG}"
  if [ "${DRY_RUN}" = 1 ]; then
    note "会合并 hooks：UserPromptSubmit + Stop → ${HOOK_CMD}（只覆盖命令含 lingxi-emit.mjs 的旧条目）"
    # 写成 if 而不是 `[ -n ... ] && note`：后者在 GUARD_CMD 为空时整体返回 1，
    # 而本脚本 set -euo pipefail，那一下就会把安装器打死在最后一步。
    if [ -n "${GUARD_CMD}" ]; then
      note "额度守卫（同一事件，独立 group）会一并装上：上下文 60/70/90% 时让猫提醒"
    fi
  else
    python3 - "${WB_SETTINGS}" "${HOOK_CMD}" "${GUARD_CMD}" <<'PY'
import json, sys

path, cmd, guard_cmd = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
# 两条命令同属 lingxi，卸载时一起认领；用户自己装的 hook 一律不碰。
MARKS = ('lingxi-emit.mjs', 'lingxi-quota-guard.mjs')


def owned(group):
    """A group is ours if ANY entry in it is ours - the guard can sit in its own group."""
    return any(m in str(entry.get('command', ''))
               for entry in group.get('hooks', [])
               for m in MARKS)


with open(path, encoding='utf-8') as f:
    data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f'✗ {path} 的顶层不是一个对象')
# 四个事件，两种性质：
#   UserPromptSubmit / Stop   会话生命周期——一轮开始与结束。
#   Notification / PermissionRequest  "弹出问题"——agent 在等用户（权限提示、提问），
#     以及权限对话框刚打开的那一刻。这俩才是"WorkBuddy 弹了个东西，猫却没反应"的答案：
#     以前只装了生命周期两条，弹窗完全不在覆盖范围内。应用侧两个都认
#     （apps/lingxi/src-tauri/src/lib.rs 的 normalize_claude_hook_event）。
# 不装 PreToolUse / PostToolUse：每次工具调用都触发，会让猫变成通知轰炸。
EMIT_EVENTS = ('UserPromptSubmit', 'Stop', 'Notification', 'PermissionRequest')
# 额度守卫只挂在生命周期上：它读的是整个会话的用量，跟弹窗没关系。
GUARD_EVENTS = ('UserPromptSubmit', 'Stop')

hooks = data.setdefault('hooks', {})
for event in EMIT_EVENTS:
    # owned() 把 emit 和守卫都认作 lingxi 的，所以这个清空动作只能做一次——
    # 分两个循环的话，第二个循环会把第一个刚写进去的 group 又删掉。
    groups = [g for g in hooks.get(event, []) if not owned(g)]
    groups.append({'hooks': [{'type': 'command', 'command': cmd, 'timeout': 10, 'async': True}]})
    if guard_cmd and event in GUARD_EVENTS:
        groups.append({'hooks': [{'type': 'command', 'command': guard_cmd, 'timeout': 10, 'async': True}]})
    hooks[event] = groups
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
    log "${WB_SETTINGS}: UserPromptSubmit→running、Stop→completed（claude 兼容载荷，实时生效）"
    if [ -n "${GUARD_CMD}" ]; then
      log "${WB_SETTINGS}: 额度守卫已挂上（上下文 60/70/90% 提醒）"
    fi
  fi
fi

echo
echo "完成。验收："
echo "  node --experimental-strip-types ${REPO}/.workbuddy/probes/verify-workbuddy-mcp.mjs"
echo "  lingxi task completed test proud \"WorkBuddy 接好了\"   # 让猫真的反应一次"
echo "  lingxi agents                                        # workbuddy 应带 🐧 与 #0AC89F"
echo "  lingxi events | tail                                 # 结束一轮对话后应出现 workbuddy 的 running/completed"
echo
echo "别忘了去连接器管理页给 lingxi 点「信任」——在那之前 MCP 工具不会出现。"
