<!-- English translation of `integrations/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Integrating Lingxi

## Read this first: will the skill actually be called?

**Not necessarily.** A skill is **advisory**. The model reads it, then decides for itself whether to use it. In most sessions it does not think of it.

So integration has two layers, and both have to be installed:

| | Who triggers it | Can it be missed? | Knows `state` | Knows `mood` |
|---|---|---|---|---|
| **Plugin / hook** | The host, deterministic | **No** | ✅ | ❌ Cannot see the content |
| **Skill / MCP** | The model itself | Yes | ✅ | ✅ **The core value** |

> **The plugin is the floor. The skill is the ceiling.**
> The plugin guarantees "when something happens, the cat reacts." The skill makes that reaction **know what the thing is about**.

The adapter **deliberately does not guess** `mood`. If the plugin invented one, it would be fabricating the one field the whole design depends on, and it would be wrong somewhere nobody can see. It leaves the field empty. The application treats that as `focused`, and overwrites it when the model actually has something to say.

> **Which copy to install: `hosts/`.** Each directory under `integrations/hosts/<host>/` is responsible for exactly one host, built to that host's real shape. It is the only integration path. The previous generic plugin directory, `integrations/plugins/`, has been deleted. If you installed `plugins/claude-code`, install `hosts/claude` once more. The tradeoff comparison is in [`hosts/README.md`](hosts/README.md).

```sh
# Claude Code: install hooks + skill + MCP together (hooks are plain curl and do not depend on node)
claude plugin install <repo>/integrations/hosts/claude

# Codex: deterministic events are carried by notify. notify is a single TOML key. If this machine
# already has another notifier (for example SkyComputerUseClient), do not overwrite it. The installer
# writes a fanout script that sends to both:
<repo>/integrations/hosts/codex/install.sh

# DSH / WorkBuddy each have their own shape. See hosts/dsh/ and hosts/workbuddy/

# Also add MCP (the channel the model drives itself):
# [mcp_servers.lingxi]
# command = "node"
# args = ["<repo>/packages/mcp-server/src/index.mjs"]
# Identity goes through ~/.lingxi/agent.json. Do not write an env block (see "Identity" below)
```

The **contract** for an event is [`schema/task-event.schema.json`](../../../integrations/schema/task-event.schema.json).
Every integration — hook, notify, MCP, curl — produces only this one object.
**Connecting one more host = writing one adapter. The application does not need to change.**

While integrating, also check and update the bubble configuration for the actual scene. The default style does not fit every application. Check whether the bubble and the text are centered, where the icon sits, and the colors of body text and emphasis text. Centering and icon position have no config fields yet. They need to be improved together with the rendering implementation.
**Every turn, update the task `summary` from the latest context, and at the end summarize the actual result, so the task title on display does not drift from the current work.**
See [bubble configuration and the per-turn task-summary requirement](../19-agent-integration.md#on-integration-you-must-check-and-update-the-bubble-configuration).

---

## Below are three manual paths, from lowest friction to highest

The spec is [`docs/19-agent-integration.md`](../19-agent-integration.md).
A running application serves the contract as-is from `GET /integration`. **That response is the authority.**

---

## 1. Skill + CLI (recommended)

```sh
./integrations/install-skills.sh
export PATH="$PATH:$(pwd)/integrations/cli"   # optional; see below
lingxi health
```

**It works without adding it to PATH, and without even having the repository** — every time the application starts, it writes the CLI to:

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi
```

The `cli` field in the response from `curl -s localhost:47811/health` is its absolute path (this endpoint needs no auth).
The only dependencies are `curl` + `python3` (or `node`). **jq is not required.**

### Capability comparison: the CLI is a superset of MCP

| | MCP | CLI |
|---|---|---|
| Speech / expression / action / effect / toy / camera | ✅ | ✅ |
| Report a task (including `mood`), memory, reminders, reload resources | ✅ | ✅ |
| `activity`: who is doing what | ❌ | ✅ |
| `events`: event history | ❌ | ✅ |
| `unremind`: cancel a reminder | ❌ | ✅ |
| `raw`: any unwrapped endpoint | ❌ | ✅ |

**So a skill alone can drive every capability.** MCP is still useful (a typed schema, per-tool permissions), but it is not required.

Once installed, **both Claude Code and Codex can use it** — both read `<directory>/<skill-name>/SKILL.md`, so it is the same skill, only the directory differs:

| Agent | Location |
|---|---|
| Claude Code (user level) | `~/.claude/skills/` |
| Codex (user level) | `~/.codex/skills/` |
| This repository (project level) | `./.claude/skills/` (add `--project`) |

The default is a **symlink**, so one `git pull` updates every agent at once. There is no "which copy is newest."
Use `--copy` for an independent copy.

