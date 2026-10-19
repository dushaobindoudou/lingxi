import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const wrap = (n: number) => ((n % 1) + 1) % 1;
const smooth = (n: number) => { const t = THREE.MathUtils.clamp(n, 0, 1); return t * t * (3 - 2 * t); };

export const steeringStrideScale = (turnRate: number) => 1 / (1 + Math.min(1.5, Math.abs(turnRate) * 1.5));
/** Metres and radians in the unscaled cat (~0.8 m tall). All additions are confined to travelling Walk. */
export const KITTEN_WALK = {
  stride: 0.72, support: 0.62, release: 0.08, frontLift: 0.025, rearLift: 0.016,
  load: 0.018, shoulderPitch: 0.010, hipSway: 0.014, tailSway: 0.025, headNod: 0.009,
};

/** Keep the authored bend plane while placing a two-bone chain in world space. */
function placePaw(upper: THREE.Object3D, lower: THREE.Object3D, paw: THREE.Object3D, target: THREE.Vector3) {
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = paw.getWorldPosition(new THREE.Vector3());
  const orientation = paw.getWorldQuaternion(new THREE.Quaternion());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const direction = target.clone().sub(a);
  const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5);
  direction.normalize();
  const pole = b.clone().sub(a).addScaledVector(direction, -b.clone().sub(a).dot(direction));
  if (pole.lengthSq() < 1e-10) pole.crossVectors(direction, new THREE.Vector3(1, 0, 0));
  pole.normalize();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const elbow = a.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  const end = a.clone().addScaledVector(direction, distance);
  function aim(joint: THREE.Object3D, child: THREE.Object3D, to: THREE.Vector3) {
    const origin = joint.getWorldPosition(new THREE.Vector3());
    const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(from, to.clone().sub(origin).normalize());
    const world = joint.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    const parent = joint.parent!.getWorldQuaternion(new THREE.Quaternion());
    joint.quaternion.copy(parent.invert().multiply(world));
    joint.updateWorldMatrix(false, true);
  }
  aim(upper, lower, elbow);
  aim(lower, paw, end);
  paw.quaternion.copy(paw.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
  paw.updateWorldMatrix(false, true);
}

