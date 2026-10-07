#!/usr/bin/env bash
# 灵犀 · Codex 专用安装器。
#
# 这里安装的是 Codex 宿主接入：config.toml 里的一行 notify、一段 mcp_servers、
# 和 ~/.codex/skills 下的一个目录。所以这个安装器做四件事，全部幂等、全部可回退：
#
#   1. 备份 ~/.codex/config.toml（带时间戳，从不覆盖旧备份）
#   2. notify 合并为 fanout：保留你现有的通知程序，灵犀排在它后面并行触发
#   3. 追加/更新 [mcp_servers.lingxi]（LINGXI_AGENT=codex 身份）
#   4. 安装两层 skill 到 ~/.codex/skills/：系统层 lingxi、lingxi-authoring，宿主层 lingxi-codex
#      （符号链接，git pull 即更新；分层见 integrations/hosts/PLUGIN-STANDARD.md 六）
#
#   ./install.sh            # 正常安装
#   ./install.sh --dry-run  # 只打印将要做的变更
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CODEX_DIR="${LINGXI_CODEX_DIR:-$HOME/.codex}"
CONFIG="$CODEX_DIR/config.toml"
MARKER="# >>> lingxi plugin >>>"
END_MARKER="# <<< lingxi plugin <<<"
EMIT="$REPO/integrations/adapters/lingxi-emit.mjs"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { if [ "$DRY_RUN" = 1 ]; then echo "  [dry] $*"; else echo "  ✓ $*"; fi; }

[ -d "$CODEX_DIR" ] || { echo "✗ $CODEX_DIR 不存在——先装 Codex 再来"; exit 1; }
[ -f "$CONFIG" ] || { echo "✗ $CONFIG 不存在——先跑一次 codex 生成配置"; exit 1; }
[ -f "$EMIT" ] || { echo "✗ 找不到 $EMIT"; exit 1; }

# ---------------------------------------------------------------- 0. 应用
# 接入的是一只猫：应用没装就先从 GitHub 装上最新版（校验 SHA256、bundle id、签名后才装，装好打开），
# 装了没开就在后台拉起，已经在跑就什么都不做。配置和数据跟着 bundle id 走，重装也沿用。
# 用的是 CLI 的 `up`，它和每个插件共用 integrations/shared/install-app.sh。失败不拦安装器：接入照装，
# 之后 `lingxi up` 重试。LINGXI_AUTOINSTALL=0 不装，LINGXI_AUTOSTART=0 不开。
echo "0. 应用"
if [ "$DRY_RUN" = 1 ]; then
  echo "  [dry] 灵犀没装就从 GitHub 下载安装并打开，没开就后台拉起（LINGXI_AGENT=codex lingxi up）"
elif LINGXI_AGENT=codex bash "$REPO/integrations/cli/lingxi" up 2>&1 | sed 's/^/  /'; then
  :
else
  echo "  ⚠️  灵犀没能装上或打开；接入照装，之后运行 lingxi up 重试（日志：~/.lingxi/codex/install.log）"
fi

BACKUP=""
if [ "$DRY_RUN" = 0 ]; then
  # 只保留第一份备份：它是 pre-lingxi 的原样快照，后面 fanout 消失时的恢复链全靠它。
  # 同秒重复安装会撞时间戳——覆盖第一份就等于删掉用户的退路。
  if ! ls "$CONFIG".bak-lingxi-* >/dev/null 2>&1; then
    STAMP="$(date +%Y%m%d-%H%M%S)"
    BACKUP="$CONFIG.bak-lingxi-$STAMP"
    cp "$CONFIG" "$BACKUP"
    echo "  ✓ 已备份 $CONFIG → $BACKUP"
  else
    echo "  · 已有备份，不覆盖（保留最早的 pre-lingxi 快照）"
  fi
fi

# ---------- 2. notify fanout：一个槽位跑两个程序，既有的在前 ----------
# Codex 的 notify 只接受一个程序。覆盖式安装会静默杀掉用户已有的通知器——这是不可接受的，
# 所以把 notify 指向生成的 fanout 脚本：原程序拿完整载荷照跑，灵犀并行排在后面。
CURRENT_NOTIFY_LINE="$(grep -E '^[[:space:]]*notify[[:space:]]*=' "$CONFIG" | tail -1 || true)"

