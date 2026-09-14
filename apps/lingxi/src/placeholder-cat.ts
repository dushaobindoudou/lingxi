// A deliberately crude "pixel cat" placeholder built from boxes, purely to validate
// the desktop pipeline (transparent overlay, click-through hit-testing, locomotion,
// facing, idle/walk animation) end to end before the production Lingxi asset (which
// needs a proper GLB export pipeline - see docs/decisions/001-realtime-desktop.md's
// "不能承诺 .blend 中 Geometry Nodes Groom 原样变成 GLB") is wired in behind the same
// Renderer interface. Swap PlaceholderCat for a GLTFLoader-based implementation later
// without touching main.ts or the life engine.
import * as THREE from 'three';

export interface PlaceholderCatLegs {
  frontLeft: THREE.Object3D;
  frontRight: THREE.Object3D;
  rearLeft: THREE.Object3D;
  rearRight: THREE.Object3D;
}

export interface PlaceholderCat {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  tail: THREE.Object3D;
  legs: PlaceholderCatLegs;
  /** Half-extents in local units, for hit-testing without a full raycast. */
  boundingRadius: number;
}

const PALETTE = {
  coat: 0xcbb89a,
  cream: 0xf1e6d3,
  nose: 0xdb8f92,
  eye: 0x2c2c2c,
};

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshToonMaterial({ color }),
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function leg(pivotY: number): { pivot: THREE.Group; mesh: THREE.Mesh } {
  const pivot = new THREE.Group();
  pivot.position.set(0, pivotY, 0);
  const mesh = box(0.16, 0.34, 0.16, PALETTE.coat);
  mesh.position.set(0, -0.17, 0);
  pivot.add(mesh);
  return { pivot, mesh };
}

export function createPlaceholderCat(): PlaceholderCat {
  const root = new THREE.Group();
  root.name = 'PlaceholderCat';

  const body = box(0.62, 0.4, 0.9, PALETTE.coat);
  body.position.set(0, 0.42, 0);
  root.add(body);

  const belly = box(0.5, 0.16, 0.7, PALETTE.cream);
  belly.position.set(0, 0.28, 0);
  root.add(belly);

  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.52);
  root.add(head);
  const skull = box(0.42, 0.38, 0.4, PALETTE.coat);
  head.add(skull);
  const muzzle = box(0.26, 0.2, 0.16, PALETTE.cream);
  muzzle.position.set(0, -0.08, 0.24);
  head.add(muzzle);
  const nose = box(0.08, 0.06, 0.04, PALETTE.nose);
  nose.position.set(0, 0.02, 0.33);
  head.add(nose);
  for (const side of [-1, 1]) {
    const eye = box(0.05, 0.05, 0.02, PALETTE.eye);
    eye.position.set(side * 0.13, 0.03, 0.32);
    head.add(eye);
    const ear = box(0.14, 0.16, 0.05, PALETTE.coat);
    ear.position.set(side * 0.15, 0.26, -0.02);
    ear.rotation.z = side * 0.18;
    head.add(ear);
  }

  const legPivotY = 0.34;
  const frontLeft = leg(legPivotY);
  const frontRight = leg(legPivotY);
  const rearLeft = leg(legPivotY);
  const rearRight = leg(legPivotY);
  frontLeft.pivot.position.set(-0.2, legPivotY, 0.32);
  frontRight.pivot.position.set(0.2, legPivotY, 0.32);
  rearLeft.pivot.position.set(-0.2, legPivotY, -0.32);
  rearRight.pivot.position.set(0.2, legPivotY, -0.32);
  root.add(frontLeft.pivot, frontRight.pivot, rearLeft.pivot, rearRight.pivot);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.5, -0.46);
  const tailMesh = box(0.12, 0.12, 0.5, PALETTE.coat);
  tailMesh.position.set(0, 0.1, -0.22);
  tailPivot.add(tailMesh);
  root.add(tailPivot);

  return {
    root,
    body,
    head,
    tail: tailPivot,
    legs: { frontLeft: frontLeft.pivot, frontRight: frontRight.pivot, rearLeft: rearLeft.pivot, rearRight: rearRight.pivot },
    boundingRadius: 0.6,
  };
}

/**
 * Simple procedural gait: sine-swing legs, bob the body, sway the tail. Idle = amplitude 0.
 *
 * `gaitPhase` (not `elapsedSeconds`) drives the leg swing and body bob: it's an odometer -
 * the caller advances it by actual distance covered, not wall-clock time - so the legs cycle
 * in proportion to ground actually covered instead of a fixed cadence regardless of how fast
 * or far the cat is really moving (the previous time-based version made fast follow-mode
 * motion and slow wander motion swing legs at the identical rate, i.e. visibly "sliding" -
 * reported as "运动的距离不对"). Head bob and tail sway stay wall-clock based; they're ambient
 * idle motion, not locomotion, so they should keep going even while perfectly still.
 */
export function animatePlaceholderCat(cat: PlaceholderCat, elapsedSeconds: number, gaitPhase: number, walkAmount: number): void {
  const swing = Math.sin(gaitPhase) * walkAmount * 0.6;
  cat.legs.frontLeft.rotation.x = swing;
  cat.legs.rearRight.rotation.x = swing;
  cat.legs.frontRight.rotation.x = -swing;
  cat.legs.rearLeft.rotation.x = -swing;

  cat.body.position.y = 0.42 + Math.abs(Math.sin(gaitPhase)) * walkAmount * 0.03;
  cat.head.position.y = 0.58 + Math.sin(elapsedSeconds * 2.2) * 0.01; // idle breathing bob, always on
  cat.tail.rotation.y = Math.sin(elapsedSeconds * 2.4 - walkAmount * 2) * (0.25 + walkAmount * 0.2);
  cat.tail.rotation.x = Math.sin(elapsedSeconds * 1.6) * 0.06;
}
