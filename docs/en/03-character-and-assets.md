<!-- English translation of `docs/03-character-and-assets.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Character and Asset Production Specification

> Historical baseline (2026-09-10): the product is now named Lingxi, and the user requires real-time 3D as the goal. The latest decisions are in the [real-time 3D decision](decisions/001-realtime-desktop.md), [brand design](08-brand-and-design-system.md), and [extension architecture](09-extension-architecture.md). Older recommendations that conflict with the new decisions no longer apply.

Status: written design baseline; visual freeze is not done. The user later added a [product concept board](../source/peipei-concept-board.png). Its visual analysis is in [Visual direction](07-visual-direction.md). A main-cat reference exists now, but face shape and markings are not frozen for each view.

## 1. Character identity

| Item | Original direction | What production still needs to fill in |
| --- | --- | --- |
| Name | 陪陪 / Peipei | Relationship to the project name |
| Age feel | A 3–6 month kitten, not overly infantilized | Confirm with a unified proportion sheet |
| Style | Stylized realism; the original text is about 80% realistic, 20% stylized | An art description, not a measurement metric |
| Silhouette | Head slightly large, body round and soft, paws round | Orthographic views and a unified length baseline |
| Coat | Warm-white body, light gray-brown tabby, pale pink nose and ears | Palette, left/right markings, and back/tail regions |
| Eyes | Gray-green or amber-green, moist, not overly enlarged | Pick one and lock the iris and highlight style |
| Temperament | Gentle, independent, lazy, moderately curious | The body's temperament, see `presets/personalities/`. The numbers are leanings, not a schedule |
| Self | A cat friend. Friend and cat are its nature. The friend is stronger while the user is here; while the user is away it is a cat | See [decision 004](decisions/004-cat-friend.md). The engine does not consume this identity yet |

It is a cat friend. While the user is away it lives its own day. While the user is here it knows them, remembers scenes they were in together, and shows up around a similar time when a scene matches. It can help because it is there, not because it is on duty. With nothing to match, it may still do something of its own, or not come. It rarely speaks. A different character may change the temperament. This relationship stays with this cat.

The weight of friend and cat is nature: which side yields when they conflict. If it is asleep, the friend yields. If the user is here and the cat was part of this scene, the body may still not come. How much of a day looked like a friend and how much looked like a cat is something you can see only afterward. It is not a target, and it does not go into the temperament sliders.

“奶油虎斑” (cream tabby) is a working description for now. The final palette and marking sheet win. Enlarging the head and eyes by 10%–15% is only a starting point for exploration. It must say which base reference it is relative to. It cannot be modeled with no baseline.

## 2. The first formal delivery: a character reference pack

Front, left, right, back, top, and three-quarter views are needed, plus detail of the face, eyes, nose, ears, paw pads, tail, and fur flow. Orthographic views keep the same neutral pose, proportions, ground line, and lighting. The three-quarter view is only for appearance checks. It does not carry dimension callouts.

The delivery must include: a unified size baseline, body-to-tail length proportions, left and right marking sheets, a palette, fur-length regions, fur-flow direction, an approved version, and a change log. The character may be naturally asymmetric. Left and right markings should not be forcibly mirrored just to save work.

AI multi-view images are candidate references. They do not automatically guarantee geometric consistency. Align eye position, ear position, limb length, tail root, and markings by hand first. Only after that passes are they used for modeling. The current concept board can be an aesthetic reference, but it is not yet a production turnaround. This round only defines the delivery specification.

## 3. Production flow and quality gates

| Stage | Inputs and outputs | Condition for entering the next stage |
| --- | --- | --- |
| Concept freeze | Concept candidates → character reference pack | Identity is consistent across views; key appearance has a clear basis |
| Base model | Reference pack → hand-made or AI-assisted blockout | Proportions, silhouette, separated limbs, and tail root are correct |
| Cleanup and topology | blockout → deformable mesh, UVs | Shoulders, hips, eyelids, and tail root can bend, with no obvious broken faces |
| Materials and fur | Mesh → art master | Eyes and the fluffy silhouette are still readable at small size |
| Rig | Model → a reusable control skeleton | Lying, sleeping, and head-raise poses have no obvious interpenetration or collapse |
| Animation | Skeleton → looping clips and transition clips | Every entry and exit pose can connect |
| Runtime product | Master → transparent sequences or a real-time model | Passes visual and performance checks inside the target app |

Blender is the core candidate tool proposed in the raw materials. Meshy / Tripo are only optional sources for an initial model. This round did not evaluate their current quality, price, or license. Whether to use them depends on whether cleanup time is lower than modeling directly. The first closed loop does not need to depend on AI quadruped motion capture.

## 4. Two uses of the assets

The **art master** stores the complete model, materials, fur, rig, and animation. It is used for offline rendering and later edits.

The **runtime product** is decided by the chosen route: the prerender route delivers transparent frames or a verified transparent encoding; the real-time route delivers mesh, textures, skeleton, and baked animation, for example GLB. Do not assume that fur, constraints, and node materials in the art software can enter the runtime with fidelity. Export a sample and verify it.

The original 50–80 bones is only a budget candidate. Control bones and export bones should be counted separately. Fur level is chosen by screen projection size and device load. Do not copy camera-distance rules from games directly.

## 5. The first action delivery

P0 suggests 6 named clips, so that one pose loop can hold first:

| ID | Content | Entry → exit | Playback constraint |
| --- | --- | --- | --- |
| `rest_loop` | Lying and breathing, including natural micro-motion | rest → rest | Loop; mark safe cut-out points |
| `rest_to_sleep` | Lower the head, close the eyes | rest → sleep | Finish the transition before entering sleep |
| `sleep_loop` | Sleep breathing and slight ear motion | sleep → sleep | Loop; mark safe cut-out points |
| `sleep_to_rest` | Wake and raise the head | sleep → rest | Do not jump from deep sleep straight to looking |
| `rest_look` | Look in a limited direction, then return | rest → rest | Left and right variants may be added; arbitrary angles are not promised |
| `rest_pet` | Head-petting reaction | rest → rest | Has a cooldown; the animation cannot be restarted continuously |

These are 6 clips, not 6 product states. M1 adds variants, face-washing, and a stretch according to feedback. Locomotion must have its own walk and settle transitions. Translating a lying image cannot stand in for walking.

The original 25-item action pool is kept as follows: 1 lying and zoning out, 2 sitting and zoning out, 3 looking out the window, 4 licking a paw, 5 washing the face, 6 grooming fur, 7 ordinary sleep, 8 curled sleep, 9 sprawled sleep, 10 rolling over, 11 stretching a paw, 12 dream twitches, 13 looking at the mouse, 14 chasing the mouse, 15 pouncing on the mouse, 16 coming near, 17 rubbing against the window, 18 being petted, 19 curious, 20 happy, 21 sleepy, 22 aggrieved (委屈), 23 doesn't want to deal with you (不想理你), 24 wants to stay with you (想陪你), 25 stretching. Items 19–24 are mainly performance targets and need to be split into actual actions. Items 14–17 involve extra locomotion and desktop capabilities, and do not count as already promised for the first version.

## 6. Delivery information for each animation

Record `id`, character version, entry/exit pose, duration, frame rate, frame size, loop point, safe cut-out points, visual facing, ground anchor, activity bounding box, interaction regions, displacement method, and applicable emotion. Prerendered material also needs alpha method, color space, and per-frame offset marked. Real-time material needs the animation name and the exported skeleton version marked.

Prerendered clips keep the same camera, scale, exposure, ground position, and transparency handling. A crossfade can only handle a small number of compatible poses. It cannot replace a real transition from sleeping to sitting up, or a double silhouette appears easily.

Suggested asset layout (assets not created yet):

```text
assets/peipei/
  reference/       # frozen character views, palette, dimensions
  source/          # Blender master and dependencies
  textures/        # textures
  animation/       # action sheet and source animation
  runtime/        # deliverables of the chosen route
  manifests/      # version, clip metadata, and license sources
```

For every external asset, record the author, source, date obtained, scope of use, and the original file. Check the specific commercial license before purchase. Acceptance should look at both the target desktop size and a magnified view, so it does not only hold in a large promotional image.