# Other Codex integrations may wrap the existing notify and keep it in a
# --previous-notify argument. Preserve that wrapper when it already reaches
# our fanout; replacing it would disable the newer integration.
WRAPPED_FANOUT=0
if printf '%s' "$CURRENT_NOTIFY_LINE" | grep -q 'notify-fanout.sh'; then
  if ! printf '%s' "$CURRENT_NOTIFY_LINE" | grep -Eq '^[[:space:]]*notify[[:space:]]*=[[:space:]]*\["[^"[:space:]]*notify-fanout.sh"\]'; then
    WRAPPED_FANOUT=1
  fi
fi

existing_notify_cmd() {
  # Keep argv boundaries, including spaces and quotes inside an argument. `sed` cannot parse
  # TOML arrays: it silently turns one argument into several and breaks the user's notifier.
  [ -n "$CURRENT_NOTIFY_LINE" ] || return 0
  local cmd
  cmd="$(notify_line_to_shell "$CURRENT_NOTIFY_LINE")" || return 1
  # 指向旧 fanout / 灵犀自身的行不保留，避免套娃
  case "$cmd" in
    *notify-fanout*|*lingxi-emit*) return 0 ;;
  esac
  printf '%s' "$cmd"
}

notify_line_to_shell() {
  python3 - "$1" <<'PYEOF'
import ast, shlex, sys
try:
    value = ast.literal_eval(sys.argv[1].split('=', 1)[1].strip())
    if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
        raise ValueError('notify must be an array of strings')
except (ValueError, SyntaxError, IndexError) as error:
    print(f'✗ 无法安全读取原有 notify：{error}', file=sys.stderr)
    sys.exit(1)
print(' '.join(shlex.quote(arg) for arg in value))
PYEOF
}

write_fanout() {
  local prev_cmd="$1"
  local fanout="$CODEX_DIR/notify-fanout.sh"
  {
    echo '#!/bin/sh'
    echo '# 灵犀 fanout（integrations/hosts/codex/install.sh 生成）：一个 notify 槽位跑两个程序，'
    echo '# 各拿完整载荷、并行、互不阻塞。回退：把 config.toml 的 notify 换回 previous 行。'
    echo 'PAYLOAD="$1"'
    if [ -n "$prev_cmd" ]; then
      echo "$prev_cmd \"\$PAYLOAD\" &   # 你原来的通知器"
    fi
    echo "LINGXI_AGENT=codex node $(printf '%q' "$EMIT") --host codex \"\$PAYLOAD\" &"
    echo 'wait'
    echo 'exit 0'
  } > "$fanout"
  chmod 700 "$fanout"
}

# 重装时 config.toml 的 notify 已经指向 fanout（被 self-filter 丢弃），此刻原通知器唯一的
# 记录在既有 fanout 脚本自己的注释行里。不回收它，重装就会静默杀掉用户的通知程序。
previous_from_fanout() {
  [ -f "$FANOUT" ] || return 0
  # New fanout stores a shell-quoted argv prefix; keep the older generated form readable too.
  local previous
  previous="$(sed -n 's/ \"\$PAYLOAD\" &[[:space:]]*#[[:space:]]*你原来的通知器[[:space:]]*$//p' "$FANOUT" | head -1)"
  if [ -n "$previous" ]; then printf '%s' "$previous"; return 0; fi
  sed -n "s/^sh -c '\(.*\)' &[[:space:]]*#[[:space:]]*你原来的通知器[[:space:]]*$/\1/p" "$FANOUT" | head -1
}

FANOUT="$CODEX_DIR/notify-fanout.sh"
FANOUT_NEEDED=0
if [ ! -f "$FANOUT" ] || ! grep -q "lingxi-emit.mjs" "$FANOUT"; then
  FANOUT_NEEDED=1
fi

# fanout 脚本也被删了的兜底：历次安装备份是最后一份原样 notify 的记录。
previous_from_backup() {
  local bak line cmd
  for bak in $(ls "$CONFIG".bak-lingxi-* 2>/dev/null); do
    line="$(grep -E '^[[:space:]]*notify[[:space:]]*=' "$bak" | tail -1 || true)"
    [ -n "$line" ] || continue
    cmd="$(notify_line_to_shell "$line")" || continue
    case "$cmd" in
      *notify-fanout*|*lingxi-emit*) continue ;;
    esac
    printf '%s' "$cmd"
    return 0
  done
  return 0
}

