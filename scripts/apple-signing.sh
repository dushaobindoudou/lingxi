#!/usr/bin/env bash
# Everything about a Developer ID certificate that can be done on this Mac.
#
# The certificate that lets a downloaded 灵犀 open without a Gatekeeper warning is a "Developer ID
# Application" certificate, and only Apple issues it - to a member of the Apple Developer Program
# (USD 99/year). No tool can generate one locally, and a self-signed certificate does not help:
# codesign refuses an untrusted identity, and Gatekeeper treats a trusted-on-this-Mac self-signed
# app exactly like an ad-hoc one everywhere else. What CAN be done here is every step around
# Apple's part:
#
#   ./scripts/apple-signing.sh csr                1. private key + certificate signing request
#       -> upload the .csr at developer.apple.com -> Certificates -> + -> Developer ID Application
#       -> download developer_id.cer
#   ./scripts/apple-signing.sh import <file.cer>  2. Apple's certificate + the key -> a signing
#                                                    identity in a keychain of its own
#   ./scripts/apple-signing.sh notary             3. store notarisation credentials (asks for them)
#   ./scripts/apple-signing.sh github             4. hand the identity to the release workflow as
#                                                    repository secrets
#   ./scripts/apple-signing.sh status             what is set up so far
#
# After step 2, ./scripts/release.sh finds the identity on its own and signs with it; after step 3
# it notarises too. Nothing in the build has to change.
#
# Where things live:
#   ~/.lingxi-release/apple/        key, CSR, certificate, .p12 - mode 0700, never in the repo
#   ~/Library/Keychains/lingxi-release.keychain-db
#                                   the identity. A keychain of its own because codesign may only
#                                   use a key without a GUI prompt once its partition list is set,
#                                   and that needs the keychain's password - which for the login
#                                   keychain is your account password.
#   login keychain, service "lingxi-release"
#                                   that keychain's password and the .p12's, generated here
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$HOME/.lingxi-release/apple"
KEY="$DIR/developer-id.key"
CSR="$DIR/developer-id.csr"
CER="$DIR/developer-id.cer"
P12="$DIR/developer-id.p12"
KEYCHAIN="$HOME/Library/Keychains/lingxi-release.keychain-db"
SERVICE="lingxi-release"
NOTARY_PROFILE="lingxi-notary"
# LibreSSL, not whatever openssl is first on PATH: an OpenSSL 3 .p12 uses PBES2/AES by default,
# which older macOS `security import` rejects with an unhelpful "MAC verification failed".
OPENSSL=/usr/bin/openssl
INTERMEDIATE_URL="https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }
secret() { security find-generic-password -s "$SERVICE" -a "$1" -w 2>/dev/null; }
remember() { security add-generic-password -U -s "$SERVICE" -a "$1" -w "$2" >/dev/null; }

[ "$(uname -s)" = Darwin ] || die "macOS only"
mkdir -p "$DIR"; chmod 700 "$HOME/.lingxi-release" "$DIR"

cmd="${1:-status}"; shift || true
case "$cmd" in
  csr)
    [ ! -f "$KEY" ] || [ "${1:-}" = --force ] || die "$KEY already exists. Its CSR is $CSR.
A new key invalidates any certificate Apple issued for the old one - pass --force if that is intended."
    EMAIL="${LINGXI_CSR_EMAIL:-$(git -C "$REPO" config user.email || true)}"
    NAME="${LINGXI_CSR_NAME:-$(git -C "$REPO" config user.name || echo lingxi)}"
    say "Key and certificate signing request"
    ( umask 077; "$OPENSSL" genrsa -out "$KEY" 2048 2>/dev/null )
    "$OPENSSL" req -new -key "$KEY" -out "$CSR" -subj "/emailAddress=${EMAIL}/CN=${NAME}/C=CN"
    chmod 600 "$KEY"
    "$OPENSSL" req -in "$CSR" -noout -verify 2>&1 | sed 's/^/  /'
    echo "  key: $KEY (keep it; the certificate is useless without it)"
    echo "  csr: $CSR"
    cat <<EOF

  Next, with an Apple Developer Program membership (Account Holder role):
    1. https://developer.apple.com/account/resources/certificates/add
    2. choose "Developer ID Application", then the G2 Sub-CA
    3. upload $CSR
    4. download the certificate, then:  ./scripts/apple-signing.sh import ~/Downloads/developerID_application.cer