/** Add steering after the mixer, then solve paws AFTER the torso bends. No changes to the source clips. */
export function createLocomotion(root: THREE.Object3D) {
  const find = (name: string) => {
    let result: THREE.Object3D | undefined;
    root.traverse(n => { if (n.name.replace(/[._]/g, '') === name.replace(/[._]/g, '')) result = n; });
    return result;
  };
  root.updateWorldMatrix(true, true);
  const legs = [
    ['Front', 'L', 0], ['Front', 'R', .5], ['Rear', 'L', .25], ['Rear', 'R', .75],
  ].flatMap(([part, side, offset]) => {
    const upper = find(`${part}Upper.${side}`), lower = find(`${part}Lower.${side}`), paw = find(`${part}Paw.${side}`);
    return upper && lower && paw ? [{ upper, lower, paw, front: part === 'Front', offset: Number(offset), rest: root.worldToLocal(paw.getWorldPosition(new THREE.Vector3())), anchor: null as THREE.Vector3 | null, lastPhase: -1 }] : [];
  });
  const chain = [['Loin', .10], ['Spine', .20], ['Chest', .20], ['Neck', .22], ['NeckB', .16], ['Head', .12], ['Tail0', -.25], ['Tail1', -.18]] as const;
  const joints = chain.flatMap(([name, share]) => { const bone = find(name); return bone ? [{ bone, share }] : []; });
  const pelvis = find("Pelvis");
  const chest = find("Chest"), tail = find("Tail0");
  let pelvisPosition: THREE.Vector3 | null = null;
  const saved = new Map<THREE.Object3D, THREE.Quaternion>();
  let bend = 0;
  function save(bone: THREE.Object3D) { if (!saved.has(bone)) saved.set(bone, bone.quaternion.clone()); }
  return {
    beforeMixer() {
      if (pelvis && pelvisPosition) pelvis.position.copy(pelvisPosition);
      pelvisPosition = null;
      for (const [bone, quaternion] of saved) bone.quaternion.copy(quaternion);
      saved.clear();
    },
    update(dt: number, turnRate: number, moving: boolean, clip: string, phase: number, strideScale = KITTEN_WALK.stride * steeringStrideScale(turnRate)) {
      const wanted = moving ? THREE.MathUtils.clamp(turnRate * .18, -.28, .28) : 0;
      bend += (wanted - bend) * (1 - Math.exp(-Math.max(0, dt) / .16));
      root.updateWorldMatrix(true, true);
      const walking = moving && clip === 'Walk';
      // Capture the mixer pose before moving the torso; IK then keeps paw contacts independent of body load.
      const targets = legs.map(leg => {
        const local = root.worldToLocal(leg.paw.getWorldPosition(new THREE.Vector3()));
        if (walking) {
          local.z = leg.rest.z + (local.z - leg.rest.z) * strideScale;
          const p = wrap(phase + leg.offset);
          if (p >= KITTEN_WALK.support) {
            const swing = (p - KITTEN_WALK.support) / (1 - KITTEN_WALK.support);
            // Extra clearance peaks in mid swing and vanishes at both ends, preserving the clip's toe roll.
            local.y += (leg.front ? KITTEN_WALK.frontLift : KITTEN_WALK.rearLift) * Math.sin(Math.PI * swing);
          }
        }
        return root.localToWorld(local);
      });
      // Forepaws land half a cycle apart. The torso yields just after contact, then recovers over planted legs.
      const load = walking ? -KITTEN_WALK.load * Math.cos(4 * Math.PI * phase - .2 * Math.PI) : 0;
      if (pelvis && (Math.abs(bend) > 1e-5 || walking)) {
        pelvisPosition = pelvis.position.clone();
        const drop = up.clone().multiplyScalar((load - .025 * Math.min(1, Math.abs(bend) / .18)) * root.getWorldScale(new THREE.Vector3()).y);
        const parent = pelvis.parent!;
        const point = pelvis.getWorldPosition(new THREE.Vector3()).add(drop);
        pelvis.position.copy(parent.worldToLocal(point));
        if (walking) {
          save(pelvis);
          // A tiny side-to-side hip transfer follows the alternating hind paws.
          pelvis.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), KITTEN_WALK.hipSway * Math.sin(2 * Math.PI * phase)));
        }
        pelvis.updateWorldMatrix(false, true);
      }
      for (const { bone, share } of joints) {
        save(bone);
        const axis = up.clone().applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
        bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, bend * share));
        bone.updateWorldMatrix(false, true);
      }
      if (walking && chest) {
        save(chest);
        chest.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -KITTEN_WALK.shoulderPitch * Math.cos(4 * Math.PI * phase - .2 * Math.PI)));
        chest.updateWorldMatrix(false, true);
      }
      if (walking && tail) {
        save(tail);
        tail.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), KITTEN_WALK.tailSway * Math.sin(2 * Math.PI * phase + .5)));
        tail.updateWorldMatrix(false, true);
      }
      legs.forEach((leg, i) => {
        const p = wrap(phase + leg.offset);
        // These offsets and duty belong to the shipped ZZZ4 Walk; gallop keeps its authored flight.
        const planted = walking && p < KITTEN_WALK.support;
        if (planted) {
          if (!leg.anchor || p < leg.lastPhase || dt > .1) leg.anchor = targets[i].clone();
          // Hold all three coordinates from touchdown to toe-off: no horizontal skating or hovering sole.
          targets[i].copy(leg.anchor);
        } else if (walking && leg.anchor) {
          // Transfer from the fixed contact into the authored swing over a short toe-off, avoiding a one-frame pop.
          const release = smooth((p - KITTEN_WALK.support) / KITTEN_WALK.release);
          targets[i].lerpVectors(leg.anchor, targets[i], release);
          if (release >= 1) leg.anchor = null;
        } else leg.anchor = null;
        leg.lastPhase = p;
        if (!moving && Math.abs(bend) < 1e-5) return;
        for (const bone of [leg.upper, leg.lower, leg.paw]) save(bone);
        placePaw(leg.upper, leg.lower, leg.paw, targets[i]);
      });
    },
  };
}
