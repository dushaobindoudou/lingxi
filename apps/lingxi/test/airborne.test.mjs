// Every clip that leaves the floor, held to real gravity - in the keyframes AND on the body.
//
// Two bugs made the cat's jump look wrong, and the first fix found only one of them.
//
// 1. `sampleMotion` smoothstepped every segment of every track, so the cat left the ground at
//    zero vertical speed, accelerated in mid-air and stopped dead at the apex: lifted on a
//    string. Fixed by `interp: "ballistic"`, and the tests below measure the SHAPE of the arc.
//
// 2. The keyframes were in voxels and the body controller added them to `rig.root`, which is
//    scaled by VOXEL_TO_WORLD x size - so they were drawn in WORLD units. `hop-catch`'s 1.6
//    became 58 voxels at the medium size: 87 cm, nearly six shoulder heights, in 0.12 s, which
//    is about 12g. Every keyframe test passed throughout, because every one of them read the
//    JSON. So the last tests here drive the real rig through the real body controller at every
//    size preset and measure the daylight under its paws.
//
// Retuning a height or a hang time is fine and fails nothing here. Floating, hovering, jumping
// at the wrong gravity, or drawing the jump in the wrong unit does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sampleMotion, leavesFloor } from '../src/anim/motion.ts';

const read = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));
const library = read('../src/data/actions.json');
const skeleton = read('../src/data/skeleton.json');
const byId = Object.fromEntries(library.actions.map((a) => [a.id, a]));

/** Derived, not listed: a new jump is held to all of this the moment it is added. */
const AIRBORNE = library.actions.filter(leavesFloor).map((a) => a.id);

const VOXEL_CM = skeleton.units.voxelCm;
const SHOULDER_VOXELS = skeleton.reference.shoulderHeight;
const EARTH = 9.81;

const liftTrack = (clip) => clip.tracks.find((t) => t.channel === 'root.position.y');
const height = (clip, t) => sampleMotion(clip, t)['root.position.y'] ?? 0;

/**
 * Each hop in a lift track: a key at 0, an apex, a key at 0. A positive value anywhere else - two
 * positive keys in a row - is a plateau, and a plateau is the cat hovering.
 */
function hops(clip) {
  const keys = liftTrack(clip).keys;
  const found = [];
  for (let i = 1; i + 1 < keys.length; i += 1) {
    if (keys[i][1] <= 0) continue;
    assert.ok(
      keys[i - 1][1] === 0 && keys[i + 1][1] === 0,
      `${clip.id}: the lift key at ${keys[i][0]}s is not a lone apex between two floor keys - ` +
        'a body cannot hold a height in mid-air',
    );
    found.push({ takeoff: keys[i - 1][0], apex: keys[i][0], land: keys[i + 1][0], height: keys[i][1] });
  }
  return found;
}

test('the airborne set is what it should be, so the rest of this file is not vacuous', () => {
  for (const id of ['hop-catch', 'pounce', 'claw-screen']) assert.ok(AIRBORNE.includes(id), `${id} should leave the floor`);
  // These two used to hover a smoothstepped half-voxel for seconds at a time. Rearing up is
  // sitting up; a nuzzle is leaning in. Neither is flight.
  for (const id of ['rear-up', 'kiss-nuzzle']) assert.ok(!AIRBORNE.includes(id), `${id} must keep its paws on the floor`);
});

test('every airborne clip declares itself ballistic - the default would float it', () => {
  for (const id of AIRBORNE) {
    assert.equal(liftTrack(byId[id]).interp, 'ballistic', `${id}'s lift must not use the smoothstep default`);
  }
});

test('the cat leaves the floor fast and arrives at the apex slow, not the other way round', () => {
  for (const id of AIRBORNE) {
    const clip = byId[id];
    for (const hop of hops(clip)) {
      const slices = 8;
      const step = (hop.apex - hop.takeoff) / slices;
      const travelled = [];
      for (let i = 0; i < slices; i += 1) {
        travelled.push(height(clip, hop.takeoff + (i + 1) * step) - height(clip, hop.takeoff + i * step));
      }
      for (let i = 1; i < travelled.length; i += 1) {
        assert.ok(
          travelled[i] < travelled[i - 1],
          `${id} @${hop.apex}s: slice ${i} of the rise (${travelled[i].toFixed(4)}) should be shorter than ` +
            `slice ${i - 1} (${travelled[i - 1].toFixed(4)}) - a rising body decelerates`,
        );
      }
      assert.ok(travelled[0] > travelled[slices - 1] * 3, `${id} @${hop.apex}s: the takeoff should be decisive`);
    }
  }
});

test('the fall mirrors the rise, so both halves imply one gravity', () => {
  for (const id of AIRBORNE) {
    for (const hop of hops(byId[id])) {
      const rise = hop.apex - hop.takeoff;
      const fall = hop.land - hop.apex;
      assert.ok(
        Math.abs(rise - fall) < 0.005,
        `${id} @${hop.apex}s: rise ${rise.toFixed(3)}s and fall ${fall.toFixed(3)}s must match - ` +
          'a body under gravity takes as long coming down as it took going up',
      );
    }
  }
});

