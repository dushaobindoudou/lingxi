<!-- English translation of `docs/archive/13-threejs-preview.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Three.js motion preview

2026-09-11. The user wanted to look directly at the latest model's realtime solid form and motion. This round built an interactive page on top of the third Blender study.

**[Open the private motion preview](https://lingxi-cat-motion-preview.mergedao.chatgpt.site).** It has been published privately. Visitors are limited to the project owner.

## What you can do

- Drag to rotate, scroll or pinch to zoom, switch front / side / back, and reset the view.
- Continuous breathing and a natural blink; trigger a blink, a tail swing, and a slight head turn on their own.
- Pause / play, motion speed, a hair-visibility toggle, and warm-white / dark / gray backgrounds.
- Under the system reduced-motion preference it pauses by default, and can still be played manually.

## Assets actually used

The input is `lingxi-anatomy-study-v3.blend`, exported through a background call of the official Blender MCP, without modifying the original file. The original mesh geometry is kept. 93,137 native hair curves were sampled, and each is shown as a three-segment line. There are 45 render records and about 38.8 MB of model arrays, loaded as files no larger than 16 MiB.

Rendering uses a pinned `three@0.186.0` and OrbitControls. The dependencies and the MIT license are saved with the page. It does not depend on a runtime CDN. The export script is [export_three_preview.py](../../../scripts/blender/export_three_preview.py). The export evidence is [threejs-export.json](../../evidence/threejs-export.json). A chunking step was added after the original export. The final script includes that step.

## Boundary with a finished result

Procedural materials are converted to approximate vertex colors. Line hair does not have Cycles hair scattering or full thickness. The look of the realtime page cannot be called a Blender-equivalent reproduction.

Breathing is done by scaling the body, the tail swing and head turn by part pivots, and the blink by eye scaling and an overlay. The mesh and its hair move together, but a quadruped skeleton, skinning, and eyelid deformation are not done yet. These are motion-effect trials, not a production character rig.

The visual problems of the model itself are still in the [character-study acceptance](12-character-study-review.md). New motion does not mean the form has passed acceptance. Realtime frame rate, power use, and the desktop transparent overlay have not been measured systematically.

## Verification and what was saved

The page JavaScript passed a syntax check. Every model array was checked for offset, length, finite values, and coverage of the body / head / feet / tail / both eyes. The page and the model dependencies return HTTP 200 on this machine. There was no browser screenshot and no automated interaction test. The animation cannot be claimed to have passed visual acceptance.

The page includes a progressively enabled WebMCP motion-control entry. This environment did not verify its registration or its calls. Lack of support for that interface does not affect the ordinary buttons and mouse controls.

The interactive preview is a separate private Sites project. Its source is not mixed into the main repository. The project ID and how to continue locally are in the [preview directory notes](../../../previews/README.md).

## Gap with v4 (2026-09-12)

The preview assets this page describes still come from v3. The [v4 study](12-character-study-review.md) (new eye structure, soft face marking, new ears, denser layered hair, a 24-bone skeleton) has **not yet** been exported to this preview. Reason: the preview is hosted on ChatGPT's Sites product (domain `*.chatgpt.site`; the project ID is recorded in `previews/threejs/.openai/hosting.json`). It was created by another session / tool using that publishing capability. The current Claude Code session does not have that publishing channel. It can only update source files in this repository and the local `dist/` output. It cannot republish a new version to that domain. Also, v4's hair total (about 1.16 million hairs, 40 hair objects) is much larger than v3 (214,819 hairs, 12 objects). Even if the export script caps sampling per object, the model data gets significantly larger. The sampling cap and the chunking strategy have to be decided before export. The v3 parameters cannot be copied over.
