#!/usr/bin/env bash
# Install (or update) the 灵犀 app from its GitHub release.
#
#   install-app.sh                  install if missing; leave an installed app alone
#   install-app.sh --update         replace an installed app with the latest release, if newer
#   install-app.sh --from <path>    a local .dmg (with SHA256SUMS.txt beside it) or a directory
#                                   holding both - offline installs, and the tests
#   install-app.sh --dest <dir>     where to put it (default /Applications, or ~/Applications
#                                   when /Applications is not writable)
#   install-app.sh --open           open it afterwards, in front, and show the Claude page
#   install-app.sh --replay <file>  after opening, deliver this saved hook payload
#
# What it refuses to install: anything whose SHA256 does not match the release's SHA256SUMS.txt,
# anything whose bundle identifier is not com.dushaobin.lingxi-desktop, anything whose code
# signature does not verify. A checksum from the same release protects against a broken or
# truncated download, not against the release itself; the release is as trustworthy as the
# GitHub account that published it.
#
# What it never touches: ~/Library/Application Support/com.dushaobin.lingxi-desktop. That is the
# app's data - settings, memory, reminders, custom assets - and it belongs to the bundle
# identifier, not to a particular copy of the app. Install, update, delete and reinstall: the
# data is still there, and the new copy reads it on first launch.
#
# Downloads come through `gh` when it is logged in (the repository may be private) and through
# the public GitHub API otherwise. Everything is logged to ~/.lingxi/claude/install.log, and
# progress is in ~/.lingxi/claude/install.state, which the session hook and /lingxi:status read.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

UPDATE=0; FROM=""; DEST="${LINGXI_INSTALL_DIR:-}"; OPEN=0; REPLAY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --update) UPDATE=1 ;;
    --from) FROM="${2:-}"; shift ;;
    --dest) DEST="${2:-}"; shift ;;
    --open) OPEN=1 ;;
    --replay) REPLAY="${2:-}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$LX_STATE_DIR"
LOG="$LX_STATE_DIR/install.log"
say() { printf '%s\n' "$*"; printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
state() { printf '%s\t%s\n' "$1" "${2:-}" > "$LX_STATE_DIR/install.state"; }
fail() { state failed "$*"; say "✗ $*"; exit 1; }

[ "$(uname -s)" = Darwin ] || fail "灵犀 只支持 macOS"

# One installer at a time: two sessions starting together must not both download and race to
# replace the same bundle. A lock older than 15 minutes is a crashed run, not a live one.
LOCK="$LX_STATE_DIR/install.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rm -rf "$LOCK"; mkdir "$LOCK"
  else
    say "另一个安装正在进行（${LOCK}）"; exit 3
  fi
fi
WORK="$(mktemp -d)"
MOUNT=""
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -force -quiet 2>/dev/null || true
  rm -rf "$WORK" "$LOCK"
}
trap cleanup EXIT

EXISTING="$(lx_app_path)"
if [ -n "$EXISTING" ] && [ "$UPDATE" = 0 ]; then
  state installed "$EXISTING"
  say "已安装：${EXISTING}（$(lx_version_of "$EXISTING")）"
  exit 0
fi

# --- 1. get the release -------------------------------------------------------------------------
state downloading "正在获取安装包"
DMG=""; SUMS=""
if [ -n "$FROM" ]; then
  if [ -d "$FROM" ]; then
    DMG="$(find "$FROM" -maxdepth 1 -name 'Lingxi-*.dmg' | sed -n 1p)"; SUMS="$FROM/SHA256SUMS.txt"
  else
    DMG="$FROM"; SUMS="$(dirname "$FROM")/SHA256SUMS.txt"
  fi
  [ -f "$DMG" ] || fail "没有找到安装包：$FROM"
  [ -f "$SUMS" ] || fail "安装包旁边没有 SHA256SUMS.txt，拒绝安装一个无法校验的包"
  cp "$DMG" "$SUMS" "$WORK/"; DMG="$WORK/$(basename "$DMG")"; SUMS="$WORK/SHA256SUMS.txt"
  TAG="local"
else
  say "从 GitHub 获取 $LX_REPO 的最新版本…"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    TAG="$(gh release view --repo "$LX_REPO" --json tagName -q .tagName 2>>"$LOG")" \
      || fail "gh 读不到 $LX_REPO 的 release（仓库是私有的话，需要这个 GitHub 账号有访问权限）"
    gh release download "$TAG" --repo "$LX_REPO" --dir "$WORK" \
      --pattern 'Lingxi-*-universal.dmg' --pattern 'SHA256SUMS.txt' >>"$LOG" 2>&1 \
      || fail "下载 $TAG 失败，详情见 $LOG"
  else
    API="$(curl -fsSL -m 20 "https://api.github.com/repos/$LX_REPO/releases/latest" 2>>"$LOG")" \
      || fail "拿不到 $LX_REPO 的最新 release。仓库是私有的话，先 gh auth login 再运行 /lingxi:setup"
    TAG="$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' <<<"$API" | sed -n 1p)"
    for pattern in 'Lingxi-[^"/]*-universal\.dmg' 'SHA256SUMS\.txt'; do
      url="$(grep -o "\"browser_download_url\": *\"[^\"]*/$pattern\"" <<<"$API" | sed 's/.*"\(https[^"]*\)"/\1/' | sed -n 1p)"
      [ -n "$url" ] || fail "$TAG 里没有找到 ${pattern//\\/}"
      curl -fL -m 600 --retry 2 -o "$WORK/$(basename "$url")" "$url" >>"$LOG" 2>&1 || fail "下载失败：$url"
    done
  fi
  DMG="$(find "$WORK" -maxdepth 1 -name 'Lingxi-*.dmg' | sed -n 1p)"; SUMS="$WORK/SHA256SUMS.txt"
  [ -f "$DMG" ] && [ -f "$SUMS" ] || fail "$TAG 的安装包或校验文件不完整"
