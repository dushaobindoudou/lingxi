// Toy props. Built in the same Three.js scene as the cat and placed with the same
// pixel->ground-plane mapping, so a toy sits on the floor next to the cat rather than
// floating as a 2D sticker over a 3D scene - which is what drawing them in the DOM overlay
// would have produced at any camera angle other than dead overhead.
//
// Deliberately built from primitives rather than authored as voxel assets: these are props,
// not characters, and a yarn ball made of three torus rings reads instantly at 40px while
// costing nothing to maintain.
import * as THREE from 'three';

export type ToyKind = 'yarn' | 'feather' | 'laser';

export interface ToyProp {
  /** Added to / removed from the scene by the renderer. */
  readonly object: THREE.Object3D;
  /**
   * Per-frame animation (spin, bob, flicker).
   * @param speed the toy's own travel speed, px/s
   * @param charge 0..1 wind-up while the user is holding the ball ready to throw
   */
  update(deltaSeconds: number, speed: number, charge: number): void;
  dispose(): void;
}

/** Voxel units, matching the rig's own scale (the cat is ~13 units tall). */
const YARN_RADIUS = 2.0;

function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}

/** 毛线球: a ball with wound thread. Rolls - the spin is driven by how fast it is moving. */
function createYarn(): ToyProp {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(YARN_RADIUS, 1), // faceted, to match the voxel look
    new THREE.MeshStandardMaterial({ color: 0xe2708a, roughness: 0.95, metalness: 0 }),
  );
  group.add(ball);

  // Three rings at different tilts read as wound thread from every angle.
  const threadMaterial = new THREE.MeshStandardMaterial({ color: 0xf6c6d2, roughness: 0.95 });
  const tilts: [number, number][] = [
    [0, 0],
    [Math.PI / 2.4, 0.5],
    [Math.PI / 2, Math.PI / 2.6],
  ];
  for (const [rx, rz] of tilts) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(YARN_RADIUS * 0.99, 0.22, 6, 20), threadMaterial);
    ring.rotation.set(rx, 0, rz);
    group.add(ring);
  }
  // A loose thread trailing off, so a stationary ball still reads as yarn and not as a marble.
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, YARN_RADIUS * 2.4, 5),
    threadMaterial,
  );
  tail.rotation.z = Math.PI / 2.1;
  tail.position.set(YARN_RADIUS * 1.1, -YARN_RADIUS * 0.55, 0);
  group.add(tail);

  group.position.y = YARN_RADIUS; // resting on the floor, not sunk into it

  // Wind-up ring: a flat halo on the ground under the ball that fills out as you hold. The
  // whole point of a charge mechanic is that you can see how much you have; without a readout
  // it is just an unexplained delay.
  const chargeRing = new THREE.Mesh(
    new THREE.RingGeometry(YARN_RADIUS * 1.5, YARN_RADIUS * 1.9, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  chargeRing.rotation.x = -Math.PI / 2;
  chargeRing.position.y = -YARN_RADIUS + 0.06;
  group.add(chargeRing);

  let squash = 0;
  return {
    object: group,
    update(deltaSeconds, speed, charge) {
      // Roll rate from travel speed: a ball that spins while parked looks like a prop, and one
      // that slides without spinning looks like a bug.
      group.rotation.x -= (speed / 90) * deltaSeconds * 4;
      group.rotation.z += (speed / 260) * deltaSeconds * 2;

      // Held and winding up: the ball squashes and the ring brightens and closes in.
      squash += (charge - squash) * (1 - Math.exp(-deltaSeconds / 0.09));
      ball.scale.set(1 + squash * 0.18, 1 - squash * 0.22, 1 + squash * 0.18);
      const ringMaterial = chargeRing.material as THREE.MeshBasicMaterial;
      ringMaterial.opacity = squash * 0.9;
      chargeRing.scale.setScalar(1.45 - squash * 0.45);
      chargeRing.rotation.z += deltaSeconds * (1 + squash * 9);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

/** 逗猫棒: a feather on a wand, dangling from above - the stick runs up out of frame. */
function createFeather(): ToyProp {
  const group = new THREE.Group();
  const bob = new THREE.Group(); // everything that sways; the outer group only translates
  group.add(bob);

  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 26, 5),
    new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 1 }),
  );
  rod.position.set(3.2, 20, -2);
  rod.rotation.z = -0.22;
  bob.add(rod);

  const plumeMaterial = new THREE.MeshStandardMaterial({
    color: 0x6fc2d6,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 4; i += 1) {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(1.0, 4.2, 4), plumeMaterial);
    const angle = (i / 4) * Math.PI * 2;
    plume.position.set(Math.cos(angle) * 0.7, 6.4, Math.sin(angle) * 0.7);
    plume.rotation.set(Math.cos(angle) * 0.42, 0, Math.sin(angle) * -0.42);
    bob.add(plume);
  }
  const knot = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({ color: 0xf2d17a, roughness: 0.9 }),
  );
  knot.position.y = 4.1;
  bob.add(knot);

  let phase = 0;
  return {
    object: group,
    update(deltaSeconds, speed) {
      // Dangling sway: faster and wider the more the hand is moving it.
      phase += deltaSeconds * (2.4 + Math.min(6, speed / 90));
      const amount = 0.08 + Math.min(0.26, speed / 900);
      bob.rotation.z = Math.sin(phase) * amount;
      bob.rotation.x = Math.cos(phase * 0.7) * amount * 0.6;
    },
    dispose() {
      disposeTree(group);
    },
  };
}

