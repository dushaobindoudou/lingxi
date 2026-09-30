<!-- English translation of `docs/23-bubble-unread-and-copy.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# 23 · Bubble notifications and unread state — problem statement and one unified plan

> Compiled by: the dsh-lingxi plugin side (2026-09-25) · Status: awaiting app-side review and unified implementation
>
> Scope: this document only describes the problem and the plan. The dsh-lingxi plugin-side changes are implemented on their own and do not depend on the app side; every item marked "app side" has not been touched and waits for the unified optimization. Style changes that are already done stay as the baseline in the checklist (Appendix A) and can be re-reviewed together.

---

## 0. TL;DR

1. **Style**: the comic-book look of thick borders and large type is replaced by a healing baseline (1px hairline / 13px / soft shadows) and kept pending unification.
2. **Unread**: the core claim is **tiering** — "forgetting" a completed state costs almost nothing, and it is handled by being findable (panel archive + a summary on return); only to-do states (approval/input/failure) are worth a persistent marker on the cat. Backed by a state machine, click-the-cat replay, and 24h decay.
3. **Copy**: one bubble read in one breath. Mathematically, anything over ~27 characters is bound to "vanish before it is read"; the sweet spot is 12–25 characters; write like a friend: conclusion first, concrete nouns, emotion matching the facts, one thing per bubble, and to-do items must carry the next step.

---

## 1. Problem statement

### P1 Style: border too thick, type too large (fixed, pending the baseline)

How a bubble actually looks is decided by two layers on top of each other, and both used to push toward "comic style":

| Layer | Location | Before | Problem |
|---|---|---|---|
| Built-in default | `stage-fx.ts` `DEFAULT_BUBBLE_STYLE` | 2.5px near-black outline, 15px/600, hard shadow, springy overshoot entrance | the system voice's heaviness |
| User asset | `assets/bubble.json` | 3px bright teal `#0AC89F` + 16px + hard shadow | the thing users actually complained about |

Already changed to the healing baseline (details in Appendix A): 1px warm-grey hairline border, 13px/500, warm-white background, soft diffuse shadow (the spiky explosion bubble keeps its hard shadow — shouting should have impact), line-height 1.6, gentle entrance. **Please ask the app side to re-review and submit this together with the unified optimization.**

### P2 Unread and forgetting: dies the moment it is said, with no "remembered" form

Bubble lifetime: `hold = min(9000, 1800 + len×130) ms`, one bubble per fullscreen at a time, later ones push earlier ones out. Two failure modes follow:

- **A didn't see it**: the user is AFK, or a completed bubble gets pushed out by a later event → the completion is lost entirely and the cat never mentions it again.
- **B saw it but forgot**: the bubble showed and vanished, with no archive entry point and no persistent "N things unread" state.

