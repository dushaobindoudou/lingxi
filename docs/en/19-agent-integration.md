<!-- English translation of `docs/19-agent-integration.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Integrating Lingxi: the full specification for agents

> This document is for **the models and people who write an integration**. A running app
> serves the vocabulary below and the mapping currently in effect, verbatim, from
> `GET http://127.0.0.1:47811/integration` —
> that endpoint is authoritative; this document explains it.

---

## The one-sentence version

**Report what you are doing. Do not tell the cat what to do.**

```
❌  The build failed → I make the cat play shake-head + the expression "annoyed"
✅  I report { state: "failed", kind: "build" } → the cat decides how to show it
```

Three reasons, all of them practical:

1. **The user can change everything at once.** The mapping lives in `reactions.json`
   in the user custom-asset directory
   (`~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/reactions.json`, not in the repo). Once the user edits it, every agent changes together.
   If you hard-code an action, the user has to go edit you.
2. **You do not have to memorize 49 actions and 30 expressions.** You only need to know what you are doing.
3. **When we add an action or change an animation, you do not change a line.**

Direct drive (`POST /control {"action": ...}`) **stays open**. Debugging and special cases need it,
but it is a low-level interface, not the right shape for an everyday integration.

---

## Before step zero: what if the app is not open

The bridge exists only while the app is alive. Every integration path used to answer this the same way —
"Lingxi is not reachable" — and that sentence is true, but **the caller is a model**, and the person who can open the app
is not necessarily looking at the terminal.

So now **every entry point offered to a third party carries the same check**: is the bridge up? If not,
`open -g -b com.dushaobin.lingxi-desktop`, wait until `/health` answers (at most 15 seconds), then continue. The only difference is **when the check runs**:

