<!-- English translation of `assets/characters/lingxi/voxel-style-kit/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Lingxi skin material pack

The lab now supports **importing any PNG to cover the whole model**. Use [`import-examples/colour-check.png`](../../../../../../assets/characters/lingxi/voxel-style-kit/import-examples/colour-check.png) and [`.json`](../../../../../../assets/characters/lingxi/voxel-style-kit/import-examples/colour-check.json) to test automatic tiling and per-face UVs. See [`20-arbitrary-png-skin-import.md`](../../../../20-arbitrary-png-skin-import.md).

Six skins. Each includes a body PNG, a 256×256 transparent feature PNG, and explicit six-face UV JSON.

- `collection.png`: an overview of palettes and feature illustrations (not a 3D screenshot).
- `expressions.json`: ten preset expressions.
- `actions.json`: eight demo actions; futureActions are not implemented yet.
- The layout is fixed at the default `lingxi-cat-v1`, 4 texels/unit. It cannot be used directly on a body type whose UVs have been laid out again.
- The format is custom Lingxi JSON. It borrows Minecraft's block-resource organization and is not directly compatible with Minecraft JSON.

Full development document: [`19-voxel-style-kit-handoff.md`](../../../../archive/19-voxel-style-kit-handoff.md).
Preview: from the project root, run `npm run dev --prefix apps/lingxi`, and open `http://localhost:1420/style-lab.html`.
This round the lab supports skin swapping. The formal Tauri settings page is still waiting to be wired up.

Re-export the PNGs (the extra tool depends on @napi-rs/canvas; it is not an application runtime dependency):

```sh
npm install --prefix /tmp/lingxi-style-export --no-audit --no-fund @napi-rs/canvas
node --experimental-strip-types scripts/export-voxel-style-kit.mjs /tmp/lingxi-style-export/node_modules/@napi-rs/canvas/index.js
```

The export script registers the PingFang font on macOS. Other systems should replace it with an available Chinese font file.
