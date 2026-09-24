#!/usr/bin/env bash
# Build, sign, verify (and, with a Developer ID, notarise) 灵犀, and collect what gets published.
#
# WHY THIS EXISTS
#
# `npm run tauri build` on its own produces a bundle with NO _CodeSignature directory - only the
# linker's ad-hoc mark on the binary. It runs on the machine that built it because macOS never
# quarantined it there, which is exactly why the problem stays invisible during development. Send
# that .app or .dmg to anyone else and Gatekeeper calls it damaged:
#
#   "code has no resources but signature indicates they must be present"
#
# The previous version of this script fixed the .app and missed the .dmg: it re-signed the .app
# AFTER Tauri had already packed the unsigned one into the .dmg, so the file people actually
# download was still the broken one. Now Tauri does the signing itself, before it builds the .dmg,
# and this script checks the copy INSIDE the .dmg as well as the one beside it.
#
# USAGE
#
#   ./scripts/release.sh                  universal (Apple Silicon + Intel) build, best signing available
#   ./scripts/release.sh --arch native    this Mac's architecture only - much faster, for trying things
#   ./scripts/release.sh --skip-tests     for CI, where ci.yml already ran them on this commit
#   ./scripts/release.sh --skip-notarize  sign with a Developer ID but stop before Apple's servers
#   ./scripts/release.sh --allow-dirty    build uncommitted app changes (the result is never publishable)
#
# SIGNING - chosen automatically, strongest first
#
#   1. APPLE_SIGNING_IDENTITY is set         -> that identity (must be in the keychain)
#   2. a "Developer ID Application" identity -> that one
#      is in the keychain
#   3. neither                               -> ad-hoc ("-"): a complete, verifying signature with no
#                                               identity behind it. Runs anywhere once the user allows
#                                               it in System Settings; Gatekeeper will not vouch for it.
#
#   Only a Developer ID can be notarised, and only Apple issues one (Apple Developer Program,
#   USD 99/year). scripts/apple-signing.sh does every step of that which can be done locally - see
#   docs/RELEASING.md. Notarisation then needs ONE of:
#     APPLE_KEYCHAIN_PROFILE                          a `xcrun notarytool store-credentials` profile
#     APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID       APPLE_PASSWORD is an app-specific password
#
# OUTPUT: release/v<version>/
#
#   Lingxi-<version>-<arch>.dmg        what people download
#   Lingxi-<version>-<arch>.app.zip    the same app, for people who do not want a disk image
#   SHA256SUMS.txt
#   BUILD_INFO.json                    commit, signing, notarisation - read by publish-release.sh
#
# Asset names are ASCII on purpose: GitHub rewrites non-ASCII characters in release asset names,
# and "灵犀_0.1.0_universal.dmg" arrives as something nobody would recognise.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO/apps/lingxi"
TAURI_DIR="$APP_DIR/src-tauri"
ARCH_MODE="universal"
SKIP_TESTS=0
SKIP_NOTARIZE=0
ALLOW_DIRTY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --arch) shift; ARCH_MODE="${1:-}" ;;
    --arch=*) ARCH_MODE="${1#--arch=}" ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --skip-notarize) SKIP_NOTARIZE=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
case "$ARCH_MODE" in universal|native) ;; *) echo "--arch must be universal or native" >&2; exit 1 ;; esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. preflight ------------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || die "macOS only - this builds and signs an .app bundle."
command -v xcrun >/dev/null || die "Xcode command line tools are missing: xcode-select --install"
# rustup's shims first: a Homebrew cargo ahead of them silently ignores rust-toolchain.toml.
[ -d "$HOME/.cargo/bin" ] && PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || die "cargo not found - install Rust with rustup (https://rustup.rs)"

VERSION="$(cd "$REPO" && node scripts/version.mjs | awk '/^version /{print $2}')" \
  || die "the version fields disagree - run: node scripts/version.mjs <version>"
