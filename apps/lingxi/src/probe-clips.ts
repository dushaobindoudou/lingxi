// Clip interpenetration probe - dev-only, NOT a build input. Open /probe-clips.html against
// `npm run dev`.
//
// "Some actions clip through the model" is not something you can chase by watching; the
// offending frame is often a few frames long and on the far side of the cat. So this plays
// every clip in the library through the real pose pipeline and measures, frame by frame, how
// far non-adjacent body parts push into each other. What comes out is a ranked list of which
// clips are actually wrong and by how much, which is a thing you can fix.
import * as THREE from 'three';
import skeletonData from './data/skeleton.json';
import skins from './data/skins.json';
import { refineSkeleton } from './rig/anatomy.ts';
import { buildRig, type SkeletonData } from './rig/skeleton.ts';
import { createIdleAnimator } from './anim/idle.ts';
import { createBodyController } from './anim/body-controller.ts';
import { createDirector } from './anim/director.ts';

const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const skin = (skins as any[]).find((s) => s.id === 'honey-mittens');
const rig = buildRig(skin, SKELETON);
const controller = createBodyController(rig, SKELETON);
const idle = createIdleAnimator(rig);
const director = createDirector(SKELETON.nodes.map((n) => n.id));

// Parent/child pairs are *supposed* to overlap - the whole point of the refined skeleton is
// that boxes interpenetrate at the joints so the body reads as one soft shape. Only pairs with
// no such relationship count as clipping.
const parentOf = new Map<string, string | null>(SKELETON.nodes.map((n) => [n.id, n.parent]));
function isAncestor(maybeAncestor: string, of: string) {
  let cursor = parentOf.get(of) ?? null;
  while (cursor) {
    if (cursor === maybeAncestor) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
/**
 * Anything on the same chain is exempt at ANY depth - the refined skeleton deliberately
 * overlaps boxes along a chain so the body reads as one soft shape rather than a stack of
 * blocks, so spine1 sitting inside the head is the rig working as designed.
 *
 * Cousins are not exempt. A hind leg inside the ribcage, or the two thighs swapping places,
 * shares no chain and is real clipping.
 */
/** Strip a trailing L/R so `thighL` and `thighR` can be recognised as the same part mirrored. */
const sideless = (id: string) => id.replace(/([LR])$/, '');

function related(a: string, b: string) {
  if (a === b || isAncestor(a, b) || isAncestor(b, a)) return true;
  // Siblings hanging off the same joint also overlap by design - a thigh tucked against the
  // pelvis is a sitting cat, not a bug. The exception is a BILATERAL pair: the left and right
  // of the same part sharing space means the two legs have swapped sides, which is real.
  const parent = parentOf.get(a);
  if (parent && parent === parentOf.get(b) && sideless(a) !== sideless(b)) return true;
  return false;
}

interface Tracked { id: string; mesh: THREE.Mesh; box: THREE.Box3 }
// The face boxes are hidden in the real renderer (a painted decal replaces all of them), so
// including them here would report clipping nobody can see.
const FACE_BOX = /^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/;
const tracked: Tracked[] = [];
for (const node of SKELETON.nodes) {
  if (FACE_BOX.test(node.id)) continue;
  const object = rig.node(node.id);
  for (const child of object.children) {
    if (child instanceof THREE.Mesh && child.visible) {
      child.geometry.computeBoundingBox();
      tracked.push({ id: node.id, mesh: child, box: new THREE.Box3() });
    }
  }
}

/** Overlap depth on the shallowest axis - i.e. how far one box would have to move to separate. */
function penetration(a: THREE.Box3, b: THREE.Box3) {
  const x = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const y = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const z = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (x <= 0 || y <= 0 || z <= 0) return 0;
  return Math.min(x, y, z);
}

const lines: string[] = [];
const results: { id: string; worst: number; pair: string; atSecond: number }[] = [];

for (const motion of director.actions) {
  director.play(motion.id);
  let worst = 0;
  let worstPair = '';
  let worstAt = 0;
  let elapsed = 0;
  // Real frame time, not duration/FRAMES: the springs in the idle animator are integrated
  // explicitly, and feeding them a step several times larger than a real frame measures the
  // integrator rather than the clip.
  const dt = 1 / 60;
  const frames = Math.ceil(motion.duration / dt);
  for (let f = 0; f <= frames; f += 1) {
    elapsed += dt;
    controller.reset();
    idle.update(rig, elapsed, dt, 0, 0);
    const frame = director.update(dt, 'idle', false);
    controller.apply(frame.offsets);
    rig.root.updateMatrixWorld(true);
    for (const entry of tracked) entry.box.copy(entry.mesh.geometry.boundingBox!).applyMatrix4(entry.mesh.matrixWorld);
    for (let i = 0; i < tracked.length; i += 1) {
      for (let j = i + 1; j < tracked.length; j += 1) {
        if (related(tracked[i].id, tracked[j].id)) continue;
        const depth = penetration(tracked[i].box, tracked[j].box);
        if (depth > worst) {
          worst = depth;
          worstPair = `${tracked[i].id} × ${tracked[j].id}`;
          worstAt = elapsed;
        }
      }
    }
  }
  results.push({ id: motion.id, worst, pair: worstPair, atSecond: worstAt });
}

results.sort((a, b) => b.worst - a.worst);
lines.push(`Checked ${results.length} clips. Worst interpenetration between unrelated parts, in voxels:`);
lines.push('(the cat is ~13 voxels tall, so anything over ~1.0 is visible)');
lines.push('');
for (const r of results.slice(0, 20)) {
  lines.push(`  ${r.worst.toFixed(2).padStart(6)}  ${r.id.padEnd(18)} ${r.pair.padEnd(26)} @${r.atSecond.toFixed(1)}s`);
}
const bad = results.filter((r) => r.worst > 1.0);
lines.push('');
lines.push(`clips over 1.0 voxel: ${bad.length} -> ${bad.map((b) => b.id).join(', ') || 'none'}`);
document.getElementById('out')!.textContent = lines.join('\n');
