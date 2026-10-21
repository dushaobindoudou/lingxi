#!/bin/bash
# 灵犀 CLI 定位器：找到 lingxi 可执行文件，必要时拉起应用，然后把参数原样转发。
#
# 为什么需要它：灵犀的 CLI 不在 PATH 上，应用每次启动会把它写到
# ~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi。
# 让模型每次拼这个长路径既啰嗦又容易错，所以统一从这里进。
#
# 用法：bash scripts/lingxi.sh <子命令> [参数...]
# 退出码与 lingxi 本身一致；找不到 CLI 时返回 127，并打印一句能照做的话。
#
# 环境变量：
#   LINGXI_CLI        指定 CLI 路径（优先于自动探测）
#   LINGXI_AGENT      署名，默认 workbuddy
#   LINGXI_AUTOSTART  0/false/no 时不尝试启动应用

set -u

APP_DIR="$HOME/Library/Application Support/com.dushaobin.lingxi-desktop"
APP_BUNDLE_ID="com.dushaobin.lingxi-desktop"

find_cli() {
  if [ -n "${LINGXI_CLI:-}" ] && [ -x "$LINGXI_CLI" ]; then
    printf '%s\n' "$LINGXI_CLI"
    return 0
  fi
  # 应用自己写的那个最权威：它和 bridge-token 在同一个 HOME 下。
  # PATH 上的 lingxi 可能是别的同名工具，所以放到它后面。
  if [ -x "$APP_DIR/bin/lingxi" ]; then
    printf '%s\n' "$APP_DIR/bin/lingxi"
    return 0
  fi
  # type -P 只找可执行文件，不会返回 alias 或函数
  local from_path
  from_path="$(type -P lingxi 2>/dev/null || true)"
  if [ -n "$from_path" ] && [ -x "$from_path" ]; then
    printf '%s\n' "$from_path"
    return 0
  fi
  return 1
}

may_start() {
  case "${LINGXI_AUTOSTART:-1}" in
    0|false|no|False|No) return 1 ;;
  esac
  [ "$(uname -s 2>/dev/null)" = "Darwin" ] || return 1
  return 0
}

# 应用装过但一次都没启动时，CLI 文件还不存在。给它 6 秒把自己写好。
start_and_wait() {
  may_start || return 1
  open -g -b "$APP_BUNDLE_ID" >/dev/null 2>&1 || return 1
  local i=0
  while [ "$i" -lt 12 ]; do
    sleep 0.5
    if [ -x "$APP_DIR/bin/lingxi" ]; then
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

CLI="$(find_cli || true)"

if [ -z "$CLI" ]; then
  if start_and_wait; then
    CLI="$(find_cli || true)"
  fi
fi

if [ -z "$CLI" ]; then
  echo "找不到灵犀的命令行工具。" >&2
  echo "" >&2
  if [ "$(uname -s 2>/dev/null)" != "Darwin" ]; then
    echo "灵犀是 macOS 应用，当前系统不是 macOS，无法使用。" >&2
    exit 127
  fi
  echo "最可能的原因：应用还没装，或者装上之后一次都没启动过。" >&2
  echo "先跑 bash scripts/check.sh 确认；没装的话问用户要不要帮他装，" >&2
  echo "用户同意后执行 bash scripts/install.sh（下载、校验、安装并打开），之后重新执行本命令即可。" >&2
  exit 127
fi

# 在 WorkBuddy 里说话就用 workbuddy 的署名；外部显式设置时不覆盖。
export LINGXI_AGENT="${LINGXI_AGENT:-workbuddy}"

if [ "$#" -eq 0 ]; then
  exec "$CLI" help
fi

exec "$CLI" "$@"
