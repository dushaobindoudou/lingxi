<!-- English translation of `integrations/hosts/claude/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# lingxi-claude — Lingxi's dedicated Claude Code plugin

A three-piece set made for Claude Code: **hooks (deterministic reactions) + skill (mood semantics) + MCP (direct control)**.
Self-contained: the hooks are plain `curl`. They do not depend on node, and they do not depend on any other directory in the repository — copying the whole `lingxi-claude/`
directory anywhere and installing it from there still works.

## Install

```bash
claude plugin install /Users/liepin/workspace/lingxi/integrations/hosts/claude
```

MCP is registered by the `.mcp.json` inside the plugin. `mcp/` is a synced copy of **every module** in `packages/mcp-server/src/`
(previously only `index.mjs` was copied, and the three files it imports were not there, so the plugin's MCP never started successfully even once).
After changing the MCP server source, copy it again: `cp packages/mcp-server/src/*.mjs integrations/hosts/claude/mcp/`
— `packages/mcp-server/test/plugin-copy.test.mjs` fails when the two sides disagree.

**If the cat is not open, it launches itself.** The `SessionStart` hook checks whether the application is up at the start of every session. If it is not, it
`open -g` in the background, waits until the bridge is ready, and then sends this event as a follow-up. The MCP server also checks once when the host connects. The other hooks only deliver.
They do not launch — launching is only placed at the session boundary. `LINGXI_AUTOSTART=0` turns it off.

## Layers: who is responsible for what

| Layer | File | Responsibility | Depends on |
|---|---|---|---|
| hooks | `hooks/hooks.json` | Session start (launch the cat if it is not open) / waiting for your approval / end of turn → the cat necessarily reacts | curl + the `open` that ships with macOS |
| skill | `skills/lingxi/SKILL.md` | Teaches the model to report `mood`, and to make the cat speak / remember / remind with restraint | lingxi CLI |
| MCP | `.mcp.json` → `mcp/index.mjs` | 13 tools with a typed schema; the host authorizes them one by one | node |

Hooks are the floor: **the cat reacts even if the model does nothing.** The skill is the increment: hooks only know "what happened."
"How this thing feels" is known only to the model that read the work. MCP is optional: it is needed only when you want typed authorization.

## Relationship to the app's one-click install

The hook command is **verbatim the same** as the command the app's main window writes under "Agent integration" (the same path `/task-event`,
the same way of reading the token file), so:

- If the plugin is installed, you do not also click one-click install (and the reverse: they do not stack);
- The app's uninstall logic, `remove_our_hook_entries`, identifies entries by the command string and can clear the hooks this plugin installed along with its own.

The event identity is the bridge's `claude`: the bare-payload path does not read `~/.lingxi/agent.json`, so this half's identity is fixed.
The half the model drives itself (skill / MCP) still reads the machine identity file — the two identities differing is intentional. In the event stream you can
tell "reported by the host on your behalf" from "reported by the model itself."

## Acceptance

```bash
# 1. Hooks take effect: the hook payload is sent directly, and the event is stored
T=$(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token")
H=$(mktemp); printf 'header = "Authorization: Bearer %s"\n' "$T" > "$H"
printf '{"session_id":"plug-e2e","hook_event_name":"Notification","message":"Claude needs your permission to use Bash"}' \
  | curl -s -m 2 --noproxy '*' -K "$H" -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' --data-binary @-
rm -f "$H"
# Expect {"ok":true,"recorded":true}; the newest entry in lingxi events has state=needs_approval

# 1b. Check module: quit Lingxi first, then open a new Claude Code session — the cat should appear within a few seconds (without stealing focus),
#     and lingxi events should contain a "session start" with state=queued. It should not appear when LINGXI_AUTOSTART=0.

# 2. MCP registration: claude mcp list should show lingxi and ✔ Connected
# 3. Skill visible: /skills inside a session should list lingxi
```

## Uninstall

```bash
claude plugin uninstall lingxi-claude
# Hooks are removed automatically with the plugin; you can also click "Disconnect Claude Code" in the app's main window as a fallback
```
