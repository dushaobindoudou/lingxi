<!-- English translation of `docs/14-daily-life-action-atlas.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Lingxi Daily-Life Action Atlas · 8 × 8

Generated with the built-in imagegen, using a four-view kitten provided by the user as the identity reference. Date: 2026-09-12.

![64-cell daily-action sheet](../../assets/characters/lingxi/reference/daily-life/lingxi-daily-life-8x8-v1.png)

The original image is 1254 × 1254 pixels, 8 rows × 8 columns. Each row is read from left to right. It is a concept overview of actions and expressions, not a precise sequence of frames that can be played directly. A single cell is for the overview. Formal production needs further refinement.

## Action index

The table below records the design intent of each cell. Especially for walk, run, and jump, the contact order, action amplitude, and transitions in the image that was actually generated still need calibration. The index cannot be treated as verified action data.

| Row | Category | The eight cells from left to right |
| --- | --- | --- |
| 1 | Walk | Start, front paw steps out, weight shifts, hind paw follows, step off on the other side, body passes through, hind paw pushes, return to the loop pose |
| 2 | Run | Gather, hind legs load, push off the ground, stretch in the air, front paws reach forward, front paws land, body absorbs, hind legs follow |
| 3 | Jump | Watch the target, prepare, take off, rise, reach with the paws, descend, land, recover a standing pose |
| 4 | Lie down | Prepare from standing, crouch, lower the chest, lie down quietly, rest with eyes raised, chin against the paws, lie on the side, relaxed belly exposed |
| 5 | Sleep | Curl into a ball, sleep pillowed on a paw, sleep lying prone, sleep on the side, sleep on the back, tail against the face, paws covering the face, wake and stretch |
| 6 | Expression | Calm gaze, curious head tilt, slow blink, drowsy, yawn, surprised, slightly displeased, content with eyes closed |
| 7 | Poses and grooming | Sitting, looking back, stretch reaching forward, arched-back stretch, lick a paw, wash the face, scratch an ear, lower the head and sniff |
| 8 | Play and interaction | Look at the wand toy, crouch low and stare at the toy, bat a ball, pounce on the toy, hug the toy, knead (踩奶), rub against the cushion, rest after play |

## Character consistency

Keep the gray-brown tabby, the white inverted-V on the face, white chest and white paws, hazel-green eyes, a small pink nose, a fluffy tail, and soft kitten proportions. Rest, drowsiness, and gentle interaction are the main temperament. Companionship is not performed through a human-style exaggerated smile or by frequently demanding attention.

Markings, proportions, and limb contact still differ across cells because of generation, so the sheet cannot be reverse-engineered directly into a set of 3D animation assets whose identity is fully consistent, and it has not replaced the model in the existing Three.js preview.

## From the atlas to a daily simulation

The next phase should organize the actions into a life process that can continue: rest and sleep, waking and stretching, watching and walking, a short play, grooming, and settling down again. Transitions should keep center of mass and contact. Behavior should have duration and cooldown, rather than switching the 64 cells at random.

Walk and run need left/right limb phase and paw locking. Jump needs takeoff, time in the air, landing, and center-of-mass absorption. Sleep needs breathing and a small amount of rolling over. Expressions need the eyelids, eyeballs, ears, and muzzle to move together. Formal continuous animation still needs a skeleton, skinning, fur that follows, and state transitions.

The full generation prompt and the input and output record are in the [generation record](../../assets/characters/lingxi/reference/daily-life/generation-v1.json).
