import * as THREE from 'three';

// Short hairs where groom.bin leaves the painted skin showing. Its strands are 15-25 mm on the head and body and groomed
// away from the features; on the paws they are 2-6 mm. So close up there was a bald ring round each eye, a smooth,
// blurred blaze and muzzle (the user, zoomed in: "脸上太少"), and legs and paws that read as smooth tubes and mittens
// when the cat lay with them in front of it. These are thin tapering ribbons rooted on the coat mesh, sampled by area
// over a region (the way createLidFuzz covers the lids), skinned with it, rooted just outside the opaque undercoat
// (rooted on the skin they were buried under it - none showed).

export interface CoatFuzzRegion {
  name: string;
  count: number;
  seed: number;
  /** how much of this coat a point carries, 0..1 (mesh rest space; `share` blends a per-vertex value at the point) */
  weight(at: THREE.Vector3, normal: THREE.Vector3, share: (values: Float32Array) => number): number;
  /** the way the hair lies there (any length; projected onto the skin) */
  flow(at: THREE.Vector3, normal: THREE.Vector3, random: () => number): THREE.Vector3;
  /** its length (m) at a point carrying `weight` */
  length(at: THREE.Vector3, weight: number, random: () => number): number;
  width: readonly [number, number];
  /** how far a hair stands off the skin (share of its length) */
  lift: number;
  /** how much lighter or darker one hair is than the next (share of its colour) */
  toneSpread: number;
  /** the coat's paint is the skin under lighter strands (renderer LID_UNDERCOAT_LIFT): the hairs are the strands' colour */
  colourLift: number;
  /** how far out the opaque undercoat reaches at full coat (the renderer's solid shells: this times furScale squared) */
  undercoat: number;
  /** per-vertex values `weight` may blend (e.g. the share of a vertex on the leg bones) */
  vertexValues?: Float32Array;
}