# The wrapping program's own path (argv[0] of the current notify), unquoted.
wrapper_program() {
  python3 - "$1" <<'PYEOF'
import ast, sys
try:
    value = ast.literal_eval(sys.argv[1].split('=', 1)[1].strip())
    print(value[0])
except Exception:
    pass
PYEOF
}

if [ "$WRAPPED_FANOUT" = 1 ]; then
  # The wrapper runs itself on every turn and THEN hands the payload to --previous-notify (our
  # fanout). A fanout that also calls the wrapper runs it twice per turn - which is what a fanout
  # generated before the wrapper arrived does, since back then the wrapper WAS the previous
  # notifier. Keep only notifiers other than the wrapper; the backup is no help here, it predates
  # the wrapper too.
  PREV_CMD="$(previous_from_fanout || true)"
  WRAPPER="$(wrapper_program "$CURRENT_NOTIFY_LINE")"
  if [ -n "$WRAPPER" ] && [ -f "$FANOUT" ] && grep -qF "$WRAPPER" "$FANOUT"; then
    PREV_CMD=""
    FANOUT_NEEDED=1
    log "fanout: 去掉重复调用的 notify 包装器（${WRAPPER##*/}）——它自己已经在跑"
  fi
else
  PREV_CMD="$(existing_notify_cmd)"
  if [ -z "$PREV_CMD" ]; then
    PREV_CMD="$(previous_from_fanout || true)"
  fi
  if [ -z "$PREV_CMD" ]; then
    PREV_CMD="$(previous_from_backup || true)"
  fi
fi
# 最后一道保险：notify 指向一个已消失的 fanout，且三处都找不回原通知器——宁可拒绝安装，
# 也不能默默按"此前无通知器"写盘，把用户的通知程序埋掉。
# （包装模式不在此列：包装器自己就是原通知器，fanout 不需要再带它。）
if [ "$FANOUT_NEEDED" = 1 ] && [ -z "$PREV_CMD" ] && [ "$WRAPPED_FANOUT" = 0 ] \
   && printf '%s' "$CURRENT_NOTIFY_LINE" | grep -q 'notify-fanout'; then
  echo "✗ config.toml 的 notify 指向一个已不存在的 fanout 脚本，且备份里找不到原通知器。" >&2
  echo "  为避免悄悄丢掉你的通知程序，拒绝继续。请手工确认原 notify 后重跑。" >&2
  exit 1
fi
if [ "$FANOUT_NEEDED" = 1 ]; then
  if [ "$DRY_RUN" = 0 ]; then
    [ -f "$FANOUT" ] && cp "$FANOUT" "$FANOUT.bak-$(date +%Y%m%d-%H%M%S)"
    write_fanout "$PREV_CMD"
  fi
  if [ -n "$PREV_CMD" ]; then
    log "notify → fanout（保留既有通知器：${PREV_CMD}）"
  elif [ "$WRAPPED_FANOUT" = 1 ]; then
    log "notify → fanout（原通知器由外层包装器自己运行）"
  else
    log "notify → fanout（此前无通知器）"
  fi
else
  echo "  · fanout 脚本已就绪，跳过"
fi