test('every jump falls at Earth gravity, at the scale the rig declares', () => {
  // g = 2h/t², h in voxels converted through skeleton.json's voxelCm. The first fix settled on
  // a third of this, reasoning that a real 1g hop "reads as a glitch" - but that was reasoned
  // from a 1.6-voxel apex, and it was never what anyone saw: the drawn jump was in world units.
  // At the heights below a real hop is airborne for 10-12 frames, which reads as a hop.
  for (const id of AIRBORNE) {
    for (const hop of hops(byId[id])) {
      const rise = hop.apex - hop.takeoff;
      const g = ((2 * hop.height) / (rise * rise)) * (VOXEL_CM / 100);
      assert.ok(
        Math.abs(g - EARTH) / EARTH < 0.1,
        `${id} @${hop.apex}s implies ${g.toFixed(2)} m/s² - a ${hop.height}-voxel apex under real gravity ` +
          `takes ${Math.sqrt((2 * hop.height * VOXEL_CM) / 100 / EARTH).toFixed(3)}s to reach`,
      );
    }
  }
});

test('a hop clears a fraction of the cat, not a cat and a half', () => {
  for (const id of AIRBORNE) {
    for (const hop of hops(byId[id])) {
      assert.ok(hop.height >= 1, `${id}: ${hop.height} voxels is not a jump`);
      assert.ok(
        hop.height <= SHOULDER_VOXELS * 0.35,
        `${id}: ${hop.height} voxels is over a third of the ${SHOULDER_VOXELS}-voxel shoulder height - ` +
          'a desktop pet batting at a toy does not launch itself',
      );
    }
  }
});

test('the legs push off BEFORE takeoff and hold through the flight', () => {
  // The first retime left the crouch unfolding during the first 65ms of flight: the push-off,
  // which is the legs driving against the floor, happening after the floor was gone. With a
  // pose re-keyed mid-air the ground-contact rule also bends the torso's path off the parabola.
  for (const id of AIRBORNE) {
    const clip = byId[id];
    for (const hop of hops(clip)) {
      for (const track of clip.tracks.filter((t) => t.channel.startsWith('pose.'))) {
        const inside = track.keys.filter(([t]) => t > hop.takeoff + 1e-9 && t < hop.land - 1e-9);
        assert.deepEqual(
          inside, [],
          `${id}: ${track.channel} is keyed at ${inside.map(([t]) => t).join(', ')}s, inside the flight ` +
            `${hop.takeoff}s-${hop.land}s - legs can only push against a floor that is there`,
        );
      }
    }
  }
});

test('the paws and the head still move with the arc, not with where it used to be', () => {
  for (const id of AIRBORNE) {
    const clip = byId[id];
    for (const hop of hops(clip)) {
      // Something other than the lift has to happen while the cat is off the floor, or the jump
      // is a bare translation of a standing pose.
      const companions = clip.tracks.filter((t) => t.channel !== 'root.position.y');
      assert.ok(
        companions.some((t) => t.keys.some(([t0]) => t0 > hop.takeoff && t0 < hop.land)),
        `${id}: nothing but the lift is keyed between ${hop.takeoff}s and ${hop.land}s`,
      );
      // Where the clip swings a front leg, the extreme of that swing belongs to the jump - that
      // is the key that gets left behind on the floor when a lift is retimed without it.
      // `pounce` carries its shape in pose.crouch and has no leg tracks, so it has nothing to hold.
      const legs = ['upperFL.rotation.x', 'upperFR.rotation.x']
        .map((channel) => clip.tracks.find((t) => t.channel === channel))
        .filter(Boolean);
      if (!legs.length) continue;
      const swipes = legs.map((leg) => leg.keys.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))[0]);
      assert.ok(
        swipes.some((t) => t >= hop.takeoff - 0.1 && t <= hop.land + 0.1),
        `${id}: no front-leg swipe (${swipes.join(', ')}s) is anywhere near the flight ` +
          `${hop.takeoff}s-${hop.land}s - the cat is batting at the toy from the floor`,
      );
    }
  }
});

