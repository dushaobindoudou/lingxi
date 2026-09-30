<!-- English translation of `docs/archive/19-voxel-style-kit-handoff.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Lingxi: handoff for simple 3D skins, expressions, and motion

This plan uses the repository file `voxel_cat_face_layer_composer.html` as the art reference and reuses the existing `lingxi-cat-v1` block skeleton. The goal is a warm, clean desktop cat whose expressions read clearly. Keep the block structure. Do not go back to high-fidelity fur or realistic materials.

> A later requirement revised this to **covering the whole body after any PNG is imported**. That feature is now implemented in the lab. It supports tiling, stretching one image across the faces, and partial UV JSON. Usage and the integration code are in [the arbitrary-PNG import plan](../20-arbitrary-png-skin-import.md).

## 1. Look at what is already done

```sh
cd apps/lingxi
npm run dev
# Open http://localhost:1420/style-lab.html in a browser
```

The lab is independent of the formal pet window. The existing Vite production input does not include this development page. `npm run build` type-checks its TypeScript, but it does not ship the page in the formal application.

| Deliverable | Path | Current status |
|---|---|---|
| 3D lab | `apps/lingxi/style-lab.html` | Runnable: six skin swaps, camera, walk, expression combinations, eight small actions |
| 3D integration example | `apps/lingxi/src/style-lab/main.ts` | Reuses the real skeleton, replaces materials, mounts the face decal, swaps skins, tries on a PNG, and exports |
| Art drawing code | `apps/lingxi/src/style-lab/art.ts` | Body atlas, Canvas compositing of the features, ten expression presets |
| Motion sampling code | `apps/lingxi/src/style-lab/motion.ts` | Samples keyframes by the second and outputs rotation offsets relative to the base pose |
| Source config for the six skins | `apps/lingxi/src/style-lab/skins.json` | Colors, marking type, and name |
| Materials ready to use | `assets/characters/lingxi/voxel-style-kit/` | Six body PNGs, six transparent expression PNGs, six skin JSONs with UVs, expression and action JSON, a palette overview |
| Offline export script | `scripts/export-voxel-style-kit.mjs` | Generates the materials with the same drawing code. It does not maintain a second copy of the drawing logic |

**The formal Tauri admin page and the desktop cat are not yet wired to this skin set.** The lab's selection is stored in its own `lingxi-style-lab-skin` localStorage key. A PNG try-on lasts only for the current page. The next implementing model needs to finish the formal integration in section 7.

## 2. Why the reference design works

The reference file's key colors are kept directly in "Apricot-Sugar Letter":

| Color role | Color | Where it is used |
|---|---|---|
| Warm apricot orange | `#E29A46` | Main coat |
| Cream | `#F3E2C4` | Bib, chest, socks, whiskers |
| Bean-paste pink | `#DE8C8C` | Nose, inner ear |
| Pale rice-gold | `#F2E7C9` | Iris |
| Deep cocoa | `#2E2118` | Pupil, mouth line |
| Low-contrast caramel | `#B97835` | A few stripes |

Rules of execution:

1. The main color forms a large continuous shape. Markings are a local identity feature. Do not paint repeating horizontal stripes on every torso joint. Do not cut the body up with black stripes.
2. Make the face readable at small size first, then add detail. The pupil, the mouth line, and the light bib form the main contrast. Eyebrows may be hidden by default.
3. The nose and the inner ear share the same pink. The bib and the socks share cream. Do not pick a separate color for every part.
4. The body uses a clear pixel pattern. The face may use anti-aliased curves. Simple 3D does not require every mouth line to be a solid box too.
5. The coat texture does not bake directional light and does not paint strong highlights. Lighting is provided uniformly by the scene. Use an sRGB color texture, non-metallic, rough.
6. The palette card is the accurate color match. The final 3D color is still affected by lighting. Check it against a preview with fixed lights and a fixed camera. Do not check HEX alone.

The existing painter in `atlas.ts` paints stripes segment by segment across multiple body, neck, and leg nodes. This set's `paintSkin()` changes that to two small markings on the torso, a fine marking on the top of the head, and a few tail markings. The six skins share one skeleton. They do not manufacture "fur" with random noise.

## 3. The six skins

