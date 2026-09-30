<!-- English translation of `docs/decisions/001-realtime-desktop.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# ADR 001: Lingxi Targets Real-Time 3D

Date: 2026-09-11. Status: the user has confirmed the real 3D goal; the specific runtime choice is a suggestion pending verification. This decision replaces the "prerender first" current route in the old documents. The old plan is kept for historical comparison and for offline preview.

## Decision

A unified Blender character master provides geometry, textures, skeleton, actions, and Groom. The desktop renders a real mesh and skeleton in real time, for continuous gaze, local motion of the eyes, ears, and tail, skin changes, and action blending. Prerender is used for promotion, comparison, and asset preview. An image plane must not be passed off as the final character.

The suggested first technical verification on macOS: **an AppKit transparent, non-activating NSPanel + WKWebView + Three.js WebGL2 real-time rendering**. The settings UI can use SwiftUI later. Across platforms, window capabilities are implemented through `DesktopHost`. Windows may use a Tauri shell. The same GLB and behavior contract can be reused. The native host is not mixed into the character code.

First use the predictable WebGL2 route to measure look and power. WebGPU is an optional backend after verification on real hardware. If material quality, fur sorting, or energy use does not meet the target, the second candidate is AppKit + native Metal rendering. That then carries the development cost of fur, animation, and asset loading. Do not treat an existing habit of Web technology as a mandatory constraint.

## Desktop presentation

The window border is off, the background is transparent, and the content keeps alpha. Always-on-top and an all-desktops policy are supported, but focus is not stolen. Input is handled by the character's hit region. Transparent regions are click-through. Drag, hide, and quit from the tray are always available. Size decides LOD from screen pixels. Fullscreen apps, screen recording, the lock screen, and low battery may hide automatically or drop the frame rate. The specific behavior is configured by the user.

Apple's documentation says NSWindow carries the window and events, and Metal presents through CAMetalLayer. A transparent always-on window cannot borrow the performance conclusions of its "opaque fullscreen direct-to-display." [Apple windows and Metal](https://developer.apple.com/documentation/metal/managing-your-game-window-for-metal-in-macos)

A Tauri macOS transparent window involves its specific configuration. It cannot be assumed that every platform is compatible at zero cost. [Tauri configuration](https://v2.tauri.app/reference/config/)

## Asset requirements for reaching the reference image's realism

- Body: a continuously deformable quadruped topology, a real scapula, spine, and center of mass, and mildly neotenous proportions.
- Eyes: eyeball, iris, pupil, cornea, eyelid closure, tear line. Highlights change with the lighting. Do not make the eyes into black glass spheres.
- Fur: the Blender offline master uses a region-by-region Groom. At runtime, first compare fine Hair Cards / shells with local high-quality fur clumps. The key cheeks, ear edges, chest, and tail keep their silhouette. Every material needs a real export check.
- Actions: breathing, blinking, a gaze delay with the eyes leading the head, independent ears and tail. Base poses and local actions are blended in layers. Minimum dwell and cooldown are managed by the behavior system.
- Lighting: a soft fixed key light and fill, keeping a sense of contact. Do not read the user's desktop pixels to fake physically based environment lighting.
- Skins: a unified rig, material slots, marking masks, and an LOD contract. When a body-shape change is outside the compatible range, use a new rig version.

It cannot be promised that a Geometry Nodes Groom in a `.blend` becomes a GLB unchanged. USD/GLB output should be made for what the target runtime actually supports. Test the eyes and one patch of fur first, then expand to the whole body.

## Reproducible experiment and pass conditions

1. Output a Cycles reference frame and a real-time desktop frame of the same cat, from the same camera and size, and record the gap.
2. Test cat sizes of 256, 384, and 512px, and dark, light, and cluttered desktops. Continuous head turns, blinking, breathing, and the fur edge have no obvious pops.
3. Test operating the application underneath through transparent regions, dragging, multi-monitor scaling, not stealing focus, and a reliable quit.
4. Record CPU, GPU, memory, frame time, and energy on the target machine. Do not treat a percentage wish as a measurement.
5. If the target fur quality is not met, keep changing the assets or evaluate native Metal. Do not replace visual acceptance with "the user will not notice."

Current evidence: Blender 5.2.1 and the official MCP have been verified, and the design working scene has been saved. **A finished character and a desktop render prototype are not done, and there is no conclusion that realism or performance has been met.**
