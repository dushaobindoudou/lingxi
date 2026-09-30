<!-- English translation of `docs/lingxi-完整技术方案 v0.1.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Lingxi technical plan

Version: v0.1 (rewritten against the current implementation, 2026-09-24)

This document describes **Lingxi as it exists in the repository now**: a quiet real-time 3D kitten that lives on the macOS desktop. It replaces the "Peipei Desktop Demo" draft from the project-start period. That draft planned the first version around prerendered sequences, a Blender GLB, and eight idle clips. The product has been renamed, and the runtime has already been replaced by a real-time voxel skeleton. What follows writes only the structure that has landed and the boundaries that are still in force.

Interface detail follows the topical documents and the running app, and is not copied again here:

| What to look up | Authority |
|---|---|
| Agent contract, vocabulary, reaction mapping | [`19-agent-integration.md`](19-agent-integration.md); at runtime, `GET /integration` |
| Design intent of the behavior state machine, and the parts not yet implemented | [`04-life-engine.md`](04-life-engine.md) |
| Three-layer module boundaries | [`05-technical-architecture.md`](05-technical-architecture.md) |
| The six pages of the main interface, and the tray's seven rows | [`18-main-interface-design.md`](18-main-interface-design.md), [`21-tray-menu-and-home-surface.md`](21-tray-menu-and-home-surface.md) |
| Skin import | [`20-arbitrary-png-skin-import.md`](20-arbitrary-png-skin-import.md) |
| Short-fur skeleton v5 (not wired into the app) | [`22-character-v5-lookdev.md`](22-character-v5-lookdev.md) |

---

## 1. Product

**Lingxi** means 心有灵犀: a tacit understanding, hearts that meet without being told. The brand line is: **`你忙你的，我在这里。`** (You keep at what you're doing; I'm here.)

It is not a chat window, and it is not a task status light. The user does not have to keep feeding, talking, or tending. On the desktop there is still a recognizable cat living its own day: walking along the screen edge, stopping to do an action, staying out of the place where the mouse is working; playing when it is teased; and, when an Agent finishes a job or messes one up, meeting it with a mood that fits the event, rather than joining in the nagging.

The visual reference is [`assets/brand/lingxi-icon-v3.png`](../../assets/brand/lingxi-icon-v3.png): a gray-brown tabby, a warm-white inverted-V face, two white front paws, hazel-green eyes, and a small pink nose. "Peipei" (陪陪) in older material is kept only as concept history. It is no longer the product name.

### Experience principles

- **The cat comes first.** Gentle, independent, lazy, and moderately curious. It does not suddenly turn into customer support.
- **Quiet by default.** Speaking up, fullscreen effects, and toys all have a budget. A bad mood is caught and held; a good mood is shared; a private matter is simply accompanied.
- **Do not get in the way of work.** Transparent areas click through, focus is not stolen, and it can be hidden or quit at any time. Where the mouse is is a forbidden zone; even a footfall is not chosen there.
- **It can still live with no network.** Routine, walking, petting, and toys are all on this machine. The Agent bridge listens only on loopback.
- **Report the event; do not direct the performance.** The Agent reports `state` / `kind` / `mood`. The cat decides the expression and the action from `reactions.json`, which the user can edit.

### Explicitly not done

A full 360° game character, climbing real windows, a feeding economy, multiple pets, a shop, account cloud sync, reading screen or mail content, approving Agent operations on the user's behalf, and treating an LLM as a prerequisite of the life loop. A microphone and global keyboard recording are also out of scope.

---

## 2. Overall architecture

The three layers communicate only through contracts. Any layer can be replaced on its own.

```text
packages/life-engine          A pure behavior state machine. No DOM, no rendering, no Tauri.
        │                     It knows only a 2D world and a cursor. Unit-testable.
        │  snapshot { state, position, heading, toy, vitals, ... }
        ▼
apps/lingxi/src               The Three.js scene. It does not know the desktop host exists.
        │                     Skeleton / gait / director / camera / skins / effects layer
        ▼
