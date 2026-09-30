<!-- English translation of `docs/12-character-study-review.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Character Studies and Visual Acceptance

2026-09-11. This document records native 3D studies made through the official Blender Lab MCP the user specified. **Visual acceptance has not passed. The studies do not replace the brand hero image, and they are not the final character.**

## The goal has not changed

The identity basis is always the main cat at the upper left of the [user concept board](../source/peipei-concept-board.png). It needs gray-brown tabby and warm white, a natural white inverted-V face marking, a short muzzle, moist hazel-green eyes, a soft fluffy silhouette, and a lying pose with the head and front paws resting against each other. The user explicitly required “非常治愈” (very soothing). A successful tool connection, a mesh count, and a finished render cannot stand in for that judgment.

## Three actual 3D studies

| Version | Changes and the actual produced evidence | Conclusion |
| --- | --- | --- |
| v1 | [Blender source file](../../assets/characters/lingxi/source/lingxi-anatomy-study.blend), [render](../../assets/characters/lingxi/reference/anatomy-study-v1.png); ellipsoid volumes, eyes, a curve tail, particle fur | The face is obviously pieced together, the eyes stick out, the fur is on the stiff side; it does not meet the target |
| v2 | [Blender source file](../../assets/characters/lingxi/source/lingxi-anatomy-study-v2.blend), [render](../../assets/characters/lingxi/reference/anatomy-study-v2.png); merged face volumes, eye sockets made, fur material reset, face markings and the lying pose adjusted | An engineering study; it still needs character sculpting and region-by-region fur flow; not accepted by the user |
| v3 | [Blender source file](../../assets/characters/lingxi/source/lingxi-anatomy-study-v3.blend), [render](../../assets/characters/lingxi/reference/anatomy-study-v3.png); 214,819 native curve hairs, combed by region, kept off the eye area, thick eye rims replaced | Fur flow is more visible; the expression is still stiff, the eye area still looks like discs, the ears are too thin, and it has not reached the reference quality |

All three versions are offline Blender Cycles renders of real meshes and fur. An image plane was not used to impersonate the cat, and real-time desktop results were not demonstrated. Each version is kept as a production reference. It cannot be a reason to lower the quality target. The curve count of the third version only describes the study's structure. It does not mean quality or performance has been met.

## Specific problems found

1. **The facial anatomy is still not natural.** Merging ellipsoids and an eye-socket boolean only partly solved the seams and the bulging eyes. The eyelids, forehead, cheeks, and short muzzle still lack a continuous sculpted relationship.
2. **Fur flow is still not natural enough.** v1/v2 particle hair mostly grows outward from the surface. v3 already has different comb directions for the forehead, cheeks, chest, paws, and body, but clumps, undercoat, and guard hair lack layers, and the ear edges are still not natural.
3. **The tabby is a procedural stripe experiment.** The forehead stripes, the markings on both sides of the face, and the back stripes have not been calibrated. A runtime skin should use a UV/mask that can be checked. It cannot depend on each primitive's own coordinates.
4. **The eyes still need a complete structure.** v3 replaced the thick eye rims with a thin outline, but that is not a complete eyelid, and the eyes still have a disc-like look. Readability at small size should come jointly from the iris, cornea, eyelid coverage, and gaze direction. The spheres and highlights cannot keep being enlarged without limit.
5. **There is no production rig yet.** The v1 body-scale keyframes are only a placeholder for breathing. There is no blink deformation, quadruped skeleton, action blending, or runtime fur asset.

## What to solve first next

First correct the front, side, and lying-pose proportions of the same cat, finish one head with real eyelids and a short-muzzle structure, then make a region-by-region Groom. Expand to full-body topology, bones, and actions only after the head matches the original main image. Hold further skins and behavior animation for now, so assets do not accumulate on a look that has not passed.

Production acceptance uses the checks below. Aesthetic judgment is not disguised as a precise score:

| Check | Pass condition |
| --- | --- |
| Identity | Seen beside the original main cat, the face markings, face shape, ears, and look in the eyes still seem like the same cat |
| Sense of relaxation | The default lying pose has weight and support, the neck and shoulders are relaxed, and the eyes are not frightened and do not demand attention |
| Sense of softness | Continuous fur flow and a layered silhouette are visible; no stiff brush, no smooth plastic surface, no hard seams |
| Leaving the set | Still natural on a dark desktop, a light desktop, and a transparent background; it does not depend on a photo of a warm room |
| Actual size | At a height of 160–240px the face, the look in the eyes, and the front paws can still be told apart; that size is the prototype check range |
| Continuous motion | Later breathing, blinking, and the rest loop do not interpenetrate, slide, or grab attention often |
| User feedback | The user is willing to leave it on the desktop every day; an automated test cannot declare “治愈达标” (the soothing bar has been met) |

## Reproduction and the verification boundary

In an already started, separate official Blender MCP design session, run in order:

```sh
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool execute_blender_code --code-file scripts/blender/create_cat_study.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool execute_blender_code --code-file scripts/blender/refine_cat_study.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool execute_blender_code --code-file scripts/blender/groom_cat_study.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool render_viewport_to_path --arguments '{"output_path":"anatomy-study-v3.png"}'
```

The suggestion is to reproduce it in a new, separate design session. Each script creates a new scene. Calling them repeatedly keeps the old versions and increases the file size. The official render tool writes output to Blender's temporary directory, ignores the directory that was passed in, and keeps only the file name. Save the product from the returned `filepath`. Do not claim the file has been written into the repository based only on the requested path.

Evidence for this call: [v1 create](../evidence/blender-anatomy-study.json), [v1 render](../evidence/blender-anatomy-render.json), [v2 create](../evidence/blender-anatomy-study-v2.json), [v2 face-marking fix](../evidence/blender-face-mask-fix.json), [v2 render](../evidence/blender-anatomy-render-v2.json). The final script includes the face-marking fix. Script syntax and engineering tests can verify an executable structure. Character appearance, action quality, and GPU cost still need to be accepted separately.

Third-version evidence: [create](../evidence/blender-anatomy-study-v3.json), [render](../evidence/blender-anatomy-render-v3.json), [independent background reopen check](../evidence/blender-study-reopen.json). After the saved file was reopened, 19 mesh objects, 214,819 curve hairs, a valid camera, and transparent render settings were confirmed. The current character material has no reference image node. The native curves are not yet bound to surface deformation. An action cannot be added to the body and the fur then assumed to follow correctly.
