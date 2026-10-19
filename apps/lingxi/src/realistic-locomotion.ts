import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const wrap = (n: number) => ((n % 1) + 1) % 1;
const smooth = (n: number) => { const t = THREE.MathUtils.clamp(n, 0, 1); return t * t * (3 - 2 * t); };

export const steeringStrideScale = (turnRate: number) => 1 / (1 + Math.min(1.5, Math.abs(turnRate) * 1.5));

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
    return upper && lower && paw ? [{ upper, lower, paw, offset: Number(offset), rest: root.worldToLocal(paw.getWorldPosition(new THREE.Vector3())), anchor: null as THREE.Vector3 | null, lastPhase: -1 }] : [];
  });
  const chain = [['Loin', .10], ['Spine', .20], ['Chest', .20], ['Neck', .22], ['NeckB', .16], ['Head', .12], ['Tail0', -.25], ['Tail1', -.18]] as const;
  const joints = chain.flatMap(([name, share]) => { const bone = find(name); return bone ? [{ bone, share }] : []; });
  const pelvis = find("Pelvis");
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
    update(dt: number, turnRate: number, moving: boolean, clip: string, phase: number) {
      const wanted = moving ? THREE.MathUtils.clamp(turnRate * .18, -.28, .28) : 0;
      bend += (wanted - bend) * (1 - Math.exp(-Math.max(0, dt) / .16));
      root.updateWorldMatrix(true, true);
      // Swing feet retain their authored world targets while the shoulder/hip moves above them.
      const targets = legs.map(leg => {
        const local = root.worldToLocal(leg.paw.getWorldPosition(new THREE.Vector3()));
        if (moving && clip === "Walk") local.z = leg.rest.z + (local.z - leg.rest.z) * steeringStrideScale(turnRate);
        return root.localToWorld(local);
      });
      // Lower the support centre into a turn so straight forelegs retain reach.
      if (pelvis && Math.abs(bend) > 1e-5) {
        pelvisPosition = pelvis.position.clone();
        const drop = up.clone().multiplyScalar(-.025 * Math.min(1, Math.abs(bend) / .18) * root.getWorldScale(new THREE.Vector3()).y);
        const parent = pelvis.parent!;
        const point = pelvis.getWorldPosition(new THREE.Vector3()).add(drop);
        pelvis.position.copy(parent.worldToLocal(point));
        pelvis.updateWorldMatrix(false, true);
      }
      for (const { bone, share } of joints) {
        save(bone);
        const axis = up.clone().applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
        bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, bend * share));
        bone.updateWorldMatrix(false, true);
      }
      legs.forEach((leg, i) => {
        const p = wrap(phase + leg.offset);
        // These offsets and .62 duty belong to the shipped ZZZ4 Walk; gallop keeps its authored flight.
        const planted = moving && clip === 'Walk' && p < .62;
        if (planted) {
          if (!leg.anchor || p < leg.lastPhase || dt > .1) leg.anchor = targets[i].clone();
          const weight = smooth(p / .07) * smooth((.62 - p) / .09);
          targets[i].x = THREE.MathUtils.lerp(targets[i].x, leg.anchor.x, weight);
          targets[i].z = THREE.MathUtils.lerp(targets[i].z, leg.anchor.z, weight);
        } else leg.anchor = null;
        leg.lastPhase = p;
        if (!moving && Math.abs(bend) < 1e-5) return;
        for (const bone of [leg.upper, leg.lower, leg.paw]) save(bone);
        placePaw(leg.upper, leg.lower, leg.paw, targets[i]);
      });
    },
  };
}
