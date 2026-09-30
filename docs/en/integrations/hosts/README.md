<!-- English translation of `integrations/hosts/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# hosts/ — one dedicated plugin per host

Each directory here is responsible for exactly one host, built to that host's real shape, with no generic compromise. **This is now the only integration path.**

> There used to be a generic plugin directory, `integrations/plugins/`, with tradeoffs made so it could serve several hosts at once
> (Claude's hooks went through a node adapter, identity `claude-code`). It has been deleted: two sets side by side means installing the wrong one
> puts two identities into the event stream, and each side's docs recommend their own set.
> **If what you installed before was `plugins/claude-code`, install once more**:
> `claude plugin install <repo>/integrations/hosts/claude`.

| Directory | Host | Shape | Key tradeoff |
|---|---|---|---|
| `claude/` | Claude Code | A standard Claude plugin (plugin.json + hooks + skill + MCP) | Hooks use plain `curl` straight to `/task-event`. The Rust bridge natively maps the Claude payload — zero node dependency, and the plugin directory still works if it is copied elsewhere. The hook command is verbatim the same as the app's one-click install, so `remove_our_hook_entries` can recognize it and take over uninstall |
| `codex/` | Codex | Installer + fanout script + skill | Codex has no plugin-manifest format. Its "plugin" is a stretch of config.toml plus a script. The installer keeps an existing notify (a fanout merge rather than an overwrite). Identity uses `LINGXI_AGENT=codex` rather than the machine identity file |
| `dsh/` | DeepSeek Harness (DSH) | Dynamic Cordis plugin source | DSH has no out-of-process plugin mechanism — capabilities are registered as model Tools through a dynamic Cordis plugin. The source is in the repo, loaded with `cordis_define`, and takes effect at session scope |
| `workbuddy/` | WorkBuddy | Installer + MCP config + skill symlink + identity registration | **Both layers are advisory**: WorkBuddy does not expose session events (no hooks, and no notify), so there is no "deterministic half," and `mood` can only be reported by the model itself. Identity cannot use the host `env` (trust is recorded by a hash of the configuration) and can only go through the machine-level file |

## Acceptance baseline

Each directory's README has its own acceptance commands. The shared floor: the bridge `/health` responds, the token's permissions are 0600,
events in `lingxi events` (or `/debug/events`) are signed with the right identity, and after uninstall no further events are produced.

A new host integration must also complete the checks below. The detailed requirement is in [bubble configuration and per-turn task summaries](../../19-agent-integration.md#on-integration-you-must-check-and-update-the-bubble-configuration):

- Read and update `assets/bubble.json` for the application's scene. The default bubble configuration does not fit every application. After changing the shared configuration, check how the other hosts display.
- Confirm whether the bubble and the text need to be centered, and the icon's position and spacing, and check short lines, multi-line text, and the no-icon case. Centering and icon position currently have no config fields. They need to be improved in the rendering implementation.
- Check the display and readability of the body color `text` and the emphasis color `accentText`. Multi-color on an arbitrary fragment is a later improvement.
- Each turn, update the task `summary` from the latest conversation, and at the end summarize the result or the reason it is blocked. Verify with a follow-up that changes the task's scope in one turn that the displayed content refreshes and does not keep a stale title.