apps/lingxi/src-tauri         Window, tray, settings persistence, the local HTTP bridge
```

The desktop shell folds the environment into normalized events and hands them to the behavior layer. The behavior layer requests a semantic state and does not specify bones. The renderer draws the state according to its own capability. What the renderer cannot do (for example, it cannot walk) ignores the displacement, and the engine does not change its decision because of that.

The reasons for choosing this structure are recorded in three decisions:

- [001](decisions/001-realtime-desktop.md): the desktop side is real-time rendering of a real mesh and skeleton. Prerender is only for promotion and comparison. A picture plane must not impersonate the character.
- [002](decisions/002-physics-and-game-libraries.md): Rapier and game frameworks are not introduced. The yarn ball stays in the life engine as analytic motion; the tail of the teaser wand is a Verlet rope.
- [003](decisions/003-multi-agent-arbitration.md): when several Agents are connected at once, arbitration is by the urgency of the **event**, not by the Agent's identity.

The runtime stack is settled. It is no longer a choice between Tauri and a 小奥-style shell:

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | Tauri 2 + Rust, macOS AppKit | Transparent, borderless, always on top, tray, click-through, launch-at-login related capabilities |
| Picture | TypeScript + Three.js `^0.186`, WebGL2 | Orthographic camera. The animation loop does not go through React |
| Behavior | `packages/life-engine`, pure JS | Tested directly in Node |
| Integration | Local HTTP `127.0.0.1:47811` | The CLI, MCP, and host hooks share the same bridge |
| Management UI | `management.html` + `management.ts` | Six pages, not UI inside the cat window |

The only third-party runtime dependencies are `three` and Tauri itself. Node.js 22+. The Rust version is locked by `rust-toolchain.toml` in the repository.

---

## 3. Repository map

```text
apps/lingxi/                 The desktop app
  src/                       Rendering, animation, the main interface, probe pages
  src/data/                  Built-in skeleton, actions, skins
  src-tauri/                 Window, tray, bridge, config directory
packages/life-engine/        Behavior state machine and life variables
packages/mcp-server/         MCP tools (13)
packages/contracts/          Validation of skins, personality, and task events
packages/perception/         The implementation side of the perception contract
packages/desktop-host-contract/
integrations/                CLI, skills, and host plugins
  hosts/claude|codex|dsh|workbuddy/
  cli/lingxi
  schema/task-event.schema.json
