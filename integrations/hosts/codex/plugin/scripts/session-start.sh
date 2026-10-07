#!/usr/bin/env bash
# SessionStart for the Codex plugin: the shared check (ensure-app.sh) run as Codex - installs 灵犀
# from GitHub if it is missing, starts it if it is closed, then reports the session through
# event.sh. A wrapper rather than `LINGXI_HOST=codex …` in the hook command, so the hook does not
# depend on which shell Codex runs it with.
export LINGXI_HOST=codex
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ensure-app.sh"