| ID | Name | Style | Main / marking / light / iris |
|---|---|---|---|
| apricot-letter | Apricot-Sugar Letter | Warm apricot tabby | `#E29A46` / `#B97835` / `#F3E2C4` / `#F2E7C9` |
| moon-oat | Moonlight Oats | Oat colorpoint | `#D7C7AE` / `#9B8774` / `#F4EBDD` / `#9AABA3` |
| mist-blue | Mist-Blue Sleepy | Solid mist blue, white socks | `#8E9DA8` / `#6D7D89` / `#E6E8E3` / `#B9CBB3` |
| cocoa-snow | Cocoa Snowfall | Vanilla body, cocoa points | `#DAC6AD` / `#786051` / `#F3E7D7` / `#A8C9CC` |
| peach-cloud | Peach-Pastry Cloud | Milk-white and apricot-peach bicolor | `#EEE3D2` / `#D49A76` / `#FFF4E4` / `#C9B37F` |
| ink-sesame | Sesame Night Voyage | Soft-ink tuxedo | `#555A61` / `#40464E` / `#EDE8DC` / `#D6C38D` |

`collection.png` is an overview of the palettes and the face illustrations. It is not a 3D screenshot, and it does not show how the body markings are distributed. Body markings follow the PNG atlas and the lab's 3D preview.

## 4. The PNG + JSON resource protocol

This adopts the Minecraft-style idea of "block skeleton + six-face UVs + PNG + declarative config." **This is a custom Lingxi format. It is not a native model file for Minecraft Java / Bedrock, and it cannot promise that an arbitrary Minecraft JSON will import directly.** If Blockbench or Bedrock compatibility is needed later, build a converter separately, and handle coordinates, rotation axes, pivots, UV mirroring, and size units.

Minimum resource pack for each set:

```text
apricot-letter.json
apricot-letter.png         # six-face body atlas
apricot-letter-face.png    # 256×256 transparent feature composite decal
```

Each exported skin JSON contains:

- `format: "lingxi-skin"`, `schemaVersion: 1`.
- `rigId: "lingxi-cat-v1"`: the skeleton-topology identity.
- `layoutId: "lingxi-cat-v1-default-4tpu-v1"`: the fixed body type and UV version for this batch.
- `texture`: relative file name, actual width and height, sRGB, nearest, origin at the top left.
- `uv[nodeId]`: for each box, six `px/nx/py/ny/pz/nz` pixel rectangles `[x,y,width,height]`.
- `materials`: semantic colors. Procedural face compositing also takes its colors from here.
- `face`: file, size, current expression state, parent node `head`, and the front face `+Z`.

**This batch's layoutId applies only to the default skeleton size.** The current `computeAtlasLayout()` reads the size and lays the atlas out again. A formal PNG loader must use the manifest's explicit UVs, or require an exact layout-version match. Do not change the body type, repack the UVs, and then put the original PNG back on. Stretching boxes with the same texture can keep markings in place, but pixel density changes. When a different density is needed, issue a separate layoutId and PNG for that body type.

The UV origin is the top left of the PNG. Three.js UVs have their origin at the bottom left. The formula is:

```ts
u = pixelX / textureWidth;
v = 1 - pixelY / textureHeight;
```

The specific six-face directions reuse the existing `faceRects()` and `applyAtlasUVs()`. Do not guess the BoxGeometry face order again. An existing comment says half-texel inset, but the code actually uses `0.01` pixels. Do not treat that as full half-pixel protection. Currently nearest filtering and no mipmaps. When linear filtering or mipmaps are turned on later, gutters and edge padding must be added, and the layout version updated.

Formal import checks:

1. A file-size cap, a PNG file signature, a successful decode, and a width and height cap equal to the manifest.
2. The JSON format version, rigId, and layoutId must be supported. Name length and color format should be limited.
3. UVs contain only known nodes and the six faces. Coordinates are finite non-negative integers, rectangle area is greater than zero, nothing is out of bounds, and every visible box has a mapping.
4. Relative resource paths can only be resolved inside the import directory. `../`, absolute paths, and remote URLs are not accepted.
5. If body-type overrides are supported, check that size/segmentLength > 0, that pivots are finite, that nodes exist, and that the parent-child graph has no cycle.
6. Replace the current resources only after every load and check has finished. On failure, keep the previous skin. When selections arrive in quick succession, discard stale results with a request sequence number.