EOF
    ;;

  import)
    SRC="${1:-}"; [ -f "$SRC" ] || die "usage: $0 import <developerID_application.cer>"
    [ -f "$KEY" ] || die "no private key at $KEY - the certificate must be for a CSR made by '$0 csr'"
    say "Certificate"
    # Apple hands out DER; accept PEM too.
    "$OPENSSL" x509 -inform der -in "$SRC" -out "$CER" 2>/dev/null || "$OPENSSL" x509 -in "$SRC" -out "$CER" \
      || die "$SRC is not a certificate"
    [ "$("$OPENSSL" x509 -in "$CER" -noout -modulus)" = "$("$OPENSSL" rsa -in "$KEY" -noout -modulus 2>/dev/null)" ] \
      || die "this certificate was not issued for $KEY - was the CSR made on another machine?"
    SUBJECT="$("$OPENSSL" x509 -in "$CER" -noout -subject)"
    echo "  $SUBJECT"
    case "$SUBJECT" in *"Developer ID Application"*) ;; *) echo "  warning: not a Developer ID Application certificate - it will sign, but cannot be notarised" ;; esac

    # The intermediate goes into the .p12 too, so codesign can build the chain on any Mac - a fresh
    # CI runner has no Developer ID CA installed.
    INTERMEDIATE="$DIR/DeveloperIDG2CA.pem"
    curl -fsSL "$INTERMEDIATE_URL" -o "$DIR/DeveloperIDG2CA.cer" || die "could not download Apple's intermediate from $INTERMEDIATE_URL"
    "$OPENSSL" x509 -inform der -in "$DIR/DeveloperIDG2CA.cer" -out "$INTERMEDIATE"

    say "Keychain"
    P12_PASSWORD="$(secret p12 || true)"; [ -n "$P12_PASSWORD" ] || { P12_PASSWORD="$("$OPENSSL" rand -hex 24)"; remember p12 "$P12_PASSWORD"; }
    KC_PASSWORD="$(secret keychain || true)"; [ -n "$KC_PASSWORD" ] || { KC_PASSWORD="$("$OPENSSL" rand -hex 24)"; remember keychain "$KC_PASSWORD"; }
    ( umask 077; "$OPENSSL" pkcs12 -export -inkey "$KEY" -in "$CER" -certfile "$INTERMEDIATE" \
        -name "$(sed -n 's/.*CN *= *\([^,/]*\).*/\1/p' <<<"$SUBJECT")" -out "$P12" -passout "pass:$P12_PASSWORD" )
    [ -f "$KEYCHAIN" ] || security create-keychain -p "$KC_PASSWORD" "$KEYCHAIN"
    security unlock-keychain -p "$KC_PASSWORD" "$KEYCHAIN"
    security set-keychain-settings "$KEYCHAIN"   # no auto-lock timeout; release.sh unlocks after a reboot
    security import "$P12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASSWORD" "$KEYCHAIN" >/dev/null
    # On the search list, so codesign and Tauri find it like any other identity.
    CURRENT="$(security list-keychains -d user | tr -d '"' | xargs)"
    case " $CURRENT " in *" $KEYCHAIN "*) ;; *) security list-keychains -d user -s $CURRENT "$KEYCHAIN" ;; esac
    security find-identity -v -p codesigning "$KEYCHAIN" | sed 's/^/  /'
    echo
    echo "  ./scripts/release.sh will now sign with it. For notarisation: $0 notary"
    ;;

  notary)
    command -v xcrun >/dev/null || die "Xcode command line tools are missing"
    cat <<EOF
  Notarisation needs your Apple ID, your Team ID (the 10 characters in parentheses in the
  certificate's name) and an APP-SPECIFIC password from https://account.apple.com -> Sign-In and
  Security -> App-Specific Passwords. notarytool stores them in your keychain as "$NOTARY_PROFILE".
EOF
    xcrun notarytool store-credentials "$NOTARY_PROFILE"
    echo
    echo "  Then release with:  APPLE_KEYCHAIN_PROFILE=$NOTARY_PROFILE ./scripts/release.sh"
    ;;

  github)
    command -v gh >/dev/null || die "the GitHub CLI is missing"
    [ -f "$P12" ] || die "no signing identity yet - run: $0 import <file.cer>"
    IDENTITY="$(security find-identity -v -p codesigning "$KEYCHAIN" | sed -n 's/.*"\(.*\)".*/\1/p' | sed -n 1p)"
    [ -n "$IDENTITY" ] || die "the keychain holds no valid identity - is the Developer ID CA chain complete?"
    say "Repository secrets for .github/workflows/release.yml"
    base64 -i "$P12" | gh secret set APPLE_CERTIFICATE
    secret p12 | gh secret set APPLE_CERTIFICATE_PASSWORD
    printf '%s' "$IDENTITY" | gh secret set APPLE_SIGNING_IDENTITY
    # Notarisation credentials cannot be read back out of a notarytool profile, so they come from
    # the environment if you want CI to notarise too.
    if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
      printf '%s' "$APPLE_ID" | gh secret set APPLE_ID
      printf '%s' "$APPLE_PASSWORD" | gh secret set APPLE_PASSWORD
      printf '%s' "$APPLE_TEAM_ID" | gh secret set APPLE_TEAM_ID
      echo "  signing + notarisation secrets set"
    else
      echo "  signing secrets set. For CI notarisation, re-run with APPLE_ID, APPLE_PASSWORD (app-specific)"
      echo "  and APPLE_TEAM_ID in the environment - without them a Developer ID release job stops before"
      echo "  notarising rather than shipping something Gatekeeper will refuse."
    fi
    gh secret list | sed 's/^/  /'
    ;;

  status)
    say "Developer ID signing"
    [ -f "$KEY" ] && echo "  key:         $KEY" || echo "  key:         none   ($0 csr)"
    [ -f "$CSR" ] && echo "  csr:         $CSR"
    [ -f "$CER" ] && echo "  certificate: $("$OPENSSL" x509 -in "$CER" -noout -subject -enddate | xargs)" \
      || echo "  certificate: none   (upload the CSR to Apple, then: $0 import <file.cer>)"
    if [ -f "$KEYCHAIN" ]; then
      security unlock-keychain -p "$(secret keychain)" "$KEYCHAIN" 2>/dev/null || true
      echo "  identity:    $(security find-identity -v -p codesigning "$KEYCHAIN" | sed -n 's/.*"\(.*\)".*/\1/p' | sed -n 1p)"
    fi
    xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
      && echo "  notary:      profile \"$NOTARY_PROFILE\" works" || echo "  notary:      not set up   ($0 notary)"
    echo "  on this Mac, release.sh would sign with: $(security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | sed -n 1p | grep . || echo 'ad-hoc (-)')"
    ;;

  *) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
