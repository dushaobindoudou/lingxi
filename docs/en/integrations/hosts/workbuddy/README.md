<!-- English translation of `integrations/hosts/workbuddy/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# WorkBuddy · one MCP package, one skill, one trust gate

Each directory under `hosts/` is responsible for exactly one host. WorkBuddy's shape is unlike the other three, and that is worth stating first.

| | Who triggers it | Can it be missed? | Can it carry `mood`? |
|---|---|---|---|
| skill | The model decides for itself | **Yes** | ✅ |
| MCP | The model decides for itself | **Yes** | ✅ |

**WorkBuddy has no "deterministic half."** Claude Code has hooks (conversation-lifecycle events are exposed),
and Codex has `notify` (the end of a turn always fires). Both can guarantee "when something happens, the cat reacts."
WorkBuddy's session events are not exposed (the application has neither a `hooks` config key nor an implementation of Claude's event names),
so on this path **both layers are advisory**: they are used only when the model thinks of them.

That is a tradeoff, not a defect — it means the `priority` and `mood` fields matter more, because nobody covers for you.
Integrators should read the "Mood" section of [`19-agent-integration.md`](../../../19-agent-integration.md#mood-the-field-that-makes-it-a-pet-rather-than-a-status-light),
rather than expecting a hook to help.

---

## What to install

```sh
./install.sh              # idempotent; things that already exist are not written again
./install.sh --dry-run    # only print the changes it would make
./install.sh --set-identity   # allow rewriting the machine-level identity (see "Identity" below)
```

Four things:

| # | Where it writes | What it does |
|---|---|---|
| 1 | `~/.workbuddy/mcp.json` | Merges an `mcpServers.lingxi` (`command` + `args`, **no `env`**) |
| 2 | `~/.workbuddy/skills/` | Symlinks `integrations/skills/{lingxi,lingxi-authoring}` |
| 3 | `~/.lingxi/agent.json` | Machine-level identity → `workbuddy` |
| 4 | `POST /agents` | Registers the identity and badge with `workbuddy-mark.svg` |

---

## ⚠️ First: the trust gate

**Writing `mcp.json` does not take effect by itself.** WorkBuddy records authorization of a third-party MCP server by a hash of the configuration.
A server it has never seen is kept outside — the `mcp__lingxi__*` tools **do not appear in the session at all**.

The installer prints this run's hash. To let it through:

> Connector management page, top right → custom connector → find `lingxi` → click "Trust"

Until that click: **the skill path still works as usual** (the CLI reads the token itself and does not pass through the host's gate).
The model just does not have those 13 typed tools. This is exactly a reversed demonstration of "the plugin is the floor, the skill is the ceiling" —
here **the skill is the floor**.

## ⚠️ Second: `env` closes this gate again

WorkBuddy's hash is:

```
sha256( command | sorted(args) | sorted(env key names) )
```

Note that the last item is the **key names, not the values**. So adding a key to `lingxi`'s `env`, or renaming a key,
produces a new hash → the existing trust record (the `<hash>::lingxi` entry in `~/.workbuddy/mcp-approvals.json`)
no longer matches → **WorkBuddy refuses to start this server**.

This failure is completely invisible inside the server: the process is never started, so not a single log line in `bridge.mjs`
runs. On the surface it is only "the cat suddenly stopped reacting." It looks like the desktop pet broke, when the configuration broke.

So the identity is not placed in the host's `env`. It is placed in `~/.lingxi/agent.json` —
a machine-level file shared by every host. `command` and `args` never have to change again, and the hash stays valid forever.

> The probe `verify-workbuddy-mcp.mjs` recomputes this hash and reconciles it **before** any functional check.
> If you cannot get through the door, the checks after it mean nothing.

## Why bare `node`

It is not that "an absolute path was never considered." WorkBuddy's own product docs teach users to configure MCP with
`"command": "npx"` / `"command": "node"`, which means the host prepares a usable node for the child process — the same configuration shape as Claude Code (on this machine, `~/.claude.json` uses bare `node` too).
Hard-coding `~/.workbuddy/binaries/node/versions/22.22.2-3/bin/node` is more brittle:
when WorkBuddy changes its node version, the path changes, and changing the path changes the hash, which drops the trust.

---

## Identity: one file, three hosts

`~/.lingxi/agent.json` is **machine-level**. The MCP server and the `lingxi` CLI read the same file.
What it currently writes is:

```json
{ "id": "workbuddy", "name": "WorkBuddy", "badge": "🐧", "color": "#0AC89F" }
```

**This machine has more than one agent.** The same file is shared by every host, so changing it affects the others:

| Host | Where the identity comes from | Affected by this file? |
|---|---|---|
| WorkBuddy | MCP reads `~/.lingxi/agent.json` (it **cannot** override with env) | ✅ Yes |
| Claude Code | `mcpServers.lingxi.env.LINGXI_AGENT` in `~/.claude.json` | ❌ No (env takes priority over the file) |
| Codex | `LINGXI_AGENT=codex` (written in the MCP env in config.toml) | ❌ No |
| Claude Code hooks | The Rust bridge identifies the caller from `provider` in the payload | ❌ No |

So the installer **does not change** a non-empty id already in this file by default — silently replacing someone else's identity is the thing this design should least do.
It only stops and tells you what to do when it finds a conflict:

- To let WorkBuddy use this file without changing the other hosts → first pin the other hosts' identities **explicitly** in their own
  MCP `env` (Claude Code already does this, `LINGXI_AGENT=claude-code`), then
  `./install.sh --set-identity`.
- Or accept a shared identity: WorkBuddy and the host already named in the file share a name, and the user cannot tell who is reacting.

> The reverse is also true: **Codex / Claude Code `env` is safe. WorkBuddy's `env` is poison.**
> The difference is not technical. It is whether the host itself hangs trust on a hash of the configuration.

---

## Acceptance

```sh
cd <repo> && ./integrations/hosts/workbuddy/install.sh

