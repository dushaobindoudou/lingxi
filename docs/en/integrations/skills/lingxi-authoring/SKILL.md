<!-- English translation of `integrations/skills/lingxi-authoring/SKILL.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

---
name: lingxi-authoring
description: Author custom content for the Lingxi desktop cat - new action clips, expressions, themes/skins and speech-bubble styling. Use when the user wants the cat to do something it cannot currently do, wants a new look, or asks to edit actions.json / expressions.json / skins.json / bubble.json. Triggers - 自定义动作, 加个动作, 新表情, 换皮肤, 自定义皮肤, custom action, new expression, cat skin, bubble style.
---

# Authoring content for Lingxi

Everything the cat looks like and can do is data in the user's config directory. You can write
these files directly; the app validates and hot-reloads them.

## Where the files are

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/
  actions.json       clip library      (replaces the built-in one wholesale)
  expressions.json   expression set    (same)
  skins.json         themes            (same)
  bubble.json        speech-bubble styling
  textures/*.png     hand-painted body atlases and face sheets
  README.md          written by the app
```

If they do not exist: main window → `外观` (Appearance) → `导出内置资源为模板` (Export built-in assets as a template) writes the built-ins out as a
starting point. Tell the user to click it rather than inventing a file from scratch - editing
49 working clips beats authoring one from a spec.

**After writing, the user clicks `重新加载自定义资源` (Reload custom assets)** (or you can trigger it if you have the
MCP tools). Nothing needs recompiling.

## The rule that matters most

**Every file is validated completely before any of it is applied.** A bad file leaves the
built-in version running and shows the user exactly what is wrong. So:

- Getting it wrong is safe. It will not break their cat.
- But it will also silently not take effect, so **check the error line under `外观` (Appearance)** after a reload.

## actions.json

```jsonc
{
  "schemaVersion": 2,
  "actions": [
    {
      "id": "my-stretch",        // ^[-a-z0-9]{1,60}$, unique
      "name": "我的伸懒腰",       // <= 40 chars; "my stretch"
      "category": "伸展",         // see below; 伸展 = stretch
      "description": "…",
      "duration": 4,              // 0.2-30 seconds
      "priority": 30,             // 0-100
      "expression": "满足",       // MUST exist in expressions.json; 满足 = content
      "tracks": [
        { "channel": "pose.stretch",     "keys": [[0,0], [1,0.7], [3,0.7], [4,0]] },
        { "channel": "head.rotation.x",  "keys": [[0,0], [1,-0.2], [4,0]] }
      ]
    }
  ]
}
```

### Hard rules (the validator enforces all of these)

- **Every track starts at `[0, 0]` and ends at `[duration, 0]`.** Clips are additive offsets on
  top of the rest pose, so one that does not return to zero leaves the cat permanently deformed
  and drifts further with every play. This is the single most common mistake.
- Keyframe times strictly increasing, 2-128 per track, within `[0, duration]`.
- Max 100 tracks, channel names unique within a clip.
- Rotations `|v| <= 2π`; positions `|v| <= 10`; the `pose.*`, `face.*` and `groom.*` channels
  are `0..1` and may not be negative.

### Channels

| Channel | Meaning |
|---|---|
| `<bone>.rotation.<x\|y\|z>` | radians, added to the rest pose |
| `<bone>.position.<x\|y\|z>` | voxels |
| `root.position.y` | voxels; positive = leaves the ground. **Jumps only** - see below |
| `root.position.z` | voxels along the cat's own facing (a lunge); `x` is sideways |
| `pose.sit` `pose.crouch` `pose.loaf` `pose.tuck` `pose.stretch` `pose.curl` | whole-body pose blend, 0-1 |
| `face.blink` `face.tongue` `face.open` | 0-1 |
| `groom.paw` `groom.wash` | 0-1, drives the paw-to-face IK |

Bone names are listed in the `调试台` (debug console). The spine runs
`hipC → spine3 → spine2 → spine1 → neck2 → neck1 → head`; front legs are
`scapL/R → upperFL/R → lowerFL/R → pawFL/R`; hind are `thighL/R → shinL/R → footL/R → pawBL/R`.

**Orientation**: the rig faces `+z` (toward the viewer), `+y` is up, and the cat's own **left is
`+x`**. A positive `rotation.x` on a downward-hanging bone swings its tip backwards; a positive
`rotation.z` swings it toward `+x`.

### Categories decide when it plays

`休息` (rest) `清洁` (groom) `伸展` (stretch) `尾巴` (tail) `互动` (interact) `探索` (explore) `玩耍` (play) get picked automatically while the cat is idle.

- **`特效` (effect) is never auto-picked.** Use it for anything big that should only fire when asked.
- **Nor is anything that leaves the floor**, in any category (see Jumps below).
- A clip that touches **no leg bones and no `root.position`** can play *while the cat walks*.
  Anything else waits until it stops. So a tail flick or a head turn is "free"; a full-body
  stretch costs the cat a pause.

### Writing one that looks good

