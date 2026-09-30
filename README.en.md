<!-- English translation of `README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

[中文](README.md) · **English**

[![CI](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml)

# 灵犀 Lingxi

> You do your work. I am here.

A quiet 3D kitten that lives on the desktop. It walks itself along the screen edge, does its own things, stays out of your mouse,
plays when you tease it, and reacts when your agent finishes a job.

<img src="assets/brand/lingxi-icon-v3.png" width="200" alt="Lingxi: a grey-brown tabby kitten lying quietly, two small white paws showing" />

macOS · Tauri 2 + Rust + TypeScript + Three.js · no third-party runtime dependencies (other than three and Tauri itself)

---

## What it can do now

- **It lives on its own.** It patrols along the screen edge and turns corners (there is a turning radius; it does not spin in place). While it walks, its feet **plant on the ground**
  (the stance-phase foot is stationary in world coordinates). When it stops, it plays an action and changes expression by itself.
- **It stays out of your work.** The mouse is where you are working, so it does not go there — it will not even pick a footfall near the cursor.
- **It can play.** A yarn ball (follows the mouse, click to charge, fling it; it rolls and bounces, and the cat chases and bats), a wand (the cat stalks,
  rears up to reach, and jumps from a stand), a laser pointer (with a trail; it can never catch it).
- **It reacts.** If the mouse rests on it, it looks up at you; stroking back and forth makes it squint and purr; a double-click gets a head-nuzzle.
- **It talks.** A comic bubble above its head, pinned to the skull's projection, and it keeps up through crouching, jumping, and camera changes.
- **It can perform.** Three full-screen effects, staged like anime camera work: rushing out from the depth of the screen and growing, speed lines, a hit flash to white, screen shake.
- **It can be changed.** Actions, expressions, and themes are editable JSON; hand-drawn body atlases and expression sheets are supported.
- **It connects to an agent.** MCP server + Claude Code hooks + plain HTTP. Task completion and failure get an expression and an action,
  it can remember things about you, and it can remind you a little later.

---

## Run it

You need Node.js 22+ and Rust (`rustup`; `rust-toolchain.toml` in the repo pins the version).

```sh
npm ci --ignore-scripts
cd apps/lingxi && npm ci

npm run tauri dev            # develop
```

**Packaging and publishing** go through scripts. Do not run `tauri build` directly — the package that comes out is incompletely signed, and sending it to someone else shows "damaged":

```sh
./scripts/release.sh               # test → universal binary → sign → verify; artifacts in release/v<version>/
./scripts/publish-release.sh       # tag, push, and publish to GitHub Releases
```

Version numbers, the signing certificate, CI publishing, and troubleshooting are in [`docs/RELEASING.md`](docs/RELEASING.md) (Chinese).

The tray icon contains (7 rows, tightened in [`docs/21`](docs/en/21-tray-menu-and-home-surface.md)):
two lines of status summary, show/hide, size (small / medium / large), interaction (`逗一逗` give it a poke / `收起玩具` put the toys away), `打开灵犀…` (Open Lingxi…), `退出灵犀` (Quit Lingxi).
The debug console, toys, effects, and every setting live in the main window. The tray is not a feature directory.

### Dev helper pages

After `npm run dev` (inside `apps/lingxi`) you can open these. They are not in the packaged app:

| Page | Purpose |
|---|---|
| `/app-harness.html` | Run the real render path without Tauri, and debug it in a browser |
| `/probe-gait.html` | **Regression probe**: body jitter, feet slipping, free-mode behavior stats |
| `/probe-clips.html` | Check each action for clipping, sorted by severity |
| `/probe-airborne.html` | **Regression probe**: a jump's real height, hang time, and the gravity the torso falls at; add `?strip` for a side view |
| `/probe-framing.html` | **Regression probe**: how much of the cat each screen edge crops, per camera and per size |
| `/probe-unproject.html` | **Regression probe**: whether screen coordinates ↔ world coordinates are invertible everywhere (it used to fail at the bottom of the screen) |
| `/rig-preview.html` `/style-lab.html` | Skeleton and palette experiments |

`probe-gait.html` is the regression check for several structural bugs. The healthy values are written at the top of the file. Read it before you change the animation system.

---

## Architecture

Three layers. They talk to each other only through contracts, and any layer can be replaced on its own.

```
packages/life-engine        A pure behavior state machine. No DOM, no rendering, no Tauri.
     │                      It knows only a 2D world and a cursor. Unit-testable.
     │  snapshot { state, position, heading, toy, ... }
     ▼
