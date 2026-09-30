#!/usr/bin/env bash
# 灵犀 · 豆包专用安装器。
#
# 豆包（Doubao）没有进程外插件机制——没有 Claude Code 那种 hooks 配置文件，会话生命周期
# 事件不外露，所以没有「确定性的一半」，只有模型主动那一半。豆包的插件形态是：
#
#   1. 技能：装进豆包的技能根（.user_skills），豆包 agent 读 SKILL.md 才会驱动猫
#   2. CLI 包装器：bin/lingxi 放在豆包 agent shell 的 PATH 上，固定以豆包身份说话
#
# 外加一个不属于任何宿主、但也必须配对的共享件：
#
#   3. POST /agents  用 doubao-logo 注册身份，徽章才是「豆」而不是默认字母
#
# 以及替豆包补上「确定性的一半」：
#
#   4. 回合监听：bin/lingxi-doubao-watch 由 LaunchAgent 常驻，读豆包自己的日志里「任务开始 /
#      结束 / 等你回答」三种行（只含会话 id，不含对话内容），像别的宿主的 hook 一样报给猫。
#      LINGXI_DOUBAO_WATCH=0 不装这一项。
#
#   ./install.sh                  # 正常安装，幂等
#   ./install.sh --dry-run        # 只打印将要做的变更
#   ./install.sh --uninstall      # 把上面的都撤掉
#
# 约定：所有变量展开都写成 ${VAR}。紧跟中文/全角字符的裸 $VAR 会被 bash 当成变量名的一部分
# （UTF-8 locale 下全角标点的字节被判成字母），这是一个只在有中文提示的脚本里才会踩的坑。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLUGIN="${REPO}/integrations/hosts/doubao"
# 豆包技能根：默认是豆包 agent workspace 的 .user_skills（当前被豆包枚举的根）。
# 豆包改版换目录时用 LINGXI_DOUBAO_SKILLS 覆盖。
DOUBAO_SKILLS="${LINGXI_DOUBAO_SKILLS:-${HOME}/Library/Application Support/Doubao/Default/.doubao/agent_mode/workspace/.user_skills}"
SHARED_SKILLS="${REPO}/integrations/skills"
DOUBAO_SKILL_SRC="${PLUGIN}/skills"
CLI_DIR="${HOME}/.local/bin"   # 豆包 agent 的 shell PATH 已包含它（lingxi health 自证过）
CLI_LINK="${CLI_DIR}/lingxi"
WRAPPER="${PLUGIN}/bin/lingxi"
APP_BIN_DIR="${HOME}/Library/Application Support/com.dushaobin.lingxi-desktop"
MARK="${PLUGIN}/doubao-logo"
AGENT_ID="doubao"
AGENT_NAME="豆包"
AGENT_BADGE="豆"
AGENT_COLOR="#E6EEFF"
WATCH="${PLUGIN}/bin/lingxi-doubao-watch"
WATCH_LABEL="com.dushaobin.lingxi.doubao-watch"
WATCH_PLIST="${HOME}/Library/LaunchAgents/${WATCH_LABEL}.plist"
WATCH_LOG_DIR="${HOME}/.lingxi/doubao"
LAUNCHCTL="${LINGXI_LAUNCHCTL:-launchctl}"   # 测试里换成假的，免得真往 launchd 里装东西

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

[ -d "${DOUBAO_SKILLS}" ] || { echo "✗ 找不到豆包技能根 ${DOUBAO_SKILLS}" >&2; echo "   豆包没装或版本不同？用 LINGXI_DOUBAO_SKILLS 指定实际技能根。" >&2; exit 1; }
[ -x "${WRAPPER}" ]      || { echo "✗ 找不到包装器 ${WRAPPER}" >&2; exit 1; }
[ -f "${MARK}" ]         || { echo "✗ 找不到 ${MARK}" >&2; exit 1; }
[ -d "${DOUBAO_SKILL_SRC}" ] || { echo "✗ 找不到 ${DOUBAO_SKILL_SRC}" >&2; exit 1; }
[ -d "${SHARED_SKILLS}" ]    || { echo "✗ 找不到 ${SHARED_SKILLS}" >&2; exit 1; }

# 第一份备份才是有价值的：它是 pre-lingxi 的原样快照。同秒重跑会撞时间戳，
# 覆盖它就等于删掉用户的退路。
backup_once() {
  local src="$1" tag="$2" dest
  # -e 对指向不存在目标的软链为假，但那个名字照样占着——所以 -L 也要算存在
  { [ -e "${src}" ] || [ -L "${src}" ]; } || return 0
  if ls "${src}".bak-lingxi-doubao-* >/dev/null 2>&1; then
    note "已有备份，不覆盖（保留最早的 pre-lingxi 快照）"
    return 0
  fi
  dest="${src}.bak-lingxi-doubao-${tag}"
  if [ "${DRY_RUN}" = 1 ]; then note "会备份 ${src} → ${dest}"; return 0; fi
  mv "${src}" "${dest}"
  echo "  ✓ 已备份 ${src} → ${dest}"
}