The key tiering (this plan's dividing line):

| Unread type | Example | Cost of forgetting | Response |
|---|---|---|---|
| Completed | completed / cancelled | ≈0, the work is done | **findable**: panel archive + a summary on return |
| To-do | needs_approval / needs_input / failed / blocked | real: the flow is stuck on the user | **remembered**: a persistent marker on the cat |

Marking everything unread would turn the cat into a second notification centre, against the healing positioning.

### P3 Copy: double mismatch of length and information

- **Too long to finish reading**: not a feeling, it is arithmetic (§3.2). A 140-character truncation plus a 9s cap means a long sentence is doomed.
- **Too short to say anything**: no subject and no object ("done" — done what?), or system voice ("task #123 status changed to completed").

---

## 2. Unread plan (the app-side core)

### 2.1 State machine

```
task-event arrives
  ├─ bubble renders while the user is active (read the idle signal) → seen, flow ends
  └─ user idle/dormant, or pushed out by a later bubble     → unseen
unseen → acked: click the cat to replay / open the panel / the return summary arrives
unseen past 24h → demote to archive only (the cat lets go; the panel can still show it)
```

- The idle signal already exists: `PerceptionSnapshot.idleMs` (`packages/perception-contract/index.d.ts:36`); the activity atom is 0=active / 1=idle / 2=dormant (`lib.rs:4540`).
- Seen threshold suggestion: if `idleMs < 45_000` when the bubble renders, mark seen; tune the exact number with real data on the app side.
- Suggested: unread state lives as a **property of the task row** on the app side (task rows are created by task-events anyway); the plugin does not keep its own unread ledger.

### 2.2 Expression language

- **To-do unread**: a small dot plus a number above the cat's head (a healing-ized game quest marker) — cream background, thin brand-colour outline, breathing ease-in-out at a 3–4s cycle; never blink, never red; capped at `9+`.
- **Completed unread**: no marker. Handled by the plugin's return summary (§2.3) plus the panel archive.
- **Optional body language**: ears forward, occasionally looking at the user (`reactions.json` is config asset, but the "unread state → expression" trigger logic is on the app side).
- **Panel**: task rows get an unread dot; opening the panel acks everything.

### 2.3 Gesture slots

Current semantics (`main.ts`): drag = pick up and move; double-click = greet (head bump + heart + a line, `main.ts:536`); single click currently only records `click_on_pet` — **an empty slot**.

Suggestion: single click with a to-do unread → replay one line (reuse the existing bubble + source line, consume one at a time); no unread → keep the current petting reaction. Double-click unchanged.

### 2.4 Division of labour

| Work | Owner |
|---|---|
| idle gating + return summary (dsh event first cut) | **plugin side** (dsh-lingxi, planned, see §5) |
| Unread-dot rendering | app side (`stage-fx.ts` fx layer; anchor reuses bubble tracking) |
| Single-click replay branch | app side (`main.ts` click handling) |
| Seen determination (read idle at render) | app side |
| Panel unread dots + clear on open | app side (`management.*`) |

---

## 3. Copy plan: one bubble in one breath

The user's own words are the yardstick: **"it can't be a long chunk that vanishes before you finish reading it, and it can't be so short you don't know what it means. Like a normal friend: simple, clear, direct, and it can have emotion."**

### 3.1 Five friend-voice principles

1. **Conclusion first**: the first 5 characters must give the result or state ("fixed it", "stuck", "needs your move").
2. **Concrete nouns**: say "typert's 404", not "the build task"; names are shared memory, abstract nouns are noise.
3. **Emotion matches the facts**: task-event already carries 9 mood levels (focused/proud/tender/sad/frustrated/anxious/weary/playful/curious). A win can be "done, first try"; after three rounds say "three rounds and finally green". But not every line may be excited — emotional inflation is the same as no emotion.
4. **One thing per bubble**: the second thing is the next bubble, or a comma in the summary line.
5. **A to-do always carries the next step**: what is missing + what the user does ("one move from you: the command needs your OK"). Failures use the first person ("I'm stuck"), not blame of the user ("your command failed").

Short lines (≤8 characters) are allowed only when **shared context** was just established (the user just watched you fix something, "done" holds); agent-initiated announcements must carry the noun.

### 3.2 The arithmetic of length (why 27 characters is the line of life and death)

- Bubble survival: `hold(L) = 1.8 + 0.13L` seconds (capped at 9s).
- Comfortable reading: `need(L) = 0.8 (notice) + L/6 (Chinese ≈6 chars/sec)` seconds.
- Break-even: `L ≈ 27`. After that hold < need — "vanishes before it is read" is a certainty, not a feeling.
- Measured comparison: 40 characters (≈2 lines at 13px, 280px wide) needs 7.5s but only gets 7.0s; 60 characters needs 10.8s but only gets 9.0s.

Length ladder:

| Length | Positioning |
|---|---|
| ≤8 chars | a state flourish, only in shared context |
| **12–25 chars** | **the sweet spot, the default target** |
| 26–40 chars | the ceiling, within two lines |
| >40 chars | not allowed on a bubble: split into several, or a panel row + short bubble reference |

### 3.3 hold formula suggestion

Count lines rather than characters (lines are what real layout looks like; 13px/280px ≈ 21 chars/line):

```
hold = clamp(1.2s + lines × 2.2s, 3.2s, 12s); alert tier (to-do) floor 6s
+0.5s when there is a source line (logo + agent name)
```

Don't fight forgetting by stretching hold (that is torment); use §2's unread mechanism. hold only needs to guarantee "readable on the first pass".

### 3.4 Example library

| Tier | Anti-example (system voice) | Example (friend voice) |
|---|---|---|
| queued | added to the task queue | got it, noted: watching 12306 for you |
| running | the task is executing | running typert's tests, will call you |
| completed | task completed successfully | typert's 404 is fixed, all green |
| completed·proud | build pipeline finished | done, first try |
| completed·weary | task completed | three rounds, finally green |
| failed | execution failed, exit code 1 | stuck: the flaky test timed out a third time, I'm keeping the scene |
| needs_approval | awaiting user authorization | one move from you: the command to run needs your OK |
| needs_input | awaiting user input | want to check something with you: A or B? |
| return summary (3 items) | completed 3 tasks | just now all three are done: 404 fixed, release packaged, memory tidied |

Rule: at most one number per bubble, and it must be part of the conclusion ("all 142 tests green" ✓, "finished 142 cases in 3m 24s" ✗ — the latter goes in the panel).

### 3.5 Anti-pattern checklist

- A chunk over 40 characters; number piling (percentages / durations / task IDs all at once).
- System-voice nouns: 'task', 'execute', 'status change', 'successfully completed'.
- Emoji bombing (at most one; healing comes from tone, not emoticons).
- Subjectless short lines in agent-initiated announcements ("done").
- Every completion as a long sentence (dedup already exists per (task,state), but the tier must follow too: the second announcement of the same task should be shorter).

---

## 4. Acceptance criteria

1. Any `say` ≤ 2 lines and ≤ 40 characters (the plugin smoke can add an assertion; the app side splits or demotes to panel + short reference for anything too long).
2. A completion event during AFK shows up **exactly once** as a summary after the user returns to active.
3. To-do unread: visible on the cat → clicking the cat must reach it → acks disappear; auto release after 24h.
4. Style baseline unified to Appendix A (1px / 13px / soft shadow / line-height 1.6).
5. Double-click greet and drag-move semantics unchanged; single click behaves like today when there is no unread.

---

## 5. Interface with the plugin side

**Already planned on the plugin side (no app change needed)**: dsh-lingxi's `notify.js` queries `GET /perception`'s `idleMs` before sending a completion-tier say: user active → send as usual; idle/dormant → hold, and after the user returns active send one merged summary (the ladder hooks into the existing per-(task,state) dedup).

**Open decisions (for the app side)**:

1. Who owns the summary: the plugin summary only covers dsh events and can ship first; the long-term suggestion is a unified app-side summary (covering all agents), with the plugin as the fallback. If the app side takes it over, the plugin drops its own summary logic.
2. Where unread state lives: suggested on the app-side task row (§2.1); the plugin keeps no ledger.
3. Gesture map: single-click replay / double-click greet / drag move are already full; a future "single click opens the panel" needs a global rearrangement first.

---

## Appendix A · The baseline already kept (in the workspace, uncommitted)

- `apps/lingxi/src/fx/stage-fx.ts`
  - `DEFAULT_BUBBLE_STYLE`: `borderWidth 2.5→1`, `border #2f2a33→rgba(47,42,51,0.3)`, `text #2f2a33→#4a4149`, `accentText #675666→#8c7b6b`, `fontSize 15→13`, `fontWeight 600→500`, `radius 16→18`.
  - Shadows split by shape: spiky keeps the comic hard shadow; round/rect/cloud switch to `0 2px 6px rgba(47,42,51,.07), 0 14px 32px rgba(47,42,51,.13)`.
  - Body type: `line-height 1.45→1.6`, `letter-spacing .01em`, `padding 10px 14px→9px 15px`.
  - Animation: entrance `240ms overshoot spring→260ms cubic-bezier(.22,1,.36,1)`, `scale .5→.92`; exit `-12%/.86→-8%/.94`.
  - Source line: `.78em/700→.82em/600`, `letter-spacing .02em`, gap 6px, margin-bottom 4px; mark/badge 22→20px.
- `apps/lingxi/src/rig/custom-assets.ts`: doc example `borderWidth 3→1`, `fontSize 16→13`, `fontWeight 500→400`.
- User asset `assets/bubble.json`: warm-white background `#FFFDF8`, `#4A4149` body, `rgba(47,42,51,0.3)` 1px border, 13px/500, radius 18.
- Verified: `tsc --noEmit` passes; `npm test` 142/142 pass. Effect: a rebuild is needed to package; `POST /control {"reloadAssets": true}` hot-reloads assets (bubble.json without restart).

## Appendix B · Survey of current mechanisms (the plan's foundation)

| Mechanism | Location | Relation to this plan |
|---|---|---|
| `idleMs` | `perception-contract/index.d.ts:36`; `GET /perception` (`lib.rs:3216`) | the signal source for seen determination and the plugin's idle gating |
| Activity atom 0/1/2 | `lib.rs:4540` | app-internal active determination |
| single/double click, drag | `main.ts:504,536` | the current gesture slots |
| Task row (task-event row) | app-side task model | the host of unread state |
| `reactions.json` / expression library | user asset | the config layer of body language |
| `POST /control {"reloadAssets":true}` | `lib.rs` `/assets/status` | style hot-reload, iterating without restart |
| Bridge endpoints | `/control /task-event /agents /reminders /perception /memory` | **no style endpoint**: the plugin cannot change bubble rendering; style can only go through asset config |