fi

LATEST="${TAG#v}"
if [ -n "$EXISTING" ] && [ "$UPDATE" = 1 ] && [ "$TAG" != local ]; then
  CURRENT="$(lx_version_of "$EXISTING")"
  if [ "$CURRENT" = "$LATEST" ]; then
    state installed "$EXISTING"; say "已经是最新版本 $CURRENT"; exit 0
  fi
fi

# --- 2. verify ----------------------------------------------------------------------------------
state verifying "正在校验"
EXPECTED="$(awk -v f="$(basename "$DMG")" '$2 == f || $2 == "*"f {print $1}' "$SUMS")"
ACTUAL="$(shasum -a 256 "$DMG" | awk '{print $1}')"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || fail "校验和不匹配（期望 ${EXPECTED:-无}，实际 ${ACTUAL}），拒绝安装"

MOUNT="$WORK/mount"; mkdir -p "$MOUNT"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" "$DMG" >>"$LOG" 2>&1 || { MOUNT=""; fail "打不开安装包"; }
SOURCE_APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' | sed -n 1p)"
[ -n "$SOURCE_APP" ] || fail "安装包里没有 .app"
[ "$(lx_bundle_id_of "$SOURCE_APP")" = "$LX_BUNDLE_ID" ] || fail "安装包里的应用不是灵犀（bundle id 不对）"
codesign --verify --deep --strict "$SOURCE_APP" >>"$LOG" 2>&1 || fail "应用签名校验失败，拒绝安装"
NEW_VERSION="$(lx_version_of "$SOURCE_APP")"

# --- 3. install ---------------------------------------------------------------------------------
state installing "正在安装 $NEW_VERSION"
if [ -z "$DEST" ]; then
  if [ -n "$EXISTING" ]; then DEST="$(dirname "$EXISTING")"
  elif [ -w /Applications ]; then DEST=/Applications
  else DEST="$HOME/Applications"; fi
fi
mkdir -p "$DEST"
TARGET="$DEST/$LX_APP_NAME.app"

# An update replaces a running app: quit it first, and bring it back afterwards.
WAS_RUNNING=0
if [ -n "$EXISTING" ] && pgrep -f "$EXISTING/Contents/MacOS/" >/dev/null 2>&1; then
  WAS_RUNNING=1
  pkill -TERM -f "$EXISTING/Contents/MacOS/" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$EXISTING/Contents/MacOS/" >/dev/null 2>&1 || break; sleep 0.5; done
fi

# Copy beside the target, then swap: a failure part-way leaves the old app intact, never half of
# a new one.
STAGING="$DEST/.$LX_APP_NAME.app.installing"
rm -rf "$STAGING"
ditto "$SOURCE_APP" "$STAGING" || fail "复制到 $DEST 失败"
# Fetched by curl/gh from a checksum-verified release, so there is no quarantine attribute to
# begin with; this clears one if --from pointed at a browser download. Without it the first
# launch stops at "无法验证开发者" even though the file has just been verified here.
xattr -dr com.apple.quarantine "$STAGING" 2>/dev/null || true
if [ -e "$TARGET" ]; then
  rm -rf "$TARGET.old"; mv "$TARGET" "$TARGET.old"
fi
mv "$STAGING" "$TARGET" || { [ -e "$TARGET.old" ] && mv "$TARGET.old" "$TARGET"; fail "替换 $TARGET 失败"; }
rm -rf "$TARGET.old"
hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; MOUNT=""

say "✓ 灵犀 $NEW_VERSION 已安装到 $TARGET"
if [ -d "$LX_CONFIG_DIR" ]; then
  say "  沿用已有的配置和数据：$LX_CONFIG_DIR"
else
  say "  配置和数据会保存在：${LX_CONFIG_DIR}（以后卸载重装也会沿用）"
fi
state installed "$TARGET"

# --- 4. open -------------------------------------------------------------------------------------
# Another copy already answering on the bridge port - typically a build from src-tauri/target on a
# developer's machine - would make a second instance fail to bind and put two cats on screen. The
# user decides which one lives; the new install takes over once the other is quit.
if [ "$OPEN" = 1 ] && [ "$WAS_RUNNING" = 0 ] && lx_bridge_up; then
  RUNNING_AT="$(ps -axo command= | grep -o '/[^ ]*\.app/Contents/MacOS/lingxi' | sed -n 1p)"
  say "  已经有一个灵犀在运行${RUNNING_AT:+（${RUNNING_AT%/Contents/MacOS/lingxi}）}，没有再打开一个；退出它之后新装的这份会接管"
  OPEN=0
fi
if [ "$OPEN" = 1 ] || [ "$WAS_RUNNING" = 1 ]; then
  if [ "$WAS_RUNNING" = 1 ] && [ "$OPEN" = 0 ]; then lx_open_app "$TARGET" background; else lx_open_app "$TARGET" foreground; fi
  if lx_wait_bridge 20; then
    say "✓ 灵犀已经打开"
    if [ "$OPEN" = 1 ]; then
      # Show where Claude's connection is listed, so the first thing the user sees is that it
      # worked and what it is allowed to do. An older app without this control just ignores it.
      printf '{"openManagement":"agent:claude","agent":"%s"}' "$LX_AGENT_ID" | lx_post /control >/dev/null || true
    fi
    if [ -n "$REPLAY" ] && [ -f "$REPLAY" ]; then
      lx_post /task-event < "$REPLAY" >/dev/null || true
      rm -f "$REPLAY"
    fi
  else
    say "  灵犀装好了，但 20 秒内没有启动完成；手动打开「应用程序 → 灵犀」即可"
  fi
fi
