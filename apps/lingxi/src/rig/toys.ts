// Toy props. Built in the same Three.js scene as the cat and placed with the same
// pixel->ground-plane mapping, so a toy sits on the floor next to the cat rather than
// floating as a 2D sticker over a 3D scene - which is what drawing them in the DOM overlay
// would have produced at any camera angle other than dead overhead.
//
// Deliberately built from primitives rather than authored as voxel assets: these are props,
// not characters, and a yarn ball made of three torus rings reads instantly at 40px while
// costing nothing to maintain.
import * as THREE from 'three';
import { createRope } from './rope.ts';

export type ToyKind = 'yarn' | 'feather' | 'laser';

export interface ToyProp {
  /** Added to / removed from the scene by the renderer. */
  readonly object: THREE.Object3D;
  /**
   * Height, in voxels, of the point on this prop that should land exactly on the toy's logical
   * screen position. For the ball that is its centre (so it sits ON the pointer rather than
   * near it); for the laser it is the floor; for the wand it is where your hand would be.
   */
  readonly anchorHeight: number;
  /**
   * Optional second object added straight to the scene, UNPARENTED and UNSCALED. Anything that
   * has to stay where it was put in world space belongs here rather than as a child of
   * `object` - a child inherits the prop's position AND its scale, which is what silently
   * shrank the laser's trail to nothing (offsets in world units multiplied by 0.0275).
   */
  readonly worldLayer?: THREE.Object3D;
  /** Told the current voxel->world scale, for props whose world layer has to match the prop. */
  setWorldScale?(scale: number): void;
  /**
   * Per-frame animation (spin, bob, flicker).
   * @param speed the toy's own travel speed, px/s
   * @param charge 0..1 wind-up while the user is holding the ball ready to throw
   */
  update(
    deltaSeconds: number,
    speed: number,
    charge: number,
    /** Direction of travel in world space, plus voxels-per-logical-pixel, for rolling. */
    travel?: { x: number; z: number; scale: number },
  ): void;
  /** The cat hit it. Props that can be knocked about respond; the rest ignore it. */
  struck?(): void;
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
  const rollAxis = new THREE.Vector3();
  const rollQuaternion = new THREE.Quaternion();
  return {
    object: group,
    // The ball's own centre. The renderer places this exactly on the toy's logical point, so
    // while it is in hand the ball is centred on the pointer rather than floating off it.
    anchorHeight: YARN_RADIUS,
    update(deltaSeconds, speed, charge, travel) {
      // Roll about the axis perpendicular to travel, at the rate the surface would actually
      // turn. Spinning on fixed axes reads as a ball with a motor in it; rolling the right way
      // for the direction it is going is what makes it read as rolling at all.
      if (travel && speed > 1) {
        rollAxis.set(travel.z, 0, -travel.x);
        if (rollAxis.lengthSq() > 1e-8) {
          rollAxis.normalize();
          // Arc length over radius = the angle a rolling ball turns through.
          const worldSpeed = speed * (travel.scale ?? 1);
          rollQuaternion.setFromAxisAngle(rollAxis, (worldSpeed / YARN_RADIUS) * deltaSeconds);
          group.quaternion.premultiply(rollQuaternion);
        }
      }

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

/**
 * 逗猫棒. The rod is rigid and hangs from the hand; the feather is on the end of a soft
 * VERLET ROPE (see rig/rope.ts), which is what gives it the thing a sine wave cannot: the tip
 * trails behind your hand, overshoots when you stop, and keeps swinging afterwards. That lag is
 * the entire game - it is what the cat is timing its jump against.
 */
function createFeather(): ToyProp {
  const group = new THREE.Group();

  // The rigid part: a stick from the hand going up out of frame.
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 30, 5),
    new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 1 }),
  );
  rod.position.set(1.6, 15, -1.2);
  rod.rotation.z = -0.1;
  group.add(rod);

  // The soft part. Five links of string between the rod tip and the feather.
  const ROPE_POINTS = 6;
  const SEGMENT = 1.5;
  const rope = createRope({
    points: ROPE_POINTS,
    segmentLength: SEGMENT,
    // Tuned so it hangs quickly but keeps a visible tail-off. In the prop's own voxel units.
    gravity: 55,
    damping: 0.35,
    iterations: 8,
  });
  const ropeHand = new THREE.Vector3(0, 0, 0);

  // String, redrawn each frame from the rope's points.
  const stringGeometry = new THREE.BufferGeometry();
  stringGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ROPE_POINTS * 3), 3));
  const string = new THREE.Line(
    stringGeometry,
    new THREE.LineBasicMaterial({ color: 0xd8c9a8, transparent: true, opacity: 0.85 }),
  );
  group.add(string);

  // The feather itself, carried to the rope's last point.
  const plume = new THREE.Group();
  const plumeMaterial = new THREE.MeshStandardMaterial({ color: 0x6fc2d6, roughness: 0.85, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i += 1) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.6, 4), plumeMaterial);
    const angle = (i / 5) * Math.PI * 2;
    frond.position.set(Math.cos(angle) * 0.55, 1.7, Math.sin(angle) * 0.55);
    frond.rotation.set(Math.cos(angle) * 0.5, 0, Math.sin(angle) * -0.5);
    plume.add(frond);
  }
  const knot = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 0),
    new THREE.MeshStandardMaterial({ color: 0xf2d17a, roughness: 0.9 }),
  );
  plume.add(knot);
  group.add(plume);

  const rodTip = new THREE.Vector3(1.6, 0.6, -1.2);
  const strike = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const localPoint = new THREE.Vector3();
  const localAbove = new THREE.Vector3();
  const worldScaleVector = new THREE.Vector3();
  const inverseGroupWorld = new THREE.Matrix4();
  let started = false;
  let previousScale = 0;

  return {
    object: group,
    // The hand. Everything below it dangles, so this is what belongs on the pointer.
    anchorHeight: 0,
    update(deltaSeconds) {
      // Simulate in world-aligned voxel units. A rope simulated in the moving group's local
      // space sees a stationary hand, so its feather follows rigidly and never swings.
      group.updateWorldMatrix(true, false);
      const scale = Math.max(1e-6, group.getWorldScale(worldScaleVector).x);
      group.localToWorld(ropeHand.copy(rodTip)).multiplyScalar(1 / scale);
      if (!started || Math.abs(scale - previousScale) > 1e-6) {
        started = true;
        rope.reset(ropeHand);
      }
      previousScale = scale;
      rope.update(ropeHand, deltaSeconds);

      const positions = stringGeometry.getAttribute('position') as THREE.BufferAttribute;
      inverseGroupWorld.copy(group.matrixWorld).invert();
      for (let i = 0; i < ROPE_POINTS; i += 1) {
        // Convert the simulated world point back to the prop's local frame for rendering.
        localPoint.copy(rope.points[i]).multiplyScalar(scale).applyMatrix4(inverseGroupWorld);
        positions.setXYZ(i, localPoint.x, localPoint.y, localPoint.z);
        if (i === ROPE_POINTS - 2) localAbove.copy(localPoint);
      }
      positions.needsUpdate = true;
      stringGeometry.computeBoundingSphere();

      plume.position.copy(localPoint);
      // Point the feather along the last link, so it flies out sideways on a hard swing
      // instead of always hanging straight down.
      forward.subVectors(localPoint, localAbove);
      if (forward.lengthSq() > 1e-6) {
        plume.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), forward.normalize());
      }
    },
    struck() {
      // Up and out, with a random sideways component so repeated hits do not look canned.
      strike.set((Math.random() - 0.5) * 0.7, 1, (Math.random() - 0.5) * 0.7).normalize().multiplyScalar(0.9);
      rope.impulse(strike, 2);
    },
    dispose() {
      stringGeometry.dispose();
      (string.material as THREE.Material).dispose();
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
  // The trail lives in its own scene-level object. As children of `group` the marks inherited
  // the prop's scale, so their world-unit offsets were multiplied by ~0.028 and every mark
  // collapsed onto the dot - present in the DOM, invisible on screen.
  const worldLayer = new THREE.Group();
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
    worldLayer.add(mark);
    trail.push(mark);
    trailAnchors.push(null);
    trailAges.push(Infinity);
  }
  let markScale = 1;
  let trailIndex = 0;
  let sinceMark = 0;
  const lastWorld = new THREE.Vector3(Infinity, 0, Infinity);

  let phase = 0;
  return {
    object: group,
    worldLayer,
    anchorHeight: 0, // the dot is on the floor
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
        // World space directly - the layer this lives in is never moved or scaled.
        mark.position.set(anchor.x, 0.03, anchor.z);
        // Taper: newest marks are nearly the size of the dot, the oldest are a wisp.
        // Scaled in WORLD units now, so it has to be sized like one: the dot itself is a
        // 0.85-voxel circle at the prop's scale, and the tail tapers from about that.
        mark.scale.setScalar((0.18 + life * 0.72) * markScale);
        (mark.material as THREE.MeshBasicMaterial).opacity = life * life * 0.7;
      }
    },
    /** The renderer tells us how big a voxel currently is, so world-space marks match the dot. */
    setWorldScale(scale: number) {
      markScale = scale;
    },
    dispose() {
      for (const mark of trail) (mark.material as THREE.MeshBasicMaterial).dispose();
      disposeTree(worldLayer);
      disposeTree(group);
    },
  };
}

export function createToyProp(kind: ToyKind): ToyProp {
  if (kind === 'feather') return createFeather();
  if (kind === 'laser') return createLaser();
  return createYarn();
}
