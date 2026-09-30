<!-- English translation of `docs/05-technical-architecture.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Technical Architecture and Verification

> Historical baseline (2026-09-10): the product is now named Lingxi, and the user requires real-time 3D as the goal. The latest decisions are in the [real-time 3D decision](decisions/001-realtime-desktop.md), [brand design](08-brand-and-design-system.md), and [extension architecture](09-extension-architecture.md). Older recommendations that conflict with the new decisions no longer apply.

Status: candidate technical design. No app has been created, and no runtime verification has been run. Official sources were checked on 2026-09-10.

## 1. Module boundaries

| Module | Responsible for | External boundary |
| --- | --- | --- |
| Desktop Shell | Window, tray, hide and quit, screen coordinates, system lifecycle | Emits normalized environment events |
| Cat Life Engine | Life state, candidate scoring, cooldown, legal transitions | Requests semantic behavior; does not depend on a specific rendering technology |
| Animation Director | Turns behavior into an action sequence the current assets support | Manages entry and exit, safe cut-out, completion and failure |
| Renderer | Transparent animation playback or real-time model presentation, local hit regions | Reports supported capabilities and playback events |
| Local Store | Versioned settings, position, life state | Migratable; corruption can fall back |
| Optional AI Adapter | Summaries, intent validation, budget and timeout | Can only affect permitted high-level tendencies |

The renderer should expose capabilities, for example limited-direction observation, whether autonomous movement is supported, and whether local micro-actions are supported. The behavior layer cannot request a capability that does not exist. Do not build a complete plugin platform in P0 just for replaceability.

## 2. Rendering-route comparison

| Route | Suited to | Main constraints | Current handling |
| --- | --- | --- | --- |
| Offline prerender of a fixed character, played back at runtime | High-quality fur, limited camera positions, quiet rest | Storage and decode cost, action seams, number of directions | Preferred P0 candidate |
| Simplified-model real-time 3D | Continuous gaze, independent eyes/ears/tail, flexible displacement | Material and fur development, transparent compositing, power | Make a small sample as a comparison |
| Prerendered body with real-time parts composited on top | Local control while keeping some offline look | Occlusion, seams, lighting, and view matching are complex | Not adopted without a dedicated verification |

This project recommends defining "hybrid" first as **a unified 3D master producing the assets, with runtime behavior dynamically directed**. Do not use the same word to also promise hybrid compositing of the body and the parts. Choosing full real-time later is not an inevitable upgrade. If prerender already meets the core experience, it can stay for the long term.

## 3. Candidate tools and known boundaries

Tauri is the desktop-shell candidate. React can be used for the settings UI, but the animation loop should not depend on React updating every frame. The transparent-sequence route does not require Three.js or WebGPU.

Tauri's official configuration notes: macOS transparent-window capabilities involve the `macOSPrivateApi` setting. Whether to adopt it, and its effect on the target distribution channel, should be checked at the prototype stage. Cross-platform transparent windows cannot be treated as a switch that needs no verification. [Tauri configuration reference](https://v2.tauri.app/reference/config/)

Three.js's `WebGPURenderer` tries WebGPU by default and provides a WebGL 2 fallback. That capability does not prove that transparency, materials, and animation are all fine in the target Tauri WebView. They must be tested in an actually packaged app. [Three.js official notes](https://threejs.org/manual/en/webgpurenderer)

Fur, material, and animation export from Blender to GLB is still listed as an engineering verification item. This round did not succeed in reading the current Blender export manual, so it does not claim that a specific version's support range has been checked.

## 4. Verification checklist for living on the desktop

First make a minimal transparent-window prototype, and confirm:

- The visible cat region accepts interaction, and transparent regions allow operating the application underneath. Window-level click-through is not automatically the same as per-pixel hit testing.
- The cat can be shown without activating the window. Focus behavior of the settings window and the cat window is verified separately.
- Cat-region hover, dragging, and click-through switching do not deadlock. When global input permission is missing, restore and quit through the tray still work.
- After multiple monitors, scaling, negative coordinates, and a display being unplugged, position is clamped to the visible work area.
- Lock screen, sleep, resume, fullscreen apps, and desktop switching have explicit behavior. The MVP may prefer hiding rather than always covering.
- Do not treat other applications' window bounds, or global keyboard and mouse input, as capabilities Tauri has by default. Verify them per platform.

The first version can use only input on the cat region. It does not need to record keyboard content, window titles, the screen, or the microphone. Later perception collects only data the feature needs and the user has turned on. Cloud AI does not receive raw content by default. When the system refuses a permission, reduce capability rather than blocking basic companionship.

## 5. Asset and performance budget

Prerender is not naturally low-memory. For example, a 512 × 512 RGBA frame, at 30 fps, fully decoded for 10 seconds, occupies about 300 MiB (not counting extra cache). Compressed file size does not represent runtime memory. So segmented loading, a frame-cache cap, picking assets by size, and the actual decode method all need testing.

Whether a transparent encoding is supported in the target WebView, whether it is hardware-decoded, and whether the alpha edge is correct, are all prototype conclusions. P0 can first use a short transparent sequence to rule out encoding interference, then evaluate the formal delivery format.

The original CPU <2%, GPU <5%, memory <300 MB (ideal <200 MB) is recorded as an **aspirational budget pending measurement**. It cannot be a uniform guarantee across machines. The suggestion is to freeze the acceptance definition in P0 after the minimum target device is specified:

| Condition | Must record |
| --- | --- |
| Device | Chip, memory, OS, monitor count and scale, battery or plugged in |
| Software | App version, WebView, render backend, asset version |
| Picture | Cat pixel size, actual frame rate, playback state, time running |
| CPU | Measurement tool, whole-machine / single-core definition, total of the app and child processes |
| GPU | Measurement tool and utilization definition; do not compare directly with other platforms |
| Memory | Total of the app, WebView, and related processes; peak and steady value |
| Smoothness | Frame interval, stutter, action seams; record reproducible samples |
| Energy | Energy, temperature rise, or fan change against a no-cat baseline |

The suggestion is to warm up, then sample rest, continuous interaction, and hidden for 10 minutes each, and then check whether a long run keeps growing. Rest and interaction frame rates are set by sample quality. While hidden or locked, pause rendering and decisions that are not needed. The formal budget is decided jointly by the measurements and what users will accept.

## 6. Failure and recovery

If a resource fails to load, return to a usable idle or an operable placeholder screen. An LLM timeout does not affect life. A corrupt state file restores the defaults. After a drag or a display change, coordinates are constrained again. User quit has the highest priority. Record the failure reason and the asset version. Sensitive raw input is not recorded by default.