[ -n "$VERSION" ] || die "could not read the version"
COMMIT="$(git -C "$REPO" rev-parse HEAD)"

# Only what goes INTO the app counts. Working material elsewhere in the tree (Blender scripts,
# notes) does not change a byte of the bundle and should not block a release.
APP_PATHS=(apps packages integrations presets package.json package-lock.json)
DIRTY="$(git -C "$REPO" status --porcelain -- "${APP_PATHS[@]}")"
if [ -n "$DIRTY" ]; then
  [ "$ALLOW_DIRTY" = 1 ] || die "uncommitted changes in files that go into the app:
$DIRTY
Commit them first - a release has to be reproducible from its tag - or pass --allow-dirty to try
the pipeline (publish-release.sh will refuse that build)."
  echo "  building uncommitted changes (--allow-dirty): this build cannot be published"
fi

if [ "$ARCH_MODE" = "universal" ]; then
  for target in aarch64-apple-darwin x86_64-apple-darwin; do
    grep -qx "$target" <<<"$(rustup target list --installed 2>/dev/null)" \
      || die "Rust target $target is missing: rustup target add $target"
  done
  TARGET_ARGS=(--target universal-apple-darwin)
  BUNDLE_DIR="$TAURI_DIR/target/universal-apple-darwin/release/bundle"
  ARCH_NAME="universal"
else
  TARGET_ARGS=()
  BUNDLE_DIR="$TAURI_DIR/target/release/bundle"
  ARCH_NAME="$(uname -m)"
fi

# --- 1. the checks that should stop a release ---------------------------------------------------
if [ "$SKIP_TESTS" = 0 ]; then
  say "Tests"
  ( cd "$REPO" && npm test >/dev/null ) || die "unit tests failed - run npm test"
  ( cd "$APP_DIR" && npx tsc --noEmit ) || die "typecheck failed"
  ( cd "$TAURI_DIR" && cargo test --quiet >/dev/null ) || die "rust tests failed - run cargo test in $TAURI_DIR"
  ( cd "$REPO" && npm run check >/dev/null ) || die "project checks failed - run npm run check"
  echo "  all green"
fi

# --- 2. who signs it ----------------------------------------------------------------------------
say "Signing identity"
# A Developer ID imported by scripts/apple-signing.sh lives in a keychain of its own, which is
# locked again after every restart. Its password is in the login keychain.
RELEASE_KEYCHAIN="$HOME/Library/Keychains/lingxi-release.keychain-db"
if [ -f "$RELEASE_KEYCHAIN" ]; then
  security unlock-keychain -p "$(security find-generic-password -s lingxi-release -a keychain -w 2>/dev/null || true)" \
    "$RELEASE_KEYCHAIN" 2>/dev/null || echo "  warning: could not unlock $RELEASE_KEYCHAIN - ./scripts/apple-signing.sh status"
fi
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ] && [ "$APPLE_SIGNING_IDENTITY" != "-" ]; then
  IDENTITY="$APPLE_SIGNING_IDENTITY"
  grep -qF "\"$IDENTITY\"" <<<"$IDENTITIES" \
    || die "APPLE_SIGNING_IDENTITY is \"$IDENTITY\" but no valid identity by that name is in the keychain:
$IDENTITIES"
else
  IDENTITY="$(sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' <<<"$IDENTITIES" | sed -n 1p)"
  IDENTITY="${IDENTITY:--}"
fi
case "$IDENTITY" in
  -) SIGNING="adhoc"; echo "  ad-hoc - no Developer ID on this machine (see docs/RELEASING.md)" ;;
  "Developer ID Application:"*) SIGNING="developer-id"; echo "  $IDENTITY" ;;
  *) SIGNING="other"; echo "  $IDENTITY (not a Developer ID: signed, but not notarisable)" ;;
esac

