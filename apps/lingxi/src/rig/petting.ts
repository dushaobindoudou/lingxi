import * as THREE from 'three';
import type { PettingRegion } from '../../../../packages/desktop-host-contract/index.d.ts';

function visible(object: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = object; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Use the actual posed boxes, including their hidden collision layer, never a screen rectangle. */
export function createVoxelPettingProbe(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh && o.geometry.type === 'BoxGeometry') meshes.push(o); });
  return (ray: THREE.Raycaster, bellyExposed: boolean): PettingRegion | null => {
    root.updateWorldMatrix(true, true);
    const hit = ray.intersectObjects(meshes.filter(visible), false)[0];
    if (!hit) return null;
    for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
      if (node.name === 'head') return 'head';
      if (/^(hipC|spine[123])$/.test(node.name)) {
        // The ventral face of a torso box. The normal is already in this box's local frame.
        return bellyExposed && (hit.face?.normal.y ?? 0) < -0.35 ? 'belly' : 'body';
      }
      // Legs and tail should not become torso hits just because they descend from the spine.
      if (/^(scap|upper|lower|paw|thigh|shin|foot|tail)/.test(node.name)) return null;
    }
    return null;
  };
}

/** Fit small ellipsoids to the base coat in each bone's rest frame, once at load.
 * They follow the posed anatomy without CPU-skinning the full coat on every pointer frame.
 * Unlike screen rectangles, empty corners miss and a rolled ventral surface stays identifiable.
 */
export function createSkinnedPettingProbe(root: THREE.Object3D, chest: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const head = root.getObjectByName('Head');
  const volumes: { anchor: THREE.Object3D; mesh: THREE.Mesh; region: 'head' | 'body' | null;
    local: THREE.Matrix4; bellyLocal: THREE.Vector3 }[] = [];
  const point = new THREE.Vector3(), size = new THREE.Vector3(), center = new THREE.Vector3();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !visible(object)) return;
    const mesh = object, name = String(mesh.userData.name ?? mesh.name);
    const region = /^LX_(Head|Muzzle|Ear|Eye|Lid|Nose|Whisker)/.test(name) ? 'head'
      : /^LX_Body/.test(name) ? 'body' : null;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const groups = new Map<THREE.Object3D, { bounds: THREE.Box3; inverse: THREE.Matrix4 }>();
    const skinIndex = mesh.geometry.getAttribute('skinIndex'), skinWeight = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < position.count; i++) {
      let anchor: THREE.Object3D = region === 'head' ? head ?? mesh : region === 'body' ? chest : mesh;
      if (region !== 'head' && mesh instanceof THREE.SkinnedMesh && skinIndex && skinWeight) {
        const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
        const indices = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
        let dominant = 0;
        for (let j = 1; j < 4; j++) if (weights[j] > weights[dominant]) dominant = j;
        anchor = mesh.skeleton.bones[indices[dominant]] ?? anchor;
      }
      let group = groups.get(anchor);
      if (!group) { group = { bounds: new THREE.Box3(), inverse: anchor.matrixWorld.clone().invert() }; groups.set(anchor, group); }
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(group.inverse);
      group.bounds.expandByPoint(point);
    }
    for (const [anchor, group] of groups) {
      group.bounds.getSize(size).multiplyScalar(0.5);
      group.bounds.getCenter(center);
      const minimum = Math.max(size.x, size.y, size.z) * 0.06 || 0.001;
      size.set(Math.max(minimum, size.x), Math.max(minimum, size.y), Math.max(minimum, size.z));
      volumes.push({ anchor, mesh, region,
        local: new THREE.Matrix4().compose(center, new THREE.Quaternion(), size),
        bellyLocal: new THREE.Vector3(0, -1, 0).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()).invert()) });
    }
  });
  const matrix = new THREE.Matrix4(), inverse = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const ray = new THREE.Ray(), sphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const normal = new THREE.Vector3(), belly = new THREE.Vector3(), hit = new THREE.Vector3();
  return (caster: THREE.Raycaster, bellyExposed: boolean): PettingRegion | null => {
    root.updateWorldMatrix(true, true);
    let nearest = Infinity, region: PettingRegion | null = null;
    for (const volume of volumes) {
      if (!visible(volume.mesh)) continue;
      matrix.multiplyMatrices(volume.anchor.matrixWorld, volume.local);
      inverse.copy(matrix).invert();
      ray.copy(caster.ray).applyMatrix4(inverse);
      if (!ray.intersectSphere(sphere, hit)) continue;
      normal.copy(hit).applyNormalMatrix(normalMatrix.getNormalMatrix(matrix));
      hit.applyMatrix4(matrix);
      const distance = hit.distanceTo(caster.ray.origin);
      if (distance >= nearest || distance < caster.near || distance > caster.far) continue;
      nearest = distance;
      belly.copy(volume.bellyLocal).applyQuaternion(volume.anchor.getWorldQuaternion(new THREE.Quaternion()));
      region = volume.region === 'body' && bellyExposed && normal.dot(belly) > 0.45 ? 'belly' : volume.region;
    }
    return region;
  };
}
