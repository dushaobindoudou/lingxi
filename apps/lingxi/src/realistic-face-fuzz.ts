import * as THREE from 'three';

// The face's short coat. groom.bin's head strands are 15-25 mm and groomed away from the features, so round the eyes,
// down the nose bridge and over the muzzle they leave the head's painted surface showing - close up a bald ring round
// each eye and a smooth, blurred blaze and muzzle (the user, zoomed in: "脸上太少"). A kitten's face there is velvet:
// short hairs, flowing out from the nose and away from the eyes. These are those hairs, as thin tapering ribbons rooted
// on the head mesh (the way createLidFuzz covers the lids), skinned and shape-keyed with it.
export const FACE_FUZZ = {
  count: 18000,
  // where (head rest space, model units): the front of the face within `reach` of the point between the eyes and nose,
  // fading out over its last `fade` into the long groom; never on the eye's opening, the nose leather or the mouth's line
  reach: 0.105, fade: 0.03, eyeHole: 0.046, noseLeather: 0.011, mouth: 0.0022,
  // hair length (m): shortest right at the eye's rim and on the bridge, longer out on the cheeks
  short: [0.0024, 0.0042], long: [0.0055, 0.0095],
  width: [0.00026, 0.00042],
  // how far a hair stands off the skin (share of its length): low, a velvet laid along the face
  lift: 0.4,
  // the face's paint is the skin under lighter strands (renderer LID_UNDERCOAT_LIFT): the hairs are the strands' colour
  colourLift: 1.32,
} as const;

export interface FaceFuzzFrame {
  eyes: THREE.Vector3[];
  nose: THREE.Vector3;
  /** distance (model units) to the closed mouth's line, by rest x/y */
  mouthDistance(x: number, y: number): number;
  /** how far out the head's opaque undercoat reaches at full coat (the renderer's solid shells: this times furScale
   *  squared). The hairs root just outside it - rooted on the skin they were buried under it, none showed. */
  undercoat: number;
}

