<!-- English translation of `docs/RELEASING.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Packaging and releasing

Releasing Lingxi is three commands, and local and GitHub Actions run the **same scripts**:

```sh
node scripts/version.mjs 0.2.0     # 1. bump the version (all seven places at once), commit
./scripts/release.sh               # 2. test → universal-binary build → sign → verify (→ notarize) → collect artifacts
./scripts/publish-release.sh       # 3. tag, push, write release notes, upload to GitHub Releases
```

Or push only a tag and let CI do 2 and 3:

```sh
node scripts/version.mjs 0.2.0 && git commit -am "chore: release 0.2.0"
git tag v0.2.0 && git push origin main v0.2.0     # .github/workflows/release.yml takes over
```

---

## 1. Version number

The version lives in seven places: `tauri.conf.json` (which decides the version shown in "About"), the two `package.json`, the two `package-lock.json`, `Cargo.toml`, and `Cargo.lock`.

- `node scripts/version.mjs` — lists all seven; exits non-zero if they disagree;
- `node scripts/version.mjs 0.2.0` — changes them all at once;
- `npm run check` also checks that they agree, and CI runs it on every push.

The version of `packages/mcp-server` is **managed separately**: it talks to whichever app instance is running, and its protocol does not change just because the app ships a new version.

## 2. Packaging: `scripts/release.sh`

| Usage | What it does |
|---|---|
| `./scripts/release.sh` | universal binary (Apple Silicon + Intel), full tests, the strongest signing available |
| `--arch native` | build only the local architecture; much faster, for trying the flow |
| `--skip-tests` | for CI: `ci.yml` has already run on this commit |
| `--skip-notarize` | with a Developer ID, sign only and skip notarization |
| `--allow-dirty` | allows packaging uncommitted changes; `publish-release.sh` **refuses** such artifacts |

In order:

1. **Preflight**: versions agree; `apps/ packages/ integrations/ presets/` and the root `package*.json` have no uncommitted changes (other directories — Blender scripts, notes — are not packaged and do not block a release); the two Rust targets the universal build needs are installed (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).
2. **Tests**: `npm test`, `tsc`, `cargo test`, `npm run check`; any red stops the run.
3. **Choose the signing identity** (see section 4).
4. **Build**: `tauri build --target universal-apple-darwin`. Signing is done by Tauri **before the .dmg is built**, with hardened runtime and `entitlements.plist`.
5. **Verify**, both the .app itself and the copy **inside the .dmg**: the signature verifies, `_CodeSignature` is present (the ad-hoc marker the linker adds also verifies; this is exactly what was missing), hardened runtime, entitlements are actually written, it really is a universal binary, and the cdhash of the copy inside the .dmg matches the one outside.
6. **Notarize** (Developer ID only): submit the .dmg, wait, staple, Gatekeeper evaluation.
7. **Collect** into `release/v<version>/` (gitignored):

   | File | |
   |---|---|
   | `Lingxi-<version>-universal.dmg` | this is what users download |
   | `Lingxi-<version>-universal.app.zip` | the same .app, zipped with `ditto` (`zip` breaks in-package symlinks, which manufactures your own "damaged" error) |
   | `SHA256SUMS.txt` | |
   | `BUILD_INFO.json` | commit, signing method, whether notarized, cdhash, toolchain versions; the publish script reads it |

   File names are ASCII: GitHub rewrites non-ASCII characters in release attachment names, so `灵犀_0.1.0_universal.dmg` would no longer be recognizable once uploaded. The app itself is still named "灵犀.app".

**Why this script**: a package from a bare `npm run tauri build` has **no `_CodeSignature`** — only the ad-hoc marker the linker stamps on the binary. It runs on the machine that built it (not quarantined), but on other people's Macs it is "damaged and cannot be opened". The old script fixed the .app but signed it only **after** Tauri had already packed the unsigned copy into the .dmg — the .dmg users actually download was still broken. Now Tauri signs before building the .dmg, and the script verifies inside the .dmg afterwards.

The build sets `CI=true`: it makes Tauri skip the AppleScript that arranges Finder windows when building the .dmg. That script controls Finder, and on a Mac where the terminal has never been authorized macOS pops an "automation" authorization dialog that wedges the build. The .dmg contents are identical (app + an "Applications" shortcut), only the icon positions are not hand-arranged.

## 3. Publishing: `scripts/publish-release.sh`

| Usage | |
|---|---|
| `./scripts/publish-release.sh` | tag `v<version>` at HEAD, push branch and tag, create the release, upload attachments |
| `--draft` | create a draft; confirm in the browser before publishing |
| `--prerelease` | mark as a prerelease |
| `--no-push` | for CI: the tag is already pushed |

It refuses: packages built with `--allow-dirty`; packages where **app source changed again** after packaging (commits that only change docs or scripts are fine — the package bytes do not change, and the tag sits directly on HEAD); an existing tag with the same name that does not point at HEAD (published tags are never moved; bump the version instead).

The release notes are generated: supported system and architecture, install steps (**unblocking steps appended when not notarized**), checksums, and the commits since the last tag. An existing release is updated with new attachments and notes rather than erroring.

The tag it creates carries a `Release-Build: local` trailer. CI skips building when it sees this line — otherwise the moment the tag is pushed CI would also start a 20-minute macOS build and overwrite your upload with its own artifacts.

## 4. Signing and certificates

### Three tiers, the script picks the strongest automatically

| Tier | Condition | First open on the user's Mac after download |
|---|---|---|
| **ad-hoc** | default: no Developer ID on this machine | blocked once: "System Settings → Privacy & Security → Open Anyway", then normal |
| **Developer ID, not notarized** | certificate present, `--skip-notarize` or no notarization credentials configured | same as above — the signature says who made it, but Apple has not looked |
| **Developer ID + notarized** | certificate and notarization credentials configured | opens directly, no prompt at all |

Selection order: `APPLE_SIGNING_IDENTITY` env var → the first `Developer ID Application` in the keychain → ad-hoc (`-`). **The build itself needs no certificate** — compiling, packaging, and ad-hoc signing all happen on this machine.

ad-hoc is not "unsigned": the package is fully signed, `codesign --verify --deep --strict` passes, and hardened runtime is on. The only missing piece is an identity Apple recognizes.

### Why there is no self-signed certificate

Tried it; the conclusion is that it brings **no benefit**:

- `codesign` refuses to sign with an untrusted identity (`no identity found`); to use one you first have to set it to "always trust" in the keychain — that step pops a system authorization dialog on every build machine, and on CI it needs `sudo`;
- on **someone else's** Mac, Gatekeeper treats self-signed and ad-hoc the same way; the prompt and unblocking steps are identical;
- the one real benefit of a self-signed identity is that it does not change across versions, so TCC authorizations (Accessibility, Screen Recording…) survive an upgrade. But Lingxi **requests no TCC permissions** (cursor position is read with `NSEvent.mouseLocation`, see `lib.rs`), so that benefit is void.

### The certificate that actually helps: Developer ID Application

Only Apple can issue it, which requires joining the **Apple Developer Program** ($99/year, needs an Account Holder identity). The steps this machine can do are all in `scripts/apple-signing.sh`:

```sh
./scripts/apple-signing.sh csr        # 1. generate the private key and certificate signing request (CSR)   ← already generated
# 2. browser: https://developer.apple.com/account/resources/certificates/add
#    choose Developer ID Application → G2 Sub-CA → upload the CSR → download the .cer
./scripts/apple-signing.sh import ~/Downloads/developerID_application.cer
                                       # 3. certificate + private key → signing identity (in a separate keychain)
