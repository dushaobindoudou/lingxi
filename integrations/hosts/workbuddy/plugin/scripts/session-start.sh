#!/usr/bin/env bash
# SessionStart for the WorkBuddy plugin: the shared check (ensure-app.sh) run as WorkBuddy -
# installs 灵犀 from GitHub if it is missing, starts it if it is closed. A wrapper rather than
# `LINGXI_HOST=workbuddy …` in the hook command, so the hook does not depend on the shell.
export LINGXI_HOST=workbuddy
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ensure-app.sh"
