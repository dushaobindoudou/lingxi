<!-- English translation of `docs/archive/16-blender-rig-v5.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Lingxi v5 model and animation delivery record

## Result and acceptance status

A [Blender model](../../../assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend) was generated. It contains 47 bones, 18 animation sets, native hair, and shape keys for the eyelids, breathing, and similar forms, and it uses the three texture sources generated earlier.

**This is a functional prototype. It has not reached the photographic-quality kitten look the user approved, and it cannot be labeled the final complete product.** What is still missing includes more natural facial proportions, the look in the eyes, ear hair and hair layering, a smooth gait that matches cat anatomy, feet locked to the ground, a finished mouth cavity, and UVs baked for the engine. The final rest-pose render still has deformed front paws and an unnatural hover. The lying-down actions did not pass visual acceptance.

- [Actual model render](../../../assets/characters/lingxi/v5/portrait.png)
- [Motion preview page](../../../assets/characters/lingxi/v5/preview.html)
- [Feature map and usage notes](../../../assets/characters/lingxi/v5/README.md)
- [Animation timeline](../../../assets/characters/lingxi/v5/animations.json)
- [Hair-follow verification](../../../assets/characters/lingxi/v5/final-verification.json)
- [Jaw world-space displacement verification](../../../assets/characters/lingxi/v5/jaw-verification.json)
- [Ground-correction record](../../../assets/characters/lingxi/v5/ground-correction.json)

## Fourth-version assessment

The [fourth-version export script](../../../scripts/blender/export_three_preview_v4.py) and the actual `.blend` were checked. What the script exports is evaluation geometry in the rest pose. It does not export skeletal animation. The fourth version's look and rigging method are not enough to directly support this round's full-body motion goal, so the fourth-version original was kept, and the body, head and face, skeleton, and hair deformation were rebuilt in a new file.

What was reused is the material library and three image assets generated earlier, plus production methods the project already had. This does not claim that a static concept image was automatically turned into a 3D model of equal quality.

## Production and reproduction

Run the following scripts in order in Blender 5.2.1. Each step saves the v5 file. The first build uses the material library as input. The remaining steps open the v5 from the previous stage. The scripts are one-shot build steps. Do not repeat an append operation on the result of the same stage.

1. `scripts/blender/build_lingxi_v5.py`: create geometry, skeleton, weights, textures, and the initial animations.
2. `scripts/blender/refine_lingxi_v5.py`: adjust the underlying coat color and the iris.
3. `scripts/blender/verify_animate_lingxi_v5.py`: rebuild and verify the initial animations.
4. `scripts/blender/native_fur_lingxi_v5.py`: build real native hair curves, reading skinned point positions through Geometry Nodes.
5. `scripts/blender/polish_lingxi_v5.py`: per-hair materials, and head, face, and ear adjustments.
6. `scripts/blender/finalize_lingxi_v5.py`: a separate pupil, 18 action sets, and verification of actual jaw displacement.
7. `scripts/blender/repose_lingxi_v5.py`: redo the rest pose, using leg-segment scale as an approximation of tucking the legs. This is still not an anatomically correct folded leg.
8. `scripts/blender/ground_lingxi_v5.py`: per-frame ground-height correction. There is no IK foot lock yet.
9. `scripts/blender/check_lingxi_v5_final.py`: reread the model and verify the actions and that the hair actually follows.
10. `scripts/blender/render_lingxi_v5_demo.py`: render an 18 × 16 frame preview.

`fix_fur_lingxi_v5.py` records an intermediate diagnostic attempt. It has been replaced by the native-curve approach and does not need to be run when reproducing.

The main production work and the single-image verification were executed through the official Blender MCP already installed in the project. Batch renders that exceed its default timeout used background mode of the same Blender executable. The community MCP was not substituted.
