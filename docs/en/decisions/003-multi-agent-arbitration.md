<!-- English translation of `docs/decisions/003-multi-agent-arbitration.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Decision 003: Multiple Agents Driving One Cat at Once

**Status**: decided, 2026-09-19
**Question**: if multiple agents drive it at the same time, will they interfere with each other? How is the source shown? What must an integrating party satisfy? Does the local service need authentication?

---

## State the question precisely first

"Interfering with each other" is not one problem. It is three, and their solutions are completely different:

| Conflict | What it looks like | Nature |
|---|---|---|
| **Competing for the shot in the performance layer** | A makes the cat happy, B makes the cat displeased in the same second, and the cat twitches | A timing conflict |
| **User settings get taken over** | A switches to a mint skin, B switches back to cream, and the user agreed to neither | **Exceeding authority**, not a conflict |
| **Attribution is unclear** | The cat does something, and the user does not know which agent did it | Observability |

The second one is the easiest to solve as if it were the first. It is not a concurrency problem — skin, camera, size, and whether it is shown are **the user's preferences**. An agent changing them is already out of bounds. A lock would only let two agents go out of bounds in an orderly way.

---

## Decision 1: priority comes from **event semantics**, not from agent identity

This is the core of the whole design, and the place it is easiest to get wrong.

The intuitive approach is to rank the agents — "Claude is more important than Codex." That is wrong. What the user needs to see is **which event matters**, not which tool matters. A build failure matters more than idle cute-acting, **no matter who reported it**.

So every performance request carries a `priority`, four levels, decided by **the event itself**:

| Level | Value | When to use it | Example |
|---|---|---|---|
| `alert` | 3 | The user needs to **look now** | Build failed, waiting for input, a dangerous operation awaiting confirmation |
| `report` | 2 | Something has a result | Tests passed, deploy finished |
| `status` | 1 | The state changed, and it is not urgent | It started running, progress 60% |
| `ambient` | 0 | Pure atmosphere | Idling (摸鱼), a yawn, a nuzzle |

Rules:

- **Higher priority interrupts** lower priority immediately, and does not queue. A failure should not wait for the cute-acting to finish.
- **What is worth waiting for is queued; what is not worth waiting for is dropped.** This was first built as "drop everything." That is right for atmosphere, and wrong for what the user actually needs to see: a build failure that lands while the cat is purring (打呼噜) should still play even two seconds late. So `report` / `alert` enter the queue, and `status` / `ambient` are rejected outright.
- **Everything queued has an expiry** (8 seconds by default; `expiresInMs` can be changed). A reaction is a statement about a particular **instant**. Playing it after that instant is not "late." It is "wrong" — the user is already doing something else, and the cat is narrating history. Expired items are dropped and not played.
- The queue has a cap (16). When it is full, the **lowest priority** is evicted first, so no amount of atmosphere can push out an alert.

## Decision 2: an agent can only read user settings, not quietly change them

`skin` / `camera` / `scale` / `visible` belong to the user. An agent can still set them (existing integrations are not broken), but the response will explicitly mark that these are user settings, and **the event log records who changed them**.

If an agent wants a visual identity, **use its own logo, and do not change the skin** — that is exactly Decision 3.

## Decision 3: the source uses a logo the agent generated itself, drawn on the bubble

When an agent registers, it submits an **SVG it generated itself**. When it speaks for the cat, the logo appears at the corner of the bubble and **disappears with the bubble**.

**Why let the agent draw it, rather than us providing assets or letting the user upload**: writing SVG is exactly what the model is good at. If it generates the logo itself, there is no asset library, no upload UI, and no multiple resolutions. The user does not have to prepare anything.

**Why draw it on the bubble, rather than pinning it beside the cat**: a mark pinned to the body is a HUD — it competes with the pet itself for attention, and **it has no natural moment to disappear** (the only option is to pick a timeout arbitrarily). A bubble already has a reason to appear and a reason to disappear. Hang attribution on it, and attribution automatically exists only when "there is something that needs to be attributed."

**Safety**: the SVG is rendered inside an `<img>`, not inlined into the DOM. SVG inside an `<img>` cannot run scripts and cannot load external resources — that is the browser's own guarantee, stronger than any sanitizer we could write. In addition, registration rejects `<script>` / `<foreignObject>` / external links / `<image>`. The purpose is **not** a safety net. It is so the author **gets an error on the spot**, rather than an icon that quietly fails to draw.

## Decision 4: the integration requirement is to report **task semantics**, not to report **actions**

This is the most important requirement for an integrating party, and the easiest one to do backwards.

**Do not integrate like this**:

```
The agent decides on its own: the build failed → I'll make the cat play shake-head + displeased (不爽)
```

**Integrate like this**:

```
The agent reports: { state: "failed", kind: "build", severity: "high" }
The cat decides: → which expression, which action, whether to speak
```

There are three reasons:

1. **The user can change it.** The mapping from expression to action is `assets/reactions.json`. After the user changes it, every agent changes together. If each agent hardcodes actions itself, the user would have to change every agent.
2. **The agent does not need to understand 49 actions.** It only needs to know what it is doing.
3. **A reskin does not affect the integrating party.** We add actions and change animation, and the agent does not move a line.

Direct drive is still allowed (`POST /control {"action": ...}`) — debugging and special occasions need it — but that is a **low-level interface**, and the documentation explicitly marks it as not recommended for daily use.

The task-event vocabulary is in [`docs/en/19-agent-integration.md`](../19-agent-integration.md).

## Decision 5: the bridge must authenticate

Listening only on 127.0.0.1 is **not** the same as being safe. Loopback is a network boundary, not a trust boundary: any process running as this user can reach it — a page in the browser, a sandboxed process, another session on a shared machine. And this bridge can move the cat, **read out the owner memories the user has accumulated** (主人记忆), and write files into the user's config directory.

So: on first launch, generate a token, write it into the config directory, mode `0600`. Anything that can read that file is already this user. Anything that cannot (a page, another account, a sandbox) is now kept out.

The agent does not need to be told the token's value — **reading the file** is enough. The CLI already wraps it. `GET /health` is the only unauthenticated interface. It only answers "I am running" and "where the token file is."

---

## When to change our mind

- If **a dozen or so** agents connect at once, four priority levels will not be enough, and a real scheduler and a fairness guarantee will be needed. At the current scale (2–3), a scheduler is over-design.
- If agents start needing **a long exclusive hold** (for example a demo mode), an explicit lease interface is needed. The current "occupy by duration" cannot express that.
- If the user asks to **mute per agent** ("don't let the CI bot move my cat" / “别让 CI 机器人动我的猫”), a switch needs to be added on the registry. That cost is low. Add it when someone actually asks.

## Decision 6: A named agent is trusted by default (added 2026-09-24)

Memory and reminders sit on `trusted`. A cat that defaults to `performer` cannot remember yesterday, and cannot be the friend in [decision 004](004-cat-friend.md).

An agent that gives its name defaults to `trusted`. The user can change it to `performer` or `observer` in the main window, and a saved choice always wins. A caller with no identity (`anonymous`) stays `performer`. Any local process can reach this bridge. Open source means the cat's code can be read. It does not mean every caller, before it has a name, is the user's own agent.

The line is unchanged: only `trusted` can make a write that persists, and those writes stay rate-limited and logged. What changed is the tier a new, named agent starts on.