Lab PNG import already supports automatic full-body coverage from an ordinary image, and import of explicit UV JSON in lingxi-texture / the older lingxi-skin form. Checks include the PNG signature, an 8 MB limit, width and height of 1–4096, UV bounds, and an async request sequence number. A paired JSON+PNG can be selected together. ZIP resource-pack import is not implemented. The detailed protocol is in document 20.

## 5. Expressions use semantic layers

The order of layers is base color and markings → bib / nose → eyes → eyebrows → mouth → emotion symbols. The ears still drive real 3D joints.

| Layer | State count | Examples |
|---|---:|---|
| Eyes | 8 | Slit pupil, round pupil, wide open, glance aside, half-closed, smiling eyes, closed, hearts |
| Eyebrows | 5 | Flat, none, furrowed, raised, aggrieved |
| Mouth | 6 | Flat line, cat mouth, open, displeased, hiss, tongue out |
| Ears | 4 | Natural, forward, airplane ears, pressed back |
| Symbols | 7 | None, sweat drop, question mark, exclamation mark, heart, sleepiness, anger |

In theory that is `8×5×6×4×7 = 6,720` combinations, but that must not be advertised as 6,720 artist-verified emotions. Provide ten semantically meaningful presets first, then open advanced customization. In the existing reference, the furrowed brow and the sad brow are geometrically very close. This implementation reverses the tilt direction of the sad brow.

See `paintFace()` for the implementation: the same 256×256 Canvas is redrawn. Set `texture.needsUpdate=true` only when the state or the blink state changes. Do not generate a texture every frame. Half-closed eyes use a smaller iris region. Do not hard-code an orange eyelid onto a blue cat's face.

Fitting it in 3D:

```ts
const headSpec = skeleton.nodes.find(n => n.id === 'head')!;
const [w, h, d] = headSpec.box.size;
const face = new THREE.Mesh(
  new THREE.PlaneGeometry(w, h),
  new THREE.MeshBasicMaterial({
    map: faceTexture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
);
face.position.set(
  headSpec.box.offset[0],
  headSpec.box.offset[1],
  headSpec.box.offset[2] + d / 2 + 0.025,
);
rig.node('head').add(face);
```

Hide the original Mesh for eye / pupil / brow / nose / mouth / whisker / jaw / tongue, and keep the pivot. Otherwise the old eyebrows and pupils float in front of the new expression. The decal turns with the head. It is not a billboard that always faces the screen. Emotion symbols are currently inside the decal. If they later become floating icons above the head, they can be hung on a sprite of their own.

The features are currently **composited into one PNG after logical layering**, not several overlapping transparent planes. Later art can switch to a transparent PNG per layer and composite them with `drawImage()` at fixed anchors. The semantic states do not need to change. Material coordinates stay 256×256. Do not let each layer file crop its own edges without recording an offset.

## 6. Motion and a natural feel

The lab already has eight small clickable actions: a slow blink, a head tilt while watching, ears turned to listen, a sleepy nod, a look-up greeting, a snuggle head-tilt, ears pulled in when startled, and a look to the left and right. The config is in `actions.json`, the sampler is in `motion.ts`, and keyframe units are seconds / radians.

Current demo policy: a manual click overrides the action that is playing. When time is up, the action offset returns to zero, and the expression stays on the selected state. The priority field is for the formal scheduler. The demo does not run a priority queue. The slow-blink curve is converted into an open/closed pair of states in the current face drawing. Smooth eyelid opening and closing is the next extension.

Formal per-frame execution order:

```text
rest pose → base pose for stand/walk/sit → breathing and tail idle
          → expression ear pose / head pose → action offset → foot IK where needed → render
```

Every frame must sample from a fresh base pose and then add on top. Do not repeatedly `+=` onto the previous frame's final rotation, or it will twist further and further off. The lab reuses idle to reset the ears, explicitly resets the head rotation, and then adds the action offsets.

Suggested formal action priority: drag / edge safety > startled > user interaction > spontaneous small actions > idle. One part has only one primary controller at a time. Small idle that is allowed to stack is amplitude-limited. When a drag interrupts, fade the action out over 120–200 ms. After landing, re-establish foot contact. Do not hard-cut back from an old keyframe.

Suggested natural-feel parameters (design values; tune them at the actual desktop size):