./scripts/apple-signing.sh notary     # 4. store notarization credentials (Apple ID, Team ID, app-specific password)
./scripts/apple-signing.sh github     # 5. write them into repository Secrets so CI can also sign / notarize
./scripts/apple-signing.sh status     # check progress any time
```

After step 3, `release.sh` automatically signs with the Developer ID; after step 4, adding
`APPLE_KEYCHAIN_PROFILE=lingxi-notary ./scripts/release.sh` notarizes the local build. **The build scripts do not change a line.**

The private key and CSR live in `~/.lingxi-release/apple/` (directory 0700, private key 0600, **not in the repository**). **If the private key is lost, the certificate Apple issued is revoked** — back it up, or back up `developer-id.p12` after import (it contains the private key and certificate; the password is in the login keychain, service name `lingxi-release`, account `p12`).

The signing identity sits in a separate `~/Library/Keychains/lingxi-release.keychain-db` rather than the login keychain: for `codesign` to use a private key without a dialog it needs the keychain's partition list set, and that step needs the keychain password — for the login keychain that is your boot password. The separate keychain's password is random, stored in the login keychain, and `release.sh` unlocks it itself on restart.

## 5. GitHub Actions: `.github/workflows/release.yml`

- **Trigger**: pushing a `v*` tag; or Actions → Release → Run workflow with an existing tag to rebuild manually.
- **Skip**: tags pushed by `publish-release.sh` (with `Release-Build: local`). Manual triggers never skip.
- **Validate**: the tag must match the version in the source.
- **Sign**: with `APPLE_CERTIFICATE` etc. Secrets present it imports them into a temporary keychain and uses the Developer ID; otherwise ad-hoc. With a Developer ID but no notarization Secrets it **stops**, rather than shipping a package Gatekeeper will reject.
- **Artifacts**: published to the GitHub Release, and kept as a 14-day workflow artifact.

| Secret | Source |
|---|---|
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | set automatically by `apple-signing.sh github` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | same; at runtime just provide these three in the environment |

**Cost reminder**: the repository is private, and GitHub charges private repositories' macOS runners at **10×** the minutes. One universal release build takes about 20–30 minutes cold, i.e. 200–300 minutes of quota; the free tier is 2000 minutes a month. Local releases (`release.sh` + `publish-release.sh`) cost no quota — which is also one reason the tags from local releases make CI skip.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| user says "damaged and cannot be opened" | incomplete signature or the package was modified. `codesign --verify --deep --strict --verbose=4 灵犀.app` shows what is broken; do not re-zip the .app with `zip` |
| user says "developer cannot be verified" | not notarized; normal. Follow the "Open Anyway" unblock in the release notes; the only way to remove it is Developer ID + notarization |
| `Rust target x86_64-apple-darwin is missing` | `rustup target add x86_64-apple-darwin aarch64-apple-darwin` |
| "wants to control Finder" during build | ran `tauri build` directly instead of via `release.sh`; the script sets `CI=true` to skip this |
| notarization failed | `xcrun notarytool log <submission-id> --keychain-profile lingxi-notary` lists the reasons one by one |
| `APPLE_SIGNING_IDENTITY ... no valid identity` | the certificate chain is incomplete or the keychain is locked; `./scripts/apple-signing.sh status` |
| `publish-release.sh`: app sources changed since this build | app code changed after packaging; rerun `release.sh` |
| `cargo: command not found` | rustup's `~/.cargo/bin` is not on PATH; the script adds it automatically, and when running manually use `PATH="$HOME/.cargo/bin:$PATH"` |

## 7. Release checklist

- [ ] `node scripts/version.mjs <new version>`, commit
- [ ] `./scripts/release.sh` all green, and the signing tier at the end is the one you expect
- [ ] on **another** Mac (or a fresh user account) install from the .dmg and open it once: the cat appears, the tray works, the main interface opens
- [ ] `./scripts/publish-release.sh` (add `--draft` if it is your first time, and look at the page before publishing)
- [ ] the Releases page has all attachments: .dmg, .app.zip, SHA256SUMS.txt
