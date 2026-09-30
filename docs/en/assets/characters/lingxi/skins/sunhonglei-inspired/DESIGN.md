<!-- English translation of `assets/characters/lingxi/skins/sunhonglei-inspired/DESIGN.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Angular Ebony: face design specification

This is a Lingxi cat skin inspired by a reference person's temperament. It does not identify a real person, and it does not reproduce a real face.

At runtime it keeps the cat ears, tail, and whiskers. The body material is a black suit, white trousers, and black leather shoes. The face does not use a photograph or a generated texture. It is drawn entirely in code.

The baseline specification for the procedural face geometry is recorded in [`face.json`](../../../../../../../assets/characters/lingxi/skins/sunhonglei-inspired/face.json). Units are pixels of the 256×256 face texture:

- Distance between the two eye centers: 106px; eyes 48×35px, placed low, simulating a slightly narrowed eye shape
- The brow line is at y=88; the eyebrows are thicker and closer to the eyes
- The muzzle region: 100×58px; nose wings 24px wide, mouth 44px wide
- Whiskers shortened to 34px, reducing the kitten feel while keeping the cat recognizable

The current runtime prefers the nine-cell face sheet. After `faceSheet` is removed, it falls back to the procedural face specification in `face.json`.
