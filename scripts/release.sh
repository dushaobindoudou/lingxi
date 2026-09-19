#!/usr/bin/env bash
# Build, sign, notarise and staple 灵犀 for distribution.
#
# WHY THIS EXISTS, and what was actually wrong before it:
#
# `npm run tauri build` on its own produces a bundle with NO _CodeSignature directory at all -
# only the linker's ad-hoc mark on the binary. It runs fine on the machine that built it because
# macOS never quarantined it, which is exactly why the problem stays invisible during development.
# Send that .app or .dmg to anyone else and Gatekeeper refuses it outright:
#
#   "code has no resources but signature indicates they must be present"
#
# It also explains a symptom that cost real time earlier: macOS keys TCC permission grants on the
# code signature, and an ad-hoc signature changes on every build, so a permission granted before a
# rebuild is gone after it. A stable Developer ID signature fixes that class of problem too.
#
# This script runs the whole chain and VERIFIES each step, because every one of them can fail
# silently and leave you with a bundle that looks finished:
#
#   build -> sign (hardened runtime + entitlements) -> verify -> notarise -> staple -> verify again
#
# USAGE
#
#   ./scripts/release.sh                 # full release; needs the credentials below
#   ./scripts/release.sh --local         # build + ad-hoc sign properly; no Apple account needed
#   ./scripts/release.sh --skip-notarize # sign for real but stop before Apple's servers
#
# CREDENTIALS (a full release only)
#
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Your Name (TEAMID)"
#                            Comes from an Apple Developer Program membership (USD 99/year).
#                            `security find-identity -v -p codesigning` lists what you have.
#   APPLE_ID                 the Apple ID that owns the membership
#   APPLE_PASSWORD           an app-specific password from appleid.apple.com - NOT the real one
#   APPLE_TEAM_ID            the (TEAMID) from the identity string
#
# Or, for CI, store a notarytool keychain profile instead and set:
#   APPLE_KEYCHAIN_PROFILE   the profile name passed to `xcrun notarytool --keychain-profile`
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO/apps/lingxi"
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"
MODE="release"

for arg in "$@"; do
  case "$arg" in
    --local) MODE="local" ;;
    --skip-notarize) MODE="signed-only" ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. preflight ------------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || die "macOS only - this signs and notarises an .app bundle."
command -v xcrun >/dev/null || die "Xcode command line tools are missing: xcode-select --install"

if [ "$MODE" != "local" ]; then
  [ -n "${APPLE_SIGNING_IDENTITY:-}" ] || die "APPLE_SIGNING_IDENTITY is not set.
Run with --local for an unsigned local build, or see the header of this script.
Identities available on this machine:
$(security find-identity -v -p codesigning 2>/dev/null || echo '  (none)')"
  security find-identity -v -p codesigning 2>/dev/null | grep -qF "$APPLE_SIGNING_IDENTITY" \
    || die "APPLE_SIGNING_IDENTITY is set to \"$APPLE_SIGNING_IDENTITY\" but no such identity is in the keychain."
fi

# --- 1. the checks that should stop a release ---------------------------------------------------
say "Tests"
( cd "$REPO" && npm test >/dev/null ) || die "unit tests failed"
( cd "$APP_DIR" && npx tsc --noEmit ) || die "typecheck failed"
( cd "$APP_DIR/src-tauri" && cargo test --quiet >/dev/null ) || die "rust tests failed"
( cd "$REPO" && npm run check >/dev/null ) || die "project checks failed"
echo "  all green"

# --- 2. build -----------------------------------------------------------------------------------
say "Build"
rm -rf "$BUNDLE_DIR"
if [ "$MODE" = "local" ]; then
  ( cd "$APP_DIR" && npm run tauri build )
else
  # Tauri reads these: the identity overrides tauri.conf.json's null, and setting the notarisation
  # variables makes it notarise the .dmg itself. We still verify afterwards rather than trusting it.
  ( cd "$APP_DIR" && APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" npm run tauri build )
fi

APP="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$APP" ] || die "no .app was produced under $BUNDLE_DIR/macos"
DMG="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' -print -quit || true)"
echo "  app: $APP"
[ -n "$DMG" ] && echo "  dmg: $DMG"

