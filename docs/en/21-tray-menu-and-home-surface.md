<!-- English translation of `docs/21-tray-menu-and-home-surface.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Tray menu and main-interface design

Status: design and implementation baseline v2, 2026-09-23. It constrains the Tauri native tray menu and the `management.html` management window. The home scene, the task summary, the compact tray, and the desktop window size have been implemented as specified here. This document is the product agreement for later changes; runtime status follows the application's real data.

## Goals

The tray is the shortcut for "a glance while passing by". The main interface is the companion space where you "stop and meet Lingxi". Both share the Rust `TrayState`: menu items change state directly, and when the window opens it reads the same authoritative state. The visuals follow the [brand design system](08-brand-and-design-system.md) and the [design tokens](../../assets/brand/design-tokens.json): warm white, oat, dark brown, and a little warm apricot. Stable states use a low-saturation green. The cat remains a gray-brown tabby, with a warm-white face and front paws, hazel-green eyes, and a pink nose.

The problem with the previous version was that "cards, counts, and Agent rows" dominated the picture, and the cat looked only like a floating sticker. A soothing feeling (治愈) cannot come only from warm colors and rounded corners. It should come first from a believable moment of daily life: the cat has a desktop on which to set its body, warm light and a soft background make a space, and interface text and controls quietly recede to the edge of the scene. v2 therefore changes the hero of the first screen from data cards to "Lingxi resting by the window", and compresses data and connection status to below the scene.

The suggested first version keeps a native macOS menu plus a separate main-interface window, and does not disguise a WebView as a system menu. A native menu's keyboard, focus, and system-theme behavior are more natural. The main interface carries the cat illustration, the status summary, and the richer settings. The main interface is the next layer entered from the tray menu; it is not embedded in the native menu.

## Function and information layout

### Tray menu: only high-frequency actions that can be reversed immediately

Arranged in groups, using native menu rows, checks, and submenus. No colored cards, and no long explanations stuffed in:

1. **Status summary (disabled row)**: `灵犀 · 陪你工作中` (Lingxi · keeping you company while you work). The secondary line shows `目前没有需要留意的任务` (Nothing needs your attention right now), or a count when something has failed or is waiting. It does not offer actions such as approving or cancelling an agent.
2. **Visibility**: `显示灵犀` (Show Lingxi) / `隐藏灵犀` (Hide Lingxi). A single label switches with the current state.
3. **Size** submenu: `小` (Small) / `中` (Medium) / `大` (Large). The current value is checked.
4. **Interaction** submenu: `逗一逗` (Tease) brings out the teaser wand; `收起玩具` (Put the toy away) ends the interaction at any time. A toy is one interaction, not a global `日常` (everyday) / `逗猫` (tease-the-cat) mode.
5. Separator.
6. **`打开灵犀…` (Open Lingxi…)**: opens or focuses the main interface. It is the only main entry. In the system native menu it stays short and clear.
7. **`退出灵犀` (Quit Lingxi)**: always visible, pinned to the bottom.

`形状` (shape) is renamed to `大小` (size). Other toys and effects stay on the main interface or on interaction entries on the cat itself, so the native menu does not become a feature catalog. The tray keeps only the most-used teaser wand and the matching put-away action.

### Main-interface home: meet Lingxi first, then read the status

The main interface is the home page of the existing desktop management window, not a 420×600 phone-style narrow card. The window has landed, as specified here, at **960×680 logical px, resizable, minimum 860×620** (`open_or_focus_management_window`), and it keeps the desktop sidebar navigation. The SVG uses 1200×820 design coordinates to show hierarchy and visual proportion; those coordinates are not the actual Tauri pixel size.

```text
┌──────────────┬─────────────────────────────────────────────────────────┐
│ [Lingxi avatar] │ Right now                 Size S/M/L    Find the cat │
│ Lingxi          │                                                       │
│ You keep at…    │ ┌──────────── resting-by-the-window scene ─────────┐ │
│                 │ │ You keep at what you're doing,   [Lingxi resting] │ │
│ Companionship   │ │ I'm here.                                         │ │
│ Home            │ │ ● keeping you company while you work              │ │
│ Agent connect   │ │ [Tease]                                           │ │
│ Personality     │ └───────────────────────────────────────────────────┘ │
│ Play            │                                                       │
│ Appearance      │ Work partners nearby              Status updates live │
│ Settings        │                 Codex is working · Claude not connected │
│                 │ Sitting quietly still counts as time spent together.  │
└──────────────┴─────────────────────────────────────────────────────────┘
```

App copy in that sketch, on first use: `此刻` (Right now); `大小` (Size) with `小`/`中`/`大` (Small/Medium/Large); `找回猫咪` (Find the cat); sidebar `你忙你的…` (the brand line, truncated); `陪伴` (Companionship); `首页` (Home); `Agent 接入` (Agent connections); `性格行为` (Personality and behavior); `玩法` (Play); `外观` (Appearance); `设置` (Settings); scene line `你忙你的，我在这里。` (You keep at what you're doing; I'm here.); `陪你工作中` (keeping you company while you work); `逗一逗` (Tease); `身边的工作伙伴` (Work partners nearby); `状态实时更新` (Status updates live); `安静地待着，也算一起度过一段时间。` (Sitting quietly still counts as time spent together.).

> Note: the figure above does **not** include the line `一起度过的今天` (today spent together) — there is no reliable contract for companionship duration, so the whole item is hidden (see "Information restraint" and "Development mapping" below). The sketch draws only what is already implemented.

**Visual hierarchy**: ① brand and the existing page navigation on the left; ② the top keeps only the page name and global controls such as size / `找回猫咪` (Find the cat); ③ a large slice of daily life on the home page — Lingxi must be supported by a desktop or a soft cushion, and must use the real character identity of the project logo; ④ one short brand line and one status line; ⑤ below the scene, Agent overview as text rows (companionship duration is added only after its contract is ready), not a stack of status cards.

**Information restraint**: the default home page does not show interaction counts, a growth score, an energy bar, a pending count, or a long task stream. Those turn companionship into a monitoring dashboard. Companionship duration appears as a secondary summary below the scene only when there is real accumulated data. There is no such contract now, so the whole item is hidden; do not pass off time-the-cursor-was-near as companionship time. Agents are summarized only as recent status and task results; a click opens the Agent page for detail. Registered is not the same as online: without a heartbeat contract, show only `已登记/最近有报告` (registered / reported recently), and do not infer a disconnect. The home page does not offer approval or control of agent tasks.

**Soothing-style rules**: use a large area of warm white and light oat; apricot-brown is reserved for one primary button. Scene light leans toward soft daylight, not an orange filter. Plants appear only as blurred outlines or shadows; do not add desktop clutter. Panel edges do not get heavy shadows or stacked cards. The copy is gentle, but it does not presume the user's emotions. The character image must match the actual logo. The background may express atmosphere, but it must not "manufacture cuteness" by changing the cat's face shape and coat color.

### Interaction

| User action | Feedback and result |
| --- | --- |
| Click the Lingxi icon in the status bar | Open the native tray menu. Left- and right-click behavior stays consistent; a custom-drawn popup must not change system habits |
| Choose show/hide | Toggle the desktop cat immediately. The menu title updates with the state, and the main interface updates in sync when it is open |
| Choose size / interaction | Size applies immediately and is persisted. `逗一逗` (Tease) brings out the teaser wand; `收起玩具` (Put the toy away) clears the current toy |
| Click `打开灵犀…` (Open Lingxi…) | Create the window the first time, then focus the existing window. If the cat is hidden, opening the window does not change its visibility on its own |
| Click `逗一逗` (Tease) on the home page | Bring out the teaser wand and interact with the current pointer. Do not modify the persisted mode |
| Click `找回猫咪` (Find the cat) | Call `reset_position` (find it and return it home, and clear facing at the same time). If the capability is absent, the button is not shown; do not offer an empty action |
| Click an Agent row | Open the Agent connections page and expand the corresponding platform. Viewing tasks and connection status is read-only |
| Keyboard navigation | The native menu uses the system keyboard. The main window supports Tab, Enter, Esc, a visible focus, and the system type size |

Motion: the scene itself stays still. Only low-frequency micro-motion such as the cat's breathing and ears comes from the existing real-time renderer. Controls 160 ms, page transitions 220 ms. Respect the Reduce Motion setting. Do not pop windows automatically, do not flash to urge, and do not keep pulling attention.

## Interface assets and compositing

Assets are in [`assets/tray-menu/v1`](../../assets/tray-menu/v1/):

| File | Size/format | Use | Layer rules |
| --- | --- | --- | --- |
| `lingxi-resting-cat.png` | 1254×1254 RGBA | Lingxi in the window-side scene | Transparent character layer; do not change the aspect ratio. The sketch stacks it on the right and sets it down on the desktop line. Production should prefer the real character render, or a unified render confirmed by the character owner |
| `window-desk-scene.png` | 1672×941 RGBA | Warm window light and a light-wood desk background | No character, no text. Cropped on its own to fill the home hero; the desktop line is the baseline that supports the paws |
| `warm-paper-texture.png` | 1536×1024 RGB | Optional low-contrast warm-paper texture | Not required. Only for a slight texture on the base color outside the scene; suggested opacity no more than 12% |
| `home-surface.svg` | 1200×820 SVG | Compositing sketch of the desktop management-window home | Sidebar, text, and controls are vectors. It references the background and the transparent cat externally; the sample status is for the design comp only |
| `personality/quiet-preset.png` | 1254×1254 RGBA | Preview of the `安静` (quiet) tendency | A lightly closed-eye resting pose from the logo identity; an independent transparent layer |
| `personality/lively-preset.png` | 1254×1254 RGBA | Preview of the `活泼` (lively) tendency | The same cat with one paw slightly raised; the motion is restrained; an independent transparent layer |
| `personality/preset-cards.svg` | 780×220 SVG | Card-compositing sketch of the three behavior presets | Externally references the quiet / balanced / lively cat images. The real sliders and descriptions are still carried by the DOM |

Compositing order: warm-white base → desktop scene background → transparent Lingxi PNG (paws aligned to the desktop edge; a very faint contact shadow is allowed) → accessible DOM copy and controls. The scene and the cat must be replaceable separately. The real UI does not bake status text into the image. Do not stretch the character. The desktop line stays horizontal as the layout crops it; on a narrow window, shrink the scene height first, and do not squash the cat's face and ears.

![Home-surface assembly sketch](../../assets/tray-menu/v1/home-surface.svg)

### Asset inventory for the six pages

Not every page needs an illustration. The soothing feeling comes from the whole interface having the air of daily life, from the cat's identity staying consistent, and from functional information not overpowering companionship. Repeating a large scene on form and tool pages adds noise.

| Page | Suitable assets | What this round does | Boundary of use |
| --- | --- | --- | --- |
| Home | A light-wood desk by the window, plus a transparent Lingxi consistent with the logo | `window-desk-scene.png` and `lingxi-resting-cat.png` already exist, composited by `home-surface.svg` | The only large scene on the first screen. Companionship and Agent status sit over or beside the scene; real copy must not be baked into the image |
| Agent connections | Lingxi avatar, small connection-status graphics | Reuse the brand icon. The empty state keeps the small Lingxi avatar and does not add another large illustration | Status icons are drawn with SVG/CSS. Provider names and marks are not produced by image generation. Tasks are read-only, and error copy is clear |
| Personality and behavior | Previews of the three behaviors `安静` (quiet) / `均衡` (balanced) / `活泼` (lively) | Added `personality/quiet-preset.png` and `lively-preset.png`. Balanced reuses `lingxi-resting-cat.png`. There is a three-card sketch | Each about 64–80 px, with a real behavior description. They are visual references for the presets; a static image must not be claimed to be the live action, or a live preview of every slider value |
| Play | Operable previews of the yarn ball, teaser wand, laser dot, and effects | Do not generate stand-in images. Prefer the real 3D toys and effect previews in `src/rig/toys.ts` | Controls must show content that can actually be triggered. Do not let an illustration promise a toy or action that does not exist |
| Appearance | Thumbnail previews of skin characters | Do not generate new skin images. The current nine entries are already in `src/data/skins.json`, but the management page shows only color swatches. Later, generate small live or snapshot previews from the renderer at one shared camera | Every preview must come from the corresponding manifest and from the actual materials of the same cat. voxel-style-kit images must not be treated as the current real-time character |
| Settings | Group icons, privacy and connection-status marks | Use the same set of lightweight SVG icons and the existing status badges. Do not add a cat illustration | Make dense configuration easy to scan. Do not repeat the character decoratively, or manufacture an illusion of "already safe" |

![Personality-preset asset assembly sketch](../../assets/tray-menu/v1/personality/preset-cards.svg)

## Development mapping

Existing entry points: `build_tray` in `apps/lingxi/src-tauri/src/lib.rs` builds the native menu; `open_or_focus_management_window` opens `management.html`; `TrayState` is the authoritative state for visibility and size; the task summary is read from the same `ActivityState`; management-window logic is in `src/management.ts` and `src/management.css`. The main window defaults to about 960×680, minimum 860×620, and is resizable. Do not invent a second state store.

| Design field | Existing state/capability |
| --- | --- |
| Visibility, size | `TrayState`, persisted settings, and the commands of the same names. The tray and the window share them |
| Interaction | `set_toy(feather)` / `clear_toy`, calling the same toy entry. Do not introduce a global mode |
| Companionship duration | There is no reliable accumulated field, so it is hidden. `cursorNearPetMs` must not be used in its place |
| Agent summary | Recent tasks in `ActivityState` plus registered identities. Read-only; do not infer online or completed. Show the source, the status, and the real summary |
| `找回猫咪` (Find the cat) | Top-bar button `topbar-reset` → `reset_position`, shown only when it is actually available. The copy follows `找回猫咪` in the code. This document no longer uses the two wordings `找回灵犀` / `找到灵犀` |
| Skins, personality, connection config | Continue the existing main-interface pages. The home page is only a navigation entry |

Implementation baseline: ① the management window uses the desktop size in this document and keeps the sidebar; ② the hero scene is layered as background plus cat PNG, and status and controls remain accessible DOM; ③ the Agent summary reads the task snapshot from `get_agent_activity`; ④ the tray shows status / the count that needs attention, show/hide, size, the interaction submenu, open main interface, and quit; ⑤ data without a real contract stays hidden, and demo numbers are not filled in. If the character PNG is replaced later, prefer an actual renderer snapshot, to reduce visual character drift.

## Acceptance checklist

- The native menu has no more than 7 top-level rows (submenus do not count). Opening the main interface and quitting are always easy to find.
- The menu and the main interface read and write the same Rust state source. Checks stay consistent after startup restore, reopening the window, and clicking the tray.
- On the home first screen, without scrolling, the full scene, the companionship status, the main interaction entry, and the short Agent status are all visible. A narrow window does not produce horizontal scrolling.
- The cat is naturally supported by the desktop or the cushion, and does not look like a floating sticker. Face markings, eye color, nose color, and white paws match the logo and the actual model.
- Not connected, no tasks, and a failed read each have a clear empty state. An error state is not shown with a green "normal".
- The Agent area does not show approve, reject, cancel, or answer-on-behalf buttons.
- Interaction counts, a growth bar, or Agent cards do not take over the scene's main visual. Texture outside the scene stays light enough that it does not hurt text contrast.
- The tray template icon is legible under both dark and light menu bars. The native menu is left to the system to draw.

## Image-generation record

- `lingxi-resting-cat.png`: generated with `assets/brand/lingxi-icon-v3.png` as the identity reference. It keeps the front-facing round face, upright ears, forehead tabby, white inverted-V face marking, hazel-green eyes, and pink nose, and completes the white chest and white-paw sitting pose. Transparent PNG, no text. This image is still a design asset; at runtime, prefer reusing the actual cat model so expression and materials stay consistent.
- `window-desk-scene.png`: warm window light, a light-wood desk, and a soft-focus environment. It deliberately contains no cat, no text, and no clutter, so the transparent cat layer can be composited on its own.
- `warm-paper-texture.png`: imagegen, an extremely light warm-ivory paper texture, with the center and the lower area kept clean, and with no text or interface controls.
- `personality/quiet-preset.png`: the same logo identity in a lightly closed-eye lying pose, expressing the quiet preset, without a sad expression or an expression that solicits attention.
- `personality/lively-preset.png`: the same logo identity with a front paw slightly raised, expressing curiosity and a tendency to interact, without an exaggerated jump or a gag pose.
- The generation prompts emphasize independent compositing, light warm neutrals, the realism of soft fur, and zero text. Interface text and status are drawn by the DOM and vector layers, so that localization, accessibility, and data truthfulness hold.
- All newly added raster assets are recorded in [`assets/brand/generation-record.json`](../../assets/brand/generation-record.json). Before small sizes go into use, a person still needs to check the facial markings and the transparent edges.