- Random blink interval about 2.4–6.2 s; an ordinary eye-close about 130 ms.
- Ear pose eases toward the target with `1-exp(-dt/0.16)`.
- A head tilt of about 6–10°, returning after the watching hold. Avoid a large head swing that never stops.
- Playfulness may be fast; sleepiness should be slower. Do not put every emotion on the same beat.
- Do not schedule licking a paw, walking, and sleeping at the same time. Choose actions by pose preconditions.
- Respect the reduced-motion setting: turn off spontaneous large motions, and keep an optional faint blink.

In the existing idle, the breathing frequency is 1.55 Hz and the tail drive is 2.3 Hz. That is a fine debug baseline to start from. For quiet companionship, try breathing at 0.35–0.55 Hz and the tail at 0.2–0.5 Hz. That is an art-timing suggestion, not an animal-physiology simulation.

Sit, stretch, lick a paw and wash the face, and a small pounce are only listed as later actions in actions.json. The existing walk is still a leg-swing placeholder. There is no planted-feet IK yet. Do not fake finished grounded actions just to increase the button count.

## 7. Formal integration tasks for the implementing model

Deliver in the following order. Each step can be accepted on its own:

1. **Skins and resource loading.** Add validated texture/uv/layoutId support to `VoxelSkin`. Register the six local resources in `rig/skins.ts`, and keep the fallback for old IDs. `buildRig()` should not start an async request that cannot be tracked. Add an async resource-loading layer, then pass the loaded Texture/UV to the builder.
2. **Face module.** Wrap the lab's decal logic as `createFaceController(rig, skin)`, with `setExpression`, `setLayers`, `update`, and `dispose`. Read the size from headSpec after the application's overrides. When a skin changes color, update the body and the face together.
3. **Motion module.** Start from the pure sampler in `motion.ts`. Add a channel allowlist, a check that keyframes strictly increase, priority, cancel, and fade-out. Wire the eight small head-and-ear actions first, then the full-body actions that need IK.
4. **Admin interface.** Show six thumbnail cards with name, coat, and selected state. Click to preview, and save `skinId` after loading succeeds. Notify the pet window through the existing Tauri event / settings channel. Do not assume the localStorage of the two webviews syncs automatically.
5. **Keep state across a switch.** Do not rebuild the life engine, and do not clear tasks or drag state. For the same body type, only swap the map and the face palette. A body-type change needs to rebuild the rig/IK/animator, recompute groundOffset, and then atomically replace the old cat.
6. **Resource lifetime.** Release the old textures after replacement finishes. Cached shared resources use reference counting or a single owner. The existing `Rig.dispose()` only knows about the old materials it created. New resources must be released explicitly by the new controller.
7. **Import and persistence.** Add local PNG+JSON pack import. After a successful import, copy into the application resource directory, then write settings. After the application restarts, it cannot depend on the user's original file still being at a temporary path.

Performance note: a comment in the existing skeleton.ts says shared materials mean "one draw call." That is not true. Multiple independent Meshes are usually still drawn separately. Measure `renderer.info.render.calls` first. Do not equate a shared atlas with merged geometry in the delivery notes. If this is optimized later, independent joint animation has to be preserved. A skinned merged mesh can be considered. A simple static merge that loses motion cannot.

## 8. Acceptance

- Across front, side, and rotation, the six skins have no leftover old pupils, no floating face parts, and no decal flicker.
- When switching from orange to blue, the eyelids, eyebrows, and whiskers change color together. A half-closed eye has no orange patch.
- A re-exported PNG tries on visually the same. A bad signature, a wrong size, or a stale async result cannot overwrite the current skin.
- The ten expressions and custom combinations work. After a random blink ends, the emotional eye shape returns.
- After the eight actions finish, joints return to place. Continuous playback does not accumulate drift. Changing the expression can cancel an action.
- After the formal admin page changes the skin, the pet window stays in sync, and a restart restores it. An unknown skinId has a default fallback.
- After repeated switching and destruction, check GPU texture/geometry counts. They should not keep growing.
- A new body type must be tested on its own for UV, groundOffset, and foot IK. A test of the default body type is not a substitute.

This round ran the application TypeScript + Vite build, and looked at the real 3D in a browser, including skin and expression switches. Browser PNG+JSON file import was added later. Formal Tauri two-window sync, persistence of imported skins, and full-body IK actions still have to be accepted separately after the formal integration implements them.