### Why this path comes first

Every MCP tool call is an **authorization surface**. Quite a few hosts pop a confirmation per tool, so changing the expression three times in one turn means three approvals.
A script is one. And `lingxi` reads the token itself. **There is nothing to configure.**

---

## 2. MCP server

A better fit when the host wants a typed schema and wants to control permissions per tool. 13 tools.

**Claude Code / any client configured with JSON:**

```jsonc
{
  "mcpServers": {
    "lingxi": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/src/index.mjs"]
    }
  }
}
```

**Codex** (`~/.codex/config.toml`; note that this is TOML, not JSON):

```toml
[mcp_servers.lingxi]
command = "node"
args = ["<repo>/packages/mcp-server/src/index.mjs"]
```

The server reads the token itself from the config directory. Do not write it into the config file.
Identity is not written here either — see "Identity" below. Write it into `~/.lingxi/agent.json` once.

### Identity (`~/.lingxi/agent.json`, or `LINGXI_AGENT`)

One machine often has more than one agent driving the same cat, and **the cat has only one face**. The application arbitrates by the `agent` the caller reports, and shows a badge, so a call that does not name itself always lands as `anonymous` (💻) —
the user cannot tell who is reacting, and a `report` also loses to an `anonymous` `alert`.

**Recommended: write the identity into a machine-level file, configure it once, and share it across every host.**

```json
// ~/.lingxi/agent.json
{ "id": "workbuddy", "name": "WorkBuddy", "badge": "🐧", "color": "#0AC89F" }
```

The MCP server and the `lingxi` CLI **read the same file**, so the two paths sign with the same identity.
Once it is set, **every** call from this server carries this id, and automatically
`POST /agents` to register before contending for the stage (the registry is purely in memory and disappears when the application restarts, while the bridge token is persistent —
so an optimization like "cache that we already registered" is wrong here).

`LINGXI_AGENT` / `LINGXI_AGENT_NAME` / `LINGXI_AGENT_BADGE` / `LINGXI_AGENT_COLOR`
are still valid, and **take priority over the file**, for a temporary override on a single host.

> ⚠️ **But do not put them in the `env` of the host's MCP config.** Some hosts (WorkBuddy is one)
> record authorization of a third-party MCP server as `sha256(command|sorted(args)|sorted(env key names))`.
> Adding or removing one key in `env` changes the hash and invalidates the trust already recorded, so the host **refuses to start this server** —
> the tools vanish from the session, and because the process was never started, none of the server's own logs run,
> so from the outside it does not look like a configuration problem at all. Put the identity in the file, leave the host's `env` empty, and the hash stays valid forever.
> Details are in the header comment of `packages/mcp-server/src/bridge.mjs`.

Check:

```sh
lingxi agents     # you should see your id wearing the badge you picked
```

---

## 3. Direct HTTP

```sh
TOKEN=$(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token")
curl -H "Authorization: Bearer $TOKEN" localhost:47811/integration
```

`GET /health` is the only endpoint that does not need a token. It tells you where the token file is.

**If the application is not open, you do not have to open it by hand.** Every entry carries the same check module: the MCP server when the host connects (`initialize`),
the Claude Code `SessionStart` hook at the start of a session, the DSH plugin when it loads, and the CLI before the first request. If the bridge is unreachable they
`open -g -b com.dushaobin.lingxi-desktop` (without stealing focus), wait for the bridge, and then continue. `lingxi up` is that check pulled out as its own command.
Set `LINGXI_AUTOSTART=0` if you do not want this behavior. If you cannot connect, run `lingxi doctor` first.
When each entry checks, and why it only launches at a session boundary, see [docs/19](../19-agent-integration.md#before-step-zero-what-if-the-app-is-not-open), section "Before step zero."

---

## Claude Code hooks (optional, extra automatic reactions)

Let the cat react automatically to the start and end of **every turn**, without the model calling anything itself:

Main window → "Agent integration" → "Install Claude Code hooks", or:

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" localhost:47811/task-event \
  -H 'Content-Type: application/json' \
  -d '{"provider":"claude","state":"completed","kind":"chat","mood":"focused"}'
```

The hook uses the same `/task-event`. Only the shape differs (the application recognizes both automatically).

> Hooks cannot report `mood` — they are conversation-lifecycle events and do not know the content.
> **If you want the cat to actually understand what is happening, have the model send the task event itself.** That is exactly what the skill teaches it to do.

---

## Check after installing

```sh
lingxi doctor          # every precondition: application / auth / identity / permissions / skill / host
lingxi health          # whether the application is up, and where the token is
lingxi integration     # the full contract
lingxi capabilities    # every action / expression / theme, marked builtin/custom
lingxi task completed test proud "connected"    # make the cat react once
```