- **Ease, don't step.** Three or four keys minimum: rest → into the pose → hold → back to rest.
  Two keys reads as a snap.
- **Hold the middle.** A pose the cat holds for a second reads; one it passes through does not.
- **Offset the parts.** Ears/tail leading or lagging the body by 0.1-0.2s is most of what makes
  an action feel alive rather than mechanical.
- **Check it for clipping.** `apps/lingxi/probe-clips.html` (dev server) ranks every clip by how
  far unrelated body parts push into each other. Anything over ~1.0 voxel may be visible.

### Jumps: real gravity, or not at all

Every track may set `"interp"`: `smooth` (default - eases in and out, right for a pose settling),
`linear`, or `ballistic`. A jump's `root.position.y` **must** be `ballistic`; under the default the
cat leaves the floor at zero speed and stops dead at the top, which reads as being hauled up on a
string.

- One hop is three keys: `[takeoff, 0]`, `[apex, h]`, `[land, 0]`, with **rise time = fall time
  = √(2h/g)** - h in metres (voxels × 0.015), g = 9.81. A 3-voxel hop rises in 0.096 s.
- Keep `h` at or under **3.5 voxels** (a third of the shoulder). A desktop pet does not launch itself.
- **Push off before takeoff**: finish un-crouching by the takeoff key and put no `pose.*` key inside
  the flight - legs can only push against a floor that is there.
- **Never hover.** Rearing up or leaning in is a pose plus `z`, with the paws on the floor. Any
  positive `y` that is not a ballistic hop fails `apps/lingxi/test/airborne.test.mjs`.
- A clip that leaves the floor is **never auto-picked**, whatever its category - it plays only
  when the toy logic, the debug console or an agent asks for it by name.
- `apps/lingxi/probe-airborne.html` (dev server) measures the jump on the actual posed body:
  height in cm, hang time, and the gravity the torso really falls at.

## expressions.json

Five layers, one choice each:

```json
{ "我的开心": { "eye": "happy", "brow": "raise", "mouth": "cat", "ear": "forward", "symbol": "none" } }
```

`我的开心` is the expression name ("my happy").

| Layer | Values |
|---|---|
| `eye` | slit round wide side half happy closed heart soft wink-left wink-right sparkle tearful |
| `brow` | flat none furrow raise sad |
| `mouth` | flat cat open frown hiss tongue |
| `ear` | neutral forward airplane back |
| `symbol` | none sweat question exclaim heart sleep anger |

Replacing this file replaces the **whole** set, so keep the names any clip references - a clip
whose `expression` no longer exists fails validation and the entire actions.json is rejected.

## skins.json

```jsonc
[{
  "id": "my-cat",
  "name": "我家的猫",
  "description": "一句话",
  "pattern": "tabby",     // tabby point solid bicolor tuxedo atelier-tabby atelier-silver atelier-calico
  "materials": {          // all ten required, #RRGGBB
    "fur": "#E29A46", "pattern": "#B97835", "cream": "#F3E2C4", "iris": "#F2E7C9",
    "pupil": "#2E2118", "nose": "#DE8C8C", "paw": "#F3E2C4", "mouth": "#5A2A2A",
    "whisker": "#F3E2C4", "tongue": "#E88AA0"
  },

  // optional: replace the generated body art with a hand-painted atlas
  "bodyTexture": { "png": "my-cat.png", "config": "my-cat.json" },

  // optional: replace the procedural face with a grid of drawn expressions
  "faceSheet": {
    "png": "my-face.png",
    "columns": 6, "rows": 5,          // cells numbered left-to-right, top-to-bottom
    "cells": { "安然": 0, "开心": 1, "生气": 7 },
    "fallback": 0
  }
}]
```

`我家的猫` is the display name ("the cat at our house"); `一句话` means "one sentence".
In `cells`, `安然` is calm, `开心` is happy, `生气` is angry. Those strings are expression ids.

Custom skins are **merged over** the built-ins, so reusing a built-in id replaces that theme and
a new id adds one. PNGs go in `textures/` and are referenced by filename.

## bubble.json

Only the fields you want changed:

```json
{
  "background": "#1e1e28", "text": "#f0e6ff", "border": "#8f7fd8",
  "borderWidth": 3, "radius": 20,
  "fontFamily": "\"LXGW WenKai\", \"PingFang SC\", sans-serif",
  "fontSize": 16, "fontWeight": 500,
  "shape": "round", "shadow": true
}
```

`shape`: `round` (normal) · `rect` (square corners) · `cloud` (thought bubble) · `spiky` (a
shout). Colours accept any CSS colour. Fonts must already be installed on the machine.

## Working with the user

Ask what they want the cat to *do* or *look like*, not for JSON. Then write the file, tell them
to hit `重新加载` (Reload), and check the `外观` (Appearance) page for validation errors. If you have the `lingxi` MCP
tools, `lingxi_capabilities` confirms afterwards that your clip actually loaded, and
`lingxi_express` plays it so they can see it immediately.
