// The realistic cat's face: the look-dev rig's face controls (lingxi-v5fix face-controls.json, applied in Blender by
// scripts/lookdev-v6/v6_face_apply.py) reproduced on the exported GLB, so the 30 expressions the voxel cat shows by
// name show on this cat too. Same semantics as apply(), action by action:
//   key        shape key += value x weight, clamped (lids: the lids.glb patch; tongue: the main GLB)
//   loc        pose location of an armature-space offset          -> a parent-space offset on the glTF bone
//   loc_local  pose location in the bone's own rest frame
//   rot        pose euler (bone-local XYZ) += value x vector
//   rotarm     a turn about an armature-space axis, before the pose
//   ear        forward / flatten / swivel / tip turns of Ear.* and EarTip.*
//   mat        the iris's pupil size and look (absolute values), drawn by the iris shader
//   catch      catchlight strength, sparkx the extra sparkles
// Blender armature space (z up, the cat facing -y) is glTF's (x, z, -y): the exporter converts the axes and keeps
// every bone's own frame, and the rig node exports as identity (checked on round zzz3: Head (0, -.259, .48) in
// Blender is (0, .48, .259) in the GLB).
import * as THREE from 'three';

type Action = [string, ...unknown[]];
export interface FaceSpec {
  controls: Record<string, Action[]>;
  layers: Record<string, Record<string, Record<string, number>>>;
  expressions: Record<string, { eye: string; brow: string; mouth: string; ear: string; symbol?: string }>;
  expression_extras?: Record<string, Record<string, number>>;
  ear: { fwd_rad: number; flat_rad: number; swivel_rad: number; tip_rad: number };
  rest: Record<string, { head: number[]; tail: number[] }>;
}

/** Per-eye iris shader inputs (realistic-renderer.ts irisMaterial). */
export interface IrisUniforms {
  uPupil: { value: THREE.Vector2 };
  uGaze: { value: THREE.Vector2 };
  uCatch: { value: number };
  uSpark: { value: number };
}

// Keep the exported rig's .33 control values, but expose more of the textured iris at desktop size. A larger black
// pupil swallowed the warm radial detail, especially after the eye was downsampled to the companion's actual size.
// At .29 though the eyes read as a startled stare, a small cat rather than a kitten ("不够奶萌"): a kitten's pupils are
// wide. .36 keeps a ring of iris round them.
const BLENDER_PUPIL = 0.33;
export const APP_PUPIL = 0.36;
// Iris-UV shift per unit of look (V6_GAZE_UV): Blender subtracts (x, -y) from its UV; glTF's v runs the other way.
const GAZE_UV = 0.30;
// Shape keys allowed past 1 (build_lingxi_v5.py slider_max): the lick's tongue reach.
const KEY_MAX: Record<string, number> = { Up: 2.5, Out: 1.5 };
// Eye layers that own the lids: the clip's own blinks are left out while they show (a smile-closed eye that also
// blinks shut, or a wink that blinks the other eye, reads broken).
const EYES_OWN_LIDS = new Set(['happy', 'closed', 'wink-left', 'wink-right']);

/** The controls of a named expression, as v6_face_apply.expression(): its four layers plus its extras, summed. */
// 安心 - the loaf's face, and so the face of a cat lying about doing nothing - took the look-dev 'soft' eyes (lids a
// quarter down, the lower lids lifted .6): with the clip's own blink on top a narrow slit that read as unwell, not at
// ease (the user: "没事趴在这发现姿势不够自然"). Its own lighter layer: the lids a little lowered, the lower lids barely.
export const CALM_EYES = { blink: 0.12, lowerLift: 0.26 };
export function calmLoafFace(spec: FaceSpec) {
  const soft = spec.layers.eye?.soft, calm = spec.expressions['安心'];
  if (!soft || !calm || calm.eye !== 'soft') return;
  spec.layers.eye.calm = { ...soft, 'Blink.L': CALM_EYES.blink, 'Blink.R': CALM_EYES.blink, 'LowerLift.L': CALM_EYES.lowerLift, 'LowerLift.R': CALM_EYES.lowerLift };
  spec.expressions['安心'] = { ...calm, eye: 'calm' };
}

