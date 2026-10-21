#!/bin/bash
# 经用户同意后安装灵犀：从 GitHub Releases 下载最新版，校验 SHA256、bundle id 与代码签名，
# 装进「应用程序」并打开。只在用户明确同意之后调用；已经装好时什么也不做。
#
# 真正干活的是同目录的 install-app.sh（integrations/shared/install-app.sh 的逐字副本，
# 每个宿主插件用的都是同一份），这里只把宿主身份定成 workbuddy：进度与日志写在
# ~/.lingxi/workbuddy/，装好后应用停在 WorkBuddy 那一栏。
#
# 用法：bash scripts/install.sh
# 退出码：0 已装好（或本来就装着） / 1 失败，原因在最后一行 / 3 另一个安装正在进行 / 6 不是 macOS

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(uname -s 2>/dev/null)" != "Darwin" ]; then
  echo "灵犀只支持 macOS，当前系统无法安装。"
  exit 6
fi

export LINGXI_HOST="${LINGXI_HOST:-workbuddy}"
# 用 bash 调而不是直接执行：平台解压后不保证保留可执行位。
exec bash "$DIR/install-app.sh" --open "$@"