test('sampleMotion honours all three interpolations, and defaults to the old one', () => {
  const clip = (interp) => ({
    id: 'probe', name: 'probe', duration: 1, priority: 0, expression: 'x',
    tracks: [{ channel: 'root.position.y', keys: [[0, 0], [1, 1]], ...(interp ? { interp } : {}) }],
  });
  const at = (interp, t) => sampleMotion(clip(interp), t)['root.position.y'];

  assert.equal(at('linear', 0.25), 0.25, 'linear should be linear');
  // smoothstep(0.25) = 0.15625 - slower than linear at the start, which is what makes it wrong
  // for a takeoff and right for a head turn.
  assert.ok(Math.abs(at(undefined, 0.25) - 0.15625) < 1e-9, 'the default must still be smoothstep');
  assert.ok(Math.abs(at('smooth', 0.25) - 0.15625) < 1e-9, 'explicit smooth matches the default');
  // Rising ballistic: 0.25*(2-0.25) = 0.4375 - already past linear, because it left fast.
  assert.ok(Math.abs(at('ballistic', 0.25) - 0.4375) < 1e-9, 'a rising ballistic segment decelerates');

  const falling = {
    id: 'probe', name: 'probe', duration: 1, priority: 0, expression: 'x',
    tracks: [{ channel: 'root.position.y', keys: [[0, 1], [1, 0]], interp: 'ballistic' }],
  };
  // Falling: 1 - 0.25² = 0.9375 - barely moved, because it started from rest at the apex.
  assert.ok(
    Math.abs(sampleMotion(falling, 0.25)['root.position.y'] - 0.9375) < 1e-9,
    'a falling ballistic segment accelerates from rest',
  );
});

// --- the body, not the keyframes ------------------------------------------------------------

/**
 * Just enough of a DOM for buildRig: it paints its texture atlas onto a 2D canvas, and nothing
 * measured here depends on a single pixel of it.
 */
function stubCanvas() {
  const noop = () => {};
  const context = new Proxy({}, {
    get: (store, key) => {
      if (key in store) return store[key];
      if (key === 'getImageData' || key === 'createImageData') {
        return (_x, _y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h });
      }
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop: noop });
      return noop;
    },
    set: (store, key, value) => { store[key] = value; return true; },
  });
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context }) };
}

async function realBody() {
  stubCanvas();
  const THREE = await import('three');
  const { refineSkeleton } = await import('../src/rig/anatomy.ts');
  const { buildRig } = await import('../src/rig/skeleton.ts');
  const { createBodyController } = await import('../src/anim/body-controller.ts');
  const skins = read('../src/data/skins.json');
  const refined = refineSkeleton(skeleton);
  const rig = buildRig(skins.find((s) => s.id === 'honey-mittens'), refined);
  const controller = createBodyController(rig, refined);
  const box = new THREE.Box3();
  /** Pose the body the way renderer.ts does - scale, apply, THEN place and turn the root. */
  function pose(offsets, { scale, x = 0, z = 0, yaw = 0 }) {
    controller.reset();
    rig.root.scale.setScalar(scale);
    controller.apply(offsets);
    rig.root.position.x = x;
    rig.root.position.z = z;
    rig.root.rotation.y = yaw;
    rig.root.updateMatrixWorld(true);
    box.makeEmpty();
    rig.root.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
    const torso = rig.node('spine2').getWorldPosition(new THREE.Vector3());
    return { clearance: box.min.y / scale, torso: torso.sub(rig.root.position).divideScalar(scale) };
  }
  return { pose };
}

/** renderer.ts's VOXEL_TO_WORLD, and lib.rs's SCALE_SMALL / MEDIUM / LARGE. */
const VOXEL_TO_WORLD = 0.055;
const SIZES = [0.25, 0.5, 1.0];

test('the drawn jump is the authored jump, in voxels, at every size', async () => {
  const { pose } = await realBody();
  for (const size of SIZES) {
    const scale = VOXEL_TO_WORLD * size;
    assert.ok(Math.abs(pose({}, { scale }).clearance) < 1e-6, `standing at ${size}x should be on the floor`);
    for (const id of AIRBORNE) {
      for (const hop of hops(byId[id])) {
        const drawn = pose(sampleMotion(byId[id], hop.apex), { scale }).clearance;
        assert.ok(
          Math.abs(drawn - hop.height) < 1e-6,
          `${id} at ${size}x: authored ${hop.height} voxels at the apex, drew ${drawn.toFixed(2)} - ` +
            'a root offset read in world units grows as the cat shrinks',
        );
      }
    }
  }
});

test('a clip lunge survives the renderer placing and turning the cat, and follows its facing', async () => {
  // The renderer sets root.position.x/z and root.rotation.y AFTER the body controller runs. A
  // lunge written onto the root was simply overwritten: pounce, rear-up, head-bump, toy-swat and
  // both rolls had authored travel that was never once drawn.
  const { pose } = await realBody();
  const scale = VOXEL_TO_WORLD * 0.5;
  for (const yaw of [0, 0.6, -2.2]) {
    const placement = { scale, x: 1.3, z: -0.4, yaw };
    const still = pose({}, placement).torso;
    const lunged = pose({ 'root.position.z': 3 }, placement).torso;
    const moved = lunged.clone().sub(still);
    assert.ok(Math.abs(moved.length() - 3) < 1e-6, `yaw ${yaw}: a 3-voxel lunge moved the torso ${moved.length().toFixed(3)}`);
    // Forward is +z turned by the yaw.
    const forward = moved.x * Math.sin(yaw) + moved.z * Math.cos(yaw);
    assert.ok(Math.abs(forward - 3) < 1e-6, `yaw ${yaw}: the lunge went ${forward.toFixed(3)} voxels forward, not 3`);
  }
});
