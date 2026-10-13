// Contact against the posed boxes that the merged voxel body actually draws.
// The life engine receives only logical points/verdicts; Three.js stays here.
import * as THREE from 'three';
import type { ToyInteraction, ToyInteractionRequest } from '../../../../packages/desktop-host-contract/index.d.ts';
import { YARN_RADIUS, LASER_RADIUS, type ToyProp } from './toys.ts';
import type { Rig } from './skeleton.ts';

function visible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Returns the first sphere contact on a swept segment, in world space. */
export function createToyContactTester(root: THREE.Object3D) {
  const boxes: THREE.Mesh[] = [];
  root.traverse(object => {
    // Face decals are flat overlays, not physical parts. Original body boxes
    // remain on layer 1 after merging, which must not disable their collisions.
    if (object instanceof THREE.Mesh && object.geometry.type === 'BoxGeometry') {
      object.geometry.computeBoundingBox();
      boxes.push(object);
    }
  });
  const inverse = new THREE.Matrix4();
  const local = new THREE.Vector3(), closest = new THREE.Vector3();
  const broad = new THREE.Box3(), direction = new THREE.Vector3();
  const ray = new THREE.Ray(), hit = new THREE.Vector3(), point = new THREE.Vector3();
  return (center: THREE.Vector3, radius: number, from = center): THREE.Vector3 | null => {
    root.updateWorldMatrix(true, true);
    let first = Infinity;
    const distance = from.distanceTo(center);
    direction.subVectors(center, from);
    ray.set(from, direction.clone().normalize());
    for (const box of boxes) {
      if (!visible(box)) continue;
      const bounds = box.geometry.boundingBox!;
      broad.copy(bounds).applyMatrix4(box.matrixWorld).expandByScalar(radius);
      if (!broad.containsPoint(from) && (!ray.intersectBox(broad, hit) || from.distanceTo(hit) > distance)) continue;
      inverse.copy(box.matrixWorld).invert();
      const separation = (t: number) => {
        point.copy(from).addScaledVector(direction, t);
        local.copy(point).applyMatrix4(inverse);
        bounds.clampPoint(local, closest).applyMatrix4(box.matrixWorld);
        return closest.distanceToSquared(point) - radius * radius;
      };
      if (separation(0) <= 1e-12) {
        first = 0;
        break;
      }
      // Squared distance to an oriented box along a line is convex. Locate the
      // nearest point before bisecting the first contact; a fast throw cannot
      // skip through a paw between frames. The narrow phase rejects the empty
      // corners of the broad world AABB, so rotated boxes do not hit early.
      let lo = 0, hi = 1;
      for (let i = 0; i < 26; i++) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (separation(a) < separation(b)) hi = b;
        else lo = a;
      }
      const nearest = (lo + hi) / 2;
      if (separation(nearest) > 1e-12 && separation(1) > 1e-12) continue;
      lo = 0;
      hi = separation(nearest) <= 1e-12 ? nearest : 1;
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2;
        if (separation(mid) <= 1e-12) hi = mid;
        else lo = mid;
      }
      first = Math.min(first, hi);
    }
    return Number.isFinite(first) ? from.clone().addScaledVector(direction, first) : null;
  };
}

/** Shared by the live renderer and CPU regression tests, with the real posed rig. */
export function createToyInteractionProbe(rig: Rig, options: {
  scale(): number;
  prop(): { kind: string | null; prop: ToyProp | null };
  place(point: { x: number; y: number }, height: number): THREE.Vector3;
  project(point: THREE.Vector3): { x: number; y: number };
}) {
  const test = createToyContactTester(rig.root);
  const sphere = new THREE.Sphere();
  const root = new THREE.Vector3(), paw = new THREE.Vector3(), goal = new THREE.Vector3();
  return (request: ToyInteractionRequest): ToyInteraction | null => {
    const scale = options.scale();
    const active = options.prop();
    rig.root.updateWorldMatrix(true, true);
    if (request.kind === 'feather') {
      if (active.kind !== 'feather' || !active.prop) return null;
      active.prop.contactSphere(sphere);
    } else {
      const height = request.kind === 'yarn' ? YARN_RADIUS * scale : 0;
      sphere.center.copy(options.place(request.position, height));
      if (request.kind === 'laser') sphere.center.y += .05 * scale;
      sphere.radius = (request.kind === 'yarn' ? YARN_RADIUS : LASER_RADIUS) * scale;
    }
    root.set(rig.root.position.x, 0, rig.root.position.z);
    // Aim the front paw, not the feet-anchor/centre of the cat, at the target.
    const pawMesh = rig.node('pawFR').children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
    pawMesh.geometry.computeBoundingBox();
    pawMesh.geometry.boundingBox!.getCenter(paw);
    pawMesh.localToWorld(paw);
    goal.set(sphere.center.x - (paw.x - root.x), 0, sphere.center.z - (paw.z - root.z));
    const target = options.project(goal);
    const shift = options.place(request.petPosition, 0).clone().sub(root);
    const previousShift = options.place(request.previousPetPosition, 0).clone().sub(root);
    const center = sphere.center.clone().sub(shift);
    const from = request.kind === 'yarn'
      ? options.place(request.previousPosition, YARN_RADIUS * scale).clone().sub(previousShift)
      : sphere.center.clone().sub(previousShift);
    const hit = test(center, sphere.radius, from);
    if (!hit) return { target, touching: false };
    const length = from.distanceTo(center);
    const fraction = length > 1e-9 ? Math.min(1, from.distanceTo(hit) / length) : 1;
    hit.add(previousShift.lerp(shift, fraction));
    return {
      target, touching: true,
      contactPosition: request.kind === 'yarn' ? options.project(hit) : undefined,
      petContactPosition: {
        x: request.previousPetPosition.x + (request.petPosition.x - request.previousPetPosition.x) * fraction,
        y: request.previousPetPosition.y + (request.petPosition.y - request.previousPetPosition.y) * fraction,
      },
    };
  };
}