export function createCoatFuzz(mesh: THREE.SkinnedMesh, region: CoatFuzzRegion): THREE.SkinnedMesh | null {
  const g = mesh.geometry, p = g.getAttribute('position'), col = g.getAttribute('color'), normals = g.getAttribute('normal');
  const joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight'), ix = g.getIndex(), coat = g.getAttribute('furScale');
  if (!p || !col || !normals || !joints || !weights) return null;
  const at = (i: number) => (ix ? ix.getX(i) : i);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), centroid = new THREE.Vector3(), nc = new THREE.Vector3();
  let verts = [0, 0, 0], bary = [1 / 3, 1 / 3, 1 / 3];
  const share = (values: Float32Array) => verts.reduce((s, vertex, k) => s + bary[k] * values[vertex], 0);
  const triangles = (ix?.count ?? p.count) / 3;
  let total = 0;
  const areas = new Float64Array(triangles);
  for (let t = 0; t < triangles; t++) {
    verts = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)]; bary = [1 / 3, 1 / 3, 1 / 3];
    a.fromBufferAttribute(p, verts[0]); b.fromBufferAttribute(p, verts[1]); c.fromBufferAttribute(p, verts[2]);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    nc.set(0, 0, 0);
    for (const v of verts) nc.x += normals.getX(v), nc.y += normals.getY(v), nc.z += normals.getZ(v);
    const w = region.weight(centroid, nc.normalize(), share);
    total += b.sub(a).cross(c.sub(a)).length() * 0.5 * w;
    areas[t] = total;
  }
  if (total <= 0) return null;
  let seed = region.seed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const count = region.count;
  const positions = new Float32Array(count * 12), colors = new Float32Array(count * 12), nrm = new Float32Array(count * 12);
  const ji = new Uint16Array(count * 16), sw = new Float32Array(count * 16), indices: number[] = [];
  const root = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), across = new THREE.Vector3(), point = new THREE.Vector3();
  // the coat's shape keys move the hairs with it: the body's Breath swells the flanks by up to ~12 mm at the renderer's
  // breathing gain, and hairs left at rest were buried under the swollen undercoat there (the inside of a lying cat's
  // thigh stayed smooth skin with these at any density)
  const keys = g.morphAttributes.position ?? [];
  const morphs = keys.map(() => new Float32Array(count * 12));
  const delta = new THREE.Vector3();
  let made = 0;
  for (let h = 0; h < count; h++) {
    const sample = random() * total;
    let lo = 0, hi = triangles - 1;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (areas[m] < sample) lo = m + 1; else hi = m; }
    verts = [at(lo * 3), at(lo * 3 + 1), at(lo * 3 + 2)];
    const u = Math.sqrt(random()), v = random();
    bary = [1 - u, u * (1 - v), u * v];
    const blend = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, k: number) => verts.reduce((s, vertex, i) => s + bary[i] * attr.getComponent(vertex, k), 0);
    root.set(blend(p, 0), blend(p, 1), blend(p, 2));
    normal.set(blend(normals, 0), blend(normals, 1), blend(normals, 2)).normalize();
    const w = region.weight(root, normal, share);
    if (w <= 0.02 || random() > w) continue; // the triangle straddled an edge of the region
    const flow = region.flow(root, normal, random);
    tangent.copy(flow).addScaledVector(normal, -flow.dot(normal));
    if (tangent.lengthSq() < 1e-10) continue;
    tangent.normalize();
    across.crossVectors(tangent, normal).normalize();
    const length = region.length(root, w, random);
    const width = THREE.MathUtils.lerp(region.width[0], region.width[1], random());
    const tone = 1 - region.toneSpread / 2 + random() * region.toneSpread;
    const lift = coat ? region.undercoat * blend(coat, 0) ** 2 : 0;
    const o = made * 12;
    for (let corner = 0; corner < 4; corner++) {
      const tip = corner >= 2, side = corner % 2 ? 1 : -1;
      point.copy(root).addScaledVector(normal, lift * 1.02 + 0.0004 + (tip ? length * region.lift : 0)).addScaledVector(tangent, tip ? length : 0)
        .addScaledVector(across, side * width * (tip ? 0.08 : 0.5));
      positions[o + corner * 3] = point.x; positions[o + corner * 3 + 1] = point.y; positions[o + corner * 3 + 2] = point.z;
    }
    keys.forEach((key, m) => {
      delta.set(blend(key, 0), blend(key, 1), blend(key, 2));
      if (!g.morphTargetsRelative) delta.sub(root);
      for (let corner = 0; corner < 4; corner++) for (let k = 0; k < 3; k++) morphs[m][o + corner * 3 + k] = delta.getComponent(k);
    });
    const influences = new Map<number, number>();
    verts.forEach((vertex, k) => { for (let j = 0; j < 4; j++) {
      const joint = joints.getComponent(vertex, j);
      influences.set(joint, (influences.get(joint) ?? 0) + bary[k] * weights.getComponent(vertex, j));
    } });
    const skin = [...influences].sort((x, y) => y[1] - x[1]).slice(0, 4), weightSum = skin.reduce((s, pair) => s + pair[1], 0) || 1;
    for (let corner = 0; corner < 4; corner++) {
      const vertex = made * 4 + corner;
      for (let k = 0; k < 3; k++) {
        colors[vertex * 3 + k] = Math.min(1, blend(col, k) * region.colourLift * tone * (corner >= 2 ? 1.08 : 0.92));
        nrm[vertex * 3 + k] = normal.getComponent(k);
      }
      skin.forEach(([joint, weight], j) => { ji[vertex * 4 + j] = joint; sw[vertex * 4 + j] = weight / weightSum; });
    }
    indices.push(made * 4, made * 4 + 1, made * 4 + 2, made * 4 + 2, made * 4 + 1, made * 4 + 3);
    made++;
  }
  if (!made) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, made * 12), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(0, made * 12), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, made * 12), 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(ji.slice(0, made * 16), 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw.slice(0, made * 16), 4));
  if (keys.length) {
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = morphs.map((values) => new THREE.BufferAttribute(values.slice(0, made * 12), 3));
  }
  const fuzz = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  fuzz.name = `${mesh.name}_${region.name}`;
  fuzz.bind(mesh.skeleton, mesh.bindMatrix);
  fuzz.bindMode = mesh.bindMode;
  fuzz.position.copy(mesh.position);
  fuzz.quaternion.copy(mesh.quaternion);
  fuzz.scale.copy(mesh.scale);
  if (keys.length) {
    fuzz.morphTargetDictionary = mesh.morphTargetDictionary;
    fuzz.morphTargetInfluences = mesh.morphTargetInfluences;
  }
  fuzz.frustumCulled = false;
  fuzz.receiveShadow = true;
  return fuzz;
}

