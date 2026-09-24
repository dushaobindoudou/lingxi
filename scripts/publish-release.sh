#!/usr/bin/env bash
# Publish what scripts/release.sh collected in release/v<version>/ as a GitHub release.
#
#   ./scripts/publish-release.sh               tag HEAD, push branch + tag, create the release, upload
#   ./scripts/publish-release.sh --draft       the same, as a draft nobody else sees until you publish it
#   ./scripts/publish-release.sh --prerelease  marked as a pre-release
#   ./scripts/publish-release.sh --no-push     CI: the tag was pushed already, just make the release
#
# It refuses, rather than publishes something that does not match its tag:
#   - a build made with --allow-dirty
#   - a build whose app sources have changed since (commits that only touch docs or tooling are
#     fine - the bundle would be byte-identical, so HEAD gets the tag)
#   - an existing tag that points somewhere other than HEAD
#
# The tag it creates carries a `Release-Build: local` trailer. .github/workflows/release.yml builds
# every pushed v* tag EXCEPT those, so publishing a local build does not also start a 20-minute
# macOS job that would overwrite these files with its own.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
DRAFT=(); PRERELEASE=(); PUSH=1
while [ $# -gt 0 ]; do
  case "$1" in
    --draft) DRAFT=(--draft) ;;
    --prerelease) PRERELEASE=(--prerelease) ;;
    --no-push) PUSH=0 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || die "the GitHub CLI is missing: brew install gh"
gh auth status >/dev/null 2>&1 || die "gh is not logged in: gh auth login"

VERSION="$(node scripts/version.mjs | awk '/^version /{print $2}')" || die "the version fields disagree"
TAG="v$VERSION"
OUT="release/$TAG"
[ -f "$OUT/BUILD_INFO.json" ] || die "nothing built for $TAG - run ./scripts/release.sh first"

info() { node -p "require('./$OUT/BUILD_INFO.json').$1"; }
BUILD_COMMIT="$(info commit)"
SIGNING="$(info signing)"
NOTARIZED="$(info notarized)"
ARCH="$(info arch)"
[ "$(info dirty)" = false ] || die "$OUT was built from uncommitted changes (--allow-dirty) - rebuild from a commit"

APP_PATHS=(apps packages integrations presets package.json package-lock.json)
[ -z "$(git status --porcelain -- "${APP_PATHS[@]}")" ] || die "uncommitted changes in app sources - commit them and rebuild"
git cat-file -e "$BUILD_COMMIT^{commit}" 2>/dev/null || die "the build's commit $BUILD_COMMIT is not in this repository"
git diff --quiet "$BUILD_COMMIT" HEAD -- "${APP_PATHS[@]}" \
  || die "app sources changed since this build ($BUILD_COMMIT) - rebuild: ./scripts/release.sh"

ASSETS=("$OUT"/Lingxi-*.dmg "$OUT"/Lingxi-*.app.zip "$OUT/SHA256SUMS.txt")
for asset in "${ASSETS[@]}"; do [ -f "$asset" ] || die "missing $asset"; done
( cd "$OUT" && shasum -a 256 -c SHA256SUMS.txt >/dev/null ) || die "SHA256SUMS.txt does not match the files in $OUT"

# --- tag ------------------------------------------------------------------------------------------
say "Tag $TAG"
HEAD="$(git rev-parse HEAD)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  [ "$(git rev-list -n 1 "$TAG")" = "$HEAD" ] || die "$TAG already exists at $(git rev-list -n 1 "$TAG"), not at HEAD ($HEAD).
Bump the version (node scripts/version.mjs <next>) rather than moving a published tag."
  echo "  $TAG already at HEAD"
else
  [ "$PUSH" = 1 ] || die "$TAG does not exist and --no-push was given"
  git tag -a "$TAG" -m "灵犀 $TAG" -m "Built by scripts/release.sh ($ARCH, $SIGNING) and uploaded by scripts/publish-release.sh.

