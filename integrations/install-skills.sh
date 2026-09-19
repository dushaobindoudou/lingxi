#!/usr/bin/env bash
# Install the 灵犀 skills wherever the agents on this machine will look for them.
#
# Claude Code and Codex both read `<dir>/<skill-name>/SKILL.md`, so ONE skill serves both - the
# only difference is where the directory lives. Everything is symlinked rather than copied, so
# `git pull` updates every agent at once and there is no "which copy is current" question.
#
#   ./integrations/install-skills.sh            # install for whatever is present
#   ./integrations/install-skills.sh --copy     # copy instead of symlink
#   ./integrations/install-skills.sh --project  # also into ./.claude/skills for this repo
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/integrations/skills"
MODE="link"
PROJECT=0
for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --project) PROJECT=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

install_into() {
  local dest="$1" label="$2"
  [ -d "$(dirname "$dest")" ] || { echo "  - $label: not present, skipped"; return; }
  mkdir -p "$dest"
  for skill in "$SRC"/*/; do
    local name; name="$(basename "$skill")"
    rm -rf "${dest:?}/$name"
    if [ "$MODE" = "copy" ]; then cp -R "$skill" "$dest/$name"; else ln -s "$skill" "$dest/$name"; fi
    echo "  ✓ $label: $name"
  done
}

echo "Installing 灵犀 skills ($MODE):"
install_into "$HOME/.claude/skills"  "Claude Code (user)"
install_into "$HOME/.codex/skills"   "Codex (user)"
[ "$PROJECT" = 1 ] && install_into "$REPO/.claude/skills" "this repo"

# The CLI has to be on PATH for the skills to be usable as written.
if ! command -v lingxi >/dev/null 2>&1; then
  cat <<EOF

The skills call \`lingxi\`, which is not on your PATH yet. Either:

  ln -s "$REPO/integrations/cli/lingxi" /usr/local/bin/lingxi

or add this to your shell profile:

  export PATH="\$PATH:$REPO/integrations/cli"
EOF
fi

cat <<EOF

Done. Check with:
  lingxi health        # is the cat running, where is its token
  lingxi integration   # the live contract the skills are written against
EOF