assets/brand/                Icons, design tokens
assets/characters/lingxi/    Reference images, the voxel style kit, and the v5 look-dev that is not wired in
presets/                     Skin and personality presets
scripts/                     Project checks, Blender builds (v5, not imported into the app)
docs/                        Specs, decisions, evidence
```

Development and packaging:

```sh
npm ci --ignore-scripts
cd apps/lingxi && npm ci
npm run tauri dev
npm run tauri build
```

`npm test` runs the unit tests of every package. `npm run check` checks project conventions. Rendering and gait are not closed out by unit tests; they are closed out by the probe pages in `apps/lingxi` (see section 10).

---

## 4. Character and rendering

### 4.1 What is drawn on the desktop now is a voxel skeleton

The in-app cat is generated by `apps/lingxi/src/rig/skeleton.ts` from `src/data/skeleton.json`: an articulated body assembled from boxes, with pivots on the joints, not at the box centers. `anatomy.ts` overlaps neighboring segments at the bend, so the torso reads as one piece rather than a string of separate blocks.

That discipline decides how a body type is changed: gait, IK, and poses **must not hardcode sizes**. Segment length, standing height, and joint positions are all read back from the built skeleton. A skin can change box sizes with a sparse `proportions`; changes such as short legs or a large body do not require rewriting the animation. `hiddenNodes` can remove parts a given silhouette does not need (for example the ears or the tail).

The face is not a pile of blocks. Eyes, nose, mouth, and whiskers are drawn on decals. The geometry is described by `face.json`, and the defaults are in `rig/art.ts`. The block face still keeps its pivots, so idle animation can drive them, and the mesh itself is hidden.

The default skin is `honey-mittens`. Nine are built in, all in `src/data/skins.json`: `apricot-letter`, `moon-oat`, `mist-blue`, `cocoa-snow`, `peach-cloud`, `ink-sesame`, `honey-mittens`, `silver-brook`, `calico-poem`. When a user skin has the same id as a built-in one, the user's copy takes effect.

The stacking order of one frame is written at the top of `renderer.ts`:

1. The whole body returns to the rest pose
2. Involuntary base noise: breathing, blinking, the tail, gait
3. The ear and head tilt carried by the current expression
4. The action clip chosen by the director, crossfaded in
5. Additive channels, pose expansion, paw IK, grounding
6. Screen position and facing are applied last — because step 1 clears the root transform

### 4.2 The camera is orthographic, and the angle changes with the occasion

`rig/cameras.ts` uses an orthographic camera. Orthographic projection has no perspective distortion, so pitch can be chosen freely. The clip planes are placed very wide, so a shallow angle does not crop the cat off the screen. The default preset is `game` (about 24°, a classic 3/4). There are also `仰视` (low-angle, looking up), `平视` (eye-level), `俯身` (leaning over, as if standing and looking down), `俯视` (top-down), and `auto`: when stopped or being dragged it switches to eye level, and when walking or playing with a toy it switches back to 3/4.

The lights belong to the character. Desktop pixels are not read in order to fake ambient light. Fullscreen effects are DOM/SVG, with `pointer-events: none` the whole time, so they do not swallow clicks.

### 4.3 The short-fur skeleton v5 is not this cat yet

[22-character-v5-lookdev.md](22-character-v5-lookdev.md) and `scripts/blender/` are making an editable short-fur mesh (Blender 5.2+, about 47 bones). It has **not** been approved as the brand master, and it has **not** been imported into Three.js. The markings still do not match the icon: the model leans toward a uniform cream-white, and the icon is a gray-brown tabby plus a white face marking. Until the markings, the closed eyes, and the sense of softness at small desktop size pass, Lingxi on the desktop keeps using the voxel skeleton.

The Groom in the Blender master cannot be assumed to become runtime fur as-is. If the runtime character is really to be replaced, pass a same-camera comparison first, then talk about import.

---

## 5. Motion

These are the roots of stability. Keep them before changing animation.

**Facing is held by the engine, and is not inferred backward from displacement.** The cat can move forward only along `heading`. Turning has an angular-velocity cap and a minimum turning radius. Once facing becomes a derivative of position, position jitter becomes facing jitter, and perspective magnifies it again.

**Gait is driven by distance walked, not by the clock.** In `anim/gait.ts`, the ground distance of one stride advances one gait cycle. A foot in stance is stationary in world coordinates, so it does not skate at any speed. The gait is a lateral-sequence walk (left hind, left front, right hind, right front), with a duty cycle of about 0.62, and roughly three feet on the ground at one moment. The leg chain is short and stays in the sagittal plane. It uses a two-bone closed-form IK, not an iterative solver.

**Grounding height is a property of the pose**, not "whichever paw is lowest this frame".

**Bounds are computed from the body, and there are two layers.** The point the engine manipulates is the feet; the body is drawn above the feet. The renderer measures the body's actual span on screen (`screenExtent()`), and the host provides two boxes:

- **Limit**: where dragging, toys, and fullscreen effects can reach. Half the body is allowed off screen.
- **Free activity**: where the cat itself decides to go. Left and right may still show half; up and down, the whole cat stays on screen. The cat's height is about three times its width. The same fraction, cut on the side, is the flank; cut on the top, it is the head, and the expression is the core.

**Dodging the mouse goes around, and does not only flee.** Target selection avoids the cursor. When the cursor presses in, the cat runs, and one flee target is held for at least about 1.4 seconds, so the direction is not redrawn every frame and the cat does not shiver in place. If, while traveling, the target is on the other side of the cursor, it aims at the tangent of the forbidden zone and goes around. Only the desired facing changes; turn rate, slow-down in a curve, and gait do not.

Known motion gaps: a paw in swing can go below the ground plane, by at most about 0.7 voxels. The desktop does not draw a floor, so this is usually not visible. The complete solution is world-space foot planting plus two-bone IK. Some curled actions (rolling, lying on the side, scratching an ear) overlap the hind legs and the torso; look at them by severity with `probe-clips.html`.

---

## 6. Behavior

The life engine's states are: `idle`, `wander`, `dragged`, `ai_directed`, `play_toy`, `sleep`.

There used to be `工作模式` (work mode) / `逗猫模式` (tease-the-cat mode). That split was wrong: when the user puts a toy out, that is playing; when they put it away, the cat is left to itself. Only free activity remains. The laser pointer covers the one thing in the old `逗猫模式` that was "chase the cursor", and it is a thing on the screen, not an implicit state in a menu.

### 6.1 Living its own day

The cat patrols along the screen edge, with a turning radius, and does not turn around in place. The four edges are not equivalent: on macOS the right side is the most empty, the left is next, the bottom has the Dock, and the top is the menu bar. The default weights are right 1.6, left 1.15, bottom 0.7, top 0.25, with an extra penalty on the top-left corner. It would rather keep walking along the current edge than cross the middle of the screen — the middle is where a person is working.

It performs actions only when it has stopped. Rest is deliberately stretched; otherwise it is walking most of the time, and it does not look like a life.

### 6.2 A day, not only a loop

Two life variables from 0 to 1, changing by the hour, not by the frame:

| Variable | Meaning |
|---|---|
| `energy` | How much is left to spend. Consumed while awake, and walking is faster; restored by sleep. Low energy walks slowly and rests longer |
| `sleepiness` | How much it wants to stop. Rises while awake, faster at night. It lies down only after crossing the threshold and having already settled for about 6 seconds |

The two are separate: it can be in good spirits but out of strength, or rested enough and still sleepy. The nighttime peak is placed at 3 a.m. What is modeled is the rhythm of keeping a person company, not a real cat's crepuscular activity. One tick advances life variables by at most 15 minutes, so eight hours with the lid closed does not make it instantly exhausted or instantly slept-out.

Five personality sliders enter the engine: `independence`, `curiosity`, `gentleness`, `playfulness`, `sleepiness`, all 0–1, with 0.5 meaning no lean. They bend the already-tuned defaults (about 0.6–1.6×). They do not replace them.

Still only a design, and not in the code yet: `comfort`, curiosity as a fluctuation quantity, a Utility AI scored by life variables, action-level cooldowns and a minimum dwell, an independent emotion layer, and persisting life variables. Action selection is currently in the director on the rendering layer. After a restart, life variables start from their initial values.

### 6.3 The person and the cat

When the mouse rests on the body, the cat looks up. Stroking back and forth makes it squint and purr; a double-click makes it nuzzle with its head. Passing by does not count as petting: contact has to be read as "a person reached over", and it counts only when the pointer moves more than the cat does. The cat walking onto a stationary cursor by itself is not treated as being petted.

Three toys, differing in who moves them:

| Toy | Who moves it | What the cat does |
|---|---|---|
| Yarn ball `yarn` | After it is thrown it rolls on its own, slows down, and bounces off edges | Chase and bat; after batting it can keep playing on its own |
| Teaser wand `feather` | Follows the cursor, with lag | Stalk, rear up to reach, jump, and fail to catch it |
| Laser pointer `laser` | Pinned to the cursor | Chase; batting does nothing |

The system mouse pointer cannot be hidden, so the teaser wand and the laser pointer are drawn at the cursor position; they do not replace the pointer. The soft tail of the teaser wand is a Verlet rope (`rig/rope.ts`). It affects only the picture, not the point the cat is chasing.

The comic bubble above the head is pinned to the skull's projection, and follows a crouch, a jump, and a camera change. Speech has a budget: a bubble no more than about three times an hour, and the same line is not repeated.

The built-in action library is in `src/data/actions.json`, about 49 entries, with status `playable-stylized`. Clips use seconds and radians, and blend relative to the rest pose. The director is responsible for choosing a clip, the crossfade, and a safe cut-out. While the cat is walking, an action is postponed until it stops.

---

## 7. Desktop shell

macOS only. The window, the tray, and cursor reading go through AppKit. On multiple displays, the cursor's y flip is computed from the primary screen only, so a secondary screen is inaccurate.

The cat window: transparent, borderless, always on top, and it does not steal focus. Hit testing is by the character's region, not by the whole window. Transparent areas operate the application underneath. While dragging, autonomous movement pauses; on release it lands in a safe area. When hidden, when the screen is locked, or when the system sleeps, meaningless rendering and decisions stop. Quitting takes priority over any animation.

The tray is a glance while passing by, not a feature catalog. Seven rows: two lines of status summary, show/hide, size (`小` Small / `中` Medium / `大` Large), interaction (`逗一逗` Tease / `收起玩具` Put the toy away), `打开灵犀…` (Open Lingxi…), `退出灵犀` (Quit Lingxi). The debug console is entered from Settings on the main interface.

The main interface is a 960×680 logical-pixel management window (minimum 860×620), with six pages in the sidebar:

| Page | What it does |
|---|---|
| `首页` (Home) | See the cat by the window first, then the status and the task summary |
| `Agent 接入` (Agent connections) | Folds for Claude / Codex / DSH, permissions, and the task stream |
| `性格行为` (Personality and behavior) | Personality sliders and the related presets |
| `玩法` (Play) | Toys and interaction |
| `外观` (Appearance) | Size and skins; built-in resources can be exported as an editable template |
| `设置` (Settings) | General, MCP, the brain (the LLM controls are present; the backend is not connected), and the debug entry |

The top bar is the current page name, size, and `找回猫咪` (Find the cat). There is no global "work / tease-the-cat" switch, and there is no do-not-disturb period.

Configuration is in:

```text
~/Library/Application Support/com.dushaobin.lingxi-desktop/
```

The bridge token is `bridge-token` in that directory, mode `0600`. Every time the app starts it writes the CLI to `bin/lingxi` in the same directory. The identifier is `com.dushaobin.lingxi-desktop`.

---

## 8. Connecting an Agent

The bridge listens only on `127.0.0.1:47811`. Loopback is a network boundary, not a trust boundary: any process on this machine can connect, so everything except `GET /health` requires a token. The token goes in `Authorization: Bearer` or `X-Lingxi-Token`. Do not put it in the URL.

Three ways of connecting hit the same bridge:

| Path | Who triggers it | Does it know the mood? |
|---|---|---|
| Host plugin / hook | The host, deterministically | It cannot see the content. `mood` is left empty, and the app uses `focused` |
| skill + CLI | The model decides for itself whether to use it | It can judge `mood`. This is the most valuable field in the integration |
| MCP server | The model, with types | The same. The CLI is a superset of it |

The plugin guarantees "when something happens, there is a reaction". The skill lets the reaction know what the event is about. Adapters do not guess the mood.

The correct one hop is:

```bash
lingxi task <state> <kind> <mood> "one sentence"
```

`state` is one of `queued` `running` `blocked` `needs_input` `needs_approval` `completed` `failed` `cancelled`. `kind` is one of `build` `test` `deploy` `review` `search` `write` `chat` `other`. `mood` is one of `focused` `proud` `tender` `sad` `frustrated` `anxious` `weary` `playful` `curious`.

Progress on `running` produces a visible reaction only the first time and when it crosses 50%. A terminal state is not swallowed. Priority is by the event: `alert` may interrupt, `report` queues, and `status` and `ambient` are dropped when busy. Each Agent registers its own small logo, shown on the bubble, and it disappears with the bubble. On a conflict, failure outranks completion, completion outranks status, and status outranks ambience.

The thirteen MCP tools: `lingxi_register`, `lingxi_task`, `lingxi_capabilities`, `lingxi_state`, `lingxi_say`, `lingxi_express`, `lingxi_perform`, `lingxi_play`, `lingxi_remember`, `lingxi_recall`, `lingxi_remind`, `lingxi_look`, `lingxi_reload_assets`.

The main HTTP routes:

| Method | Path | Use |
|---|---|---|
| GET | `/health` | No authentication. Whether the app is up, the CLI path, and where the token file is |
| GET | `/integration` | The current contract and the reaction mapping that is in effect |
| GET | `/status` `/capabilities` `/agents` `/activity` | Appearance, capabilities, who is driving, recent activity |
| POST | `/task-event` `/intent` `/control` | Tasks, high-level intent, low-level control |
| GET/POST | `/memory` | Read memory back and write it |
| GET/POST/DELETE | `/reminders` | Reminders |

Memory has only four kinds: `owner`, `project`, `preference`, `moment`. Plain JSON. Do not write passwords, health, or financial details. A reminder may carry a mood and a repeat interval, with a minimum of five minutes. When several come due at once, only one is spoken.

Writing memory and reminders must carry an identity. `X-Lingxi-Agent` wins; otherwise the `agent` in the body is used. The tiers are observer / performer / trusted, plus a field whitelist and a per-minute write limit. The cat only observes an Agent's tasks: it does not approve, cancel, or answer on the user's behalf.

When the app is not running, the CLI's `lingxi up`, the start of an MCP session, Claude's SessionStart, and the DSH plugin all use `open -g` to bring it up in the background, without stealing focus, and each process tries only once. `LINGXI_AUTOSTART=0` means do not start it this time. If it cannot be reached, run `lingxi doctor` first.

A direct `POST /control {"action": ...}` is still open, for debugging. Day-to-day integration should not poke action names itself.

---

## 9. Resources that can be changed

Main interface → Appearance → `导出内置资源为模板` (Export built-in resources as a template), written to the config directory above:

```text
assets/
  actions.json
  expressions.json
  skins.json
  reactions.json
  bubble.json
  face.json
  textures/*.png
  README.md          The format notes the app itself writes
```

Each file is fully validated before it takes effect. If the format is wrong, the built-in version is kept, and the interface points at the specific error. There is no half a face, and no joint twisted off. Action and expression files are replaced as a whole: when an Agent wants to add one entry, it must first know whether the user has already edited that file, or it will wipe what the user wrote. `/capabilities` marks each entry's `source`.

Hand-drawn body atlases and expression images can be swapped. Constraints on arbitrary-PNG skins are in [20-arbitrary-png-skin-import.md](20-arbitrary-png-skin-import.md). A ZIP resource pack and a Minecraft skin converter do not exist yet.

---

## 10. How to confirm it is still good

```sh
npm test
npm run check
cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test
```

After `npm run dev` (in `apps/lingxi`), these pages are not part of the packaged product:

| Page | Use |
|---|---|
| `/app-harness.html` | The real render path, without Tauri |
| `/probe-gait.html` | Body jitter, feet skating, free-activity statistics |
| `/probe-clips.html` | Check clipping action by action |
| `/probe-framing.html` | How much of each edge is cropped, at each view and each size |
| `/probe-unproject.html` | Whether screen coordinates and world coordinates are invertible |

Before changing the animation system, look at the health values at the top of `probe-gait.html`.

The Agent side proves itself with `lingxi state`, `lingxi status`, and `lingxi agents`. The `action` seen in a single sample may be the previous autonomous action: while walking, a new action is postponed. If you see `stage busy`, drop it; do not retry.

---

## 11. Boundaries, and what is not finished

It can already be used day to day. The following are the boundaries as they are now, not a wish list on the roadmap:

- macOS only. Windows is not promised.
- Cursor coordinates on a secondary screen are inaccurate.
- Paws outside the stance phase may sit slightly below the ground plane; some curled actions overlap.
- The system pointer cannot be hidden.
- Life variables are not persisted. Utility AI, action cooldowns, and comfort are still in the design.
- The LLM "brain" controls on the main interface are disabled. There is no backend.
- There is no reliable accumulation of companionship duration, so that item on the home page is hidden.
- Agents have no heartbeat. Only "registered / reported recently" can be seen; a disconnect cannot be judged.
- DSH integration is manual steps. There is no one-click button.
- The bubble's centering and the icon position do not have config fields yet. Multi-color support is only a body color and an accent color.
- Skins on the Appearance page are color swatches, not character thumbnails from one shared camera.
- Short-fur v5 is not wired in. Until it satisfies markings, small-size silhouette, and performance at the same time, the voxel skeleton is the product character.

Performance does not state cross-machine CPU/GPU percentage guarantees. When accepting, measure rest, interaction, and hidden separately, on a specified chip, memory, scale, and power state, and compare against a no-cat baseline. Hiding and locking the screen should pause rendering.
