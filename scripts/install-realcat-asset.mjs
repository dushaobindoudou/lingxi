#!/usr/bin/env node
// Install the realistic cat ("真实猫") from a look-dev round of lingxi-v5fix into the app's public folder (git-ignored;
// a local `tauri build` bundles whatever is there).
//
//   node scripts/install-realcat-asset.mjs <round dir>      e.g. ../lingxi-v5fix/assets/characters/lingxi/v6/round-zzz3
//
// From the round:
//   export/lingxi-realcat.glb   the model and its clips      (scripts/blender/export_lingxi_v5_glb.py)
//   export-lids/lids.glb        the four lids WITH their shape keys (same script, LINGXI_GLB_ONLY=LX_LidUpper.L,... and
//                               LINGXI_GLB_ANIM=0): in the main export the lids' Solidify modifier cost them their keys
//   export-lids/rig.json        bone rest heads / tails     (scripts/lookdev-v6/v6_rig_export.py)
//   face-controls.json          the face: controls, layers and the 30 expressions (build_lingxi_v5.py)
// Writes current/cat.glb, current/lids.glb and current/face.json (face-controls + the rest heads / tails, Blender
// armature space, that the ear turns are taken about).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const round = process.argv[2];
if (!round) {
  console.error('usage: node scripts/install-realcat-asset.mjs <look-dev round dir>');
  process.exit(2);
}
const src = resolve(round);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/lingxi/public/characters/lingxi-realistic/current');
const need = ['export/lingxi-realcat.glb', 'export-lids/lids.glb', 'export-lids/rig.json', 'face-controls.json'];
const missing = need.filter((f) => !existsSync(join(src, f)));
if (missing.length) {
  console.error(`missing in ${src}: ${missing.join(', ')}`);
  process.exit(1);
}
// Export original Blender strands into <round>/export-groom first. Verify the pairing
// before touching the installed asset; never leave a previous round's groom on a new cat.
const groomDir = process.argv[3] ? resolve(process.argv[3]) : join(src, 'export-groom');
const hasGroom = existsSync(join(groomDir, 'groom.json'));
if (hasGroom) {
  const groom = JSON.parse(readFileSync(join(groomDir, 'groom.json'), 'utf8'));
  const hash = createHash('sha256').update(readFileSync(join(src, need[0]))).digest('hex');
  if (groom.modelSha256 !== hash || readFileSync(join(groomDir, 'groom.bin')).byteLength !== groom.bytes) {
    throw new Error('Groom does not match this model, or groom.bin is incomplete');
  }
}
mkdirSync(out, { recursive: true });
copyFileSync(join(src, 'export/lingxi-realcat.glb'), join(out, 'cat.glb'));
copyFileSync(join(src, 'export-lids/lids.glb'), join(out, 'lids.glb'));
const face = JSON.parse(readFileSync(join(src, 'face-controls.json'), 'utf8'));
const rig = JSON.parse(readFileSync(join(src, 'export-lids/rig.json'), 'utf8'));
face.rest = Object.fromEntries(rig.bones.map((b) => [b.name, { head: b.head, tail: b.tail }]));
writeFileSync(join(out, 'face.json'), JSON.stringify(face));
for (const file of ['groom.json', 'groom.bin']) {
  if (hasGroom) {
    if (resolve(groomDir, file) !== resolve(out, file)) copyFileSync(join(groomDir, file), join(out, file));
  } else rmSync(join(out, file), { force: true });
}
console.log(`installed ${src} -> ${out}: cat.glb, lids.glb, face.json (${Object.keys(face.expressions).length} expressions), ${hasGroom ? 'original groom' : 'legacy shell fallback (no export-groom)'}`);
