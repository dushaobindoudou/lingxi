<!-- English translation of `docs/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Documentation index

This is the English documentation set. The Chinese `docs/` tree is the source of truth. If an English file and its Chinese source diverge, the Chinese source wins.

## Also translated

These directories are the English counterparts of material outside this index. They are linked here; the files themselves are produced separately:

- [Repository README (English)](../../README.en.md) — language switch with the Chinese homepage
- [`docs/en/repo/`](repo/)
- [`docs/en/integrations/`](integrations/)
- [`docs/en/apps/`](apps/)
- [`docs/en/assets/`](assets/)

The documents in this repository include both **the specs as they are now** and **the records of how things were then**. Both are worth keeping, but reading them mixed together produces contradictory "current states" — for example, a 2026-09-13 audit says "Agent task observation is only a contract", while today posting one `completed` event to `/task-event` makes the cat change expression, play an action, and say a line. Both sentences were true once; one of them has expired.

So every document belongs to one, and only one, of the three layers below. **See which layer it is in before you read it.**

## 1. Current specs — describing the implementation as it is now

Read these before changing code. If they disagree with the code, that is a bug, and one of the two sides should be changed.

| Document | What it covers |
|---|---|
| [`01-project-understanding.md`](01-project-understanding.md) | What the project is meant to become |
| [`02-product-and-mvp.md`](02-product-and-mvp.md) | Product scope and MVP boundaries |
| [`03-character-and-assets.md`](03-character-and-assets.md) | Character definition and asset constraints |
| [`04-life-engine.md`](04-life-engine.md) | Design intent of the behavior engine |
| [`05-technical-architecture.md`](05-technical-architecture.md) | The three-layer architecture and module boundaries |
| [`07-visual-direction.md`](07-visual-direction.md) | Visual direction |
| [`08-brand-and-design-system.md`](08-brand-and-design-system.md) | Brand, icons, and the design system |
| [`09-extension-architecture.md`](09-extension-architecture.md) | Extension and adapter architecture |
| [`11-project-setup.md`](11-project-setup.md) | Environment and engineering conventions |
| [`18-main-interface-design.md`](18-main-interface-design.md) | Information architecture of the main interface (management window) |
| [`21-tray-menu-and-home-surface.md`](21-tray-menu-and-home-surface.md) | Tray menu and the soothing main-interface visual plan, asset compositing, and the development mapping |
| [`19-agent-integration.md`](19-agent-integration.md) | **The authority on connecting Agents**: bridge interface, vocabulary, reaction mapping |
| [`lingxi-technical-plan-v0.1.md`](lingxi-technical-plan-v0.1.md) | An overview written against the current implementation: product, three-layer architecture, voxel character, behavior, desktop shell, and integration. Detail still follows the other specs in this table and `GET /integration` |
| [`20-arbitrary-png-skin-import.md`](20-arbitrary-png-skin-import.md) | Custom skin import |
| [`RELEASING.md`](RELEASING.md) | Packaging, signing certificates, notarization, publishing to GitHub (the same scripts locally and in CI) |

For **runtime** questions of the form "is it installed, is it connected, is it on right now", the documents are not the answer — the `主界面` (main interface) page reached from the tray is read from the running app, and so are `GET /health` and `GET /integration`. Documents describe the design; the runtime answers the status.

## 2. Historical decision records — why it is like this now

The conclusions are still in force, but they record the tradeoffs **of that time**, not the current interface.

| Document | What it covers |
|---|---|
| [`decisions/001-realtime-desktop.md`](decisions/001-realtime-desktop.md) | Why it is a real-time desktop program |
| [`decisions/002-physics-and-game-libraries.md`](decisions/002-physics-and-game-libraries.md) | Why physics and game engines are not introduced |
| [`decisions/003-multi-agent-arbitration.md`](decisions/003-multi-agent-arbitration.md) | How to arbitrate when several agents drive at once |
| [`decisions/004-cat-friend.md`](decisions/004-cat-friend.md) | The cat friend's self: nature is not a time quota, and showing up is not a count |
| [`decisions/005-species-packs.md`](decisions/005-species-packs.md) | Other species join as species packs; what is unified is intent, not the skeleton; finish the cat first |
| [`24-species-pack-design.md`](24-species-pack-design.md) | Architecture design for species packs: intent vocabulary, skeleton roles, locomotion modules, habitat, migration steps (**design document, not implemented**) |
| [`06-roadmap-and-decisions.md`](06-roadmap-and-decisions.md) | Roadmap and stage decisions |
| [`16-desktop-shell-prototype.md`](16-desktop-shell-prototype.md) | Architecture landed during the desktop-shell prototype, and a misdiagnosis |
| [`14-daily-life-action-atlas.md`](14-daily-life-action-atlas.md) | The 64-cell daily-action atlas (the images are not in the repository; see below) |
| [`22-character-v5-lookdev.md`](22-character-v5-lookdev.md) | Look-dev of the short-fur skeleton v5 (not approved, not wired into the app) |
| [`23-bubble-unread-and-copy.md`](23-bubble-unread-and-copy.md) | Bubble notifications and unread state: problem statement and one unified optimization plan (app-side items pending unified implementation) |
| [`12-character-study-review.md`](12-character-study-review.md) | Review conclusions from the character-study stage (the v1 period, before the current voxel skeleton) |
| [`evidence/`](../evidence/) | Measured records from the Blender / MCP period |

## 3. Archive of problems that have been fixed — snapshots of that time, not the current state

**This layer is the easiest to misread as the current state.** Each document is a measurement or a review from one day; after it was written, the code kept changing. Use them as regression lists, not as a status board.

| Document | Snapshot date | Status |
|---|---|---|
| [`RELEASE-READINESS-2026-09-24.md`](repo/RELEASE-READINESS-2026-09-24.md) | 2026-09-24 | Pre-release inventory: stale documents, unfinished items, and a bug list. The document-correction part has landed; the code part has not been touched |
| [`ISSUES-2026-09-19.md`](repo/ISSUES-2026-09-19.md) | 2026-09-19 | Per-item fix conclusions are at the top; still valid as an interface regression list |
| [`CODE-AUDIT-2026-09-13.md`](repo/CODE-AUDIT-2026-09-13.md) | 2026-09-13 | Some conclusions have been overturned by later implementation; there is a note at the top |
| [`archive/`](archive/) | — | Documents from the Blender asset-pipeline period; see [`archive/README.md`](archive/README.md) |

## Why some links point at files that are not in the repository

`.gitignore` deliberately excludes the heavy material from the modeling period (`.blend` files, renders, evaluation frames, export bundles — hundreds of MB; excluding them is what makes this repository cloneable). Documents that describe that material still cite the original paths, because on the machine that produced them the files really are there.

`npm run check` knows this: for a missing target it runs `git check-ignore` once. A target that git deliberately ignores is not a dead link; everything else is still reported as an error. So when the check passes, it also prints a line of the form "N links point at git-ignored working material".