/** 激光笔: a red dot lying on the floor, with a soft halo. Never caught, so never picked up. */
function createLaser(): ToyProp {
  const group = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 16),
    new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.95 }),
  );
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 20),
    new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.22 }),
  );
  // Flat on the ground plane, lifted a hair so it never z-fights anything standing on the floor.
  for (const mesh of [dot, halo]) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    group.add(mesh);
  }

  // Comet tail. The first version of this was technically present but invisible: 14 marks at
  // 0.5 voxels living 0.34 seconds, which at desktop scale is three pixels for a third of a
  // second ("激光笔：划过的时候没有尾随的小尾巴"). A trail has to be long enough to still be
  // there when your eye arrives, and it has to taper, or it reads as a string of dots.
  const TRAIL = 30;
  const TRAIL_LIFE = 0.75; // seconds from drop to gone
  const trail: THREE.Mesh[] = [];
  const trailAnchors: (THREE.Vector3 | null)[] = [];
  const trailAges: number[] = [];
  for (let i = 0; i < TRAIL; i += 1) {
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(1, 12),
      new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0, depthWrite: false }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.visible = false;
    group.add(mark);
    trail.push(mark);
    trailAnchors.push(null);
    trailAges.push(Infinity);
  }
  let trailIndex = 0;
  let sinceMark = 0;
  const lastWorld = new THREE.Vector3(Infinity, 0, Infinity);

  let phase = 0;
  return {
    object: group,
    update(deltaSeconds) {
      // A real laser dot is never perfectly steady - the tiny flicker is most of what sells it.
      phase += deltaSeconds * 9;
      const pulse = 0.85 + Math.sin(phase) * 0.15;
      (dot.material as THREE.MeshBasicMaterial).opacity = pulse;
      halo.scale.setScalar(0.9 + Math.sin(phase * 0.6) * 0.12);

      // Drop a new mark wherever the dot has actually travelled. Distance-gated rather than
      // purely time-gated so a stationary pointer does not pile marks on one spot.
      sinceMark += deltaSeconds;
      const moved = lastWorld.distanceTo(group.position);
      if (sinceMark > 0.012 && moved > 0.002) {
        sinceMark = 0;
        lastWorld.copy(group.position);
        trailIndex = (trailIndex + 1) % TRAIL;
        trailAnchors[trailIndex] = group.position.clone();
        trailAges[trailIndex] = 0;
      }

      for (let i = 0; i < TRAIL; i += 1) {
        const anchor = trailAnchors[i];
        const mark = trail[i];
        if (!anchor) continue;
        trailAges[i] += deltaSeconds;
        const life = 1 - trailAges[i] / TRAIL_LIFE;
        if (life <= 0) {
          mark.visible = false;
          trailAnchors[i] = null;
          continue;
        }
        mark.visible = true;
        // Marks are children of a group the renderer moves every frame, so their LOCAL position
        // has to be counter-offset to keep them where they were dropped in world space.
        mark.position.set(anchor.x - group.position.x, 0.03, anchor.z - group.position.z);
        // Taper: newest marks are nearly the size of the dot, the oldest are a wisp.
        mark.scale.setScalar(0.18 + life * 0.72);
        (mark.material as THREE.MeshBasicMaterial).opacity = life * life * 0.7;
      }
    },
    dispose() {
      for (const mark of trail) (mark.material as THREE.MeshBasicMaterial).dispose();
      disposeTree(group);
    },
  };
}

export function createToyProp(kind: ToyKind): ToyProp {
  if (kind === 'feather') return createFeather();
  if (kind === 'laser') return createLaser();
  return createYarn();
}
