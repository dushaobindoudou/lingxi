// Voxel rig builder. Turns data/skeleton.json (+ a skin) into a Three.js scene graph.
//
// The one discipline this file exists to enforce: NOTHING downstream (gait, IK, poses,
// face) may hardcode a dimension. Segment lengths, standing height and joint positions are
// all read back off the built rig via `segmentLength()` / `groundOffset`. That is what makes
// 体型参数 skins (short-legged Munchkin, big Maine Coon, flat-faced Persian) essentially
// free: a skin ships a sparse override of box sizes, and the IK/gait adapt on their own.
// The moment something downstream writes `13` for shoulder height, that capability is gone.
import * as THREE from 'three';
import skeletonData from '../data/skeleton.json';
import { computeAtlasLayout, applyAtlasUVs, paintAtlas } from './atlas.ts';

export type Vec3Tuple = [number, number, number];

export interface BoxSpec {
  size: Vec3Tuple;
  /** Box centre relative to the node's pivot. Pivots sit at joints, never at box centres. */
  offset: Vec3Tuple;
}

export interface NodeSpec {
  id: string;
  parent: string | null;
  pivot: Vec3Tuple;
  box: BoxSpec;
  slot: string;
  /** Distance to the next joint down the chain. Present on limb/tail segments only. */
  segmentLength?: number;
  slide?: { axis: 'y'; range: number };
}

export interface SkeletonData {
  schemaVersion: number;
  id: string;
  slotFallback: string;
  nodes: NodeSpec[];
  restPose: Record<string, Vec3Tuple>;
}

/** A skin's sparse per-node dimension override - the 体型参数 layer. */
export interface ProportionOverride {
  size?: Vec3Tuple;
  offset?: Vec3Tuple;
  pivot?: Vec3Tuple;
  segmentLength?: number;
}

export interface VoxelSkin {
  id: string;
  name: string;
  rigId: string;
  /** slot -> hex colour. Sparse: unknown slots fall back (see DEFAULT_SLOT_COLOURS). */
  materials: Record<string, string>;
  proportions?: Record<string, ProportionOverride>;
}

export interface Rig {
  /** Ground anchor. The renderer positions this; y=0 on it means paws touching the floor. */
  root: THREE.Group;
  node(id: string): THREE.Object3D;
  /** Post-skin segment length. IK and gait read lengths from here, never from the JSON. */
  segmentLength(id: string): number;
  /** Authored rest rotation, so animation layers can offset from the pose the rig was
   *  designed in instead of re-stating those angles as literals in code. */
  restRotation(id: string): Vec3Tuple;
  /** How far the rest-pose rig had to be lifted for its lowest box to sit at y=0. */
  groundOffset: number;
  /** Half-extent of the rig's rest-pose bounding sphere, for hit-testing. */
  boundingRadius: number;
  dispose(): void;
}

/**
 * Slots the legacy 4-colour `SkinManifest` (presets/skins/*.json - fur/pattern/iris/nose)
 * doesn't define. Keeping these as defaults rather than requiring every skin to specify all
 * of them means the two existing presets render a correct cat untouched, and a new skin only
 * overrides what it actually wants to change. Same per-field fallback philosophy as the
 * Rust side's sanitize_settings.
 */
const DEFAULT_SLOT_COLOURS: Record<string, string> = {
  pupil: '#241f1d',
  mouth: '#b8766f',
  whisker: '#fbf7f2',
  tongue: '#e8909a',
  paw: '#f3e7da',
};

function toColour(skin: VoxelSkin, slot: string, fallbackSlot: string): string {
  return skin.materials[slot] ?? DEFAULT_SLOT_COLOURS[slot] ?? skin.materials[fallbackSlot] ?? '#cccccc';
}

function applyOverride(spec: NodeSpec, override: ProportionOverride | undefined): NodeSpec {
  if (!override) return spec;
  return {
    ...spec,
    pivot: override.pivot ?? spec.pivot,
    box: {
      size: override.size ?? spec.box.size,
      offset: override.offset ?? spec.box.offset,
    },
    segmentLength: override.segmentLength ?? spec.segmentLength,
  };
}