# ---------------------------------------------------------------- 卸载
if [ "${UNINSTALL}" = 1 ]; then
  echo "撤销豆包接入："
  for s in lingxi lingxi-doubao lingxi-authoring; do
    dest="${DOUBAO_SKILLS}/${s}"
    if [ -L "${dest}" ]; then
      target="$(readlink "${dest}")"
      case "${target}" in
        *"/integrations/hosts/doubao/skills/${s}"|*"/integrations/skills/${s}")
          if [ "${DRY_RUN}" = 1 ]; then
            note "会删除软链 ${dest} → ${target}"
          else
            rm -f "${dest}"
            log "已删除软链 ${dest}"
          fi ;;
        *) note "${dest} 指向别处（${target}），不碰" ;;
      esac
    else
      note "${dest} 不存在或不是软链，不碰"
    fi
  done
  # 只撤自己的 CLI 包装器：没备份（不是我们装的）就不动。
  if [ -L "${CLI_LINK}" ] && [ "$(readlink "${CLI_LINK}")" = "${WRAPPER}" ]; then
    if [ "${DRY_RUN}" = 1 ]; then
      note "会删除 ${CLI_LINK}（我们装的包装器）"
    else
      rm -f "${CLI_LINK}"
      log "${CLI_LINK}: 已删除"
    fi
  else
    note "${CLI_LINK} 不是我们的包装器，不碰"
  fi
  if ls "${CLI_LINK}".bak-lingxi-doubao-* >/dev/null 2>&1; then
    bak="$(ls "${CLI_LINK}".bak-lingxi-doubao-* | head -1)"
    if [ "${DRY_RUN}" = 1 ]; then
      note "会恢复原 CLI ${CLI_LINK} ← ${bak}"
    else
      mv "${bak}" "${CLI_LINK}"
      log "${CLI_LINK}: 已恢复原 CLI"
    fi
  fi
  if [ -f "${WATCH_PLIST}" ]; then
    if [ "${DRY_RUN}" = 1 ]; then
      note "会停止并删除回合监听 ${WATCH_PLIST}"
    else
      "${LAUNCHCTL}" bootout "gui/$(id -u)/${WATCH_LABEL}" >/dev/null 2>&1 || true
      rm -f "${WATCH_PLIST}"
      log "回合监听已停止并删除"
    fi
  else
    note "没有装回合监听，不碰"
  fi
  echo
  echo "注意：身份注册（POST /agents）是内存态的，应用重启即消失，无需清理。"
  exit 0
fi

# ---------------------------------------------------------------- 1. 技能
echo "1. 技能（${DOUBAO_SKILLS}）"
# 软链而不是拷贝：git pull 一次豆包跟着更新。两层都装（integrations/hosts/PLUGIN-STANDARD.md 六）：
# 系统层 lingxi（插件内的逐字副本，上传技能时整个文件夹带走）和 lingxi-authoring（共享版），
# 宿主层 lingxi-doubao（豆包才成立的事：没有 hook、身份、只用 CLI）。
install_skill() {
  local name="$1" src="$2"
  local dest="${DOUBAO_SKILLS}/${name}"
  if [ -e "${dest}" ] && [ ! -L "${dest}" ]; then
    echo "✗ ${dest} 是普通目录，安装器不覆盖它；请手动确认后重跑" >&2
    exit 1
  fi
  if [ -L "${dest}" ] && [ "$(readlink "${dest}")" = "${src}" ]; then
    note "${name}: 已是指向 ${src} 的软链，跳过"
    return 0
  fi
  if [ "${DRY_RUN}" = 1 ]; then
    note "会软链 ${dest} → ${src}"
    return 0
  fi
  rm -f "${dest}"
  ln -s "${src}" "${dest}"
  log "${dest} → ${src}"
}
install_skill "lingxi"          "${DOUBAO_SKILL_SRC}/lingxi"
install_skill "lingxi-doubao"   "${DOUBAO_SKILL_SRC}/lingxi-doubao"
install_skill "lingxi-authoring" "${SHARED_SKILLS}/lingxi-authoring"

