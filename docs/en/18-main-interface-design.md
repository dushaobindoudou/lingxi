<!-- English translation of `docs/18-main-interface-design.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Main-interface product design and interaction spec (v2: revised against the user's decisions)

Status: **design proposal v2** (2026-09-13), **status marks corrected on 2026-09-24**. After the v1 review the user gave 10 decisions (see §0), and this document has carried all of them out. The text distinguishes ✅ already present, ◐ partly present, and ⬜ proposed, and does not treat the design as already implemented.

> **Read this paragraph first.** The ✅/◐/⬜ marks in this document originally stopped at 2026-09-13. After that, the MCP server (13 tools), permission tiers, write rate limits, the call log, one-click connection for Claude / Codex, and the cat-side reactions have all been implemented. On 2026-09-24 those marks were corrected item by item, but **the design-argument sections are kept as they were** — they record why it was decided that way at the time.
>
> The page count follows this document and [`21-tray-menu-and-home-surface.md`](21-tray-menu-and-home-surface.md): **6 pages** (`首页` Home / `Agent 接入` Agent connections / `性格行为` Personality and behavior / `玩法` Play / `外观` Appearance / `设置` Settings). Visual and interaction agreements for the tray and the home page follow `21`. Where this document conflicts with `21`, `21` wins.

Related documents: [extension architecture](09-extension-architecture.md) (the three-platform integration paths have been verified), [behavior system](04-life-engine.md), [brand and design system](08-brand-and-design-system.md), [desktop-shell prototype](16-desktop-shell-prototype.md), [contracts](../../packages/contracts/src/index.d.mts), [perception contract](../../packages/perception-contract/index.d.ts).

---

## 0. Decision record (v2, user, 2026-09-13)

| # | Decision | Design impact |
| --- | --- | --- |
| 1 | Remove the stacked approval-card area | The home page no longer has a "needs you" block. The approval flow is removed from the whole document (the old §9 is rewritten as §9, the configuration-write boundary) |
| 2 | Agent connection uses folds (an accordion) | §6.2 redesigned: one expandable section per platform |
| 3 | Capability exposure is folded into Settings; each agent gets one-click connection | Navigation 7 pages → 5 pages; MCP becomes a section inside Settings; §6.2 adds "one-click connection" (`玩法` Play later became its own page, so it is actually 6 pages) |
| 4 | Personality and behavior stay on the v1 plan | §6.3 is kept |
| 5 | No do-not-disturb | Delete the do-not-disturb period/switch (the personality page and the global top bar) |
| 6 | Appearance matters, and several choices are offered | §6.4 expanded: skin candidates grow to 6, plus a custom size slider |
| 7 | The brain is folded into Settings | The LLM becomes a section inside Settings (§6.5) |
| 8 | Connect Claude first | The M1 launch adapter = Claude Code (the Hooks path in [09-extension-architecture.md](09-extension-architecture.md)) |
| 9 | The LLM defaults to an OpenAI-style configuration | The Base URL / API Key / Model trio, with a DeepSeek (compatible) preset + custom |
| 10 | Do no approval operations at all (including remote approval); toward the agent, only observe, do not operate | The cat is forever read-only toward agent tasks (continuing the TaskObserver boundary); within its granted tier the agent writes pet configuration **directly**, with a whitelist plus a call log as the backstop |

## 1. Requirements translated

| # | Original requirement | Product translation | Current state |
| --- | --- | --- | --- |
| 1 | Connect Codex / Claude / DSH | Three first-class "roommates", each managed in its own fold, one-click connection, and they can be disconnected | ✅ Accordion UI is built; Claude / Codex one-click connect and disconnect are implemented; the DSH panel is manual steps (see U6) |
| 2 | Perceive agent state and react | Task events → normalization → restrained cat-side reactions + a task stream | ✅ End to end: `POST /task-event` → normalization → expression/action/bubble; the task stream is on the Agent page |
| 3 | Provide a skill and MCP | An MCP server inside the Settings page + a tool list (risk-graded) + skill guidance | ✅ MCP server, 13 tools (`packages/mcp-server`) + two skills + the CLI; the list is on the Settings page |
| 4 | Emotional value; the agent can update pet configuration | Within its permission tier the agent **directly** writes whitelist fields (no approval), with a call log the whole way | ✅ observer/performer/trusted, three tiers + a field whitelist + 10 writes per minute + the most recent 200 call-log entries |
| 5 | A separate LLM makes simple responses based on activity | A resident rules layer + an optional LLM layer (OpenAI-compatible configuration), with an input whitelist | ◐ The growth placeholder formula is present |

**Positioning: the main interface is the dashboard of the three-way relationship among the user, the cat, and the agent. What the cat presents on the desktop is the "result"; the main interface is the editor of the "cause".**

## 2. Non-goals

- Do not build a remote control or a chat window for the agent. **Agent tasks are only observed**: do not approve, reject, cancel, or answer on the user's behalf (continuing the `TaskObserver` contract's "read-only" boundary).
- Do not build an approval/confirmation flow: pet-side configuration is constrained by permission tier + field whitelist. No cards, and no remote approval.
- Do not upload screen content or images to the LLM. Perception is only statistics and state.
- Do not do account cloud sync. All data stays on this machine.

## 3. Users and moments of use

1. **Set it up and forget it** (99% of the time): important state is perceptible on the tray and on the cat. The main interface is not a required path.
2. **An occasional look** (a few times a day, under 30 seconds): who is working, what is the cat doing → a 3-second scan of the home page.
3. **When something goes wrong** (a few times a week): connection / permission / calls have a readable log and a reason, not an "unknown error".

## 4. Information architecture (v2: 6 pages)

```
┌────────────┬──────────────────────────────────┐
│ 🐱 Lingxi   │  top bar: [page name] [size S/M/L] [Find the cat] │
│ status: keeping you company at work │          │
│ ▸ Home      │           page content           │
│ ▸ Agent connections │                          │
│ ▸ Personality │                                │
│ ▸ Play      │                                  │
│ ▸ Appearance │                                 │
│ ▸ Settings  │                                  │
├────────────┤                                  │
│ Version · Help │                               │
└────────────┴──────────────────────────────────┘
```

App copy in that sketch: `灵犀` (Lingxi); `陪工作中` (keeping you company at work); `首页` (Home); `Agent 接入` (Agent connections); `性格行为` (Personality and behavior); `玩法` (Play); `外观` (Appearance); `设置` (Settings); `大小` (Size) with `小`/`中`/`大` (Small/Medium/Large); `找回猫咪` (Find the cat); `版本 · 帮助` (Version · Help).

| Navigation | What it carries | Difference from v1 |
| --- | --- | --- |
| Home | Cat status card, activity summary, agent task stream (merged view), shortcuts | The approval stack is removed, and the do-not-disturb button is removed |
| Agent connections | Three-platform fold panels: one-click connection, status, permission tier, task stream | Changed to an accordion + one-click connection |
| Personality and behavior | Identity, personality sliders, behavior presets, growth | Do-not-disturb is removed |
| Appearance | Size (three steps + a custom slider), skin library | Expanded |
| Settings | Four sections: General / Capability exposure (MCP) / Brain (LLM) / Data privacy | Absorbs the original three pages `能力开放` (Capabilities), `大脑` (Brain), and `数据隐私` (Data and privacy) |

Content of the current management window is re-homed: name/personality → Personality and behavior; size/mode/visibility/reset/permission status → Appearance and Settings-General; Agent cards → the Agent-connections folds. The tray and the main interface still share one `TrayState` as the single state source.

## 5. Global components

**Status badges** `● 已连接` (connected) / `◐ 空闲` (idle) / `○ 未连接` (not connected) / `⚠ 异常` (abnormal) — the color meaning is consistent throughout; **permission switches** (a toggle + a subtitle for the area affected); **empty states** (every page must define one, pointing at the next step); **Toast** (bottom-right, 3s, confirmation only; errors use inline red text). v1's "approval card" component is deleted with decision 1.

## 6. Page-by-page spec

### 6.1 Home (right now)

Purpose: in 3 seconds, answer "how is the cat, and who is working".

```
┌─ Cat ─────────────┐ ┌─ Agent ────────────┐
│ [thumbnail / status art] │ │ Claude ◐ idle   ⚠1 │  ⚠ = a task is waiting on the user, or failed
│ status: keeping you company at work │ │ Codex  ● running tasks 2 │
│ place: bottom right · work mode │ │ DSH    ○ not connected │
│ mood: relaxed (0.7) │ │ —— latest tasks ———— │
│ energy ▓▓▓░ 72%    │ │ ✓ refactor renderer.ts │
│ growth Lv.3 ▓▓░░░  │ │ ⋯ running the test suite… │
└───────────────────┘ └────────────────────┘
┌─ Today ───────────────────────────────────┐
│ interactions 12 · drags 2 · yielded 5 · focus 3h12m │
└──────────────────────────────────────────┘
[ tease-the-cat mode ] [ Find the cat ]        ← shortcuts
```

App copy in that sketch, where not already glossed: `放松` (relaxed); `精力` (energy); `成长` (growth); `今天` (Today); `被避让` (times yielded); `专注` (focus); `逗猫模式` (tease-the-cat mode); `工作模式` (work mode); `运行任务` (running tasks); `未连接` (not connected).

- Data source: the same-origin snapshot as `GET /perception`, plus the TaskStore snapshot. Poll every 2s, and pause when the page is not visible.
- Clicking an Agent card → jump to the connections page and expand the corresponding fold. Clicking a task row → expand a summary of ≤240 characters (the contract is already set).
- The ⚠ badge only means "a task needs the user to handle it on the agent side". **The main interface provides no operation** (decision 10).

### 6.2 Agent connections (folds + one-click connection)

One accordion section per platform. All collapsed by default; expand one:

```
┌ ▸ Claude Code ──────── ○ not connected · launch adapter ┐
├ ▸ Codex ────────────── ○ not connected                  │
├ ▸ DeepSeek Harness ─── ○ not connected                  │
└─────────────────────────────────────────────────────────┘
```

`首发适配` (launch adapter).

**The Claude section after it is expanded (the launch platform):**

```
┌ ▾ Claude Code ──────────────── ◐ idle ────┐
│ [ Connect ]   (when connected: [Disconnect] [Detect again]) │
│ Method: Hooks, merged automatically into ~/.claude/settings.json │
│         (backed up automatically before writing; one-click rollback; existing hooks are not overwritten) │
│ Tier: (👁 Observe) (💬 Suggest) (🎮 Operate) (⚙ Configure)  default 👁 │
│ Today: 4 done · 1 failed · 0 waiting on you │
│ ▾ Task stream (scrollable; failed/waiting pinned to the top) │
└───────────────────────────────────────────┘
```

App copy: `一键接入` (Connect); `断开` (Disconnect); `重新检测` (Detect again); `观察` (Observe); `建议` (Suggest); `操作` (Operate); `配置` (Configure); `等待你` (waiting on you).

- **One-click connection** lands per platform (each auto-detects first, and on failure degrades to "copy the config and paste it by hand"):
  - Claude: **merge** the `UserPromptSubmit` / `Stop` / `StopFailure` hook fragments into the user's settings.json (backup + rollback). The badge turns green when the first event arrives;
  - Codex: guide the user to enable app-server event subscriptions (`thread/status/changed`, `turn/started`, `turn/completed`);
  - DSH: detect `dsh-acp` and establish `dsh/sessions/watch`.
- Permission tiers are independent per platform: 👁 Observe (read-only task events) → 💬 Suggest (`AIIntent` suggestions for movement/mode) → 🎮 Operate (all low-risk MCP tools) → ⚙ Configure (**directly** write whitelist fields; see §9).
- Boundaries inherited from [09-extension-architecture.md](09-extension-architecture.md): a disconnect only marks the task expired and does not infer completion; summaries are ≤240 characters; the raw prompt and tool parameters do not enter the event; an observer has no approve/execute/cancel capability.

### 6.3 Personality and behavior (keep v1, delete do-not-disturb)

```
┌─ Identity ────────────────────────────────┐
│ name [Lingxi]  personality in one line [gentle, loves to sleep] │
├─ Personality tendency (affects behavior weights) ┤
│ independence ○───●─────○  curiosity ○─●──────○  gentleness ○────●──○ │
│ playfulness ○──────●──○  sleepiness ○──●─────○  (5 dimensions, contracts already set) │
├─ Behavior presets ─────────────────────────┤
│ (quiet) (balanced✓) (lively)  ← avoidRadius / wander radius / energy rate, packed as steps │
├─ Growth ───────────────────────────────────┤
│ Lv.3 · engagement 62/100 · "It is starting to remember your routine" │
└───────────────────────────────────────────┘
```

App copy: `名字` (name); `性格一句话` (personality in one line); `温柔、爱睡觉` (gentle, loves to sleep); `独立` (independence); `好奇` (curiosity); `温柔` (gentleness); `玩心` (playfulness); `困意` (sleepiness); `安静` (quiet); `均衡` (balanced); `活泼` (lively); `参与度` (engagement).

- Sliders map to `PersonalityManifest.traits` (0–1). Preset buttons load `presets/personalities/*.json` and can then be fine-tuned. Saving goes through `composeCompanion` validation.
- Items the behavior engine does not consume are honestly labeled `即将生效` (not yet in effect) (the honesty principle).
- Behavior presets also close the avoid-radius issue from the audit: quiet `avoidRadius` ≈ the cat's body + 40 px, balanced 100 px, lively 150 px.

### 6.4 Appearance (expanded: several choices)

```
┌─ Size ─────────────────────────────────────┐
│ (Small 0.25x) (Medium 0.5x) (Large 1x)  custom ○────●─○ 0.25–1.0 │
├─ Skin library ──────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│ │warm-pile tabby✓│ │silver-gray cloud│ │orange-white taffy│ │obsidian shadow│ │
│ │in use   │ │planned │ │planned │ │planned │ │
│ └────────┘ └────────┘ └────────┘ └────────┘ │
│ ┌────────┐ ┌────────┐                       │
│ │cow-print pudding│ │calico dumpling│  (clicking a skin that is not shipped → show the plan note) │
│ └────────┘ └────────┘                       │
│ each card: preview · rig-compatibility mark · status badge │
└─────────────────────────────────────────────┘
```

Display names in the sketch: `暖绒虎斑` (warm-pile tabby); `银灰云朵` (silver-gray cloud); `橘白软糖` (orange-and-white taffy); `黑曜影子` (obsidian shadow); `奶牛布丁` (cow-print pudding); `三花团子` (calico dumpling); `使用中` (in use); `自定义` (custom).

- The existing `SkinManifest` entries (`暖绒虎斑` warm-pile tabby / `银灰云朵` silver-gray cloud) are shown according to the contract. The four new ones are **candidate proposals**, marked `planned` and not selectable. Clicking a card explains "what assets are required before it can ship" (a real model and materials, continuing the "do not forge asset paths" principle in [09-extension-architecture.md](09-extension-architecture.md)).
- Switching follows the [09-extension-architecture.md](09-extension-architecture.md) flow: validate the complete assets first → replace atomically → on failure, keep the old skin.
- The custom size slider is linked to `setScale` (the three steps are currently a hardcoded enum; the slider is a proposal, and the Rust side needs to open the sanitize whitelist).
- Previews inside the management window are static renders. Anything that is not live must be labeled as such (the honesty principle).

### 6.5 Settings (four sections)

```
┌─ General ──────────────────────────────────┐
│ show/hide [toggle] · Find the cat · launch at startup [proposal] │
│ Accessibility: authorized / not authorized (a read-only check; do not pop a system dialog) │
├─ Capability exposure (MCP) ─────────────────┤
│ MCP Server [toggle]  transport: stdio (default) / HTTP │
│ HTTP mode: 127.0.0.1:47812 · access token ●●●● [copy][rotate] │
│ Tool list (risk grade is the default switch): │
│  get_perception  read cat state/activity   low  [on] │
│  get_tasks       read task summaries       low  [on] │
│  suggest_move_to suggest the cat walk over low  [on] │
│  play_emote      play an expression/action low  [on] │
│  set_mode        switch work/tease-the-cat medium [off] │
│  write_settings  change settings directly  high [off] │
│ Skill guidance: [copy Claude skill] [copy Codex] [copy DSH] │
├─ Brain (LLM) ───────────────────────────────┤
│ Reaction engine (local rules, always on):    │
│  task done → a small celebration · failure → comfort · waiting on the user → a clear mark │
│  long focus → a nap · cursor idle → curious watching   [edit rules (advanced)] │
│ LLM enhancement [toggle]:                     │
│  preset: (DeepSeek · OpenAI-compatible) (custom) │
│  Base URL [___________]  model [___________]  │
│  API Key [write to the keychain…] (plaintext is not written to disk) │
│  allowed to send: ☑ task-status summary ☑ activity stats ☐ window title ☐ screen content │
│  budget: ≤50 times a day · ≤500 tokens each · cooldown ≥10 minutes │
│  [send a test] → sample-response preview · used today 3/50 │
├─ Data and privacy ──────────────────────────┤
│ record on-cat interaction [on] · cursor stats [on] (a track is never recorded) │
│ retention: task events 30 days · activity summaries 7 days · call log 90 days │
│ [clear everything now]                        │
│ call log: 14:02 Claude suggest_move_to ✓      │
│ bridge safety: listens only on 127.0.0.1 ✓ · token [enabled] │
└──────────────────────────────────────────────┘
```

App copy: `通用` (General); `显示/隐藏` (show/hide); `启动时自动运行` (launch at startup); `已授权/未授权` (authorized / not authorized); `能力开放` (Capabilities); `复制` (copy); `轮换` (rotate); `大脑` (Brain); `写入钥匙串…` (write to the keychain…); `发送测试` (send a test); `数据隐私` (Data and privacy); `立即清除全部` (clear everything now); `调用日志` (call log); `令牌` (token); `启用` (enabled).

- An LLM output is only one kind of thing: a reaction intent (`AIIntent` + a `reaction` enum), on the same channel as an external agent — the cat's own brain and an outside agent are two personas of the same protocol.
- Failure degradation: no network, or over budget → fall back silently to the rules layer. Do not retry, and do not report an error that disturbs the user.
- The Accessibility permission check becomes **read-only** (which also fixes the current bug where `get_status` pops a system permission dialog).

## 7. Cat-side reaction design

Follow the restraint principle in [09-extension-architecture.md](09-extension-architecture.md): quiet by default, events are merged, there is a cooldown, and important state is also carried in text (tray / main interface), not by expression alone.

| Trigger | Cat side | Main interface / tray side |
| --- | --- | --- |
| Task completed | `soft_glance`: a slight head raise + a small celebration | A ✓ at the head of the task stream. The do-not-disturb concept has been deleted, so the action is always on (subject to the global mode) |
| Task failed | `attention_mark`: head tilt + ears pressed back | Tray tooltip "a task failed"; the task stream pins it to the top |
| Waiting on the user | Walk to the bottom edge of the screen and sit quietly | Task stream pinned to the top + a ⚠ badge on the home page + a tray tooltip (a reminder only, no operation) |
| A long task running | Quiet at each step, occasionally glancing toward the screen | The Agent card shows "running n" |
| Disconnect / expired | No action | Badge ○ + an expired mark (completion is not inferred) |

## 8. Where the data contracts land

| Contract | Status | Notes |
| --- | --- | --- |
| `TaskObserver` / `TaskEvent` / `TaskStore` / `taskCue` | ✅ reused | The output side of the platform adapters; not changed |
| `PerceptionSnapshot` / `ActivitySummary` | ◐ extended | Add `agentConnections` (each platform's connection state) |
| `AIIntent` | ◐ extended | Add an optional `reaction?: 'celebrate'\|'comfort'\|'attention'`; it is still the only channel that can be sent |
| `AgentConnection` | ⬜ new | Connection state / permission tier / active time, shared by the management window and the snapshot |
| `WriteSettingsScope` | ⬜ new | The field-whitelist definition for write_settings (see §9), replacing v1's SettingsProposal |
| MCP tool schema | ⬜ new | A separate `packages/companion-mcp`, defined tool by tool |

## 9. Configuration-write boundary (replaces the v1 approval flow, per decisions 1 and 10)

No approval cards and no remote approval. The trust model becomes **permission tier × field whitelist × call log**:

```
Agent (MCP write_settings, carrying field + value)
  → Rust checks: schema ✓ → that agent's permission tier includes ⚙ Configure ✓ → the field is on the whitelist ✓ → the value passes sanitize ✓
  → write PersistedSettings directly + broadcast it into effect (the same TrayState path as the tray and the main interface)
  → the call log records one line (who, when, what changed, old value → new value)
  any step that fails → reject + a reason in the receipt + a log record
```

- Field whitelist (first version): `interactionMode`, `scale`, personality traits, and the behavior-preset step. **Identity fields (name / personality in one line) are locked as the user's own by default** and are not on the whitelist — the cat's name belongs to the user and the cat, and the agent is not authorized to change it.
- Fields outside the whitelist (such as the skin) are rejected in the first version, with a receipt that clearly says "this field does not support modification by an agent".
- The user can turn off an agent's ⚙ Configure tier at any time on the Settings page; turning it off takes effect immediately.
- Rate limit: the same agent may write at most 10 times per minute; beyond that, reject — to stop a runaway script from hammering the configuration.

## 10. Milestone mapping (Claude ships first)

| Stage | What the main interface delivers |
| --- | --- |
| M1 companionship MVP (current position) | The 6-page IA skeleton + home (cat card / activity summary / task stream) + the personality-and-behavior page + **the Claude Code adapter** (one-click hook connection + task stream + cat-side reactions) |
| M2 relationship validation | Codex/DSH adapter folds + the MCP server and low-risk tools + write_settings (whitelist / log / rate limit) + the Settings data-privacy section + the Appearance skin-library UI (`planned` cards may be built) |
| M3 expansion | The LLM brain's default presets and the budget system brought to completion + real skins enabled (depends on model assets being ready) + the custom size slider + accessories (if they are done) |

## 11. Acceptance checklist (the definition of this design being "done")

- [x] The 6-page navigation works (`首页` Home / `Agent 接入` Agent connections / `性格行为` Personality and behavior / `玩法` Play / `外观` Appearance / `设置` Settings). Existing features are all re-homed, and tray/main-interface state syncs both ways (TrayState is the single state source).
- [x] Claude Code end to end: one-click connection (including backup/rollback) → a real task event → the task stream → a cat-side reaction. (Screenshot/screen-recording evidence is still missing; see below.)
      - [x] One-click connection (`install_claude_hooks`: merge-write `UserPromptSubmit` / `Stop` / `StopFailure` into `~/.claude/settings.json`, backing up to `.lingxi-backup` first, appending only and not overwriting existing hooks) + disconnect (`uninstall_claude_hooks`, which precisely removes those three of its own).
      - [x] A real task event → the task stream: a new local `POST /task-event` endpoint receives events forwarded by the hooks, normalizes them into a `TaskEvent` (session granularity), broadcasts `claude-task-event`, and the Agent connections page uses `TaskStore` from `packages/contracts` to deduplicate and render a list. Unit tests cover normalization and the merge logic of install/uninstall (16 added or changed tests in `src-tauri/src/lib.rs`, all green).
      - [x] Cat-side reactions: done. The placeholder cat `placeholder-cat.ts` has been deleted. It is now the voxel skeleton in `src/rig/skeleton.ts` plus the gait/pose/expression system in `src/anim/`. The (state, kind, mood) triple maps to an expression + an action + a line, and the user can override it with `assets/reactions.json`.
      - [ ] Screenshot/screen-recording evidence: none this round — limited by being unable to interact with a real native macOS app in this environment. Verified with `cargo test` / `tsc` / `vite build`, but that is not visual evidence of end-to-end connectivity, so it is honestly left unchecked.
- [x] The MCP server can be connected by any agent. Tool risk grades and default switches match §6.5. Call-log entries are visible one by one. (`packages/mcp-server`, 13 tools; Claude Code / Codex / WorkBuddy have all been connected; the log is on the Agent connections page under `权限与日志` (Permissions and log).)
- [x] write_settings end to end: tier / whitelist / rate limit / log, and each of the four rejection paths has an explicit receipt. Identity fields are confirmed not writable. (`/control` filters field by field and returns `applied` and `rejected` together; `/memory` and `/reminders` are single actions and return 403 directly. **Known defects: see B1 in [RELEASE-READINESS-2026-09-24.md](repo/RELEASE-READINESS-2026-09-24.md)**)
- [ ] The experience is complete when the LLM is off (the rules layer stands on its own); when it is on, data outside the whitelist is not sent (a unit test asserts the payload). (The controls are laid out but disabled, and are not connected to a backend.)
- [x] Every item that is not in effect is honestly labeled `即将生效` (not yet in effect). Skin cards do not forge asset status.
- [ ] README/docs are updated in sync (no more "the docs say it does not exist, but the code has it").
