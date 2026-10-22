// 毛线球 for the realistic cat. The voxel cat's ball (rig/toys.ts) is a faceted core under three torus rings - right
// for a voxel world, and beside a furred kitten it read as a pink plastic sweet ("球的质感感觉也不对"). This one is
// wound wool: dozens of plied strands round a core, matte with a soft sheen; a loose end that is a real rope, dragged
// and flicked along the floor as the ball rolls; and a ball that hops when it is batted and squashes as it lands.
// Same units and contract as the voxel props (ToyProp, voxel units, centre on the toy's point), so the renderer and the
// life engine treat it exactly as they did the old ball.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { YARN_RADIUS, type ToyProp } from './rig/toys.ts';
import { createRope } from './rig/rope.ts';

// strands: wound round the core; ply: the twist's turns along a strand per voxel unit; colour: the wool and how much one
// strand's shade wanders from it. thread: the loose end - points, link length (in ball radii) and thickness.
// hop: the batted ball's upward speed and the fall's pull (voxel units, per second); squash: how much a landing flattens it.
const YARN = {
  strands: 84, strandRadius: [0.055, 0.075] as const, ply: 2.4,
  colour: 0xc8505f, core: 0x8f3846, shade: 0.12,
  thread: { points: 14, link: 0.42, radius: 0.05 },
  hop: { speed: 7.5, gravity: 60 }, squash: 0.16,
} as const;

function woundBall(random: () => number) {
  const R = YARN_RADIUS;
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color(YARN.colour);
  for (let i = 0; i < YARN.strands; i++) {
    // a great circle at a random tilt, a little proud of the core; later strands sit over earlier ones
    const lift = 1 + 0.01 + 0.035 * (i / YARN.strands);
    const axis = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    const curve = new THREE.EllipseCurve(0, 0, R * lift, R * lift, 0, Math.PI * 2, false, random() * Math.PI * 2);
    const points = curve.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0).applyQuaternion(q));
    const path = new THREE.CatmullRomCurve3(points, true);
    const radius = THREE.MathUtils.lerp(YARN.strandRadius[0], YARN.strandRadius[1], random()) * R;
    const tube = new THREE.TubeGeometry(path, 72, radius, 5, true);
    const shade = 1 + (random() - 0.5) * 2 * YARN.shade;
    const c = base.clone().multiplyScalar(shade);
    const colours = new Float32Array(tube.getAttribute('position').count * 3);
    for (let k = 0; k < colours.length; k += 3) { colours[k] = c.r; colours[k + 1] = c.g; colours[k + 2] = c.b; }
    tube.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(tube);
  }
  return mergeGeometries(parts)!;
}

/** Wool: matte, a soft sheen at the edge, and the ply's twist drawn along every strand (tube uv: u along, v round). */
function woolMaterial(length: number, colour?: number) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: colour == null, color: colour ?? 0xffffff, roughness: 0.95, metalness: 0,
    sheen: 0.45, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xf0b3bc),
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      #ifdef USE_UV
        float twist = fract(vUv.x * ${(length * YARN.ply).toFixed(1)} + vUv.y * 2.0);
        diffuseColor.rgb *= 0.62 + 0.5 * smoothstep(0.0, 0.5, twist) * (1.0 - smoothstep(0.5, 1.0, twist));
      #endif`);
  };
  m.defines = { USE_UV: '' };
  m.customProgramCacheKey = () => 'realcat-yarn-wool-v2';
  return m;
}