# ---------------------------------------------------------------- 2. CLI 包装器
echo "2. CLI 包装器（${CLI_LINK}）"
if [ -L "${CLI_LINK}" ] && [ "$(readlink "${CLI_LINK}")" = "${WRAPPER}" ]; then
  note "${CLI_LINK} 已经是我们的包装器，跳过"
elif [ -e "${CLI_LINK}" ] || [ -L "${CLI_LINK}" ]; then
  backup_once "${CLI_LINK}" "$(date +%Y%m%d-%H%M%S)"
  if [ "${DRY_RUN}" = 1 ]; then
    note "会软链 ${CLI_LINK} → ${WRAPPER}"
  else
    ln -s "${WRAPPER}" "${CLI_LINK}"
    log "${CLI_LINK} → ${WRAPPER}"
  fi
else
  if [ "${DRY_RUN}" = 1 ]; then
    note "会创建 ${CLI_DIR} 并软链 ${CLI_LINK} → ${WRAPPER}"
  else
    mkdir -p "${CLI_DIR}"
    ln -s "${WRAPPER}" "${CLI_LINK}"
    log "${CLI_LINK} → ${WRAPPER}"
  fi
fi

# ---------------------------------------------------------------- 3. 注册身份
echo "3. 注册身份与徽章"
CLI="$(command -v lingxi 2>/dev/null || true)"
[ -n "${CLI}" ] || CLI="${APP_BIN_DIR}/bin/lingxi"
if [ ! -x "${CLI}" ]; then
  note "找不到 lingxi CLI，跳过（应用启动后会把 CLI 写到 ${APP_BIN_DIR}/bin/lingxi）"
elif ! "${CLI}" health >/dev/null 2>&1; then
  note "灵犀没在跑，跳过——启动后手工补一次："
  note "lingxi register ${AGENT_ID} --logo \"${MARK}\" --name \"${AGENT_NAME}\" --color ${AGENT_COLOR} --badge \"${AGENT_BADGE}\""
elif [ "${DRY_RUN}" = 1 ]; then
  note "会注册 ${AGENT_ID}（${AGENT_BADGE} ${AGENT_NAME} ${AGENT_COLOR}）+ doubao-logo"
else
  # 注册表是纯内存的，重启应用就没了——所以每次安装都重注册，代价是一次回环请求。
  "${CLI}" register "${AGENT_ID}" --logo "${MARK}" --name "${AGENT_NAME}" \
    --color "${AGENT_COLOR}" --badge "${AGENT_BADGE}" >/dev/null
  log "已注册 ${AGENT_BADGE} ${AGENT_NAME}（${AGENT_ID} ${AGENT_COLOR}）"
fi

# ---------------------------------------------------------------- 4. 回合监听
echo "4. 回合监听（${WATCH_LABEL}）"
# 用 python3 的真实路径，不走 /usr/bin/python3 这个 xcrun 转发壳：launchd 给的环境里没有它的缓存，
# 每次启动要多花好几秒，而且转发壳的路径在系统更新后也可能变。
PYTHON="$(python3 -c 'import sys; print(sys.executable)' 2>/dev/null || true)"
if [ "${LINGXI_DOUBAO_WATCH:-1}" = 0 ]; then
  note "LINGXI_DOUBAO_WATCH=0，跳过"
elif [ -z "${PYTHON}" ]; then
  note "没有可用的 python3，跳过——豆包的回合结束要靠模型自己报"
elif [ "${DRY_RUN}" = 1 ]; then
  note "会安装 ${WATCH_PLIST}（${PYTHON} ${WATCH}），登录后常驻"
else
  mkdir -p "$(dirname "${WATCH_PLIST}")" "${WATCH_LOG_DIR}"
  cat > "${WATCH_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${WATCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${PYTHON}</string><string>${WATCH}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardErrorPath</key><string>${WATCH_LOG_DIR}/watch.err</string>
</dict>
</plist>
PLIST
  # 重装时先卸下旧的，才会用上新的脚本路径和 python。
  "${LAUNCHCTL}" bootout "gui/$(id -u)/${WATCH_LABEL}" >/dev/null 2>&1 || true
  if "${LAUNCHCTL}" bootstrap "gui/$(id -u)" "${WATCH_PLIST}" >/dev/null 2>&1; then
    log "回合监听已启动：豆包每轮开始、结束、等你回答都会报给猫"
  else
    note "LaunchAgent 已写好但没能启动；注销重新登录后会自动运行"
  fi
fi

echo
echo "完成。验收："
echo "  lingxi agents                                        # doubao 应带「豆」与 #E6EEFF"
echo "  lingxi task completed write proud \"豆包接好了\"       # 让猫真的反应一次"
echo "  lingxi events                                       # 应看到 provider=doubao 的事件"
