<!-- English translation of `integrations/hosts/codex/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# lingxi-codex — Lingxi's dedicated Codex plugin

The "plugin" here is the Codex host integration: an idempotent installer + the three things it installs:

| What gets installed | Where | Role |
|---|---|---|
| notify fanout script | `~/.codex/notify-fanout.sh` | Automatically reports the end of a turn to the cat; **your existing notifier stays first** |
| MCP server section | `~/.codex/config.toml` `[mcp_servers.lingxi]` | 13 tools with a schema; signed as `LINGXI_AGENT=codex` |
| skill | `~/.codex/skills/lingxi` (symlink) | Teaches the model to report `mood`, and to use the cat with restraint |

`notify` only means one Codex reply turn has ended. It does not prove the user's task is finished. The main window labels this kind of event "this reply turn ended." Real task completion, failure, and the specific task name should be reported by `lingxi_task`.

## Install

```bash
./integrations/hosts/codex/install.sh --dry-run   # see what it will change first
./integrations/hosts/codex/install.sh
```

The installer promises:

- **It never overwrites notify** — it first backs config.toml up to `config.toml.bak-lingxi-<timestamp>`,
  then points notify at the generated fanout script, keeping the original notifier as the first command inside the fanout;
- The MCP section is wrapped in `# >>> lingxi plugin >>>` markers. A repeat install replaces the whole section and leaves no debris;
- The skill is a symlink. `git pull` updates every machine.

## Relationship to an existing hand-written config

If you previously configured it by hand following [`integrations/README.md`](../../README.md) (a fanout script + `[mcp_servers.lingxi]`),
running this installer again keeps the existing fanout and replaces the unmarked MCP section in place with a marked section. It does not produce a duplicate TOML table.
The installer writes the fanout with the same semantics as the hand-written version (the original notifier first, the `LINGXI_AGENT=codex` emission after it).

## Acceptance

```bash
grep -A3 'mcp_servers.lingxi' ~/.codex/config.toml   # the section exists, LINGXI_AGENT=codex
grep notify ~/.codex/config.toml                     # points at notify-fanout.sh
~/.codex/notify-fanout.sh '{"type":"agent-turn-complete","thread-id":"e2e","last-assistant-message":"verification"}'
lingxi events                                        # the newest entry has provider=codex
```

## Uninstall

```bash
# 1. Point notify back at the "# your original notifier" line inside the fanout script (or the notify line in the pre-install backup)
# 2. Delete the >>> lingxi plugin <<< marked section in config.toml
# 3. rm ~/.codex/skills/lingxi ~/.codex/notify-fanout.sh
```