# 1. The gate itself (hash reconciliation + identity file + 13 tools + attribution + mood, end to end)
node --experimental-strip-types .workbuddy/probes/verify-workbuddy-mcp.mjs

# 2. Make the cat actually react once
lingxi task completed test proud "WorkBuddy is connected"
lingxi agents     # workbuddy should wear the 🐧 badge and #0AC89F, claims should increase, and anonymous should not
```

Expect to see this at step 1:

```
— Integration gate (WorkBuddy)
  ✓ lingxi's configuration hash is trusted        <first 16 digits of the hash>
  ✓ mcp.json has no env (that is what keeps the hash stable)  identity goes through ~/.lingxi/agent.json
  ✓ ~/.lingxi/agent.json exists and has an id  🐧 WorkBuddy (workbuddy)
  ✓ the id in the file is workbuddy
```

`✗ lingxi's configuration hash is trusted` is the "Trust has not been clicked yet" case — click it on the connector management page, then run again.

### If it is trusted and the tools still do not appear

In order from most likely to least:

1. **The session was not restarted.** The MCP server is started when the session starts. After clicking Trust, open a new turn.
2. **`node` was not resolved.** The PATH the host gives the child process has no node (a macOS application launched from the GUI inherits
   launchd's PATH, which is only `/usr/bin:/bin:/usr/sbin:/sbin`). How to confirm: see whether
   `~/.workbuddy/mcp-tool-list.json` contains `mcp__lingxi__*`.
   The fix is to replace `"command": "node"` with an absolute path — **but changing `command` changes the hash**,
   so after the change, click Trust once more. See above.
3. **The hash does not match.** `install.sh` prints the current hash. The key in `~/.workbuddy/mcp-approvals.json` is
   `<hash>::lingxi`. If the two disagree, it has not been trusted.


## Uninstall

```sh
./install.sh --uninstall
```

Removes the `lingxi` entry in `mcp.json` and the two skill symlinks, and withdraws the identity in `agent.json`
(only if this file is still workbuddy; it does not touch what someone else wrote). The trust record in `~/.workbuddy/mcp-approvals.json`
is cleaned up by WorkBuddy itself.

## Customizing the WorkBuddy skin

This step is not part of integration. It uses the same resource mechanism. The tools are in the repository:

```sh
node --experimental-strip-types .workbuddy/probes/build-workbuddy-assets.mjs   # generate
node --experimental-strip-types .workbuddy/probes/verify-workbuddy-assets.mjs  # preflight with the application's own parser
lingxi reload                                                                 # reload, then lingxi assets to see lastErrors
```

`build-workbuddy-assets.mjs` writes skins, expressions, actions, bubbles, and the reactions mapping into the resource directory.
**It reads the existing `skins.json` and then appends incrementally** — a custom skin is a "merge." A `skins.json`
written without reading first wipes the user's existing skins off disk. That is the easiest way this mechanism causes irreversible loss.