// TypeScript widens JSON array literals to `number[]`, so a `[number, number, number]`
// tuple can't be inferred from an imported .json no matter how it's written. This is the one
// place that gap is bridged; everything downstream gets real tuples.
const DEFAULT_SKELETON = skeletonData as unknown as SkeletonData;

export function buildRig(skin: VoxelSkin, data: SkeletonData = DEFAULT_SKELETON): Rig {
  if (skin.rigId && skin.rigId !== data.id) {
    // Loud, not silent: a skin built for another rig would attach boxes to nodes that may
    // not exist, producing a subtly broken cat rather than an obvious error.
    throw new Error(`skin "${skin.id}" targets rig "${skin.rigId}", but this rig is "${data.id}"`);
  }

  // Apply proportion overrides first so the atlas layout is sized from the FINAL boxes.
  const specs = data.nodes.map((raw) => applyOverride(raw, skin.proportions?.[raw.id]));

  // One atlas layout for the whole rig. Stable and deterministic, so a hand-painted PNG
  // replacement can be dropped in and the UV coordinates will line up automatically.
  const layout = computeAtlasLayout(specs);

  // Paint the atlas on a canvas and wrap it as a Three.js texture. NearestFilter keeps
  // the blocky look: bilinear interpolation across texel boundaries would blur the stripes
  // into a gradient, defeating the Minecraft aesthetic.
  const colorFn = (_nodeId: string, slot: string) => toColour(skin, slot, data.slotFallback);
  const atlasCanvas = paintAtlas(specs, layout, colorFn);
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;

  // All boxes share a single Lambert material that samples the atlas. One draw call for
  // the whole cat; markings come from UV coordinates, not from a material-per-box split.
  const sharedMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, flatShading: true });

  const root = new THREE.Group();
  root.name = 'VoxelCat';
  // Inner group carries the ground lift, so `root` itself stays a clean anchor the renderer
  // can position without having to know anything about the rig's internal proportions.
  const body = new THREE.Group();
  body.name = 'VoxelCatBody';
  root.add(body);

  const nodes = new Map<string, THREE.Object3D>();
  const lengths = new Map<string, number>();
  const geometries: THREE.BoxGeometry[] = [];

  for (const spec of specs) {
    const pivot = new THREE.Group();
    pivot.name = spec.id;
    pivot.position.set(spec.pivot[0], spec.pivot[1], spec.pivot[2]);

    const geometry = new THREE.BoxGeometry(spec.box.size[0], spec.box.size[1], spec.box.size[2]);
    geometries.push(geometry);

    // Remap UV coordinates from the default [0,1]^2 to this box's region in the shared atlas.
    applyAtlasUVs(geometry, layout.regions[spec.id], layout.size);

    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    mesh.position.set(spec.box.offset[0], spec.box.offset[1], spec.box.offset[2]);
    mesh.name = `${spec.id}:box`;
    pivot.add(mesh);

    const parent = spec.parent == null ? body : nodes.get(spec.parent);
    if (!parent) throw new Error(`node "${spec.id}" names unknown parent "${spec.parent}"`);
    parent.add(pivot);

    nodes.set(spec.id, pivot);
    if (spec.segmentLength != null) lengths.set(spec.id, spec.segmentLength);
  }

  // Rest pose must be applied BEFORE measuring: the digitigrade hind leg folds a 13.6-unit
  // bone chain into roughly half that height, so measuring the unposed rig would lift the
  // cat well off the floor.
  for (const [id, rotation] of Object.entries(data.restPose)) {
    const node = nodes.get(id);
    if (node) node.rotation.set(rotation[0], rotation[1], rotation[2]);
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(body);
  const groundOffset = -bounds.min.y;
  body.position.y = groundOffset;

  const sphere = new THREE.Sphere();
  bounds.getBoundingSphere(sphere);

  return {
    root,
    node(id: string) {
      const node = nodes.get(id);
      if (!node) throw new Error(`unknown rig node "${id}"`);
      return node;
    },
    segmentLength(id: string) {
      const length = lengths.get(id);
      if (length == null) throw new Error(`rig node "${id}" has no segment length`);
      return length;
    },
    restRotation(id: string) {
      return data.restPose[id] ?? [0, 0, 0];
    },
    groundOffset,
    boundingRadius: sphere.radius,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      atlasTexture.dispose();
      sharedMaterial.dispose();
      root.removeFromParent();
    },
  };
}