export function createFaceFuzz(head: THREE.SkinnedMesh, frame: FaceFuzzFrame, count: number = FACE_FUZZ.count): THREE.SkinnedMesh | null {
  const g = head.geometry, p = g.getAttribute('position'), col = g.getAttribute('color'), normals = g.getAttribute('normal');
  const joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight'), ix = g.getIndex();
  if (!p || !col || !normals || !joints || !weights) return null;
  const at = (i: number) => (ix ? ix.getX(i) : i);
  const { eyes, nose } = frame;
  const centre = eyes.reduce((s, e) => s.add(e), new THREE.Vector3()).multiplyScalar(1 / eyes.length).lerp(nose, 0.45);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  // how much of the short coat a point carries: 0 outside the face's front
  const weightAt = (v: THREE.Vector3, nz: number) => {
    if (nz < 0.05) return 0;
    for (const e of eyes) if (v.distanceTo(e) < FACE_FUZZ.eyeHole) return 0;
    if (v.distanceTo(nose) < FACE_FUZZ.noseLeather) return 0;
    if (frame.mouthDistance(v.x, v.y) < FACE_FUZZ.mouth) return 0;
    const d = v.distanceTo(centre);
    return THREE.MathUtils.smoothstep(nz, 0.05, 0.4) * (1 - THREE.MathUtils.smoothstep(d, FACE_FUZZ.reach - FACE_FUZZ.fade, FACE_FUZZ.reach));
  };
  let total = 0;
  const areas: number[] = [];
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, at(i)); b.fromBufferAttribute(p, at(i + 1)); c.fromBufferAttribute(p, at(i + 2));
    const centroid = n.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const nz = (normals.getZ(at(i)) + normals.getZ(at(i + 1)) + normals.getZ(at(i + 2))) / 3;
    const w = centroid.distanceTo(centre) > FACE_FUZZ.reach + 0.01 ? 0 : weightAt(centroid, nz);
    total += b.sub(a).cross(c.sub(a)).length() * 0.5 * w;
    areas.push(total);
  }
  if (total <= 0) return null;
  let seed = 41117;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const keys = g.morphAttributes.position ?? [];
  const positions = new Float32Array(count * 12), colors = new Float32Array(count * 12), nrm = new Float32Array(count * 12);
  const ji = new Uint16Array(count * 16), sw = new Float32Array(count * 16), indices: number[] = [];
  const morphs = keys.map(() => new Float32Array(count * 12));
  const root = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), across = new THREE.Vector3(), point = new THREE.Vector3();
  const away = new THREE.Vector3();
  let made = 0;
  for (let h = 0; h < count; h++) {
    const sample = random() * total;
    let lo = 0, hi = areas.length - 1;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (areas[m] < sample) lo = m + 1; else hi = m; }
    const verts = [at(lo * 3), at(lo * 3 + 1), at(lo * 3 + 2)], u = Math.sqrt(random()), v = random(), bary = [1 - u, u * (1 - v), u * v];
    const blend = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, k: number) => verts.reduce((s, vertex, i) => s + bary[i] * attr.getComponent(vertex, k), 0);
    root.set(blend(p, 0), blend(p, 1), blend(p, 2));
    normal.set(blend(normals, 0), blend(normals, 1), blend(normals, 2)).normalize();
    const w = weightAt(root, normal.z);
    if (w <= 0.02 || random() > w) continue; // the triangle straddled an edge of the region
    // the flow: out from the nose and back toward the ears, and away from each eye near it
    away.copy(root).sub(nose); away.y *= 0.55; away.normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, -0.12, -0.35));
    let nearEye = 0;
    for (const e of eyes) {
      const d = root.distanceTo(e), k = 1 - THREE.MathUtils.smoothstep(d, FACE_FUZZ.eyeHole, 0.07);
      if (k > 0) away.addScaledVector(tangent.copy(root).sub(e).normalize(), 1.4 * k);
      nearEye = Math.max(nearEye, k);
    }
    away.x += (random() - 0.5) * 0.5; away.y += (random() - 0.5) * 0.5;
    tangent.copy(away).addScaledVector(normal, -away.dot(normal)).normalize();
    across.crossVectors(tangent, normal).normalize();
    const outward = THREE.MathUtils.smoothstep(root.distanceTo(centre), 0.03, FACE_FUZZ.reach);
    const lenShort = THREE.MathUtils.lerp(FACE_FUZZ.short[0], FACE_FUZZ.short[1], random());
    const lenLong = THREE.MathUtils.lerp(FACE_FUZZ.long[0], FACE_FUZZ.long[1], random());
    const length = THREE.MathUtils.lerp(lenLong, lenShort, Math.max(nearEye, 1 - outward)) * (0.75 + 0.25 * w);
    const width = THREE.MathUtils.lerp(FACE_FUZZ.width[0], FACE_FUZZ.width[1], random());
    const tone = 0.9 + random() * 0.24;
    const coat = g.getAttribute('furScale');
    const lift = coat ? frame.undercoat * blend(coat, 0) ** 2 : 0;
    const hair = (out: Float32Array, offset: number, base: THREE.Vector3, nrmv: THREE.Vector3) => {
      for (let corner = 0; corner < 4; corner++) {
        const tip = corner >= 2, side = corner % 2 ? 1 : -1;
        point.copy(base).addScaledVector(nrmv, lift * 0.9 + 0.0004 + (tip ? length * FACE_FUZZ.lift : 0)).addScaledVector(tangent, tip ? length : 0)
          .addScaledVector(across, side * width * (tip ? 0.08 : 0.5));
        out[offset + corner * 3] = point.x; out[offset + corner * 3 + 1] = point.y; out[offset + corner * 3 + 2] = point.z;
      }
    };
    const o = made * 12;
    hair(positions, o, root, normal);
    keys.forEach((dp, key) => {
      a.set(blend(dp, 0), blend(dp, 1), blend(dp, 2));
      const moved = g.morphTargetsRelative ? b.copy(root).add(a) : b.copy(a);
      const tmp = new Float32Array(12);
      hair(tmp, 0, moved, normal);
      for (let i = 0; i < 12; i++) morphs[key][o + i] = tmp[i] - positions[o + i];
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
        colors[vertex * 3 + k] = Math.min(1, blend(col, k) * FACE_FUZZ.colourLift * tone * (corner >= 2 ? 1.08 : 0.92));
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
  if (morphs.length) {
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = morphs.map((values) => new THREE.BufferAttribute(values.slice(0, made * 12), 3));
  }
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  mesh.name = `${head.name}_FaceFuzz`;
  mesh.bind(head.skeleton, head.bindMatrix);
  mesh.bindMode = head.bindMode;
  mesh.position.copy(head.position);
  mesh.quaternion.copy(head.quaternion);
  mesh.scale.copy(head.scale);
  if (morphs.length) {
    mesh.morphTargetDictionary = head.morphTargetDictionary;
    mesh.morphTargetInfluences = head.morphTargetInfluences;
  }
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}