# --- 3. build -----------------------------------------------------------------------------------
say "Build ($ARCH_NAME, $VERSION)"
rm -rf "$BUNDLE_DIR"
# APPLE_SIGNING_IDENTITY makes Tauri sign the .app - hardened runtime, entitlements.plist - BEFORE
# it packs the .dmg, which is the whole point. "-" is its spelling of ad-hoc.
#
# CI=true makes Tauri's .dmg step skip the AppleScript that arranges the Finder window. That script
# drives Finder, and on a Mac where the terminal has never been allowed to, macOS stops the build
# for an Automation prompt. The .dmg is the same - app plus an Applications link - just without a
# hand-placed icon layout.
#
# The notarisation variables are deliberately NOT passed through: step 5 notarises the .dmg itself
# and verifies the result, rather than trusting a build tool to have done it.
( cd "$APP_DIR" && env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_KEY -u APPLE_API_ISSUER \
    CI=true APPLE_SIGNING_IDENTITY="$IDENTITY" npm run tauri -- build ${TARGET_ARGS[@]+"${TARGET_ARGS[@]}"} ) \
  || die "tauri build failed"

APP="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
[ -n "$APP" ] || die "no .app was produced under $BUNDLE_DIR/macos"
DMG="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
[ -n "$DMG" ] || die "no .dmg was produced under $BUNDLE_DIR/dmg"
BIN="$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
echo "  app: $APP"
echo "  dmg: $DMG"

# --- 4. verify, beside and inside the .dmg ------------------------------------------------------
verify_app() {
  local app="$1" where="$2" bin
  bin="$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
  codesign --verify --deep --strict "$app" 2>/dev/null || die "$where: the signature does not verify
$(codesign --verify --deep --strict --verbose=4 "$app" 2>&1)"
  # The linker's ad-hoc mark verifies too; what it lacks is the sealed resources.
  [ -f "$app/Contents/_CodeSignature/CodeResources" ] || die "$where: no _CodeSignature - resources are unsealed"
  # Captured, then matched: `codesign | grep -q` under pipefail fails whenever grep exits on its
  # first match before codesign has finished writing - the check itself raced.
  local details entitlements
  details="$(codesign -dv --verbose=4 "$app" 2>&1)"
  entitlements="$(codesign -d --entitlements - "$app" 2>/dev/null || true)"
  case "$details" in *"flags="*runtime*) ;; *) die "$where: not signed with the hardened runtime" ;; esac
  case "$entitlements" in *com.apple.security.cs.allow-jit*) ;; *) die "$where: entitlements.plist was not applied - the webview will not start" ;; esac
  if [ "$ARCH_MODE" = universal ]; then
    local archs; archs="$(lipo -archs "$bin")"
    case "$archs" in *arm64*x86_64*|*x86_64*arm64*) ;; *) die "$where: expected a universal binary, got: $archs" ;; esac
  fi
  awk -F= '/^CDHash=/{print $2}' <<<"$details"
}

say "Verify the signature"
OUTER_CDHASH="$(verify_app "$APP" "the .app")"
MOUNT="$(mktemp -d)"
trap 'hdiutil detach "$MOUNT" -force -quiet 2>/dev/null; rmdir "$MOUNT" 2>/dev/null' EXIT
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" "$DMG" >/dev/null || die "could not mount $DMG"
INNER_APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' -print -quit)"
INNER_CDHASH=""
[ -n "$INNER_APP" ] && INNER_CDHASH="$(verify_app "$INNER_APP" "the .app inside the .dmg")"
hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force -quiet || true
rmdir "$MOUNT" 2>/dev/null || true
trap - EXIT
[ -n "$INNER_APP" ] || die "the .dmg does not contain an .app"
[ "$OUTER_CDHASH" = "$INNER_CDHASH" ] || die "the .app in the .dmg is not the one that was signed ($INNER_CDHASH vs $OUTER_CDHASH)"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E '^(Authority|TeamIdentifier|Signature|CodeDirectory)' | sed 's/^/  /'
echo "  architectures: $(lipo -archs "$BIN")"
echo "  the .dmg carries the same signed app (cdhash $OUTER_CDHASH)"