export function expressionValues(spec: FaceSpec, name: string): Record<string, number> | null {
  const e = spec.expressions[name];
  if (!e) return null;
  const out: Record<string, number> = {};
  for (const layer of ['eye', 'brow', 'mouth', 'ear'] as const) {
    for (const [k, v] of Object.entries(spec.layers[layer]?.[e[layer]] ?? {})) out[k] = (out[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(spec.expression_extras?.[name] ?? {})) out[k] = (out[k] ?? 0) + v;
  // The exported smile lifts the separate philtrum/upper lip, but barely moves the lower lip.
  // At the look-dev value 1.4 their centre edges separate; keep the smile at the corners
  // without opening a slit under the nose (including expressions that add more corner lift).
  if (e.mouth === 'cat') for (const side of ['L', 'R']) {
    const key = `MouthCornerUp.${side}`;
    if (out[key] > 0) out[key] *= 0.45;
  }
  return out;
}

/** Whether the expression's eyes replace the clip's blinks. */
export function eyesOwnLids(spec: FaceSpec, name: string) {
  return EYES_OWN_LIDS.has(spec.expressions[name]?.eye ?? '');
}

/** The values a face eases from and to when a control is not named: the material ones rest where the iris does. */
export function restValue(control: string) {
  return /^Pupil[WH]\./.test(control) ? BLENDER_PUPIL : 0;
}

const blenderToGltf = (v: ArrayLike<number>) => new THREE.Vector3(v[0], v[2], -v[1]);

interface KeyRef { mesh: THREE.Mesh; index: number; max: number }

export interface FaceRig {
  /** Undo last frame's face, so the animation mixer (or nothing) writes this frame's base pose. */
  beforeMixer(): void;
  /** Lay `values` over the pose the mixer just wrote. `clipLids` 0..1: how much of the clip's own blinks to keep. */
  apply(values: Record<string, number>, clipLids: number): void;
  readonly missing: string[];
}

export function createFaceRig(spec: FaceSpec, root: THREE.Object3D, iris: Record<'L' | 'R', IrisUniforms>): FaceRig {
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => byName.set((o.userData.name as string | undefined) ?? o.name, o));
  const missing: string[] = [];
  const rig = byName.get('LX_Rig') ?? root;
  rig.updateWorldMatrix(true, true);
  const rigInverse = rig.getWorldQuaternion(new THREE.Quaternion()).invert();

  // rest frames, read before any clip has posed the bones
  const restLocal = new Map<THREE.Bone, THREE.Quaternion>();
  const parentInverse = new Map<THREE.Bone, THREE.Quaternion>();
  function bone(name: string) {
    const b = byName.get(name) as THREE.Bone | undefined;
    if (!b || !(b as THREE.Bone).isBone) { if (!missing.includes(name)) missing.push(name); return null; }
    if (!restLocal.has(b)) {
      restLocal.set(b, b.quaternion.clone());
      const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      parentInverse.set(b, rigInverse.clone().multiply(pq).invert());
    }
    return b;
  }
  /** An armature-space direction (Blender) in the bone's parent space at rest. */
  const inParent = (b: THREE.Bone, v: ArrayLike<number>) => blenderToGltf(v).applyQuaternion(parentInverse.get(b)!);

  const keyMeshes: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.morphTargetDictionary) keyMeshes.push(m); });
  function keyRefs(target: string, key: string): KeyRef[] {
    const refs: KeyRef[] = [];
    for (const m of keyMeshes) {
      const name = (m.userData.name as string | undefined) ?? m.name;
      if (target.startsWith('LX_') ? name !== target : !name.endsWith(target)) continue;
      const index = m.morphTargetDictionary![key];
      if (index !== undefined) refs.push({ mesh: m, index, max: KEY_MAX[key] ?? 1 });
    }
    if (!refs.length && !missing.includes(`${target}:${key}`)) missing.push(`${target}:${key}`);
    return refs;
  }

  // Each control's actions, resolved once.
  type Compiled =
    | { kind: 'key'; refs: KeyRef[]; w: number }
    | { kind: 'offset'; bone: THREE.Bone; perUnit: THREE.Vector3 }
    | { kind: 'rot'; bone: THREE.Bone; perUnit: THREE.Vector3 }
    | { kind: 'turn'; bone: THREE.Bone; axis: THREE.Vector3; perUnit: number }
    | { kind: 'ear'; side: 'L' | 'R'; part: 'fwd' | 'flat' | 'swivel' | 'tip'; w: number }
    | { kind: 'mat'; side: 'L' | 'R'; field: 'w' | 'h' | 'gx' | 'gy' }
    | { kind: 'catch'; w: number }
    | { kind: 'spark'; w: number };
  const compiled = new Map<string, Compiled[]>();
  for (const [control, actions] of Object.entries(spec.controls)) {
    const list: Compiled[] = [];
    for (const a of actions) {
      const [kind, target] = a as [string, string];
      if (kind === 'key') list.push({ kind, refs: keyRefs(target, a[2] as string), w: (a[3] as number | undefined) ?? 1 });
      else if (kind === 'loc' || kind === 'loc_local' || kind === 'rot' || kind === 'rotarm') {
        const b = bone(target);
        if (!b) continue;
        const v = a[2] as number[];
        if (kind === 'loc') list.push({ kind: 'offset', bone: b, perUnit: inParent(b, v) });
        else if (kind === 'loc_local') list.push({ kind: 'offset', bone: b, perUnit: new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(restLocal.get(b)!) });
        else if (kind === 'rot') list.push({ kind: 'rot', bone: b, perUnit: new THREE.Vector3(v[0], v[1], v[2]) });
        else list.push({ kind: 'turn', bone: b, axis: inParent(b, v).normalize(), perUnit: a[3] as number });
      } else if (kind === 'ear') list.push({ kind, side: target as 'L' | 'R', part: a[2] as 'fwd', w: a[3] as number });
      else if (kind === 'mat') {
        const side = target.endsWith('.R') ? 'R' : 'L';
        const node = a[2] as string;
        const field = node === 'LX_PupilW' ? 'w' : node === 'LX_PupilH' ? 'h' : node === 'LX_GazeX' ? 'gx' : node === 'LX_GazeY' ? 'gy' : null;
        if (field) list.push({ kind, side, field });
      } else if (kind === 'catch') list.push({ kind, w: a[2] as number });
      else if (kind === 'sparkx') list.push({ kind: 'spark', w: a[2] as number });
    }
    compiled.set(control, list);
  }

  // the ears: Blender's _turn axes (armature space) in each ear bone's parent space
  const ears = (['L', 'R'] as const).map((sf) => {
    const root_ = bone(`Ear.${sf}`);
    const tip = bone(`EarTip.${sf}`);
    const rest = spec.rest;
    if (!root_ || !tip || !rest[`Ear.${sf}`] || !rest[`EarTip.${sf}`]) return null;
    const along = new THREE.Vector3(...(rest[`EarTip.${sf}`].tail as [number, number, number]))
      .sub(new THREE.Vector3(...(rest[`Ear.${sf}`].head as [number, number, number]))).normalize();
    return {
      sf, root: root_, tip,
      swivel: inParent(root_, along.toArray()).normalize(),
      flat: inParent(root_, [0, 1, 0]).normalize(),
      fwd: inParent(root_, [1, 0, 0]).normalize(),
      tipAxis: inParent(tip, [1, 0, 0]).normalize(),
    };
  });

  // the clip's blinks: the eyes' Blink / Squint keys are identical to their basis (build_lingxi_v5.py) and exist only
  // so every clip could drive them by name - which makes their weights exactly the lids the clip asked for
  const clipEye = (['L', 'R'] as const).map((sf) => {
    const eye = keyMeshes.find((m) => ((m.userData.name as string | undefined) ?? m.name) === `LX_Eye.${sf}`);
    return {
      eye,
      blink: [...keyRefs(`LidUpper.${sf}`, 'Blink'), ...keyRefs(`LidLower.${sf}`, 'Blink')],
      squint: [...keyRefs(`LidUpper.${sf}`, 'Squint'), ...keyRefs(`LidLower.${sf}`, 'Squint')],
    };
  });

  // what the face touched last frame, restored before the mixer runs
  const touchedBones = new Set<THREE.Bone>();
  for (const list of compiled.values()) for (const c of list) if ('bone' in c) touchedBones.add(c.bone);
  for (const e of ears) if (e) { touchedBones.add(e.root); touchedBones.add(e.tip); }
  const baseBone = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion }>();
  const touchedKeys = new Map<THREE.Mesh, number[] | null>();
  for (const list of compiled.values()) for (const c of list) if (c.kind === 'key') for (const r of c.refs) touchedKeys.set(r.mesh, null);
  let faced = false;

  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const keyAdd = new Map<KeyRef['mesh'], Map<number, { v: number; max: number }>>();
  const rotSum = new Map<THREE.Bone, THREE.Vector3>();

  return {
    missing,
    beforeMixer() {
      if (!faced) return;
      for (const [b, s] of baseBone) { b.position.copy(s.p); b.quaternion.copy(s.q); }
      for (const [m, base] of touchedKeys) if (base && m.morphTargetInfluences) for (let i = 0; i < base.length; i++) m.morphTargetInfluences[i] = base[i];
      faced = false;
    },
    apply(values, clipLids) {
      // this frame's base: whatever the mixer (or the rest pose) left
      for (const b of touchedBones) {
        const s = baseBone.get(b);
        if (s) { s.p.copy(b.position); s.q.copy(b.quaternion); } else baseBone.set(b, { p: b.position.clone(), q: b.quaternion.clone() });
      }
      for (const m of touchedKeys.keys()) touchedKeys.set(m, m.morphTargetInfluences ? m.morphTargetInfluences.slice() : null);
      faced = true;

      keyAdd.clear();
      rotSum.clear();
      const addKey = (r: KeyRef, v: number) => {
        let per = keyAdd.get(r.mesh);
        if (!per) keyAdd.set(r.mesh, (per = new Map()));
        const cur = per.get(r.index);
        if (cur) cur.v += v; else per.set(r.index, { v, max: r.max });
      };
      const ear = { L: { fwd: 0, flat: 0, swivel: 0, tip: 0 }, R: { fwd: 0, flat: 0, swivel: 0, tip: 0 } };
      const pupil = { L: { w: BLENDER_PUPIL, h: BLENDER_PUPIL, gx: 0, gy: 0 }, R: { w: BLENDER_PUPIL, h: BLENDER_PUPIL, gx: 0, gy: 0 } };
      let catchK = 1;
      let spark = 0;

      for (const [control, v] of Object.entries(values)) {
        const list = compiled.get(control);
        if (!list || v === 0 && !/^Pupil/.test(control)) continue;
        for (const c of list) {
          switch (c.kind) {
            case 'key': for (const r of c.refs) addKey(r, v * c.w); break;
            case 'offset': c.bone.position.addScaledVector(c.perUnit, v); break;
            case 'rot': {
              const s = rotSum.get(c.bone);
              if (s) s.addScaledVector(c.perUnit, v); else rotSum.set(c.bone, c.perUnit.clone().multiplyScalar(v));
              break;
            }
            case 'turn': c.bone.quaternion.premultiply(q.setFromAxisAngle(c.axis, c.perUnit * v)); break;
            case 'ear': ear[c.side][c.part] += v * c.w; break;
            case 'mat': pupil[c.side][c.field] = v; break;
            case 'catch': catchK *= 1 + (c.w - 1) * v; break;
            case 'spark': spark += c.w * v; break;
          }
        }
      }
      for (const [b, e] of rotSum) b.quaternion.multiply(q.setFromEuler(euler.set(e.x, e.y, e.z, 'XYZ')));

      // the clip's lids
      if (clipLids > 0) {
        for (const ce of clipEye) {
          const inf = ce.eye?.morphTargetInfluences;
          const dict = ce.eye?.morphTargetDictionary;
          if (!inf || !dict) continue;
          const blink = inf[dict.Blink ?? -1] ?? 0;
          const squint = inf[dict.Squint ?? -1] ?? 0;
          for (const r of ce.blink) addKey(r, blink * clipLids);
          for (const r of ce.squint) addKey(r, squint * clipLids);
        }
      }
      for (const [m, per] of keyAdd) {
        const inf = m.morphTargetInfluences;
        if (!inf) continue;
        for (const [i, { v, max }] of per) inf[i] = THREE.MathUtils.clamp((inf[i] ?? 0) + v, 0, max);
      }

      const rad = spec.ear;
      for (const e of ears) {
        if (!e) continue;
        const s = e.sf === 'L' ? -1 : 1;
        const a = ear[e.sf];
        // as v6_face_apply: swivel, then flatten, then forward, each before the pose; the tip folds back about +x
        if (a.swivel) e.root.quaternion.premultiply(q.setFromAxisAngle(e.swivel, s * a.swivel * rad.swivel_rad));
        if (a.flat) e.root.quaternion.premultiply(q.setFromAxisAngle(e.flat, s * a.flat * rad.flat_rad));
        if (a.fwd) e.root.quaternion.premultiply(q.setFromAxisAngle(e.fwd, a.fwd * rad.fwd_rad));
        if (a.tip) e.tip.quaternion.premultiply(q.setFromAxisAngle(e.tipAxis, -a.tip * rad.tip_rad));
      }

      const scale = APP_PUPIL / BLENDER_PUPIL;
      for (const sf of ['L', 'R'] as const) {
        const u = iris[sf];
        const p = pupil[sf];
        u.uPupil.value.set(Math.max(0.02, p.w * scale), Math.max(0.02, p.h * scale));
        u.uGaze.value.set(p.gx * GAZE_UV, p.gy * GAZE_UV);
        u.uCatch.value = catchK;
        u.uSpark.value = spark;
      }
    },
  };
}