export function createRealisticYarn(seed = 20261022): ToyProp {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const R = YARN_RADIUS;
  const group = new THREE.Group();
  // body: the hop and the squash; rolling: the ball's turn as it travels
  const body = new THREE.Group();
  const rolling = new THREE.Group();
  group.add(body);
  body.add(rolling);
  const wool = woolMaterial(2 * Math.PI * R);
  const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 32, 20), new THREE.MeshStandardMaterial({ color: YARN.core, roughness: 1 }));
  const strands = new THREE.Mesh(woundBall(random), wool);
  for (const mesh of [core, strands]) { mesh.castShadow = true; rolling.add(mesh); }

  // The loose end: anchored on the ball (it turns with the roll) and simulated in world-aligned voxel units, so the
  // thread trails, drags on the floor and whips when the ball is struck.
  const rope = createRope({ points: YARN.thread.points, segmentLength: YARN.thread.link * R, gravity: 55, damping: 0.25, iterations: 6 });
  const threadAnchor = new THREE.Vector3(R * 0.97, -R * 0.2, 0);
  const anchorWorld = new THREE.Vector3(), centreWorld = new THREE.Vector3(), worldScale = new THREE.Vector3();
  const threadMaterial = woolMaterial(YARN.thread.points * YARN.thread.link * R, YARN.colour);
  let thread = new THREE.Mesh(new THREE.BufferGeometry(), threadMaterial);
  thread.castShadow = true;
  const threadLayer = new THREE.Group();
  threadLayer.add(thread);
  let started = false, previousScale = 1;

  // Wind-up ring, as on the voxel ball: you can see how much you have in hand.
  const chargeRing = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.5, R * 1.9, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  chargeRing.rotation.x = -Math.PI / 2;
  chargeRing.position.y = -R + 0.06;
  group.add(chargeRing);

  let squash = 0, hop = 0, hopSpeed = 0, landing = 0;
  const rollAxis = new THREE.Vector3(), rollQuaternion = new THREE.Quaternion();
  const inverseThread = new THREE.Matrix4();
  return {
    object: group,
    worldLayer: threadLayer,
    anchorHeight: R,
    contactSphere(target) {
      rolling.getWorldPosition(target.center);
      rolling.getWorldScale(worldScale);
      target.radius = R * Math.max(worldScale.x, worldScale.y, worldScale.z);
      return target;
    },
    update(deltaSeconds, speed, charge, travel) {
      const dt = Math.min(1 / 20, Math.max(0, deltaSeconds));
      if (travel && speed > 1) {
        rollAxis.set(travel.z, 0, -travel.x);
        if (rollAxis.lengthSq() > 1e-8) {
          rollAxis.normalize();
          const worldSpeed = Math.hypot(travel.x, travel.z) * travel.scale;
          rollQuaternion.setFromAxisAngle(rollAxis, (worldSpeed / R) * dt);
          rolling.quaternion.premultiply(rollQuaternion);
        }
      }
      // the hop off a swat, and the squash and rebound of its landing
      if (hop > 0 || hopSpeed > 0) {
        hopSpeed -= YARN.hop.gravity * dt;
        hop += hopSpeed * dt;
        if (hop <= 0) { hop = 0; landing = Math.min(1, -hopSpeed / YARN.hop.speed); hopSpeed = 0; }
      }
      landing *= Math.exp(-dt / 0.07);
      squash += (charge - squash) * (1 - Math.exp(-dt / 0.09));
      const flat = Math.max(squash, landing * YARN.squash / 0.22);
      body.position.y = hop;
      body.scale.set(1 + flat * 0.18, 1 - flat * 0.22, 1 + flat * 0.18);
      const ringMaterial = chargeRing.material as THREE.MeshBasicMaterial;
      ringMaterial.opacity = squash * 0.9;
      chargeRing.scale.setScalar(1.45 - squash * 0.45);
      chargeRing.rotation.z += dt * (1 + squash * 9);

      // the thread: anchor on the turning ball, floor under the ball, rebuilt as a tube each frame
      group.updateWorldMatrix(true, true);
      const scale = Math.max(1e-6, group.getWorldScale(worldScale).x);
      rolling.localToWorld(anchorWorld.copy(threadAnchor)).multiplyScalar(1 / scale);
      group.getWorldPosition(centreWorld).multiplyScalar(1 / scale);
      if (!started || Math.abs(scale - previousScale) > 1e-6) { started = true; rope.reset(anchorWorld); }
      previousScale = scale;
      rope.update(anchorWorld, dt);
      const floor = centreWorld.y - R + YARN.thread.radius * R;
      for (const p of rope.points) {
        if (p.y < floor) p.y = floor;
        // never through the ball itself
        const dx = p.x - centreWorld.x, dy = p.y - (centreWorld.y + hop), dz = p.z - centreWorld.z;
        const d = Math.hypot(dx, dy, dz), min = R * 1.04;
        if (d < min && d > 1e-6) { p.x = centreWorld.x + dx * min / d; p.y = centreWorld.y + hop + dy * min / d; p.z = centreWorld.z + dz * min / d; }
      }
      threadLayer.updateWorldMatrix(true, false);
      inverseThread.copy(threadLayer.matrixWorld).invert();
      const points = rope.points.map((p) => p.clone().multiplyScalar(scale).applyMatrix4(inverseThread));
      thread.geometry.dispose();
      thread.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 3, YARN.thread.radius * R * scale, 4, false);
    },
    struck() {
      hopSpeed = YARN.hop.speed;
      hop = Math.max(hop, 1e-3);
      // the loose end whips away
      rope.impulse(new THREE.Vector3((random() - 0.5) * 0.5, 0.25, (random() - 0.5) * 0.5), 2);
    },
    dispose() {
      group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      thread.geometry.dispose();
      wool.dispose(); threadMaterial.dispose();
      (core.material as THREE.Material).dispose();
      (chargeRing.material as THREE.Material).dispose();
    },
  };
}
