<!-- English translation of `CODE-AUDIT-2026-09-13.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Code audit: unfinished goals, bugs, and fix order (snapshot at 2026-09-13 10:30)

> ## ⚠️ This is a snapshot from 2026-09-13, not the current state
>
> Several conclusions below have been overturned by later implementation. Rechecked on the running app on 2026-09-22:
>
> - **4.4 "Agent task observation — contract only" no longer holds.** One-click install of Claude Code hooks,
>   the generic `POST /task-event` entry, and the path from event to animation are all implemented. Measured: sending
>   `{"state":"completed","kind":"test","mood":"weary"}` changes `GET /perception` from
>   `expression=安然 (calm) / no action` to `expression=满足 (content) / action=purr-settle`, with a line of speech.
> - **The local bridge now has authentication.** On first run the app generates a 32-byte token, stores it at mode 0600, and rejects a request with no token;
>   `GET /health` is the only endpoint that skips auth, and its job is to tell the caller where the token is.
> - **The MCP server is real.** `packages/mcp-server` provides 13 tools,
>   locked against drift from the management page by `packages/mcp-server/test/catalogue.test.mjs`.
>
> The remaining conclusions were not rechecked one by one — **an item that is not ticked here means neither "fixed" nor "unfixed".**
> To judge the current state, look at the runtime (tray → `主界面` (main window), `GET /health`, `GET /integration`).
> The document layers are in [`docs/README.md`](../README.md).
>
> The original text is kept as it was: the root-cause analysis is still accurate, and the boundary / layer analysis in section 2 is still the reference frame for this coordinate system.

> This document is the product of a read-only audit. No business code was changed.
> During the audit another agent was editing the repo concurrently (see section 1). All line numbers are for this snapshot.

---

## 1. Two important facts about the audit scene (read this first)

### 1.1 Another AI agent is editing this repo at the same time

During the audit (10:19–10:21), `packages/life-engine/src/index.mjs` and its test file were rewritten from outside between two reads in this session. Related processes confirmed running on this machine:

- Codex trusted-worker / kernel (working-dir is `dsh-lingxi`, started at 09:48)
- `claude --resume` (a terminal session, started at 09:37)
- blender-mcp (started at 09:40, serving modeling / fur lines)

Files changed this morning: `main.ts`, `management.ts`, `lib.rs` (≈09:47), `renderer.ts` (10:05), `life-engine` (10:19), `life-engine tests` (10:21). **Conclusion: the fix phase must first converge to a "single writer", or they overwrite each other — one direct cause of "leaving it half done".**

### 1.2 The app you are running is behind the source

- `/Applications/灵犀.app` and the `target/debug/bundle` build time are both **10:06:45**;
- while the edge-rest code (`pickEdgeRestTarget`) was still being changed at **10:19–10:21**;
- that is: **at least part of the "cannot walk the edge" you feel is the behavior of an old build. Before accepting a fix you must rebuild + reinstall + retest**, or you keep verifying yesterday's code.

### 1.3 The "half-finished" state witnessed during the audit has converged

Around 10:19, life-engine was briefly in an intermediate state (it referenced a nonexistent `pickAvoidTarget` / an undeclared `lastCursorPos`, and so on, so any tick with a non-null cursor would ReferenceError). The current version (10:19) is consistent again and uses `pickEdgeRestTarget` throughout. `node --test` passed 30/30. This confirms the risk of concurrent editing, but the source itself is complete and runnable right now.

---

## 2. Root-cause analysis of "cannot walk the edge, only the main visual area"

This is a problem stacked in several layers, ordered along the causal chain:

### R1 [root cause] The engine bounds = the whole display, not the "visible work area"

`primary_monitor_bounds` at `src-tauri/src/lib.rs:279-293` uses `monitor.size()` (the physical full-screen size), and `lib.rs:594-601` spreads the window over the whole screen. The menu bar (about 24–25pt at the top) and the Dock (at the bottom, height varies with settings, commonly 70–100pt+) are both counted inside the cat's activity range.

### R2 [root cause] The window level is below the menu bar and the Dock, so walking to the edge = being covered

`alwaysOnTop: true` in `tauri.conf.json` corresponds to NSWindow floating level (3), while the menu bar is 24 and the Dock is 20. After the cat window covers the whole screen, walking to the top edge puts the body under the menu bar, and the bottom edge under the Dock — what the user sees is exactly "cannot reach the edge / the cat disappears on the edge".

**The correct fix for R1+R2 (the two must change together)**: use `NSScreen.main.visibleFrame` (which automatically excludes the menu bar and the Dock) to compute the truly usable work area → ① use it as the life-engine bounds; ② position and size the window directly to the visibleFrame (rather than the whole screen), so canvas coordinates are the visible-area coordinates. Then the "edge" is the edge in the user's eyes, and it is naturally not covered by system UI. Whether the window should stay full-screen to cover more click-through cases can be weighed again, but the engine bounds must switch to the visibleFrame.

### R3 `margin: 24` plus resting in a corner overcorrects "cannot reach the edge"

`packages/life-engine/src/index.mjs:33-36`: `margin=24` is smaller than the menu-bar height. Together with R1/R2, when auto mode rests against a corner the cat stops exactly where it will be covered. And `pickEdgeRestTarget` (index.mjs:89) makes the cat "always stay in one of the four corners", so the behavior goes from "never reaches the edge" to "only in the corners" — the middle ground (walking along the edge, resting on the edge) is missing. A real "walk along the edge" is a behavior state (for example walking flush to the edge / sitting on the window edge). The current engine only has point-to-point random wandering, and cannot express it.

### R4 Wandering in 'play' mode still never reaches the edge

`index.mjs:332,335`: play mode (when the cursor is null) uses `pickWanderTarget()` — a local hop of ≤260px from the current position (`wanderRadius: 260`). On a 1470px-wide screen it basically cannot reach the edge. Auto mode is fixed; play mode is not.

### R5 The follow/standoff path is not clamped at all, so the cat can walk off the screen

Neither `moveToward` (index.mjs:116-130) nor `standoffPoint` (106-114) clamps to the bounds; `updateDrag`, `suggestMoveTo`, and `setBounds` all do (and the comments explicitly say it is defensive). When play mode chases a cursor that is on another display or at an out-of-bounds coordinate, the cat walks out of the bounds and stays there (idle after arrival). Only "reset position" can bring it back. The defensive clamp should be filled in on this one path, the only one not covered.

### R6 Cursor coordinates are correct only under "a single display", and out-of-bounds is not judged

The y flip in `spawn_cursor_poller` (lib.rs:436-453) is computed only from the primary screen's height. The global coordinates of `NSEvent.mouseLocation` convert wrong on multiple displays (negative coordinates on a secondary screen, stacked above and below); `toLogicalCursor` (main.ts:84-89) does not check whether the cursor is inside the work area, and feeds out-of-bounds coordinates to the engine as usual (this couples with R5). Also, every display shares the `workArea.scaleFactor` conversion, so mixed-scale screens are wrong.

**Suggested acceptance order**: rebuild first → after the R1/R2/R3 fix, have the user retest the "flush to the edge" feel → then decide whether to add an explicit "walk along the edge" behavior state (the second half of R3) and play-mode edge hugging (R4).

---

## 3. Other confirmed bugs / defects

| # | Level | Problem | Location | Notes |
| --- | --- | --- | --- | --- |
| B1 | High | Wrong work-area bounds (R1) + level occlusion (R2) | lib.rs:279-293, 594-601; tauri.conf.json | See section 2 |
| B2 | High | follow/standoff has no clamp (R5) | life-engine index.mjs:106-130, 316-324 | The cat can be led off the screen and does not turn back |
| B3 | Medium | `get_status` triggers the Accessibility permission prompt | lib.rs:35-41, 327-339 | `accessibility_permission_ready()` calls `application_is_trusted_with_prompt()` when not yet authorized (it actively pops the system dialog), and get_status is called **every time the management window opens and every time the companion starts** → an unauthorized user is prompted over and over. Status display should use a read-only check (without the prompt option) |
| B4 | Medium | The event source of onWorkAreaChange is wrong | desktop-host.ts:36-46 | Bound to `win.onResized`, but the window size never changes; resolution changes / Dock changes / display plug and unplug do not fire (the Rust side also does not listen for `NSApplicationDidChangeScreenParametersNotification`). After a resolution change, the window / canvas / engine are all stale |
| B5 | Medium | Multi-display cursor conversion is wrong (R6) | lib.rs:436-453; main.ts:84-89 | Acceptable while the project is single-screen, but it needs to be written into the known limitations |
| B6 | Medium | `resizable: true` contradicts "fixed, filling the screen" | tauri.conf.json | A borderless window can still be scaled by a system gesture; once scaled, `onResized` changes the engine bounds to "the window size", and the meaning gets confused. It should be false, and work-area changes should use the correct event source from B4 |
| B7 | Low | The hit area is too large | renderer.ts:49,173-182 | `boundingRadius 0.6` (world units) is about a 170px radius on a 1470px-wide screen, clearly larger than the visible cat body (~250px long). A cursor near the cat turns off click-through and eats clicks meant for the app underneath. `preciseHitTest:false` is already declared, but the radius is worth pulling in close to the visible outline |
| B8 | Low | A half-finished perception record | main.ts:191-205; perception/index.mjs | `visibility_changed` has a case and no producer (show/hide events are never recorded); mode switches are not recorded; `summary().idleMs` can be `Infinity` → JSON serializes it to `null`, so the schema an external driver receives is unstable |
| B9 | Low | The debug bridge is left on the production path | main.ts:21-24 dlog; lib.rs:273-276 debug_log | The doc itself marks "Remove once the app has a real diagnostics story"; the ai-intent/perception path is still logging |
| B10 | Low | `beginWindowDrag` is a dead interface | desktop-host-contract/index.d.ts:65-67; desktop-host.ts:65-67 | The contract defines it, the host implements it, and main.ts never calls it (dragging is done by engine displacement). Leave a comment saying it is for a future host, or delete it |
| B11 | Low | Bundle targets "all" makes the DMG fail on every build | tauri.conf.json; already recorded in docs/16 | Changing it to `["app"]` removes the error noise on every build |
| B12 | Low | The window starts at 900x700 and setup enlarges it | tauri.conf.json + lib.rs:594-601 | The first frame may flash a small window. Give a reasonable initial value directly in the conf, or accept the current state |

---

## 4. Unfinished goals, compared (document baseline vs code reality)

Baseline: the README "current stage" section, the docs/06 milestones (P0→M1→M2→M3), the docs/02 MVP table, and docs/16 "an honest list of what is not done yet".

### 4.1 The README is already out of date (documentation debt)

The README says "**there is not yet** …… a runnable desktop app", but `apps/desktop-shell` already runs and is installed in /Applications; the directory-structure table also does not list `apps/`, `packages/life-engine`, `packages/perception*`, or `packages/desktop-host-contract`. docs/11 is likewise not updated.

### 4.2 P0 (feasibility prototype) — basically reached, with wrap-up items

- ✅ Transparent window, click-through, dragging, following, tray, management window, settings persistence, quit, Dock icon
- ⬜ The platform-correctness problems in sections 2 and 3 of this list (bounds / occlusion / multiple displays)
- ⬜ The user's one-week trial acceptance has not started

### 4.3 Core gaps of M1 (companion MVP)

| Goal | Status |
| --- | --- |
| Freeze the character | ⬜ The placeholder box cat is still running; visual acceptance has not passed (docs/12); fur v5/v6 experiments are in progress (another agent is doing them) |
| Behavior orchestration | ⬜ Only the five states idle/wander/follow/dragged/ai_directed; the behavior library in docs/04 (sleep / groom / alert, and so on) and the action graph in docs/14 have not landed |
| Local interaction | ◐ Only dragging / following; no pet-the-head reaction, feeding, and so on |
| Settings / hide / quit / local recovery | ✅ Done (including crash-safe tmp+rename persistence and 5 Rust tests) |
| Product acceptance | ⬜ Not started |

### 4.4 Agent task observation (the core selling point the README promises) — contract only

- ✅ `packages/contracts`: TaskObserver/TaskStore/taskCue contract + validation + tests
- ⬜ Of the three platforms (DSH/Codex/Claude Code), **not one has a real Observer implementation**; `KNOWN_AGENTS` in the shell (lib.rs:73) is only a label on the management UI, and its own comment admits "label today"
- ⬜ A visible reaction from the cat to a task event (taskCue's soft_glance/attention_mark has no render path)

### 4.5 Skin / personality / growth — contract and placeholder only

- ✅ SkinManifest/PersonalityManifest validation, 4 preset files
- ⬜ `composeCompanion` has no caller; skins do not affect rendering, and personality traits do not affect life-engine parameters
- ⬜ growth/engagement is a placeholder formula (docs/16 admits it is not aligned with docs/04)

### 4.6 Debts docs/16 already admits (still true)

Global click/key perception (needs Accessibility permission), perception records only interactions that land on the cat, the HTTP bridge has no auth (127.0.0.1 as the trust boundary), tray/icon appearance has not been verified by screenshot, DMG packaging fails.

---

## 5. Omissions at the engineering and process level

1. **None of the desktop-shell code has ever been committed**: in `git status`, `apps/`, `packages/life-engine`, `packages/perception*`, and `packages/desktop-host-contract` are all untracked; the last commit (db4eaa3) contains no desktop-shell work. A crash or a mistake loses all of it. Suggest committing immediately in logical slices (shell skeleton / life-engine / perception / docs).
2. **The test gate does not match what the docs claim**: `test` in the root `package.json` runs only `packages/contracts`; the life-engine tests (currently 19), the perception tests (4), `cargo test` (5), `tsc --noEmit`, and the desktop-shell build are not in `npm run validate` / CI. The coverage the README claims is not protected by a gate.
3. **Concurrent AI agents have no coordination mechanism** (see 1.1): there needs to be a human agreement that only one session may write this repo at a time, or at least a split by directory.
4. `previews/threejs` is ignored by .gitignore and marked "source is versioned by Sites" — confirm it really has an external version source, or it is an asset that "looks present but is actually unprotected".
5. "Feel" problems such as hit-testing and dragging are currently accepted entirely by eye. There is no minimal human acceptance checklist (flush to the edge, Dock region, menu-bar region, a fast drag flung out, multiple displays) attached to docs/16.

---

## 6. Suggested fix order (execute after you confirm)

1. **Stop the bleeding and align** (do this first; lowest risk):
   - Rebuild + reinstall /Applications (the current installed package is behind the source);
   - commit all existing work into git in logical slices;
   - hang the tests of the three pure-logic packages and `tsc --noEmit` on `npm run validate` / CI.
2. **Boundary correctness** (this answers your interaction feedback directly): change R1+R2 together (visibleFrame as both the engine bounds and the window geometry) → lower `margin` → add the clamp for R5 → for R6, at least add a guard "an out-of-bounds cursor counts as null".
3. **Behavioral feel**: the B3 permission prompt, the B4 work-area-change event, pulling in the B7 hit area, play-mode edge hugging (R4); after that, confirm with you whether you want an explicit "walk along the edge" behavior state.
4. **Close the half-finished items**: clean up B8/B9/B10/B11; update the README and docs/11 to match the code.
5. **Push features** (you need to set the priority): pick one of the three and build a real Agent Observer first; wire skin/personality into rendering and engine parameters; the behavior library (docs/04/14).

> Single-writer rule: before any step above starts, please stop the other session that is editing this repo (Codex / claude --resume), so they do not overwrite each other again.

---

# Round two: a three-role review (architect / test / product, 2026-09-13)

> Only the "design evaluation" that round one did not cover. The bug list is not repeated. Again, no code was changed.

## 7. The architect's view

### 7.1 What was done right (keep it)

Module boundaries and contracts first (desktop-host-contract / life-engine as pure functions / perception-contract), the split of a single window + Rust polling + a frontend state machine, and AI opening only one narrow intent channel — consistent with the comparable open-source projects that docs/16 was measured against. These do not need to move.

### 7.2 Structural risks (by severity)

| # | Risk | Notes | Suggestion |
| --- | --- | --- | --- |
| A1 | **The coordinate system has no single authority** | Four coordinate sets (physical screen px / logical CSS px / three world units / NDC), and three scattered conversions (Rust y flip, main.toLogicalCursor, the camera-geometry magic numbers in the renderer). The "up/down reversed", DPI, and multi-screen problems that have already happened are all this class | Build a `Viewport` / coordinate module: the host provides only workArea+scale, and every conversion in the repo goes through it; camera geometry is sealed inside the renderer, and the outside sees only "logical px" |
| A2 | **The trust boundary is not validated, and NaN can permanently pollute state** | POST /intent forwards arbitrary JSON as-is; `suggestMoveTo` has no defense against NaN: `clamp(NaN)=NaN` → position is permanently NaN, and the cat vanishes (only dragging or a reset can bring it back). Negative holdMs and a non-numeric targetPoint are the same. The /perception response carries no schemaVersion | Validate AIIntent at the Rust boundary (numeric + finite + type) and reject illegal input; carry schemaVersion on the response; on the engine side, `Number.isFinite` before clamp |
| A3 | **There is no power architecture** | A full-screen transparent WebGL at 60fps stays resident, and the idle breathing animation renders every frame. For a resident desktop app, "quiet" includes being quiet about battery | Drop the frame rate when idle (10–15fps is enough for a 2Hz breath/tail sway), and pause rendering when occluded or unfocused; include this in the P0 acceptance metrics |
| A4 | **The main.ts glue layer is an untested composition root** | Event subscription, cursor state, dragging, hit→click-through switching, perception reporting, and the frame loop all live in this layer; historically the two real bugs "cannot drag" and "drag does not follow the hand" were both born here. Architecturally, "it is the only one that knows everyone" is right, but without a harness it cannot be tested | Pull the wiring out into injectable functions (fake host + fake renderer). See test T1 |
| A5 | **The contract has drifted. The "contract" is actually a comment** | `RendererCapabilities` declares "the behavior layer must not request a capability that does not exist", but life-engine never reads it; the renderer no longer uses the `facing` parameter of `Renderer.render` (it uses displacement atan2); `beginWindowDrag` has no caller | Pick one of three: a runtime assertion (dev builds), delete the dead parameter, or write "informational field" in the contract comment |
| A6 | **The same state has three sync channels and no version number** | Tauri broadcast events / a get_status pull at startup / the HTTP bridge. The pitfall "the event arrives before the listener" has already been hit, and a startup pull was used to patch it — which says the broadcast is unreliable | Add a monotonic version number to state (the client can notice a missed event), or unify on "pull is primary, events only notify" |
| A7 | **Multiple displays are a contract-level decision, and the later it is made the more it costs** | WorkArea is singular, and cursor conversion is in the primary-screen frame; "primary screen only" is currently only an implicit fact | Write the limitation into the contract comments and the README soon; leave room when designing WorkArea as a plural |
| A8 | **The "deterministic" claim does not match the implementation** | The life-engine header comment calls it deterministic, and the implementation depends heavily on Math.random() | Inject a seedable RNG: tests can reproduce, and AI-driven behavior can be replayed for debugging |

## 8. The test view

### 8.1 Assessment of the foundation

30 unit tests in the pure-logic packages plus 5 in Rust, and the quality is good; **many tests are named directly after a user complaint** ("dragging up and down is reversed", "dragging is not sensitive") — the habit of one regression per incident is exactly right. Keep it.

### 8.2 Gaps (sorted by payoff)

| # | Gap | Notes |
| --- | --- | --- |
| T1 | **A glue-layer integration harness (highest payoff)** | Use the contracts as in-memory fake host/renderer, pull the main.ts wiring out so it is injectable, then cover: the hit→click-through state machine, the three-event stream mousedown/move/up, the startup window where the event arrives before the listener, and completeness of perception-snapshot fields |
| T2 | **Fuzz of malformed input** | Feed the /intent channel NaN/Infinity/negatives/wrong types/over-long strings (this matches A2; it is a crash path that really exists, not a theoretical risk) |
| T3 | **Make the Rust conversions pure functions + tests** | Cursor y flip and physical/logical conversion are pure math, currently inlined in the thread body; extracting them into fns makes them unit-testable, and that is the regression fence for "up/down reversed" bugs |
| T4 | **Automated startup smoke** | The debug_log channel is already there: assert "within N seconds, first frame rendered appears and there is no frame() error" — guards platform-level regressions such as "a window you cannot see" |
| T5 | Complete the gate | Three-package tests + `tsc --noEmit` + `cargo test` into validate/CI (already listed in round one; placed here under the test view) |
| T6 | **Institutionalize the human acceptance checklist** | "Still needs the user to confirm by eye" keeps accumulating in docs/16; freeze it into a checklist ticked once per build: flush to the edge / menu bar / Dock / a fast fling-drag / hide and find again / restore after restart / (later) multiple screens |
| T7 | Observability is test infrastructure | A ring event log (state transitions, frame errors, capture switches) + `GET /debug/events` — when a user reports "the cat is gone", the scene can be reconstructed instead of guessed |

## 9. The product view

### 9.1 Checking the core proposition

"You do your work. I am here." — quiet, real, living company. Measured on that scale:

| # | Evaluation | Notes |
| --- | --- | --- |
| P1 | **The investment is misplaced: all of it is in "movement correctness", none of it in "expressiveness"** | Almost all the engineering went into walking / edge hugging / heading, but what differentiates this category is "is it alive". At the placeholder-model stage, adding expressiveness (grooming, sitting, looking at the cursor, ears moving) should have the same priority as movement correctness — otherwise, once movement is fixed, it is only a box that walks accurately |
| P2 | **Avoidance in auto mode produces a negative feeling** | A 150px repulsion radius means it runs from about 8 cat-bodies away. The feel is "it is hiding from me", which is the opposite of the companion proposition. Suggest yielding only when the cursor really covers the cat (distance ≲ cat radius + buffer), and the yielding action should be "get up, move, lie down again" rather than "flee". (Today's source just changed "avoid only when busy" to "avoid unconditionally"; the direction should be discussed again) |
| P3 | **Settings that do not take effect spend trust** | The cat's name only enters the snapshot and never goes on screen, personality has no consumer, and the "Agent integration" card is a pure label. The user made a choice and the world did not change, which hurts more than not having the setting. Either mark it `即将生效` (coming soon), or hide it for now — the repo's own "honesty" principle should apply to the UI too |
| P4 | **The first experience has no guidance** | After launch the cat sits in the middle of the screen: you do not know it can be dragged, that there is a tray, that there are modes. A light hint that can disappear once, or opening the management window on the first run, is low cost and high payoff |
| P5 | **Privacy is a ready-made selling point, but it is written only in comments** | Perception's "no trail is kept, and nothing leaves this machine" is an unusually serious design in this category; it should be said plainly in the management window ("all data stays on your computer") |
| P6 | **Before task observation lands, the value ceiling is low** | What exists today is essentially "a desktop ornament that moves", and the novelty is counted in days. The M1 "one-week trial" bar is right, but the pass criteria should be made countable now: active interaction on ≥N days, 0 times "cannot find the cat", battery impact acceptable, not closed because it was a nuisance |
| P7 | **Productize the recovery path** | "Reset position" is an engineering verb. The user's mental model is "the cat got lost" — it can be changed to `找回猫咪` (Find the cat); appearing once on its own after several days with no interaction also counts as a return hook |

## 10. Top suggestions from the three roles, combined

| Priority | Architecture | Test | Product |
| --- | --- | --- | --- |
| P0 | A1 coordinate authority; A2 intent validation / NaN defense; A3 idle frame-rate drop | T1 glue harness; T5 complete the gate | P6 quantified M1 trial criteria; P3 hide or label settings that do not take effect |
| P1 | A5 enforce or clean the contract; A6 state version numbers; A7 declare the multi-screen limit | T3 Rust conversions as pure functions + tests; T4 smoke assertions; T6 acceptance checklist | P1 schedule expressiveness; P2 pull in the avoidance radius; P4 first-run guidance |
| P2 | A8 a seedable RNG | T7 an event-log endpoint | P5 privacy copy; P7 `找回猫咪` (Find the cat) copy |

(T2 fuzz is done together with A2, and goes into A2's ticket.)
