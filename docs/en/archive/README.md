<!-- English translation of `docs/archive/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Archive

The documents here **are not wrong; they are outdated**. They record the path the project actually took, but the process they describe is no longer how things are implemented. They are kept rather than deleted, because the judgments and tradeoffs in them are still useful as reference, and if the asset pipeline is ever rebuilt, these are the starting point.

## Why they are outdated

The early cat was modeled in Blender, exported as glTF, and then loaded at runtime. Now **the whole cat is generated in code**: the skeleton comes from `apps/lingxi/src/data/skeleton.json`, the markings are painted onto an atlas by `src/rig/art.ts`, and the expression is a 256×256 decal. There is no .blend, no glTF, and no asset-export step.

The reason for the change: a procedurally generated cat can change body type, markings, and palette by editing a few lines of data, whereas in a Blender pipeline every new skin has to be exported again. The user-editable `skins.json` capability was not achievable on the old pipeline.

| Document | What it covers |
|---|---|
| `10-blender-workflow.md` | The Blender + MCP modeling workflow |
| `12-character-study-review.md` | Early form reviews |
| `13-threejs-preview.md` | A standalone Three.js preview page (replaced by the debug console) |
| `15-approved-short-fur-assets.md` | The record of the approved short-fur assets |
| `16-blender-rig-v5.md` | The v5 rig inside Blender |
| `17-reusable-cat-models.md` | Research on reusing third-party cat models |
| `19-voxel-style-kit-handoff.md` | Handoff of the voxel style kit |

The scripts under `scripts/blender/` are the same: they are kept, but they are not on the application's build path.