# --- 3. sign ------------------------------------------------------------------------------------
say "Sign"
ENTITLEMENTS="$APP_DIR/src-tauri/entitlements.plist"
[ -f "$ENTITLEMENTS" ] || die "entitlements.plist is missing - the hardened runtime needs it"

if [ "$MODE" = "local" ]; then
  # An ad-hoc signature, but a PROPER one: this writes the _CodeSignature directory that a bare
  # `tauri build` leaves out, so `codesign --verify` passes and TCC has something stable-ish to
  # key on within this build. It is still not distributable - that needs a Developer ID.
  codesign --force --deep --sign - --options runtime --entitlements "$ENTITLEMENTS" "$APP"
else
  # --deep is deliberately NOT used for a real signature: it signs nested code with the same
  # options regardless of what that code needs, and Apple has advised against it for years.
  # Sign inner binaries first, then the bundle, which is the order that actually validates.
  while IFS= read -r inner; do
    codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" \
      --sign "$APPLE_SIGNING_IDENTITY" "$inner"
  done < <(find "$APP/Contents" -type f -perm -u+x -not -path "*/MacOS/*" 2>/dev/null || true)
  codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" \
    --sign "$APPLE_SIGNING_IDENTITY" "$APP"
fi

say "Verify the signature"
codesign --verify --strict --verbose=2 "$APP" || die "the signature does not verify"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E 'Authority|TeamIdentifier|Signature|flags' | sed 's/^/  /'

if [ "$MODE" = "local" ]; then
  say "Done (local)"
  cat <<EOF
  $APP is signed ad-hoc and verifies, which is enough for this machine.
  It is NOT distributable: another Mac will quarantine it and Gatekeeper will refuse it.
  Run without --local, with a Developer ID, to produce something you can send to someone.
EOF
  exit 0
fi

if [ "$MODE" = "signed-only" ]; then
  say "Done (signed, not notarised)"
  echo "  Gatekeeper will still refuse this on a machine that did not build it."
  echo "  Notarisation is what removes that. Re-run without --skip-notarize."
  exit 0
fi

# --- 4. notarise --------------------------------------------------------------------------------
# Notarisation is Apple scanning the build and recording its hash. Without it, a downloaded app is
# refused no matter how correctly it is signed - the signature says who made it, notarisation says
# Apple has seen it.
say "Notarise"
SUBMIT="${DMG:-$APP}"
if [ -z "$DMG" ]; then
  SUBMIT="$BUNDLE_DIR/lingxi-notarize.zip"
  ditto -c -k --keepParent "$APP" "$SUBMIT"   # ditto, not zip: zip mangles bundle symlinks
fi

if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
  xcrun notarytool submit "$SUBMIT" --keychain-profile "$APPLE_KEYCHAIN_PROFILE" --wait \
    || die "notarisation failed - 'xcrun notarytool log <id>' says why"
else
  [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] \
    || die "set APPLE_ID, APPLE_PASSWORD (app-specific) and APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE"
  xcrun notarytool submit "$SUBMIT" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait \
    || die "notarisation failed - 'xcrun notarytool log <id>' says why"
fi

# --- 5. staple ----------------------------------------------------------------------------------
# Stapling attaches the notarisation ticket to the bundle so it validates OFFLINE. Skip it and a
# first launch without network access is refused.
say "Staple"
xcrun stapler staple "$APP" || die "stapling the .app failed"
[ -n "$DMG" ] && { xcrun stapler staple "$DMG" || die "stapling the .dmg failed"; }

# --- 6. the check that actually matters ---------------------------------------------------------
say "Gatekeeper"
spctl -a -vvv -t install "$APP" 2>&1 | sed 's/^/  /' || die "Gatekeeper rejected the app"
echo
echo "  This is the assessment a user's Mac performs on first launch. If it says 'accepted'"
echo "  and 'source=Notarized Developer ID', the build is genuinely distributable."

say "Done"
echo "  app: $APP"
[ -n "$DMG" ] && echo "  dmg: $DMG"