# --- 5. notarise --------------------------------------------------------------------------------
# Notarisation is Apple scanning the build and recording its hash. Without it a downloaded app is
# refused no matter how correctly it is signed - the signature says who made it, notarisation says
# Apple has seen it. Stapling then attaches the ticket so the check also passes offline.
NOTARIZED=false
if [ "$SIGNING" = developer-id ] && [ "$SKIP_NOTARIZE" = 0 ]; then
  if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
    NOTARY=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    NOTARY=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
  else
    die "a Developer ID build needs notarisation credentials: APPLE_KEYCHAIN_PROFILE, or
APPLE_ID + APPLE_PASSWORD (app-specific) + APPLE_TEAM_ID. Or pass --skip-notarize."
  fi
  say "Notarise"
  xcrun notarytool submit "$DMG" "${NOTARY[@]}" --wait || die "notarisation failed - 'xcrun notarytool log <id>' says why"
  say "Staple"
  xcrun stapler staple "$DMG" || die "stapling the .dmg failed"
  xcrun stapler staple "$APP" || die "stapling the .app failed"
  say "Gatekeeper"
  spctl -a -vvv -t install "$APP" 2>&1 | sed 's/^/  /'
  spctl -a -t install "$APP" 2>/dev/null || die "Gatekeeper rejected the notarised app"
  NOTARIZED=true
fi

# --- 6. collect ---------------------------------------------------------------------------------
say "Collect"
OUT="$REPO/release/v$VERSION"
rm -rf "$OUT"
mkdir -p "$OUT"
BASE="Lingxi-$VERSION-$ARCH_NAME"
cp "$DMG" "$OUT/$BASE.dmg"
# ditto, not zip: zip does not preserve the bundle's symlinks and extended attributes, and a
# re-zipped bundle whose seal no longer matches is exactly the "damaged" error again.
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/$BASE.app.zip"
( cd "$OUT" && shasum -a 256 "$BASE.dmg" "$BASE.app.zip" > SHA256SUMS.txt )

DIRTY_FLAG=false; [ -n "$DIRTY" ] && DIRTY_FLAG=true
TAURI_VERSION="$(cd "$APP_DIR" && node -p "require('@tauri-apps/cli/package.json').version" 2>/dev/null || echo unknown)"
node -e '
const [out, version, commit, dirty, signing, identity, notarized, arch, tauri, rustc, cdhash, minimum] = process.argv.slice(1);
require("fs").writeFileSync(out, JSON.stringify({
  version, commit, dirty: dirty === "true", arch,
  signing, identity: signing === "adhoc" ? null : identity, notarized: notarized === "true",
  cdhash, minimumSystemVersion: minimum, builtAt: new Date().toISOString(), tauri, rustc,
}, null, 2) + "\n");
' "$OUT/BUILD_INFO.json" "$VERSION" "$COMMIT" "$DIRTY_FLAG" "$SIGNING" "$IDENTITY" "$NOTARIZED" "$ARCH_NAME" \
  "$TAURI_VERSION" "$(rustc --version)" "$OUTER_CDHASH" \
  "$(node -p "require('$TAURI_DIR/tauri.conf.json').bundle.macOS.minimumSystemVersion")"

ls -lh "$OUT" | sed '1d; s/^/  /'
say "Done - v$VERSION ($ARCH_NAME, $SIGNING$([ "$NOTARIZED" = true ] && echo ', notarised'))"
if [ "$SIGNING" != developer-id ]; then
  cat <<EOF
  Signed and verifying, but not notarised: on another Mac the first launch is blocked until the
  user allows it (System Settings -> Privacy & Security -> Open Anyway). The release notes that
  publish-release.sh writes say exactly that. A Developer ID removes it - see docs/RELEASING.md.
EOF
fi
echo "  next: ./scripts/publish-release.sh"
