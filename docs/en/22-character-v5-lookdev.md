<!-- English translation of `docs/22-character-v5-lookdev.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Lingxi short-fur skeleton model v5 (in progress)

Status: an editable Blender character look-dev. It is not approved as the brand master, and it is not yet wired into the Three.js app. The large generated `.blend` and PNG check images stay in the local workspace under the repository `.gitignore` rules, and are not added to Git.

## Regenerating

Requires Blender 5.2+ and Pillow. macOS uses the official application path by default; other install locations can be set with `BLENDER_BIN`.

```sh
scripts/blender/build_lingxi_v5.sh
```

Output is in `assets/characters/lingxi/v5/`:

- `lingxi-short-fur-rig-v5.blend`: editable mesh, 47 bones, facial shape keys, and animation.
- `portrait.png`: the resting 3/4 view.
- `animations.json`: 15 named actions and their time ranges.
- `poses/*.png`, `poses/contact-sheet.png`: a representative frame of each action, and the overview.
- `build-report.json`: a summary of build counts.

The short fur is sampled from the mesh surface and then deforms with the skeleton. This is still offline look-dev; it cannot be treated as the final real-time fur solution.

## 2026-09-24: four defects that have been fixed

On the previous contact sheet, 10 of the 15 cards could not be told apart, while `build-report.json` reported "actions: 495, clips: 15, frames: 776" — all three numbers are true, because they count **containers**, not poses. After measuring frame by frame with [`scripts/blender/diagnose_lingxi_v5.py`](../../scripts/blender/diagnose_lingxi_v5.py), there are four causes, independent of each other:

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **The pose sheet samples on the sine zero-crossing** | Every expression clip is driven by `sin(phase)`, `phase = u·2π`; the render script always takes `u=0.55` → `sin(198°) = −0.31`. Curious's 13° head raise renders as 4.3°, and its distance from Idle is only 9.7 | Changed to **scan frame by frame and take the frame farthest from the rest pose**. A contact sheet has to answer "what does this action look like"; the answer is its extreme, not its mean |
| 2 | **The eyes collapse into a horizontal plane when Blink≈1** | `add_eye_blink` writes `center_z + (v.co.z - obj.data.vertices[i].co.z) * .035`, and a newly created shape key's `key.data[i].co` **equals** the basis, so the parenthesis is always 0 → every vertex lands on `center_z`. Measured maximum displacement 0.0310 = exactly half of height 0.0620, which is the signature of collapsing into a plane | Change the pivot back to `center_z`. After the fix the maximum displacement is 0.0299 = 0.965·h/2, matching the intent of "squash to 3.5%" |
| 3 | **The eyelids are zero-thickness paper** | The ears have `SOLIDIFY`, the eyelids do not; the material used is bright-white `cream` (the belly-fur color), not facial skin | Add a 3.5 mm `SOLIDIFY`, and switch to a new `LidSkin` material |
| 4 | **The silhouette barely changes** | Every standing pose's bounding box is `0.421×1.199×0.75x` — over 1.2 m they differ by 1–2 mm (0.1%). LieDown is only 3 cm shorter than standing: the legs fold 117°, but the root only drops 11 cm, so it is "standing with the legs bent" | Lie-down root lowered to −0.28; Curious adds a forward lean + a crouch + ears rotated forward; Happy adds tail up + chest out + a bounce |

Defects 1 and 2 covered for each other: the sampler always sits near the zero-crossing and so misses the extrema, which is why the eye collapse showed only once, in Sleep (the only clip with `Blink=1` the whole way through), and looked like a lighting problem.

**Distance of each clip from Idle, before and after the fix** (total bone displacement angle + weighted expression):

| clip | Before | After |
|---|---|---|
| Curious | 9.7 (**judged to be the same pose**) | 172.2 |
| Happy | 421.7 | 656.2 |
| PawPlay | 120.4 | 180.6 |
| Knead | 524.8 | 669.5 |
| LieDown silhouette height | 0.721 (Idle 0.755) | 0.805 |
| Stretch silhouette depth | 1.219 | 1.225, height 0.818 |
| Pairs judged "the same pose" | 3 | 2 |

Rebuild and reproduce: `scripts/blender/build_lingxi_v5.sh` (about 2 minutes 40 seconds). The diagnosis can be run on its own at any time:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend \
  --python scripts/blender/diagnose_lingxi_v5.py
```

## Still unsolved

- **The markings are wrong.** This is still the biggest problem in this document, and it is unrelated to the four defects above: the model is a uniform cream-white, while `assets/brand/lingxi-icon-v3.png` is a gray-brown tabby + a white inverted-V face marking + hazel-green eyes + a pink nose. Right now only the tail has a few rings. **Until the markings are filled in, this model is not Lingxi; it is some other cat.**
- **Bite and Lick still cannot be distinguished from Idle** (distance 15.3 / 38.2). They move only the jaw and the tongue; the body pose does not participate. This is the same class of problem as Curious before the fix, and it has not been changed yet.
- The eyelids have thickness now, but when closed they are still a triangular wedge; they do not travel along the sphere of the eyeball.
- Fur amount, fur flow, and the sense of softness at small desktop size still have not reached the target.

## Current review conclusion

- The number of actions is enough for a first coverage check. Improve sleep, lying down, limb support, and facial actions first; do not keep stacking similar actions.
- Compared with `assets/brand/lingxi-icon-v3.png`, the tabby on the forehead, around the eyes, and on the cheeks is still too regular, and has not reproduced the logo markings.
- Head-to-body proportion and leg volume still need to be calibrated against a unified front/side reference.
- Sleep can already roll onto the side and close the eyes. The closed-eye lid's collapse was fixed on 2026-09-24 (see above), but the wedge outline is still unnatural, and the landing center of mass is still wrong.
- The coat has a preliminary silhouette; fur amount, fur flow, and the sense of softness at small desktop size still have not reached a film-grade standard.
- The current Three.js character is still generated by the voxel skeleton in `apps/lingxi/src/rig/skeleton.ts`. v5 is an offline Blender intermediate, and has not been imported into the app.

Therefore this version is for finding the gaps and continuing to iterate. It cannot be used as the final desktop-pet asset.