// ---- the face: round the eyes, down the bridge, over the muzzle ----
export const FACE_FUZZ = {
  count: 18000,
  // the front of the face within `reach` of the point between the eyes and nose, fading out over its last `fade` into
  // the long groom; never on the eye's opening, the nose leather or the mouth's line (head rest space, model units)
  reach: 0.105, fade: 0.03, eyeHole: 0.046, noseLeather: 0.011, mouth: 0.0022,
  // hair length (m): shortest right at the eye's rim and on the bridge, longer out on the cheeks
  short: [0.0024, 0.0042], long: [0.0055, 0.0095],
  width: [0.00026, 0.00042],
  lift: 0.4,
  colourLift: 1.32,
} as const;

export function faceFuzzRegion(frame: { eyes: THREE.Vector3[]; nose: THREE.Vector3; mouthDistance(x: number, y: number): number; undercoat: number }): CoatFuzzRegion {
  const { eyes, nose } = frame, F = FACE_FUZZ;
  const centre = eyes.reduce((s, e) => s.add(e), new THREE.Vector3()).multiplyScalar(1 / eyes.length).lerp(nose, 0.45);
  const tmp = new THREE.Vector3();
  const nearEye = (v: THREE.Vector3) => Math.max(...eyes.map((e) => 1 - THREE.MathUtils.smoothstep(v.distanceTo(e), F.eyeHole, 0.07)));
  return {
    name: 'FaceFuzz', count: F.count, seed: 41117, toneSpread: 0.24, width: F.width, lift: F.lift, colourLift: F.colourLift, undercoat: frame.undercoat,
    weight(v, n) {
      if (n.z < 0.05 || v.distanceTo(centre) > F.reach) return 0;
      for (const e of eyes) if (v.distanceTo(e) < F.eyeHole) return 0;
      if (v.distanceTo(nose) < F.noseLeather || frame.mouthDistance(v.x, v.y) < F.mouth) return 0;
      return THREE.MathUtils.smoothstep(n.z, 0.05, 0.4) * (1 - THREE.MathUtils.smoothstep(v.distanceTo(centre), F.reach - F.fade, F.reach));
    },
    // out from the nose and back toward the ears, and away from each eye near it
    flow(v, _n, random) {
      const away = v.clone().sub(nose); away.y *= 0.55; away.normalize().multiplyScalar(0.8).add(tmp.set(0, -0.12, -0.35));
      for (const e of eyes) {
        const k = 1 - THREE.MathUtils.smoothstep(v.distanceTo(e), F.eyeHole, 0.07);
        if (k > 0) away.addScaledVector(tmp.copy(v).sub(e).normalize(), 1.4 * k);
      }
      away.x += (random() - 0.5) * 0.5; away.y += (random() - 0.5) * 0.5;
      return away;
    },
    length(v, w, random) {
      const outward = THREE.MathUtils.smoothstep(v.distanceTo(centre), 0.03, F.reach);
      const s = THREE.MathUtils.lerp(F.short[0], F.short[1], random()), l = THREE.MathUtils.lerp(F.long[0], F.long[1], random());
      return THREE.MathUtils.lerp(l, s, Math.max(nearEye(v), 1 - outward)) * (0.75 + 0.25 * w);
    },
  };
}

// ---- the legs and paws ----
// On the legs' bones' own share of each vertex - thighs too: lying with its knees out the cat showed the inside of a
// thigh as smooth striped skin - but not on the pads underneath. Combed down the leg to the toes; longer up the leg.
// Lying, the forelegs, hind feet and thighs are right in front of the viewer.
export const LEG_FUZZ = {
  count: 200000,
  // the lower body (rest height, model units; the cat stands ~.6 tall): full below `lowFrom`, none above `lowTo`
  lowFrom: 0.30, lowTo: 0.36,
  bones: /^(FrontUpper|RearUpper|FrontLower|FrontPaw|FrontFoot|FrontToe\d|ForearmTwist|RearLower|RearPaw|RearFoot|RearToe\d)[._]?[LR]$/,  // the loader drops the '.' (FrontLower.L -> FrontLowerL)
  // the pads: normals this far down (rest space) carry none
  sole: -0.55,
  length: [0.005, 0.010] as const,
  // the thighs' and upper arms' (their share of a vertex): into the body's coat
  upperLength: [0.007, 0.013] as const,
  upper: /^(FrontUpper|RearUpper)[._]?[LR]$/,
  width: [0.00028, 0.00046] as const,
  lift: 0.35,
  colourLift: 1.28,
} as const;

