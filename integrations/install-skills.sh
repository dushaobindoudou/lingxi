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
# WorkBuddy reads the same `<dir>/<skill-name>/SKILL.md` layout. Its MCP half is a separate step
# (the host gates it behind a config-hash approval) - see integrations/hosts/workbuddy/install.sh.
install_into "$HOME/.workbuddy/skills" "WorkBuddy (user)"
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

# --- the deterministic half -------------------------------------------------------------------
#
# A skill is advisory: the model decides whether to use it, and in most sessions it does not think
# to. Hooks fire regardless. They cannot know how the work FELT - only lifecycle - so they produce
# the plain reaction and the skill enriches it when the model does engage.
#
#   the plugin is the floor, the skill is the ceiling.
cat <<EOF

--- the deterministic half (recommended) ---

Skills only fire when the model decides to use one. To have the cat react regardless:

Claude Code - add the plugin (installs/opens the app, hooks, skill, /lingxi:setup):
  claude plugin marketplace add dushaobindoudou/lingxi && claude plugin install lingxi@lingxi
  (from this checkout instead: claude plugin marketplace add $REPO)
or, without plugins, the app's 主界面 -> Agent 接入 -> 安装 Claude Code hooks

Codex - the installer writes the notify line and keeps any notifier you already have:
  $REPO/integrations/hosts/codex/install.sh
  (notify holds ONE program, so it fans out rather than overwriting yours)

WorkBuddy - there is no deterministic half to add: it exposes no session-lifecycle hook, so the
skill above IS the integration. For the typed tool path plus the badge:
  $REPO/integrations/hosts/workbuddy/install.sh
  then click 信任 on lingxi in the connector management page (it gates MCP servers by config hash)

Done. Check with:
  lingxi health        # is the cat running, where is its token
  lingxi integration   # the live contract the skills are written against
EOF
