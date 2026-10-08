// The voxel body drawn as ONE draw call instead of one per box.
//
// The rig is ~30 visible boxes, each its own Mesh under its own pivot, and each Mesh is a draw
// call: uniforms, bindings, a draw - every frame, for every box. In a browser that is not just GPU
// work. WebKit serialises every WebGL call across to its GPU process and validates it there, so the
// per-frame cost of the cat was dominated by the NUMBER of calls, measured as a GPU process busier
// than the page itself while the cat did nothing but breathe.
//
// The boxes are rigid, so this is rigid skinning: every box's geometry, untransformed, goes into
// one buffer with each vertex weighted 100% to a "bone" - and the bone is the box's own Mesh. The
// skeleton then hands the GPU exactly the matrixWorld each box would have been drawn with, so the
// picture is the same one, vertex for vertex. Nothing about the rig changes: the pivots still
// carry the animation, and the original box meshes stay in the scene graph, positioned as ever, for
// everything that measures them (hit testing, ground contact, the rest-pose extent). They are only
// moved to a layer the camera does not draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Layer for the original box meshes: still raycast and measured, never drawn. */
export const BOX_LAYER = 1;

export interface MergedBody {
  /** Add to the scene ROOT, not under the rig: its transform must stay identity. */
  readonly mesh: THREE.SkinnedMesh;
  /** The boxes it draws, in skin-index order. */
  readonly boxes: readonly THREE.Mesh[];
  dispose(): void;
}

function drawn(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Merge every visible mesh under `root` that uses `material` into one skinned draw call. */
export function mergeBody(root: THREE.Object3D, material: THREE.Material): MergedBody {
  const boxes: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material === material && drawn(object)) boxes.push(object);
  });

  const parts = boxes.map((box, index) => {
    // Only what the material reads. A BoxGeometry's per-face groups are dropped by the merge, and
    // with a single material they never meant separate draws anyway.
    const source = box.geometry;
    const part = new THREE.BufferGeometry();
    part.setIndex(source.getIndex()!.clone());
    for (const name of ['position', 'normal', 'uv']) part.setAttribute(name, source.getAttribute(name).clone());
    const count = source.getAttribute('position').count;
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      skinIndex[i * 4] = index;
      skinWeight[i * 4] = 1;
    }
    part.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    part.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    box.geometry.computeBoundingBox();
    return part;
  });
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('merged body: the box geometries could not be merged');

  // Bones are the box meshes themselves, with identity inverses: the bone matrix IS the box's
  // matrixWorld, which is exactly the transform it would have been drawn with on its own.
  const skeleton = new THREE.Skeleton(boxes as unknown as THREE.Bone[], boxes.map(() => new THREE.Matrix4()));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'VoxelCatMergedBody';
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.matrixAutoUpdate = false; // identity, forever - the bones carry every transform
  // Its bounds would have to be recomputed from the bones every frame to be right. Culling buys
  // nothing for a camera that frames the whole screen, so it is simply off.
  mesh.frustumCulled = false;
  // Hit testing stays on the original boxes, which are exact and cheap; raycasting a skinned mesh
  // re-skins every vertex on the CPU.
  mesh.raycast = () => {};

  for (const box of boxes) box.layers.set(BOX_LAYER);

  return {
    mesh,
    boxes,
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      skeleton.dispose();
      for (const box of boxes) box.layers.set(0);
    },
  };
}