apps/lingxi/src/renderer    The Three.js scene. It does not know the desktop host exists.
     │                      Skeleton / gait / spine bend / camera / theme / effect layer
     ▼
apps/lingxi/src-tauri       Window, tray, settings persistence, the local HTTP bridge
```

The points that matter:

- **Heading is held by the engine. It is not inferred from displacement.** The cat can only move forward along `heading`. Turning has an angular-speed cap and a minimum
  turning radius. This is the root of a lot of stability problems — once heading is the derivative of position, any jitter in position becomes
  jitter in heading, and the camera's perspective scale amplifies it.
- **Gait is driven by distance, not by the clock.** One stride of ground distance advances one gait cycle, so the feet do not slip at any speed.
- **Landing height is a property of the pose**, not "whichever paw is lowest this frame".
- **The boundary is computed from the body, not from the anchor, and it has two layers.** The point the engine drives is the cat's **feet**. The whole body is drawn
  above them, so the four edges cannot share one margin — 24px on the top edge shoves the entire cat off the screen. The renderer measures the body's actual span
  on screen (`screenExtent()`), and the host turns that into two boxes:
  the **limit** (where dragging, toys, and full-screen effects may go) allows half the body off-screen, on all four edges;
  **free roaming** (where the cat decides to go) still shows half of it on the left and right (that look is meant to stay), while top and bottom keep the whole cat on screen —
  the cat is about three times as tall as it is wide, so the same ratio cuts the side of the body on the sides and cuts off the **head** on the top, and the expression is the point.
- **Dodging the mouse is not only "flee". It also goes around.** There used to be only two reactions: avoid the cursor when picking a target, or run when the cursor presses in.
  The most common case in between was unhandled — the target is on the other side of the cursor, so the cat walks straight across it. Now, while moving, it aims at
  the **tangent** of the cursor's exclusion zone and goes around (not a sideways push, which decays away just as it arrives). Only the desired heading changes.
  Turn rate, slowing for a corner, and gait are untouched. Measured time spent inside the exclusion zone with a still cursor: 1.22% → 0.00%;
  with the cursor jumping among five positions: 8.15% → 2.94%.
- **The effect layer is DOM/SVG, `pointer-events: none` the whole way.** A full-screen effect never swallows a single click of yours.

Details are in [`docs/05-technical-architecture.md`](docs/en/05-technical-architecture.md).
Early documents that are out of date but still worth reading are in [`docs/archive/`](docs/en/archive/README.md).

---

## Customization

Main window → `外观` (Appearance) → `导出内置资源为模板` (Export built-in assets as a template) writes the following into the app config directory:

```
assets/
  actions.json       action library     after editing, click 「重新加载」 (Reload) in the UI; no rebuild
  expressions.json   expressions
  skins.json         themes
  textures/*.png     hand-drawn body atlases / expression sheets
  README.md          format notes (written by the app itself)
```

**Every file is fully validated before any of it takes effect.** A bad format keeps the built-in version and shows, in the UI, exactly which line is wrong.
You will not get half a face or a joint twisted off.

---

## Connecting an agent

A local HTTP bridge (`127.0.0.1:47811`, loopback only), three ways in: MCP server, Claude Code hooks,
and HTTP directly. The full notes are in [`integrations/README.md`](docs/en/integrations/README.md).

```jsonc
// any MCP client
{ "mcpServers": { "lingxi": { "command": "node", "args": ["<repo>/packages/mcp-server/src/index.mjs"] } } }
```

Thirteen tools: register an identity, report a task, see capabilities, see status, speak, expression/action, full-screen effect, place a toy,
remember one thing, read memories back, set a reminder, change camera and theme, reload custom assets.

**The right posture for an integration is to report what you are doing, not to direct the cat** —
`{state:"failed", kind:"deploy"}` is better than "play shake-head", because the mapping is in the user's hands
(`assets/reactions.json`), and one edit applies to every agent.

Several agents connected at once is normal: each registers an emoji badge, and beside the cat you see who is driving;
when performances conflict, they are arbitrated by how urgent the **event** is (failure > completion > status > atmosphere), **not by agent identity** —
what the user should see is the thing that matters, not the tool that matters.

The full specification is [`docs/19-agent-integration.md`](docs/en/19-agent-integration.md).
The design reasons are in [Decision 003](docs/en/decisions/003-multi-agent-arbitration.md).
A running app serves the contract verbatim from `GET /integration`, and that is what wins.

---

## Tests

```sh
npm test          # unit tests for every package
npm run check     # project convention checks
cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test
```

Behavior, turning, toys, and interaction reactions all have tests. Rendering and animation are a poor fit for unit tests; use the probe pages above for quantitative regression.

---

## Where it stands, and the edges

**It works, in daily use.** But what it does not do should be said plainly:

- macOS only. Window, tray, and cursor reading all go through AppKit.
- On multiple displays, the cursor's y flip is computed from the primary screen only, so it is wrong on a secondary screen.
- A paw mid-swing can drop below the ground plane by at most about 0.7 voxels. The desktop does not draw a floor, so the clipping is invisible. The real fix is
  world-space foot locking plus two-bone IK.
- Some curled actions (roll, lie on the side, scratch an ear) overlap the hind legs and the torso. See the ordering in `probe-clips.html`.
- The system mouse pointer cannot be hidden, so the wand and the laser are drawn at the cursor, not a replacement for the pointer.
- The personality sliders are only persisted for now. The behavior engine does not consume them yet (the UI marks them `即将生效` (coming soon)).

---

## Document index

The repo holds both the current specification and snapshots from the time. [`docs/README.md`](docs/en/README.md) puts every document into one of three layers —
**current specification / historical decision / fixed-and-archived**. Read that before you read an old audit, or it is easy
to take the conclusions of 2026-09-13 as today's state.

| Entry | Contents |
| --- | --- |
| [**Layered document index**](docs/en/README.md) | Which document describes now, and which only records then |
| [中文文档](docs/README.md) | Chinese sources. Those win if a translation diverges |
| [Full specification for integrating an agent](docs/en/19-agent-integration.md) | **Read this before you write an integration**: vocabulary, priority, customization, proving it took effect |
| [Technical architecture](docs/en/05-technical-architecture.md) | How the three layers divide the work, and the contracts |
| [Behavior system](docs/en/04-life-engine.md) | Behavior design of the pure state machine |
| [Main-window design](docs/en/18-main-interface-design.md) | Information architecture of the management window |
| [Extension architecture](docs/en/09-extension-architecture.md) | Interface boundaries for reskinning / personality / agent observation |
| [Brand and design system](docs/en/08-brand-and-design-system.md) | The name, the visual baseline, icons, and UI variables |
| [Decision 001: the realtime desktop approach](docs/en/decisions/001-realtime-desktop.md) | Why realtime 3D rather than pre-rendered |
| [Decision 002: physics and game libraries](docs/en/decisions/002-physics-and-game-libraries.md) | Why Rapier / a game framework is not introduced |
| [Decision 003: multi-agent arbitration](docs/en/decisions/003-multi-agent-arbitration.md) | The tradeoffs of priority, attribution, and authentication |
| [Config directory](docs/en/apps/lingxi/src-tauri/README-config.md) | Where runtime data lives |
| [Early document archive](docs/en/archive/README.md) | Design and experiment notes that are out of date but still worth reading |

---

## Community

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

## License

See [LICENSE.md](LICENSE.md). The repository is still a private incubation and **has not chosen an open-source license**. The maintainer decides that before a public release. This file does not imply MIT or Apache.
