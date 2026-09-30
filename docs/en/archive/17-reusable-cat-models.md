<!-- English translation of `docs/archive/17-reusable-cat-models.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Reusable cat-model candidates for Lingxi

Search date: 2026-09-12. The following is information disclosed on the author or seller pages. Nothing has been purchased, downloaded, or verified locally. Prices are the US-dollar prices shown on the page. License tier, tax, and the checkout price may differ. "Natural" or "cinematic" in product marketing cannot be treated as a measured result.

## Conclusion

Switch to a base asset that already has mature skinning and animation. The rough anatomy, weights, and procedural keyframes of the existing v5 are not worth continuing as the final art base. The generated reference images remain the appearance target. Existing textures are only a source for repainting and material work. They cannot replace the base model's own UVs, hair grooming, and materials.

Evaluate the look and rig of VFX Grace British Shorthair first, and the animation coverage of Kitten - Simple. The former has an explicit AI-license restriction, so written permission for this project has to be obtained first. The latter is a lightweight game asset. It does not justify promising the close-up fur quality of the reference images.

## 1. VFX Grace British Shorthair Animation

[Official product page](https://www.vfxgrace.com/product/british-shorthair-animation-blender-3d-model/)

- Page price: $249, with Individual / Startup / Studio tiers shown.
- A native Blender project, Cycles, 4K textures, the new hair system.
- Four ready-made animations: walk, run, lie down, stretch. The page does not list jump, a full sleep, or the full set of everyday behavior animations.
- It has a mouth cavity, tongue, upper and lower teeth, eyes, and tear glands, with detailed facial controls.
- It includes limb IK/FK, center of gravity, tail, belly, and toe controls. The toe controls include weight-bearing and paw-pad squash.
- Judgment: suitable as a high-quality Blender art base, but it is not already a kitten that matches the target proportions and coat. It still needs remodeling and grooming.
- [Official display image](https://www.vfxgrace.com/wp-content/uploads/2026/06/JF0O740A_BritishShorthair_Display_Think_02-scaled.jpg)
- [Author's showcase video](https://www.youtube.com/watch?v=jfJeEmmQBCE). The video link from the product page was obtained. It was not played through in full for verification.

License limits: the [official agreement](https://www.vfxgrace.com/3d-models-license/) explicitly includes broad restrictions on AI use. There are also limits on independent distribution of the model, trademark use, and some made-to-order customization. The specific scope for an AI desktop pet, production assisted by a code agent, swappable skins inside the application, and packaging the final resources should be written out clearly to the author, and permission obtained. This does not assume that an ordinary product license already covers those uses. The author has not been contacted.

## 2. Kitten - Simple / Radik Bilalov (RedDeer)

[Fab product page](https://www.fab.com/listings/5c8fcb26-1e15-480d-8aab-36a018a26df5?lang=en)

- The page did not return a reliable price. None is guessed.
- 50 bones, about 11,200 triangles, 4 LOD levels, plus a mobile version of about 2,100 triangles.
- The page lists Unreal, Blender, FBX, and other formats. The actual download package and the Blender version still need to be checked.
- 100+ animations, including walk, run, jump, lie down, lie on the back, sleep, groom, scratch an ear, sit, and others.
- It explicitly lists start, loop, and end phases for behaviors such as eat, sleep, and lie down. It includes in-place and root-motion versions.
- Judgment: better suited to solving "moves in a coordinated, cat-like way" first, then changing coat, eyes, and hair. A lightweight mesh and alpha-card fur should not be treated as photographic-quality fur.
- [Official animation showcase](https://youtu.be/tc_LTu7gkzg)
- [Rotatable Sketchfab showcase](https://sketchfab.com/3d-models/kitten-simple-c12c4d965bc1458d9a0631b70586bfa5)
- The page is marked NoAI. The usage boundary should be checked against the specific license. Do not assume on your own that it may be uploaded to an image-to-3D or generative training service.

## 3. AnimX: Advanced Cats / Indie Cat

[Fab product page](https://www.fab.com/listings/7b57ab44-9bc9-4564-879d-f99f42ddff67?lang=en)

- The [author's store](https://www.fab.com/sellers/Indie%20Cat?lang=pl) shows a starting price of $139.99.
- A native Unreal asset, including the AnimX controller. The product page says it has been updated to UE 5.7, with a low-poly version attached.
- Third-party reposts of figures such as "90 animations" are not treated as the confirmed current package specification for this review.
- The [author's documentation](https://indiecat.notion.site/Advanced-Animals-Assets-UE4-f1e6ae0df3394f0bb0d82d6c7d178fd1) says that after purchase you can request the Blender project from the author with an invoice, and that there is also a method for swapping the model while keeping the skeleton and the logic.
- Judgment: if Unreal is chosen directly for look verification, this route is more suitable than moving a static Blender model over and then building the whole motion system yourself. The controller cannot be moved directly to Three.js.
- Fab marks an AI-use restriction. The specific license needs to be checked.

## 4. Cute Fur Kitten Gray Animated / mouch001

[CGTrader product page](https://www.cgtrader.com/3d-models/animal/mammal/cute-fur-kitten-gray-animated)

- Page price: $48.
- The native Blender 2.91 file includes hair and animation. The FBX animation does not include hair.
- 8 animation sets: idle, walk, run, jump, scratch an ear, a look-down related action, startled, sit.
- About 6,618 faces, a 2K diffuse map.
- Judgment: suitable for a lower-cost check of a kitten's shape. The version is old, the motion set is incomplete, and detailed facial controls are unconfirmed. It cannot be used directly as a substitute that already meets every requirement.

## Animation-library extra candidate: Milo / Cat Animset Pro

[Author's write-up](https://malbersanimations.artstation.com/projects/EzPYan) / [CGTrader](https://www.cgtrader.com/3d-models/animal/mammal/cat-animset-pro)

The page shows $109.99, 200+ animations, 72 skin sets, and 19 proportion morphs. The author explicitly says the variants use shape keys and bone scaling, and that the kitten anatomy is not fully accurate. It can therefore be a backup animation library. Using "scale the bones" again as the main approach to the Lingxi kitten's look is not recommended. The sales-page formats are mainly Max, Unity, and Unreal. That does not confirm a directly usable Blender project.

## Acceptance order after an asset is obtained

First reproduce the render and the motion as-is in the author's native project, before any remodeling. First check whether a side-view walk slides, whether lying down actually reaches the ground, whether a slow blink looks natural, and whether the mouth cavity and tongue are correct after the mouth opens. After that passes, keep the original skeleton and weights, and make small adjustments to face shape, coat, and the look in the eyes. Retest the motion after every adjustment.

Do not promise in advance that some model can be "swapped to the reference image in one click." The juvenile proportions and the fine short fur in the reference still need actual art production. What can be reused is the anatomy, topology, skinning, hair structure, and animation the author has already finished, not only a render screenshot.
