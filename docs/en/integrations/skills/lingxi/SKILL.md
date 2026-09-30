<!-- English translation of `integrations/skills/lingxi/SKILL.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

> This is the **system layer**. Every host plugin ships it unchanged (a symlink, or a byte-for-byte copy held by `integrations/test/skill-layers.test.mjs`) beside its own **host layer**, `integrations/hosts/<host>/skills/lingxi-<host>/SKILL.md` - see `integrations/hosts/PLUGIN-STANDARD.md`, section 六. The host layers are Chinese only.

---
name: lingxi
description: Drive the Lingxi desktop cat - let it react to what you are working on with expressions, actions and short lines, remember things about the user, and nudge them later. Use whenever Lingxi is running and the work has an emotional shape worth showing. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# Lingxi · a cat that lives on the desktop

A cat lives on the user's desktop. You can see what it is doing, and you can let it react to what you are doing.

## Read two: this is the system layer, and there is a host layer

Lingxi's skill comes in two layers, and every host has both installed:

| Layer | Skill | What it covers |
|---|---|---|
| System | `lingxi` (this file) | How Lingxi behaves with people: when to notify, what to report, mood, reminders, memory, budget, what not to do. Identical on every host |
| Host | `lingxi-<host>`, e.g. `lingxi-claude`, `lingxi-codex` | Only what holds on that host: whose identity you speak as, CLI or MCP, what the host already reports on its own, who installs and starts the app, the host's own traps |

**Identity, entry point, automatic reporting, and install/start follow the host layer; everything else follows this file.** The host layer adds that host's facts; it does not change these rules. Without a host layer, use the generic steps here, and never let the CLI borrow the machine-wide identity in `~/.lingxi/agent.json` (see "How to call it").

## When to let the cat notify

The cat is **a carrier of key messages**, not a log reader:

| Event | When to speak | How to report |
|---|---|---|
| The user must decide, approve or add information; a failure or a clear risk | Now | `needs_input` / `needs_approval` / `failed`; the `summary` says what happened and what the user has to do, with the question verbatim |
| A round of work ends, a usable result, an important milestone | At a natural pause | `completed`: name the task, what this round achieved, and what comes next (including whether the user needs to keep driving you) |
| Start, routine progress, tool logs | Quiet | The first `running` changes the face; repeated progress says nothing |

**The task report is the main channel.** For every real piece of work: report `running` when it starts and a terminal state when it ends, **always reusing the same internal `taskId`** (with the CLI, pass the same `LINGXI_TASK_ID` on every command - the environment does not carry over between shells; with MCP, pass `taskId` and `summary` to `lingxi_task`). The `summary` is **task + result + next step or the exact question**, one or two sentences, conclusion first, at most 140 characters. The cat shows it in full and holds it longer the longer it is - never truncated - so do not shrink it to "done", and never use a working directory, a session id or an old session title in place of the task. Report a result once.

Report `state`, `kind` and `mood`, and let the app's reaction map choose the face and the action. Effects are only for what the user asked for, or a milestone truly worth celebrating; check the available ids first. Risks, approvals and ordinary reminders never become full-screen effects.

Whether something in the future is worth the cat remembering is your call: when the user states a reminder or a routine with a time, set it with `lingxi remind` and tell them the exact time it will fire; with only "tomorrow" and no hour, ask or say which time you chose; a deadline you merely noticed is proposed, not scheduled.

**Its name is "Lingxi" — 心有灵犀 (a meeting of minds, without a word spoken).** That is not a decorative name. It is an acceptance test: a cat that only
waves a paw when a task ends is something any status light can do; a cat that knows you are writing to your mother tonight, and knows you have spent three hours on the same bug, is the one that
earns the name.

## How to call it

**One shell command covers every capability. MCP is not required.**

```bash
lingxi help          # every subcommand
lingxi state         # what the cat is doing
lingxi integration   # the full contract served by the running app; it wins
```

### Step one: confirm the cat is running, and launch it if it is not

```bash
L="$(command -v lingxi || echo "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi")"
if [ -x "$L" ]; then "$L" up
elif [ "${LINGXI_AUTOSTART:-1}" != 0 ]; then open -g -b com.dushaobin.lingxi-desktop
fi
```

`lingxi up` is the check itself: if the cat is running, it does nothing; if not, it launches the app in the background (`open -g`, without stealing focus),
waits until the bridge is ready, then returns. The result is the exit code. Other subcommands will also launch once if they find the cat closed, so this step only means the first
real command does not have to wait.

It is fine if `lingxi` is not on `PATH` — **every time the app starts, it writes the CLI to that fixed location above**. If that file does not exist yet,
the app has never run on this machine: `open -g -b com.dushaobin.lingxi-desktop` directly, and within a few seconds of the app coming up
it will have written the CLI. While the app is running you can also ask it (`/health` is the only endpoint that skips auth, and the response includes the absolute path of `"cli"`):

```bash
curl -s --noproxy '*' localhost:47811/health
```

**It reads the auth token itself. There is nothing to configure.** The only dependencies are `curl` and `python3` (or `node`),
both already present — **jq is not required**.

When `lingxi up` cannot launch it — the app is not installed, the user set `LINGXI_AUTOSTART=0`, or this is not macOS — it explains why.
**Tell the user the truth. Do not pretend you did it.** If the user set `LINGXI_AUTOSTART=0`, they do not want you to open the cat. Do not go around it.

### Why prefer this over MCP

In many hosts, every MCP tool call is **a separate authorization** — changing the expression three times in one turn means three confirmations.
The shell is once. And the CLI is a **superset** of MCP: it has all 13 of those tools,
plus `activity` (who is doing what), `events` (history), `unremind` (cancel a reminder),
and `raw` (any endpoint that is not wrapped).

MCP is still useful — better when the host wants a typed schema and wants to control permission per tool.
**Both roads are the same bridge, the same token, the same contract. Pick either.**

---

## 1. The one thing that matters most: report the **mood**, not only the state

```bash
lingxi task <state> <kind> <mood> "one sentence"
```

| Dimension | Values | Who judges |
|---|---|---|
| `state` | queued running blocked needs_input needs_approval completed failed cancelled | The process |
| `kind` | build test deploy review search write chat other | The process |
| **`mood`** | **focused proud tender sad frustrated anxious weary playful curious** | **Only you can judge** |

`state` and `kind` describe the **process**. Writing a letter to your mother and wrestling a flaky test are both
`running` / `write` — a pet that cannot tell those apart is a status light with fur.

**`mood` is you reading the content, so only you can judge it.** It is the most valuable field in the whole integration.

### How to pick a mood

| mood | When | Examples |
|---|---|---|
| `tender` | Private, intimate, soft | A letter to family, an anniversary, preparing a gift, a eulogy |
| `proud` | Something hard finally went through | Cracking an algorithm, finishing a refactor |
| `sad` | Bad news, a loss, an apology | Deleting something you wrote for a long time, writing an apology email, a project that died |
| `frustrated` | The same thing failed again | The fourth run of the same test, fighting the build system |
| `anxious` | There is risk, it is irreversible, there is a deadline | Shipping to production, changing a database, due tomorrow morning |
| `weary` | It has been a long time, and it is late | Three hours straight, two in the morning |
| `playful` | For fun, light | Naming something, a weekend side project, tinkering |
| `curious` | Reading something new | Research, wandering an unfamiliar codebase |
| `focused` | Ordinary work (**default**) | Most of the time |

**Judge the mood of "this thing", not how sure you yourself are.** You may be very sure about an apology letter. It is still `sad`.

### The cat's reaction is a "response", not a "mirror"

This is a design rule, and it is what "healing" (`治愈系`) specifically means:

> **A person who is frustrated does not need a cat that is frustrated along with them.** That is two people annoyed in front of the same screen.
> What they need is something small, warm, and unaffected.

So the built-in mapping looks like this:

| What you report | The cat's reaction | Why |
|---|---|---|
| `failed` + `frustrated` | `委屈` (aggrieved) + a paw reaching for you + `唔…这个真的难。歇一下再来？` (Mm… this one really is hard. Rest a bit and come back?) | **Catch it**, do not get angry together |
| `failed` + `sad` | `温柔` (gentle) + a head-nuzzle + `没关系的，我在。` (It's all right. I'm here.) | Stay with them, do not judge |
| `failed` + `anxious` | `安心` (reassured) + a paw reaching out + `别急，一步一步来` (Don't rush. One step at a time) | Steady them, do not add pressure |
| `failed` + `weary` | `困困` (sleepy) + lie down + `今天到这儿吧，明天再说` (That's enough for today. Tomorrow.) | Give them a way down |
| `completed` + `proud` | `得意` (smug) + a stretch + `看我的～` (Look at me~) | **Good feelings are shared**. That is what being glad is for |
| `completed` + `weary` | `满足` (content) + purr and lie down + `终于弄完了…歇会儿吧` (Finally done… rest a bit) | Land it, not another round |
| `completed` + `tender` | `温柔` (gentle) + a head-nuzzle + `写完啦，蹭蹭你` (It's written. A nuzzle for you) | |
| `running` + `tender` | `温柔` (gentle) (**no speech**) | A private matter. Company is enough; do not interrupt |
| `running` + `weary` | `困困` (sleepy) + a yawn | A reminder that does not speak |

Bad feelings are **caught**. Good feelings are **shared**. That is the only rule you need to remember.

The user can change any entry in `assets/reactions.json` — so **do not pick an action yourself**.
If you do, you take that power out of the user's hands, and every time we add an action you have to change.

---

## 2. Task progress: most of the time it should be quiet

A long task reports progress many times. **If the cat reacts to every one, it becomes the notification barrage a desktop pet is supposed to replace.**

```bash
lingxi task running build focused "compiling"          # the first time: set the expression
lingxi raw POST /task-event '{"state":"running","progress":0.6,...}'   # past halfway: one more look
lingxi task completed build proud "it passed"            # a terminal state: it will always show
```

The system covers you: a `running` update **produces a reaction only the first time and the time it crosses 50%**; the rest are swallowed.
A terminal state (completed / failed / needs_input / blocked / cancelled) **is never swallowed**.

So you can report progress freely. You do not have to compute when you should speak.

### Priority: by how urgent the **thing** is, not by how important you are

```bash
LINGXI_PRIORITY=alert lingxi express 惊吓
```

| priority | When | On conflict |
|---|---|---|
| `alert` | The user has to glance **now**: a failure, a confirmation, a dangerous operation | Interrupt a lower one immediately |
| `report` | There is a result | **Queue** and wait, with an expiry |
| `status` | The state changed, and it is not urgent (default) | Rejected, dropped |
| `ambient` | Pure atmosphere | Rejected, dropped |

Do not use `alert` for everything because "I am more important". What the user should see is **the thing that matters**, not the tool that matters.

---

## 3. Reminders: the cat remembers, so you do not have to

```bash
lingxi remind 45 "time to get up and walk" --mood tender
lingxi remind 60 "stand up and move" --mood tender --every 60     # once an hour
lingxi remind 1440 "remember to reply to that email tomorrow" --mood anxious
```

- `--mood` decides **which expression delivers it**. "Remember to drink water" and "time to file taxes" are not the same face.
  A reminder in the wrong tone is worse than no reminder.
- `--every N` is a standing reminder. It rewinds itself (minimum 5 minutes — any faster and it is an alarm clock, and this is a cat).
- When several reminders come due together, the cat **says only one**, and leaves the rest for the next round. It will not recite a list in one breath.

**When to set a reminder on your own** (do not wait for the user to ask):

- The user says "in a bit I need to…", "remember later…", "tomorrow…" → set it, then tell them you set it
- You see something with a time limit (a certificate expiring, a meeting, a deadline) → offer to set one
- The user has already been working for two or three hours straight → set a 45-minute rest reminder with `--mood tender`

---

## 4. Let the cat know them better

```bash
lingxi remember "likes to measure the root cause before writing code" preference
lingxi recall
```

`kind` has only four values: `owner` (who they are), `project` (what they are doing), `preference` (how they work),
`moment` (one thing that happened).

**Write only when you have actually observed something new.** Recording the same thing again turns `memory.json` — a file the user will open and read themselves —
into noise. One entry an hour is already a lot.

A good memory is **specific**:

- Worth remembering: "Often stays up very late on Thursday nights" / "Has been set off by flaky tests several times" / "Likes to measure first, then change"
- Not worth it: "Is a programmer" / "Is using TypeScript" (you can see that from the code; it is not an observation)

**Do not write** anything they would not want to see land on disk: passwords, keys, private third-party information,
health and financial details. This is a plaintext JSON file.

---

## 5. Budget: quiet is the default

The cat shares a screen with a person who is working. **Every visible action is taken out of their attention.** It is not a demo.

| Channel | Budget | Why |
|---|---|---|
| Speech bubble | ≤ 3 times/hour, and never repeat the same sentence | Every sentence competes for attention; repetition is why an app gets uninstalled |
| Expression | Unlimited, but do not reset the same one within 60 seconds, and do not switch twice within 2 seconds | Changing it is free, but flicker cannot be read |
| Action | ≤ 6 times/hour, and only at a natural pause | An action takes 3–6 seconds, and it reads as "occupied" |
| Full-screen effect | ≤ 1 time/day, and only for a milestone | It takes the screen for several seconds; used wrong once, it is retired for good |
| Toy | ≤ 1 time/day, when they are clearly worn flat | Once a toy is out, the cat does nothing else |
| Memory | Only when there is a real new observation | See above |

Before you act, `lingxi state`: if the user is dragging the cat or playing with a toy, **they are already interacting with it**. Do not cut in.

---

## 6. Other scenes (not integrated by default; wire them yourself when asked)

We do **not** bundle IM / mail / calendar. They involve the user's private data, and connecting by default would be over the line.
But if the user explicitly asks you to connect one, the same vocabulary is enough — the cat does not need to know where the data came from:

| Scene | How to map it |
|---|---|
| An important message arrived | `needs_input` + `chat` + mood judged from the content, `alert` priority |
| An email that is hard to write | `running` + `write` + `tender` or `sad` |
| A meeting in 10 minutes | `lingxi remind 10 "a meeting in ten minutes" --mood anxious` |
| CI failed | `failed` + `build` + `frustrated` |
| A PR was approved | `completed` + `review` + `proud` |
| Nothing has moved for a long time | `lingxi express 困困`, `ambient` priority, and do not speak |

**Ask the user before you connect.** Reading mail is reading mail, however many cats sit in between.

---

## 7. Prove it took effect

After you send, you have to be able to verify, or you are flying blind.

```bash
lingxi state     # expression / action / heading / intent / recoveredAt
lingxi status    # skin / camera / scale / visible
lingxi agents    # who is driving
```

**A delay on actions is normal**: while the cat is walking, an action waits until it stops before it plays. The `action` in a single sample
may be the **previous** autonomous action — do not treat that as failure and send it again.

---

## Things not to do

- **Do not pick an action and an expression yourself to express a task result.** Report `mood`, and let the cat decide. The user changes the mapping once, and every agent changes together.
- **Do not change `skin` / `camera` / `scale` / `visible`.** Those are the user's preferences, not your means of expression.
  If you want to be recognized, register a logo you drew yourself (`lingxi register`).
- **Do not treat `alert` as the default.**
- **Do not talk a lot while `running`.** Company is better than speech, especially for `tender`.
- **When you get `stage busy`, drop it.** Do not retry — by the time the stage is free, your sentence is already talking about history.