| Entry | At session start | When a call finds it down | Implementation |
|---|---|---|---|
| MCP server (Codex / WorkBuddy / Claude plugin / any MCP host) | ✅ Checked in the background on `initialize`; does not stall the handshake | ✅ Once per process; after success the first result includes a line "I started it" | `warmUp()` in `packages/mcp-server/src/launch.mjs` and `bridge.mjs` |
| Claude Code hooks (plugin + the main window's `一键接入` (one-click connect)) | ✅ `SessionStart` hook: check in the background, launch, wait until ready, then replay this event | — Other events are only delivered; they do not launch | `CLAUDE_SESSION_START_COMMAND` in `lib.rs` |
| DSH plugin | ✅ On plugin `apply`, register the identity; launch if unreachable | ✅ Once per plugin instance | `ensureAppRunning` in `lingxi-dsh-plugin.js` |
| `lingxi` CLI / skill | The skill's first step is `lingxi up` | ✅ Before the first request | `start_app` in `integrations/cli/lingxi` |
| Codex notify / `lingxi-emit` adapter | — | — Delivery only | Session start for Codex is the MCP server row above |

`lingxi up` is that check, pulled out on its own: if it is already running, do nothing; if it is not, launch it and wait until ready. The result is the exit code.
It works as the first step of a skill or the last step of an install script.

**Launching happens only at a session boundary.** That is intentional: launching on every question and every turn
would lock horns twenty times an hour with someone who turned the cat off on purpose. Once per session is a reminder, not pestering.

A few boundaries, all intentional:

- **`-g` does not steal focus.** The cat appears on the desktop; the window under your hands does not move.
- **`LINGXI_AUTOSTART=0` turns it off completely.** A call that can make a window appear on someone else's desktop out of nowhere should be refusable
  — they may be screen-sharing, presenting, or simply not wanting to see the cat right now.
- **If the app is not installed, it will not be installed.** When the `.app` cannot be found, the message is "how to build it / where to install it", not a silent failure.
- **Each process tries only once.** An app that will not start will not start the fourth time either; a script in a loop should not pay a 15-second timeout every round.
- **The check bypasses proxies.** Every curl carries `--noproxy '*'`: if the environment exports `http_proxy`, curl hands even 127.0.0.1
  to the proxy, and a local proxy answers 502 — the check would read that as "the app is running" and start nothing.
- **A machine that already installed `一键接入` (one-click connect) does not need to reinstall.** On every launch the app upgrades, in place, the old hook command **it itself wrote**
  in `~/.claude/settings.json` to the current version (after a backup). It does not touch a single character of any other hook, and it does not install events you never installed.

### `lingxi doctor` — run this first when you cannot connect

"The cat did not react" is **one** symptom with at least six causes underneath: the app is not open, it is open but the bridge did not bind the port, this account cannot read the token,
the permission tier does not allow writes, the skill was never installed, the host's plugin is not enabled. The error a model sees points out at most one of them.

```sh
lingxi doctor
```

It checks **the app / auth / attribution / permission tier / skills and hosts**, item by item. Every failure comes with a sentence you can follow;
if any item fails, it exits non-zero, so it can sit at the end of CI or an install script.

---

## Step zero: authentication

The bridge **requires a token**. The first time the app starts it generates one and writes it in the config directory, mode `0600`:

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token
```

```bash
curl localhost:47811/health          # the only endpoint that does not need a token; it tells you where the token is
curl -H "Authorization: Bearer $(cat "$TOKEN_FILE")" localhost:47811/status
```

The `X-Lingxi-Token:` header is also accepted. **Do not put the token in the URL** (`?token=` is kept only for old-client compatibility):
a URL lands in shell history, proxy logs, and referrers; a header does not.

> **Why listening on loopback is not enough**: loopback is a **network boundary, not a trust boundary**. Any process running as this user
> can reach 127.0.0.1 — including a page in the browser, including a sandboxed process. And this bridge can move the cat,
> **read the accumulated memories of the owner**, and write files into the user's config directory. The token file is readable only by the owner;
> anything that can read it is already this user.

**If you use the CLI you do not have to think about any of this** — it reads the token itself.

## Step one: register an identity and generate your own logo

```bash
lingxi register claude-code --logo my-mark.svg --name "Claude Code" --color "#d97757"
```

| Field | Meaning |
|---|---|
| `id` | **Required.** A stable string. Carry it on every later call |
| `name` | Display name, at most 24 characters |
| `logo` | **An SVG you generate yourself.** This is how the user tells "which agent did this" |
| `color` | `#rgb` or `#rrggbb`, the logo's background color |
| `badge` | A two-character text fallback, used when no logo is given |

**You draw the logo yourself.** Writing SVG is the model's trade — on the first run, generate a small mark that stands for you,
store it in your own config, and keep using it. Requirements:

- **Small and flat**, two or three colors, **no text** (unreadable at 22px)
- Pure shapes and paths. `<script>` / `<foreignObject>` / an external `href` / `<image>` are rejected, and you are told why
- Within 64KB (a normal SVG mark is far under 8KB)

> **Security**: the logo is rendered inside an `<img>` in the webview, not inlined into the DOM. SVG inside an `<img>`
> **cannot run scripts and cannot load external resources** — that is the browser's own guarantee, stronger than any sanitizer we could write.
> The rejection rules above are a second layer, so that **you get an error at registration time** instead of a mark that quietly fails to draw.

**The logo is shown on the bubble and disappears with the bubble.** It is not pinned beside the cat — a mark pinned to the body is a HUD that competes with the pet for attention,
and it has no natural moment to disappear; a bubble already has a reason to appear and a reason to go.

You can use the bridge without registering — a bare `curl` must keep working — but you will be shown as the first two characters of the id.

### On integration you must check and update the bubble configuration

**The default bubble does not fit every app.** When a new app integrates, check the bubble against the host's identity, the real copy, and the usage,
and update the settings in `bubble.json` that need to change. **It is not in the repo** — these are user-level custom assets, at
`~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/bubble.json` (the directory also holds
`actions.json` / `expressions.json` / `skins.json` / `reactions.json` / `textures/`, plus a
`README.md` written by the app itself). Read the existing config first and edit on top of it; this is shared config,
and after you change it you also have to check how the other already-integrated apps look. Tuning the default bubble and accepting an integration must cover:

| Check | Requirement |
|---|---|
| Whether it is centered | Confirm separately the bubble's position relative to the pet, and how the text is aligned inside the bubble; check both short lines and multi-line task summaries, and decide per scene whether to center |
| Icon position | Be explicit about where the host logo / badge sits relative to the body text, and the gap; with an icon, without an icon, and when long text wraps, it must not cover the text or shift the layout |
| Multiple font colors | Body text and emphasis should be distinguishable by color, while staying readable on the background; the current config provides `text` and `accentText`. Per-span multi-color is a further improvement |
| A task summary every turn | Each turn of the conversation refreshes the task `summary` from the latest context; after the user corrects the goal or changes the scope, what is shown must follow, so the task title does not drift off the current work |

The current `bubble.json` has no fields for centering or icon position. Those two need to be improved together with the renderer;
they cannot be finished by adding JSON fields alone. After the config changes, run `POST /control {"reloadAssets":true}`,
check the load result with `GET /assets/status`, and actually look at the scenes above.

---

## Step two: report the task

```bash
curl -X POST localhost:47811/task-event -H 'Content-Type: application/json' -d '{
  "provider": "claude-code",
  "agent":    "claude-code",
  "taskId":   "build-4821",
  "state":    "failed",
  "kind":     "test",
  "summary":  "3 tests failed under auth/"
}'
```

### Refresh the task summary every turn

**Every turn of the conversation must summarize the current task and report the latest `summary`. Do not keep reusing the first prompt or the session title.**
After a new message arrives, take the original goal and the user's latest request and summarize what this turn is actually going to do; when the turn ends,
update the summary again with the actual result or the reason it is blocked, and report the matching state. The summary should be short, concrete, and able to explain the current work on its own.

Follow-ups or corrections of the same task keep the `taskId` and update `summary`; switching to an independent task uses a new `taskId`.
For example, if the user goes from "adjust the bubble style" to "update the integration doc first", the summary should become "add the bubble integration config notes",
and when that is done become "added the bubble-config checks and the per-turn task-summary requirement", rather than keep showing the original title.

A model that can read the conversation is responsible for generating the summary; a hook / notify should pass through the latest summary the host provides,
and the model channel fills it in when that is unavailable. Sending only a state event does not replace a per-turn task summary.

### Mood: the field that makes it a pet rather than a status light

```bash
lingxi task failed test frustrated "the fourth run of the same test"
```

`state` and `kind` describe the **process**. Writing a letter to your mother and wrestling a flaky test are both `running`/`write` —
a pet that cannot tell those apart is a status light with fur. **`mood` is reading the content, so only the agent can judge it.**

| mood | When |
|---|---|
| `tender` | Private, intimate, soft (a letter to family, an anniversary, a eulogy) |
| `proud` | Something hard finally went through |
| `sad` | Bad news, a loss, an apology |
| `frustrated` | The same thing failed again |
| `anxious` | There is risk, it is irreversible, there is a deadline |
| `weary` | It has been a long time, and it is late |
| `playful` | For fun, light |
| `curious` | Reading something new |
| `focused` | Ordinary work (the default) |

Judge the mood of **this thing**, not how sure you yourself are.

#### The cat's reaction is a "response", not a "mirror"

> **A person who is frustrated does not need a cat that is frustrated along with them.** That is two people annoyed in front of the same screen.

Bad feelings are **caught** (failed + frustrated → "Mm… this one really is hard. Rest a bit and come back?"),
good feelings are **shared** (completed + proud → "Look at me~"). That is the only design rule of the built-in mapping,
and it is what "healing" (`治愈系`) specifically means here.

Priority: `state:kind:mood` > `state:mood` > `state:kind` > `state` > `mood`.
**mood outranks kind** — otherwise "deploy finished" would be the same face for proud, weary, and relieved.

### Progress: most `running` updates are swallowed

Include `progress` (0–1). A `running` update **produces a reaction only the first time and the time it crosses 50%**;
the rest are swallowed — otherwise a long task becomes the notification barrage a desktop pet is supposed to replace. A terminal state is never swallowed.

### Swallowed progress still counts as activity: the cat wakes up to keep you company

What gets swallowed is **speech**, not **awareness**. Every recorded event — swallowed progress included —
opens the life engine's household-activity window (a ~90s rolling window, extended by every event): a
sleeping cat wakes at once, and a settled one will not lie down; once reports stop the window lapses on
its own, sleepiness keeps accumulating, and only then does the cat settle back to sleep.

In other words, **sleep now appears only when there is no activity**. The wake itself is silent — while
you work it may get up and take a short stroll (the higher its `curiosity`, the more it likes to go and
look), but it will not interrupt you; whether it *speaks* is still decided by the reaction table and the
swallowing rules above. The window state is readable as `agentBusy` from `GET /perception`.

### State vocabulary (8 values, a closed set)

| `state` | When to report it |
|---|---|
| `queued` | Queued, not started |
| `running` | In progress |
| `blocked` | Stuck, but the user does not need to step in |
| `needs_input` | **Needs the user to answer** before it can continue (one question; it can wait) |
| `needs_approval` | **Needs the user to approve** before it can continue (a tool call is stuck right now; more urgent) |
| `completed` | Finished, successfully |
| `failed` | Finished, unsuccessfully |
| `cancelled` | Cancelled |

> `needs_input` and `needs_approval` are **split on purpose**: a question can wait until the user looks up,
> an approval is **a tool call stuck right now**. Those are the two an IM notification most needs to tell apart.
> Claude's `Notification` hook sends both; the adapter reads the message to decide.

### Work kinds (8)

`build` · `test` · `deploy` · `review` · `search` · `write` · `chat` · `other`

The kind lets the cat treat them differently — a failed deploy and a failed search should not be the same expression.

### The current built-in mapping

| state | kind | Expression | Action | Speech |
|---|---|---|---|---|
| `completed` | `deploy` | `得意` (smug) | stretch-front | `上线啦！` (It's live!) |
| `completed` | `test` | `开心` (happy) | paw-wave | `测试全绿～` (Tests are all green~) |
| `completed` | other | `开心` (happy) | paw-wave | `搞定啦～` (All done~) |
| `failed` | `deploy` | `警觉` (alert) | notice-you | `部署没过，我看着呢` (The deploy didn't pass. I'm watching.) |
| `failed` | `test` | `委屈` (aggrieved) | shake-head | `有测试挂了` (A test failed) |
| `failed` | other | `委屈` (aggrieved) | shake-head | `这次没成…` (This one didn't work…) |
| `needs_input` | — | `好奇` (curious) | notice-you | `在等你哦` (Waiting for you) |
| `needs_approval` | — | `警惕` (wary) | paw-reach | `等你批一下～` (Waiting for you to approve~) |
| `blocked` | — | `困惑` (puzzled) | curious-tilt | `卡住了…` (Stuck…) |
| `running` | — | `认真` (serious) | — | — |
| `queued` | — | `清醒` (awake) | — | — |
| `cancelled` | — | `嫌弃` (disdain) | shake-fur | — |

Trust whatever `GET /integration` returns.

---

## Permissions: what you may do is up to the user

Registering an identity is not the same as receiving permission. Each agent id has a tier, set by the user under **main window → Agent integration → `权限与日志` (Permissions and logs)**.
**The agent cannot change it itself** — an identity that picks its own permissions is not a permission.

| Tier | Can | Cannot |
|---|---|---|
| `observer` | Read (`/status`, `/perception`, `/capabilities`), register an identity | Any change |
| `performer` | Perform: expressions, actions, speech, effects, toys, `/task-event`, `/intent` | Change settings that are saved, write memories and reminders |
| `trusted` (**default for a named agent**) | All of the above + `skin` / `camera` / `scale` / `visible`, `POST /memory`, `POST /reminders` | — |

The line is drawn at **whether it stays**, not at whether it matters. A wrong expression is gone after four seconds; one `visible: false`
makes the user's cat disappear, and there is no way to see which agent did it. Those two should have different answers.

**A named agent defaults to `trusted`.** Memory and reminders sit on this tier, which is how the cat can remember yesterday. The user can change it to `performer` or `observer` on the same page, and a saved choice wins over the default. A caller with no identity is `anonymous` and stays `performer`: any process on this machine can reach the bridge, so a missing name must not receive a write that persists. A blocked call is not silent:

```jsonc
// POST /control  {"agent":"my-ci","skin":"midnight","expression":"得意"}
{
  "ok": true,
  "applied": ["expression"],            // what was not blocked still takes effect
  "rejected": ["「my-ci」的权限档位是 performer，不能改会保存下来的设置（skin）。…"]
}
```

Note that `applied` and `rejected` appear together: one over-privileged field **does not** drag down the other fields in the same call.
Writing a memory or a reminder is a single action with nothing to split, so it returns `403` directly, with the same `rejected` in the body.

`POST /memory` and `POST /reminders` identify the caller by the `X-Lingxi-Agent` header (the body is read once and cannot be scanned again for an `agent` field).
No header means `anonymous`, which stays `performer`.

### Write rate limit

Persistent writes at `trusted` are **10 per 60 seconds**, a sliding window, counted per agent. Over the limit returns `429`.
This is not to stop a bad actor; it is to stop a loop — an agent retrying a write in a tight loop would rewrite settings.json at packet speed,
and the first symptom is the disk making noise. Normal calls never hit this cap.

### Call log

Every call is recorded: who, which endpoint, **which fields were requested**, the result (applied / rejected / no permission / rate-limited), and the reason.
The latest 200 entries, in memory, cleared on restart, visible on the same page.

**Content is not recorded.** What you told the cat to say, and what the cat remembered, do not enter the log — the log is for the user to judge "should I grant this agent more",
not a second entrance for it to read the user's private business.

When a call will not go through, look here first: an entry of `无权限` (no permission) tells you directly that it is a tier problem, instead of leaving you to guess why the endpoint "did not react".

## Step three: several agents at once

Having several agents connected at the same time is normal. There is only one rule you have to cooperate with:

### Priority comes from the **event**, not from who you are

```bash
curl -X POST localhost:47811/control -d '{"agent":"my-ci","priority":"alert","expression":"惊吓"}'
```

| `priority` | Meaning |
|---|---|
| `alert` | The user has to glance **now**: a failure, a confirmation, a dangerous operation |
| `report` | There is a result |
| `status` | The state changed, and it is not urgent (**default**) |
| `ambient` | Pure atmosphere, under a quota |

Do not send `alert` for everything because "I am more important". What the user needs to see is **the thing that matters**,
not the tool that matters — a failed build matters more than idle cuteness, whoever reports it.

### If the priority is not high enough it **queues**; if it is too low it is **dropped**

```json
{ "ok": true,
  "applied": ["queued behind a higher-priority reaction (position 1, expires in 4000ms)"],
  "queued": true, "queuePosition": 1, "expiresInMs": 4000 }
```

- `alert` / `report` **queue** until the stage is free, and they **have an expiry** (8 seconds by default;
  set your own with `expiresInMs`). An expired one is dropped and not played — a reaction is a statement about a **moment**,
  and arriving late is not "late", it is "wrong".
- `status` / `ambient` **do not queue**; they are rejected outright: atmosphere has no value if it plays later.

### On `400 stage busy`, **drop it**. Do not retry

```json
{ "ok": false,
  "rejected": ["stage busy: claude-code (🤖) is showing a \"alert\" reaction for another 2600ms..."],
  "retryAfterMs": 2600,
  "dropRatherThanRetry": true }
```

A "tests passed" that plays 3 seconds later is **stale information**. By then the cat is talking about something else. Drop it.

### The user's settings are not yours

`skin` / `camera` / `scale` / `visible` are **the user's preferences**. The interface does not block you (it does not want to break existing integrations),
but it says so in the response. If you want to be recognized, **use your own logo. Do not change the skin.**

---

## Full customization: changing the cat itself

Both the user and an agent may change it. Asset directory:

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/
```

(Main window → `外观` (Appearance) → `导出内置资源为模板` (Export built-in assets as a template) writes out a full editable starter set.)

| File | Contents | How replacement works |
|---|---|---|
| `actions.json` | Action library | **Wholesale replacement** |
| `expressions.json` | Expression library | **Wholesale replacement** |
| `skins.json` | Themes | **Merged** with the built-ins (same id overrides) |
| `bubble.json` | Bubble style (color / font / shape) | Wholesale replacement |
| `face.json` | **Facial geometry**: eye spacing / eye size / nose / mouth / whisker count and length | Override per field |
| `reactions.json` | **Task → expression/action mapping** | Override per entry |
| `textures/*.png` | Hand-drawn atlases / expression sheets | By reference |

### ⚠️ What wholesale replacement means

`actions.json` and `expressions.json` are **replaced wholesale**. So before you write, **you must check the source**:

```bash
curl -s localhost:47811/capabilities | jq '.actions[] | select(.source=="custom")'
```

- `source: "builtin"` → the user has not changed it; you may start from the built-in template and write a copy
- `source: "custom"` → **the user already has their own file**. You must read it and edit incrementally on top,
  or the moment you write you delete everything of theirs

This is the point where an integrator can most easily cause irreversible loss.

### The shape of `face.json`

Color has always been swappable (`materials` inside a skin), and expressions have always been data (`expressions.json`),
but **the position and size of the features** used to require a code change and a rebuild. Now:

```jsonc
{
  // Write only the parts you want to change; the rest use the built-in values. Coordinates are in the 256x256 face-texture space.
  "eyes":     { "spacing": 72, "top": 99, "width": 44, "height": 43, "pupilRadiusX": 11 },
  "nose":     { "y": 174, "halfWidth": 9, "depth": 9 },
  "mouth":    { "y": 193, "halfWidth": 19 },
  "whiskers": { "rows": 3, "length": 58, "spread": 7, "width": 2, "droop": 0.8 },
  "muzzle":   { "x": 85, "y": 166, "width": 86, "height": 48, "radius": 16 }
}
```

A wrong field is **named**: you are told which field does not exist, and which ones are available:

```
face.json：eyes.spacng 不是可调项，可用的是：spacing / top / width / height / radius / ...
```

### The shape of `reactions.json`

```jsonc
{
  // The key is "<state>" or "<state>:<kind>"; the more specific one wins
  "failed:deploy": { "expression": "惊吓", "action": "shake-head", "say": "部署炸了…" },
  "completed":     { "expression": "得意" }
}
```

`expression` is required; `action` / `say` are optional. **Each entry is validated on its own** — one bad entry is skipped,
and it does not invalidate the whole file.

### Make the change take effect (no restart, no button for the user to click)

```bash
curl -X POST localhost:47811/control -d '{"reloadAssets":true}'
curl -s localhost:47811/assets/status
# → { "active": {...}, "lastLoadedAt": ..., "lastErrors": ["actions.json：..."] }
```

`lastErrors` is **which file and which entry is wrong**, readable as-is.

---

## Prove it took effect

After you write, you have to be able to verify, or you are flying blind.

| You changed | Where to read it back |
|---|---|
| Expression | `GET /perception` → `expression` / `expressionHeld` |
| Action | `GET /perception` → `action` |
| Position / heading | `GET /perception` → `petPosition` / `heading` |
| A move you ordered | `GET /perception` → `intent` |
| Skin / camera / size | `GET /status` |
| Custom assets | `GET /assets/status` |
| Who is driving | `GET /agents` |
| Whether the cat healed itself | `GET /perception` → `recoveredAt` (non-null means someone fed an illegal value) |

**A delay on actions is normal**: while the cat is walking, an action waits until it stops before it plays.
The `action` in a single sample may be the **previous** autonomous action — do not treat that as failure and send it again.

---

## Notification sinks: out to IM (we do not bundle any)

Lingxi **does not connect** to Slack / Feishu / Telegram — those are your accounts, and bundling any of them means handling their
tokens, API changes, and privacy model. What we provide is an **exit**; you point it at a webhook you already have.

Put `notifications.json` in the config directory:

```jsonc
{
  "sinks": [
    { "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
      "states": ["failed", "needs_approval"],   // empty = all
      "format": "feishu" },                     // feishu | slack | raw
    { "url": "http://127.0.0.1:9787/relay", "format": "raw" }
  ]
}
```

`feishu` / `slack` send the `{"text": "..."}` that both sides accept; `raw` sends the full task event,
and your own relay can transform it however it wants.

### The tradeoff, stated plainly

**Before this, the app made no outbound connection at all**, and that was part of its security. A sink sends
**a summary of what you are doing** to a third party. So:

- **It can only be changed by editing the file. There is deliberately no API.** Otherwise any process that can reach this bridge could point your task summaries
  at a server it chose — and that would turn the desktop pet into an exfiltration channel.
- **If the file does not exist, nothing is sent.** The default is still zero outbound traffic.
- **Only https is accepted**, or http on `127.0.0.1` (a local relay is the most common setup;
  requiring TLS to talk to yourself is pointless).

## Full interface list

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | **The only one without a token**: whether it is running, and where the token file is |
| GET | `/integration` | **The machine-readable version of this document; it wins** |
| GET | `/capabilities` | Every action / expression / theme / camera, plus a `source` mark |
| GET | `/status` | Skin, camera, size, visibility |
| GET | `/perception` | Position, state, expression, heading, intent, toy, health |
| GET | `/activity` | **What each tool is doing right now** (one line per tool, with its own logo) |
| GET | `/agents` | Registered agents + who currently holds the stage |
| POST | `/agents` | Register an identity and a logo |
| POST | `/task-event` | **The recommended main integration point** |
| POST | `/control` | Low-level direct drive |
| POST | `/intent` | Walk the cat to a coordinate |
| GET/POST | `/memory` | Memories about the owner |
| GET/POST | `/reminders` | Timed reminders (`mood` decides the expression on delivery; `repeatEveryMinutes` stays) |
| DELETE | `/reminders/{id}` | Cancel one reminder |
| GET | `/assets/status` | Custom-asset status and validation errors |
| GET | `/debug/events` | Task-event history |

---

## Two ways in, chosen by friction

### A. Skill + script only (recommended, lowest friction)

Every MCP tool call is an authorization surface: many hosts pop a confirmation **per tool**, so changing the expression three times in one turn means three confirmations.
A script is once. So we ship a CLI directly; the skill just carries it, and **you do not register an MCP server at all**:

```bash
integrations/cli/lingxi register claude-code --logo mark.svg --name "Claude Code"
integrations/cli/lingxi task running build "compiling"
integrations/cli/lingxi task completed test "all green"
integrations/cli/lingxi say "done"
integrations/cli/lingxi state          # prove it took effect
```

It reads the token itself; nothing to configure. `lingxi help` lists every subcommand, and `lingxi raw <METHOD> <PATH> [json]`
covers any endpoint that is not wrapped.

### B. MCP server

Better when the host wants a typed schema and wants to control permission per tool. See
[`integrations/README.md`](integrations/README.md).

Both roads use the same bridge, the same token, and the same contract.

---

## Integration self-check

- [ ] On startup, `POST /agents` registered an id plus an emoji you picked yourself
- [ ] Every call carries `agent`
- [ ] State is reported with `/task-event`, rather than you picking an action
- [ ] `priority` is set by how urgent the event is, not by how important you are
- [ ] On `stage busy`, you drop rather than retry
- [ ] Before writing `actions.json` / `expressions.json`, you checked `source`
- [ ] You do not change `skin` / `camera` / `scale` on your own
- [ ] After changing assets you `reloadAssets` and read `lastErrors`
- [ ] After driving, you prove it took effect from `/perception` or `/status`
