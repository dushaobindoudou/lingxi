#!/bin/bash
# 灵犀环境体检（只读）。
#
# 只做一件事：把"现在到底缺什么"说准，好让模型给出正确的那一句话。
#
# 它不会：
#   下载、挂载 dmg、复制 .app、写宿主的任何配置文件、改权限文件、启动应用。
# 它读的东西：应用与 token 的存在性、/health、以及 ~/.workbuddy/settings.json 里有没有
#   灵犀的 hooks（只读，用来判断"每轮自动反应"这一档体验装没装）。
# 安装和启动都是用户的选择动作；这个脚本只观察。
#
# 用法：bash scripts/check.sh
# 退出码：0 就绪 / 2 应用未安装 / 3 应用未启动 / 4 桥接不可达 / 5 token 缺失 / 6 不是 macOS
# 最后一行固定为 `RESULT: <code>`，供程序判断，不要只看中文。

set -u

APP_DIR="$HOME/Library/Application Support/com.dushaobin.lingxi-desktop"
APP_ID="com.dushaobin.lingxi-desktop"
CLI="$APP_DIR/bin/lingxi"
TOKEN="$APP_DIR/bridge-token"
BRIDGE="http://127.0.0.1:47811"

ok()   { printf '[ok]   %s\n' "$1"; }
need() { printf '[need] %s\n' "$1"; }
note() { printf '[note] %s\n' "$1"; }

finish() {
  printf '\nRESULT: %s\n' "$1"
  exit "$2"
}

printf '灵犀环境体检\n------------\n'

# --- 1. 系统 ---------------------------------------------------------------
OS="$(uname -s 2>/dev/null)"
if [ "$OS" != "Darwin" ]; then
  need "当前系统是 ${OS}，灵犀只发布 macOS 版本，无法在这个系统上使用。"
  note "直接告诉用户不支持；不要尝试安装或找替代路径。"
  finish unsupported-os 6
fi
ok "系统 macOS $(sw_vers -productVersion 2>/dev/null)"

# --- 2. 应用是否安装 -------------------------------------------------------
# LINGXI_APP_DIRS 用冒号分隔，默认两个标准位置；装在别处的人可以覆盖。
APP_DIRS="${LINGXI_APP_DIRS:-/Applications:$HOME/Applications}"

find_in_dirs() {
  local dirs="$1"
  local saved="$IFS"
  IFS=':'
  for dir in $dirs; do
    if [ -n "$dir" ] && [ -d "$dir/灵犀.app" ]; then
      IFS="$saved"
      printf '%s\n' "$dir/灵犀.app"
      return 0
    fi
  done
  IFS="$saved"
  return 1
}

APP="$(find_in_dirs "$APP_DIRS" || true)"

# Spotlight 只在标准位置没找到时才用；LINGXI_NO_SPOTLIGHT=1 供测试用。
if [ -z "$APP" ] && [ "${LINGXI_NO_SPOTLIGHT:-0}" != "1" ] \
   && [ "$APP_DIRS" = "/Applications:$HOME/Applications" ] \
   && command -v mdfind >/dev/null 2>&1; then
  hit="$(mdfind -onlyin /Applications -onlyin "$HOME/Applications" \
    "kMDItemCFBundleIdentifier == '$APP_ID'" 2>/dev/null | head -n 1)"
  if [ -n "$hit" ] && [ -d "$hit" ]; then
    APP="$hit"
  fi
fi

if [ -n "$APP" ]; then
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$APP/Contents/Info.plist" 2>/dev/null || true)"
  ok "应用已安装：${APP}${version:+（v${version}）}"
else
  need "没有找到灵犀应用（${APP_ID}）。"
  note "下载页：https://github.com/dushaobindoudou/lingxi/releases/latest"
  note "要下的是 Lingxi-<版本>-universal.dmg；用户自己下载、拖进「应用程序」并打开一次。"
  note "不要替用户下载或安装；也不要说「已经装好了」。"
  finish app-missing 2
fi

# --- 3. CLI（应用首次运行后才写出） -----------------------------------------
if [ -x "$CLI" ]; then
  ok "命令行工具就绪：${CLI}"
else
  need "应用装着，但命令行工具还没生成（${CLI} 不存在）。"
  note "这通常表示装好之后一次都没启动过。两种处理，都不需要你装任何东西："
  note "  1) 让用户自己打开一次灵犀，几秒内就会写好；"
  note "  2) 直接执行 bash scripts/lingxi.sh state —— 它会使 open 一次（受 LINGXI_AUTOSTART 控制）。"
  note "不要复制别处的 CLI，也不要改应用目录里的任何文件。"
  finish app-not-started 3
fi

# --- 4. 桥接是否在跑（/health 免鉴权） --------------------------------------
running=0
if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 2 --noproxy '*' \
    "$BRIDGE/health" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    running=1
  fi
fi

if [ "$running" -eq 1 ]; then
  ok "本地桥接在跑：127.0.0.1:47811"
else
  note "本地桥接没有响应（可能猫正关着）。"
  note "其它命令会在需要时自己拉起一次（受 LINGXI_AUTOSTART 控制），这一步不算故障。"
fi

# --- 5. token --------------------------------------------------------------
if [ ! -f "$TOKEN" ]; then
  need "找不到桥接 token：${TOKEN}"
  note "让用户启动一次应用；token 由应用在首次运行时写出，没有任何要手动配置的东西。"
  finish token-missing 5
fi

perms="$(ls -l "$TOKEN" 2>/dev/null | cut -c1-10)"
if [ "$perms" = "-rw-------" ]; then
  ok "token 存在，权限 600"
else
  note "token 存在，但权限是 ${perms:-未知}（正常应为 -rw-------）。"
  note "不要自己 chmod，也不要把 token 读出来给用户看。"
fi

# --- 6. 会话 hooks（可选增强，不算故障） ------------------------------------
# 只读：settings.json 是宿主的配置，模型不能写，这里也不写。两种装法都认——
# 用户级安装器写 settings.json，插件把自己的 hooks.json 放在插件目录里。
WB="$HOME/.workbuddy"
hooks_installed=0

if [ -f "$WB/settings.json" ] && grep -q 'lingxi-emit\.mjs' "$WB/settings.json" 2>/dev/null; then
  hooks_installed=1
fi

if [ "$hooks_installed" -eq 0 ]; then
  for candidate in "$WB"/plugins/*/hooks/hooks.json "$WB"/plugins/*/*/hooks/hooks.json; do
    [ -f "$candidate" ] || continue
    if grep -q 'lingxi-emit\.mjs' "$candidate" 2>/dev/null; then
      hooks_installed=1
      break
    fi
  done
fi

if [ "$hooks_installed" -eq 1 ]; then
  ok "会话 hooks 已安装：每轮开始/结束、权限弹窗由宿主触发"
else
  note "没有检测到会话 hooks：现在只有模型主动上报时猫才反应（不影响使用）。"
  note "想要每轮都有反应：在 WorkBuddy 里装 lingxi 插件，或按仓库 README 跑一次 install.sh。"
  note "这是可选增强，不是故障。用户没问、也没长期用，就别反复提。"
fi

# --- 结论 ------------------------------------------------------------------
if [ "$running" -eq 1 ]; then
  printf '\n一切就绪。用 bash scripts/lingxi.sh state 看猫现在的状态。\n'
  finish ready 0
fi

printf '\n环境完整，但应用当前没在跑。调用一次 bash scripts/lingxi.sh state 即可（它会拉起一次）。\n'
finish app-not-running 0