# ---------- 3. config.toml：notify 行 + MCP 段 ----------
NEW_NOTIFY_LINE="notify = [\"$FANOUT\"]"
MCP_BLOCK="$MARKER
[mcp_servers.lingxi]
command = \"node\"
args = [\"$REPO/packages/mcp-server/src/index.mjs\"]

[mcp_servers.lingxi.env]
LINGXI_AGENT = \"codex\"
LINGXI_AGENT_NAME = \"Codex\"
$END_MARKER"

update_mcp_block() {
  python3 - "$CONFIG" "$MCP_BLOCK" <<'PYEOF'
import re, sys
path, block = sys.argv[1], sys.argv[2]
text = open(path).read()
marker, end = "# >>> lingxi plugin >>>", "# <<< lingxi plugin <<<"
pattern = re.compile(re.escape(marker) + r".*?" + re.escape(end), re.S)
if pattern.search(text):
    match = pattern.search(text)
    inside = match.group()
    foreign = re.search(r'(?m)^\[(?!mcp_servers\.lingxi(?:\.|\]))[^\n]+\]\s*$', inside)
    if foreign:
        # A previous installer put the closing marker after unrelated MCP
        # tables. Keep those tables byte-for-byte instead of deleting them.
        updated = text[:match.start()] + block + "\n\n" + inside[foreign.start():].replace(end, "", 1).rstrip() + text[match.end():]
    else:
        updated = text[:match.start()] + block + text[match.end():]
else:
    # Older/manual installs have the same TOML tables but no marker. Replace those tables
    # in place; appending another [mcp_servers.lingxi] makes the whole config invalid.
    table = re.compile(r"(?m)^\[mcp_servers\.lingxi\]\s*$")
    match = table.search(text)
    if match:
        next_table = re.compile(r"(?m)^\[(?!mcp_servers\.lingxi(?:\.|\]))[^\n]+\]\s*$")
        following = next_table.search(text, match.end())
        end_at = following.start() if following else len(text)
        updated = text[:match.start()].rstrip("\n") + "\n\n" + block + "\n\n" + text[end_at:].lstrip("\n")
    else:
        updated = text.rstrip("\n") + "\n\n" + block + "\n"
open(path, "w").write(updated)
PYEOF
}

if [ "$DRY_RUN" = 0 ]; then
  if [ "$WRAPPED_FANOUT" = 1 ]; then
    log "config.toml: 保留现有 notify 包装器（已转发到灵犀 fanout）"
  elif grep -qE '^[[:space:]]*notify[[:space:]]*=' "$CONFIG"; then
    if ! grep -qF "$NEW_NOTIFY_LINE" "$CONFIG"; then
      REPLACEMENT="$(printf '%s' "$NEW_NOTIFY_LINE" | sed 's/[&|]/\\&/g')"
      sed -i '' -E "s|^([[:space:]]*notify[[:space:]]*=[[:space:]]*).*$|$REPLACEMENT|" "$CONFIG"
      log "config.toml: notify 指向 fanout"
    fi
  else
    printf '\n%s\n' "$NEW_NOTIFY_LINE" >> "$CONFIG"
    log "config.toml: 追加 notify → fanout"
  fi
  if grep -qF "$MARKER" "$CONFIG"; then
    update_mcp_block
    log "config.toml: 更新 [mcp_servers.lingxi] 段"
  else
    update_mcp_block
    log "config.toml: 追加 [mcp_servers.lingxi] 段"
  fi
else
  if [ "$WRAPPED_FANOUT" = 1 ]; then
    log "config.toml: 保留现有 notify 包装器（已转发到灵犀 fanout）"
  else
    log "config.toml: notify → $NEW_NOTIFY_LINE"
  fi
  log "config.toml: 写入 [mcp_servers.lingxi]（LINGXI_AGENT=codex）"
fi

# ---------- 4. skill：系统层 + 宿主层 ----------
link_skill() {
  local name="$1" src="$2" dest="$CODEX_DIR/skills/$1"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    # 应用「一键接入」写的是副本（旁边有 .lingxi-installed）；换成跟随仓库的软链不丢任何东西。
    if [ -f "$dest/.lingxi-installed" ] && cmp -s "$dest/SKILL.md" "$dest/.lingxi-installed"; then
      [ "$DRY_RUN" = 1 ] || rm -rf "$dest"
    else
      echo "✗ $dest 是普通目录且内容被改过；请先手动确认，安装器不会覆盖它。" >&2
      exit 1
    fi
  fi
  [ "$DRY_RUN" = 1 ] || ln -sfn "$src" "$dest"
  log "skill $name → $src"
}
[ "$DRY_RUN" = 1 ] || mkdir -p "$CODEX_DIR/skills"
link_skill lingxi "$REPO/integrations/skills/lingxi"
link_skill lingxi-authoring "$REPO/integrations/skills/lingxi-authoring"
link_skill lingxi-codex "$REPO/integrations/hosts/codex/skills/lingxi-codex"

echo
echo "完成。验收："
echo "  codex mcp list                 # lingxi 应在列"
echo "  lingxi events                  # codex 回合结束后应出现 provider=codex 的事件"
if [ -n "$BACKUP" ]; then
  echo "回退：${BACKUP}（config.toml 安装前快照）"
fi