export function legFuzzRegion(mesh: THREE.SkinnedMesh, undercoat: number): CoatFuzzRegion | null {
  const g = mesh.geometry, joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight');
  if (!joints || !weights) return null;
  const onLeg = mesh.skeleton.bones.map((b) => LEG_FUZZ.bones.test(b.name)), onUpper = mesh.skeleton.bones.map((b) => LEG_FUZZ.upper.test(b.name));
  if (!onLeg.some(Boolean)) return null;
  const legShare = new Float32Array(joints.count), upperShare = new Float32Array(joints.count);
  for (let i = 0; i < joints.count; i++) for (let j = 0; j < 4; j++) {
    const joint = joints.getComponent(i, j), w = weights.getComponent(i, j);
    if (onLeg[joint]) legShare[i] += w;
    if (onUpper[joint]) upperShare[i] += w;
  }
  let upperHere = 0;
  const down = new THREE.Vector3(0, -1, -0.25);
  return {
    name: 'LegFuzz', count: LEG_FUZZ.count, seed: 7351, toneSpread: 0.42, width: LEG_FUZZ.width, lift: LEG_FUZZ.lift, colourLift: LEG_FUZZ.colourLift, undercoat,
    vertexValues: legShare,
    weight(v, n, share) {
      // the leg bones' share, and anything low on the body: lying, the inside of a thigh skinned to the pelvis showed
      const leg = Math.max(THREE.MathUtils.smoothstep(share(legShare), 0.35, 0.8), 1 - THREE.MathUtils.smoothstep(v.y, LEG_FUZZ.lowFrom, LEG_FUZZ.lowTo));
      upperHere = share(upperShare) / Math.max(share(legShare), 1e-3);
      return leg * (1 - THREE.MathUtils.smoothstep(-n.y, -LEG_FUZZ.sole - 0.2, -LEG_FUZZ.sole));
    },
    flow(_v, _n, random) { return down.clone().add(new THREE.Vector3((random() - 0.5) * 0.4, 0, (random() - 0.5) * 0.4)); },
    length(_v, w, random) {
      const r = random(), lower = THREE.MathUtils.lerp(LEG_FUZZ.length[0], LEG_FUZZ.length[1], r), upper = THREE.MathUtils.lerp(LEG_FUZZ.upperLength[0], LEG_FUZZ.upperLength[1], r);
      return THREE.MathUtils.lerp(lower, upper, upperHere) * (0.7 + 0.3 * w);
    },
  };
}

// ---- the tail ----
// Lying, the tail comes round the flank on the floor right in front of the viewer, and its groom (cut to TAIL_LENGTH,
// slim) left a smooth ringed tube - what read as a bald leg. Combed toward the tip along the tail's bones.
export const TAIL_FUZZ = {
  count: 24000,
  length: [0.004, 0.009] as const,
  width: [0.0003, 0.00048] as const,
  lift: 0.45,
  colourLift: 1.25,
} as const;

export function tailFuzzRegion(mesh: THREE.SkinnedMesh, undercoat: number): CoatFuzzRegion | null {
  // the tail's bones in the mesh's rest space (built before any clip poses them)
  const toLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const joints: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const bone = mesh.skeleton.bones.find((b) => b.name === `Tail${i}`);
    if (bone) joints.push(bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal));
  }
  if (joints.length < 2) return null;
  const seg = new THREE.Vector3(), rel = new THREE.Vector3();
  return {
    name: 'TailFuzz', count: TAIL_FUZZ.count, seed: 9907, toneSpread: 0.34, width: TAIL_FUZZ.width, lift: TAIL_FUZZ.lift, colourLift: TAIL_FUZZ.colourLift, undercoat,
    weight: () => 1,
    flow(v, _n, random) {
      // along the nearest bone, root to tip
      let best = Infinity, dir = new THREE.Vector3(0, 0, -1);
      for (let i = 0; i + 1 < joints.length; i++) {
        seg.subVectors(joints[i + 1], joints[i]);
        const t = THREE.MathUtils.clamp(rel.subVectors(v, joints[i]).dot(seg) / seg.lengthSq(), 0, 1);
        const d = rel.copy(joints[i]).addScaledVector(seg, t).distanceTo(v);
        if (d < best) { best = d; dir = seg.clone().normalize(); }
      }
      return dir.add(new THREE.Vector3((random() - 0.5) * 0.3, (random() - 0.5) * 0.3, (random() - 0.5) * 0.3));
    },
    length(_v, _w, random) { return THREE.MathUtils.lerp(TAIL_FUZZ.length[0], TAIL_FUZZ.length[1], random()); },
  };
}