Release-Build: local"
  echo "  created $TAG at $HEAD"
fi

if [ "$PUSH" = 1 ]; then
  say "Push"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [ "$BRANCH" != HEAD ] || die "detached HEAD - check out the branch the release belongs to"
  git push origin "$BRANCH" || die "pushing $BRANCH failed - pull, rebuild if app sources changed, retry"
  git push origin "refs/tags/$TAG" || die "pushing $TAG failed - does the remote already have a different $TAG?"
fi

# --- notes ----------------------------------------------------------------------------------------
say "Release notes"
NOTES="$OUT/RELEASE_NOTES.md"
PREVIOUS="$(git describe --tags --abbrev=0 --match 'v*' "$TAG^" 2>/dev/null || true)"
{
  echo "## 灵犀 $TAG"
  echo
  case "$ARCH" in
    universal) echo "适用于 macOS $(info minimumSystemVersion) 及以上，Apple 芯片和 Intel 都能用（通用二进制）。" ;;
    arm64) echo "适用于 macOS $(info minimumSystemVersion) 及以上，**仅 Apple 芯片**。" ;;
    *) echo "适用于 macOS $(info minimumSystemVersion) 及以上，**仅 Intel**。" ;;
  esac
  echo
  echo "### 安装"
  echo
  echo "下载 \`$(basename "$OUT"/Lingxi-*.dmg)\`，打开后把「灵犀」拖进「应用程序」。"
  echo
  if [ "$NOTARIZED" = true ]; then
    echo "这个版本已由 Apple 公证，双击即可打开。"
  else
    cat <<'EOF'
**这个版本没有经过 Apple 公证**（还没有 Developer ID 证书），第一次打开会被 macOS 拦下，提示无法验证开发者。放行一次即可，之后正常打开：

1. 双击「灵犀」，在弹窗里点「完成」（不要点「移到废纸篓」）；
2. 打开「系统设置 → 隐私与安全性」，拉到底部，在「已阻止使用"灵犀"」旁边点「仍要打开」，输入密码确认。

或者在终端里执行一行（效果相同）：

```bash
xattr -dr com.apple.quarantine /Applications/灵犀.app
```

应用本身有完整的代码签名（ad-hoc，开启 hardened runtime），可以用 `codesign --verify --deep --strict /Applications/灵犀.app` 自行校验。
EOF
  fi
  echo
  echo "### 校验"
  echo
  echo '```'
  cat "$OUT/SHA256SUMS.txt"
  echo '```'
  echo
  if [ -n "$PREVIOUS" ]; then
    echo "### 自 $PREVIOUS 以来的改动"
    echo
    git log --no-merges --format='- %s (%h)' "$PREVIOUS..$TAG"
  else
    echo "### 首个发布"
    echo
    echo "最近的改动："
    echo
    git log --no-merges --format='- %s (%h)' -n 15 "$TAG"
  fi
  echo
  echo "<sub>构建：commit \`$(git rev-parse --short "$BUILD_COMMIT")\` · $(info rustc) · Tauri $(info tauri) · 签名：$SIGNING$([ "$NOTARIZED" = true ] && echo '，已公证')</sub>"
} > "$NOTES"
sed -n '1,12s/^/  /p' "$NOTES"
echo "  …"

# --- release --------------------------------------------------------------------------------------
say "GitHub release"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
  gh release edit "$TAG" --notes-file "$NOTES" >/dev/null
  echo "  updated the existing release"
else
  gh release create "$TAG" "${ASSETS[@]}" --verify-tag --title "灵犀 $TAG" --notes-file "$NOTES" \
    "${DRAFT[@]+"${DRAFT[@]}"}" "${PRERELEASE[@]+"${PRERELEASE[@]}"}"
fi
URL="$(gh release view "$TAG" --json url -q .url)"
say "Done"
echo "  $URL"
if [ "$(gh repo view --json isPrivate -q .isPrivate)" = true ]; then
  echo "  The repository is private, so only its collaborators can download this."
fi
