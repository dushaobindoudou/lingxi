<!-- English translation of `docs/20-arbitrary-png-skin-import.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Arbitrary PNG import: cover the entire block model

Requirement correction: the user wants to import an arbitrary PNG as a skin, covering the cat's head, ears, body, legs, paws, and tail. PNG export is only an extra feature. The image does not need to be prepared in advance as a Lingxi-specific unwrap.

## Lab usage that is already implemented

Open `http://localhost:1420/style-lab.html`:

1. Click `选择 PNG` (Choose PNG), or drag onto the import area. Ordinary photos, patterns, and pixel-art PNGs all work, including rectangles.
2. The default `全身平铺` (tile across the whole body) repeats the pattern and keeps each face's pattern scale in model units. Adjust `图案大小` (pattern size).
3. `整图铺到每一面` (fit the whole image onto every face): each block face uses the whole image as a center crop and keeps the original aspect ratio. Part of the image may be cropped away, but it is not stretched out of shape.
4. `像素清晰 / 柔和照片` (pixel-crisp / soft photo) selects nearest / linear filtering.
5. Turning off `保留动态五官` (keep the animated facial features) hides the overlaid eyes, mouth, nose, bib, and symbol decals, so the imported image is shown completely.
6. When placing the pattern precisely, select the PNG and the JSON together, or select the PNG first and then `导入 UV 配置` (Import UV config).
7. Click a built-in skin card to restore the preset coat and the original UVs. The PNG and JSON are not uploaded to a server; a page reload restores the presets.

`专用展开图` (dedicated unwrap) is a retained advanced mode: it is only for the atlas that matches this skeleton, and it still requires a matching size. Ordinary PNGs are not under that restriction; each separate import of a new PNG leaves the previous atlas mode.

This is still a runnable integration example. The formal Tauri management page and the pet window are not wired up yet. When a formal integration is needed, reuse this module and save the image and config into the application data directory.

## A Minecraft-like configuration style

The configuration is "block node → six faces → a PNG pixel rectangle". There is no need to manually split the whole image into many files.

The following config can be imported directly together with `import-examples/colour-check.png` from the asset directory:

```json
{
  "format": "lingxi-texture",
  "schemaVersion": 1,
  "rigId": "lingxi-cat-v1",
  "textureSize": [256, 128],
  "mapping": { "mode": "tile", "tileSize": 8 },
  "filter": "nearest",
  "faces": {
    "head": {
      "pz": [0, 0, 32, 32],
      "px": [32, 0, 32, 32],
      "nx": [96, 0, 32, 32]
    },
    "earL": { "pz": [96, 0, 32, 32] },
    "earR": { "pz": [96, 0, 32, 32] }
  }
}
```

- `textureSize` must be the actual PNG width and height, not a fixed size.
- `tileSize` is the number of model units corresponding to one source-image height; larger means a larger pattern. Range 0.25–64.
- `faces` may be omitted, or may list only the parts that need customization. Faces that are not configured keep using the global coverage mode.
- Each rectangle is `[x, y, width, height]`, counted from the top-left corner of the image; it is not `[u1,v1,u2,v2]`.
- `px/nx` = +X/−X in the model's local coordinates, `py/ny` = +Y/−Y, `pz/nz` = +Z/−Z; the cat faces +Z.
- Node names such as `head`, `chest`, `spine2`, `pawFL`, and `tail0` come from the current skeleton.json.
- A `lingxi-skin` JSON exported by the previous version can also be imported: the program converts its `uv` into an explicit per-face configuration.
- URLs or paths inside the JSON are not read; the image must be chosen by the user, to avoid ambiguity about file location. If a resource pack is to be saved, the application is responsible for associating and persisting the image and the JSON.

This is a Lingxi format that borrows from Minecraft. **It does not implement native Java/Bedrock JSON import.** The node structure, face names, and the meaning of the UV parameters are not the same; a separate converter would be required later.

## Code paths and integration points

- `apps/lingxi/src/rig/texture-import.ts`: PNG file-header size check, JSON validation, the three UV mappings, and compatibility with the old manifest. UV calculation is a pure function, with no DOM or WebGL dependency, and can be unit-tested.
- `apps/lingxi/src/style-lab/main.ts`: choosing or dropping files, decoding the PNG, replacing the whole-body material, updating each box's UVs, controlling the filter, restoring presets, and releasing resources.
- `scripts/test-voxel-texture-import.mjs`: tests for non-square PNGs, uniform physical density, center crop, partial JSON UVs, invalid config, a missing atlas, and old-format compatibility.

Implementation flow:

```text
Choose a PNG (JSON optional)
→ check the PNG signature, IHDR, and width/height
→ parse and validate the JSON (if present)
→ precompute the six-face UVs of every box
→ decode the PNG and build an sRGB CanvasTexture
→ atomically update every box's UVs and the shared material map
→ release the previous imported texture
```

The original image resolution is kept. **An arbitrary PNG is not forced into the existing small atlas.** Swapping the texture does not rebuild the skeleton; existing actions keep driving it. The body material color is white, so the old skin does not tint it again.

The orientation of an arbitrary PNG cannot be matched automatically to the cat's anatomy: automatic mode is responsible for coverage, and precise alignment is specified by JSON. Whole-body tiling repeats on each box's local faces; continuity is not guaranteed across joints or neighboring boxes. To wrap one complete picture continuously around the whole character, make a UV unwrap, or add a rest-space projection later. Do not advertise "any image can be imported" as "any image automatically recognizes the facial features and wraps seamlessly".

Transparent pixels are currently composited over the selected preset's main fur color, keeping an opaque solid; they do not punch holes through the body. PNG limit 8 MB, width and height each 1–4096; JSON limit 256 KB. Size is checked before decoding, UVs are forbidden to go out of range, and rapid successive selections discard stale results by request serial number. If config validation fails, the current skin is kept.

## Two more things a skin can change: hide nodes, change proportions

Besides the texture, each entry in `skins.json` also accepts two optional fields. They change the **silhouette**, not the color, so a "humanized" skin (remove the cat ears, enlarge the shoes) does not need a separate skeleton.

| Field | Shape | Constraints | Use |
|---|---|---|---|
| `hiddenNodes` | a non-empty array of strings | node names come from `apps/lingxi/src/data/skeleton.json`; duplicates are removed | hide skeleton nodes from the silhouette, for example `["earL","earR"]` removes the cat ears |
| `proportions` | object, keys are node names | at most 60 parts; node names must match `^[A-Za-z][-A-Za-z0-9]{0,23}$` | override body proportions per part |
| `proportions.<node>.size` | three numbers | each between 0.2 and 16 | override that node's box size on three axes |
| `proportions.<node>.segmentLength` | number | 0.2–16 | override that node's segment length |

Keys other than `size` and `segmentLength` are **rejected, and the allowed keys are reported**, rather than silently ignored — a mistyped field name is the easiest mistake here, and silent ignore would make people think the render did not take effect.

Validation is implemented by `parseSkins` in `apps/lingxi/src/rig/custom-assets.ts`. If any entry is illegal, the whole `skins.json` does not take effect, the built-in skins are kept as they are, and the error is in `lastErrors` of `GET /assets/status`.

## Verification

```sh
npm run build --prefix apps/lingxi
node --experimental-strip-types --test scripts/test-voxel-texture-import.mjs
```

Seven mapping/import validation tests and the TypeScript/Vite build have passed. Browser verification: an ordinary 1440×900 PNG covers the whole body, and a 256×128 PNG+JSON imported together places the pattern on the 5 specified faces.
