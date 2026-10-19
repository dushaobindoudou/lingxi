import * as THREE from 'three';

interface Block { offset: number; count: number }
interface GroomPart {
  name: string; strands: number; sourceStrands: number; points: number; widthCompensation: number;
  positions: Block; colors: Block; radii: Block; normals: Block; joints: Block; weights: Block;
  skinPerPoint?: boolean; morphTarget?: string | null; morphs?: Record<string, Block>;
}
export interface GroomSpec {
  version: number; source: string; modelSha256: string; jointNames: string[];
  coordinateSpace: string; strands: number; sourceStrands: number; bytes: number; parts: GroomPart[];
}
export interface GroomAsset { spec: GroomSpec; bytes: ArrayBuffer }

/**
 * Hair highlights (Kajiya-Kay, two lobes) - what made the review render's coat read as hair rather than felt: Cycles'
 * Principled Hair puts a thin bright line ACROSS each strand, along its direction, and a second, coat-coloured one
 * shifted toward the tip. A plain surface material (roughness .86) had neither. `T` view-space strand direction,
 * `N` view-space normal, `V` toward the eye; the key light's direction (world) comes in as uHairKey.
 */
export const HAIR_SPECULAR_GLSL = `
  uniform vec3 uHairKey;
  vec3 hairSpecular(vec3 T, vec3 N, vec3 V, vec3 base) {
    vec3 L = normalize((viewMatrix * vec4(uHairKey, 0.0)).xyz);
    vec3 H = normalize(L + V);
    float lit = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    vec3 T1 = normalize(T + N * 0.08);
    vec3 T2 = normalize(T - N * 0.22);
    float d1 = dot(T1, H), d2 = dot(T2, H);
    float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 90.0);
    float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 22.0);
    return (vec3(1.0, 0.97, 0.92) * s1 * 0.22 + base * s2 * 0.32) * lit;
  }`;
export const HAIR_KEY = new THREE.Vector3(-1.3, 2.4, 2.2).normalize();

// How the strands are coloured and how much of a pixel each covers, matched by eye against the Cycles review renders at
// desktop size (light background, side and front):
// - coverage: square root of the drawn width's true share - the physical (linear) share left the 40%-sampled coat thin
// - absorption: the review render's Principled Hair scatters light through many strands, each absorbing - the mass
//   reads darker and richer than one strand's colour (the tail's grey-brown 142,112,88 is a deep banded brown there).
//   Raising the colour to this power stands in for it; white stays white
// - the coat grade the undercoat and skin get (COAT_GRADE), so strands do not veil them in another shade
// - the white highlight lobe at a fraction: on blended strands every lit strand's highlight adds up to a sheen
const GROOM_COVERAGE_EXP = '0.50';
const GROOM_ABSORPTION = '1.60';
const GROOM_SPECULAR = '0.40';

export async function loadGroom(directory: string): Promise<GroomAsset | null> {
  const response = await fetch(`${directory}groom.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`groom.json: HTTP ${response.status}`);
  const spec = await response.json() as GroomSpec;
  if (spec.version !== 1 || spec.coordinateSpace !== 'gltf-rest' || !Array.isArray(spec.parts)) throw new Error('Unsupported groom format');
  const data = await fetch(`${directory}groom.bin`);
  if (!data.ok) throw new Error(`groom.bin: HTTP ${data.status}`);
  const bytes = await data.arrayBuffer();
  if (bytes.byteLength !== spec.bytes) throw new Error('Incomplete groom.bin');
  return { spec, bytes };
}

/** Original curved strands, camera-facing only across their width. No procedural re-grooming. */
export function createGroom(asset: GroomAsset, base: THREE.SkinnedMesh, root: THREE.Object3D = base.parent!) {
  const uniforms = { uGroomTime: { value: 0 }, uGroomMotion: { value: 0 }, uGroomHeight: { value: 1 }, uGroomStack: { value: 1 }, uHairKey: { value: HAIR_KEY } };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .86, metalness: 0, side: THREE.DoubleSide,
    // Blended, not alpha-to-coverage: A2C turns a given alpha into the same MSAA samples every time, so overlapping
    // strands kept landing on the same samples and a dense coat never got past its first strand's coverage - the tail's
    // 15k dark-brown strands read as a pale grey haze round a thin core. Blended strands accumulate as fur does. They
    // draw after the opaque body and undercoat (transparent pass) and are depth-tested against them, but write no
    // depth, so a strand in front never punches a hole in the ones behind it.
    alphaToCoverage: false, transparent: true, depthWrite: false,
    // DoubleSide + transparent would draw every strand twice (back faces, then front); a ribbon has no inside
    forceSinglePass: true,
    // Explicit source-over alpha preserves an already opaque torso: replacing alpha
    // with a fractional fibre alpha made the original desktop coat transparent.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec3 groomTangent;
attribute vec4 groomData;
uniform float uGroomTime, uGroomMotion, uGroomHeight;
varying float vGroomEdge, vGroomCoverage, vGroomAlong;
varying vec3 vHairT;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // Roots stay fixed. Slow breathing and movement bend only the outer part of each strand.
      float phase = groomData.w;
      float bend = groomData.z * (0.00045 + uGroomMotion * 0.0012);
      transformed += vec3(sin(uGroomTime * 1.7 + phase), 0.25 * sin(uGroomTime * 1.3 + phase),
                          0.45 * cos(uGroomTime * 1.5 + phase)) * bend;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec3 hairTangent = groomTangent;
      #ifdef USE_SKINNING
        hairTangent = (skinMatrix * vec4(hairTangent, 0.0)).xyz;
      #endif
      vec3 tangentView = normalize(mat3(modelViewMatrix) * hairTangent);
      vHairT = tangentView;
      vGroomAlong = groomData.z;
      vec2 across = vec2(-tangentView.y, tangentView.x);
      across = length(across) > 0.0001 ? normalize(across) : vec2(1.0, 0.0);
      float radiusView = groomData.y * length(modelViewMatrix[0].xyz);
      float minimumRadius = 0.30 / (projectionMatrix[1][1] * uGroomHeight * 0.5);
      float drawnRadius = max(radiusView, minimumRadius);
      // A strand drawn wider than it is covers that much less of each pixel it touches.
      vGroomCoverage = pow(min(1.0, radiusView / drawnRadius), ${GROOM_COVERAGE_EXP});
      vGroomEdge = groomData.x;
      mvPosition.xy += across * groomData.x * drawnRadius;
      gl_Position = projectionMatrix * mvPosition;
    `);
    shader.fragmentShader = 'uniform float uGroomStack;\nvarying float vGroomEdge, vGroomCoverage, vGroomAlong;\nvarying vec3 vHairT;\n' + HAIR_SPECULAR_GLSL + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.a *= vGroomCoverage * (1.0 - smoothstep(0.65, 1.0, abs(vGroomEdge)));
      // each strand drawn stands for uGroomStack of them (see setDensity): the opacity of that many overlapping
      diffuseColor.a = 1.0 - pow(1.0 - min(diffuseColor.a, 0.999), uGroomStack);
      // roots in the coat's own shade, tips in the light (groomData.z runs root 0 -> tip 1, squared)
      diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(1e-4)), vec3(${GROOM_ABSORPTION}));
      diffuseColor.rgb *= mix(0.62, 1.05, sqrt(vGroomAlong));
      { float lumC = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = max(mix(vec3(lumC), diffuseColor.rgb, 1.25) * vec3(1.06, 1.0, 0.90), 0.0); }
    `);
    // Use the groom's outward surface normal on both sides of the thin ribbon.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      outgoingLight += diffuseColor.rgb * 0.055 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
      outgoingLight += hairSpecular(normalize(vHairT), normal, normalize(vViewPosition), diffuseColor.rgb) * sqrt(vGroomAlong) * ${GROOM_SPECULAR};
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'original-groom-v4-density';
  const boneIndex = new Map(base.skeleton.bones.map((b, i) => [(b.userData.name as string | undefined) ?? b.name, i]));
  const jointMap = asset.spec.jointNames.map((name) => {
    const index = boneIndex.get(name);
    if (index == null) throw new Error(`Groom joint missing: ${name}`);
    return index;
  });
  const meshes = asset.spec.parts.map((part) => {
    const floats = (b: Block) => new Float32Array(asset.bytes, b.offset, b.count);
    const source = floats(part.positions), colors = floats(part.colors), radii = floats(part.radii);
    const normals = floats(part.normals), weights = floats(part.weights);
    const joints = new Uint16Array(asset.bytes, part.joints.offset, part.joints.count);
    const count = part.strands * part.points * 2;
    const position = new Float32Array(count * 3), color = new Float32Array(count * 3), normal = new Float32Array(count * 3);
    const tangent = new Float32Array(count * 3), data = new Float32Array(count * 4), skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
    const indices = new Uint32Array(part.strands * (part.points - 1) * 6);
    // Strands in a shuffled order, so any leading run of them (setDensity's draw range) is an even sample of the part.
    const order = shuffledOrder(part.strands);
    let ii = 0;
    for (let slot = 0; slot < part.strands; slot++) {
      const strand = order[slot];
      const phase = ((strand * .61803398875) % 1) * Math.PI * 2;
      for (let point = 0; point < part.points; point++) {
        const p = strand * part.points + point;
        const before = (strand * part.points + Math.max(0, point - 1)) * 3;
        const after = (strand * part.points + Math.min(part.points - 1, point + 1)) * 3;
        const out = slot * part.points + point;
        for (let side = 0; side < 2; side++) {
          const v = out * 2 + side;
          for (let c = 0; c < 3; c++) {
            position[v * 3 + c] = source[p * 3 + c];
            color[v * 3 + c] = colors[p * 3 + c];
            normal[v * 3 + c] = normals[strand * 3 + c];
            tangent[v * 3 + c] = source[after + c] - source[before + c];
          }
          data.set([side ? 1 : -1, radii[p] * part.widthCompensation, (point / (part.points - 1)) ** 2, phase], v * 4);
          for (let c = 0; c < 4; c++) {
            const offset = (part.skinPerPoint ? p : strand) * 4 + c;
            skinIndex[v * 4 + c] = jointMap[joints[offset]];
            skinWeight[v * 4 + c] = weights[offset];
          }
        }
        if (point < part.points - 1) {
          const v = out * 2;
          indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], ii);
          ii += 6;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', position, 3], ['color', color, 3], ['normal', normal, 3], ['groomTangent', tangent, 3],
      ['groomData', data, 4], ['skinIndex', skinIndex, 4], ['skinWeight', skinWeight, 4],
    ] as const) geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    let lid: THREE.Mesh | undefined;
    if (part.morphTarget) root.traverse((o) => {
      if (((o.userData.name as string | undefined) ?? o.name) === part.morphTarget) lid = o as THREE.Mesh;
    });
    if (part.morphTarget && !lid?.morphTargetDictionary) throw new Error(`Groom morph target missing: ${part.morphTarget}`);
    if (lid?.morphTargetDictionary) {
      geometry.morphTargetsRelative = true;
      geometry.morphAttributes.position = [];
      for (const [name, index] of Object.entries(lid.morphTargetDictionary)) {
        const delta = part.morphs?.[name] ? floats(part.morphs[name]) : null;
        const values = new Float32Array(count * 3);
        if (delta) for (let v = 0; v < count; v++) {
          const strand = order[Math.floor(v / (part.points * 2))];
          values.set(delta.subarray(strand * 3, strand * 3 + 3), v * 3);
        }
        const attribute = new THREE.BufferAttribute(values, 3);
        attribute.name = name;
        geometry.morphAttributes.position[index] = attribute;
      }
    }
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = part.name;
    if (lid) {
      mesh.morphTargetInfluences = lid.morphTargetInfluences;
      mesh.morphTargetDictionary = lid.morphTargetDictionary;
    }
    mesh.bind(base.skeleton, base.bindMatrix);
    mesh.position.copy(base.position); mesh.quaternion.copy(base.quaternion); mesh.scale.copy(base.scale);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    // The opaque undercoat supplies the large shadow. Hundreds of thousands of subpixel hair
    // shadows in a 2k map made a hard noisy coat rather than the review render's soft occlusion.
    mesh.castShadow = false;
    mesh.userData.groomStrands = part.strands;
    // slot -> source strand, for anything that has to find a source strand's vertices
    mesh.userData.groomOrder = order;
    mesh.userData.groomIndicesPerStrand = (part.points - 1) * 6;
    return mesh;
  });
  let density = 1;
  return {
    meshes, material,
    update(seconds: number, motion: number, viewportHeight: number) {
      uniforms.uGroomTime.value = seconds;
      uniforms.uGroomMotion.value = THREE.MathUtils.clamp(motion, 0, 1);
      uniforms.uGroomHeight.value = viewportHeight;
    },
    /**
     * Draw only this share of every part's strands, each standing for 1/share of them. Small on the desktop a cat is a
     * few hundred pixels across and 276k strands are far more than it has pixels - they cost ~95 ms a frame on an M4
     * (WebKit), the cat ran at ~10 fps - while a quarter of them, each as opaque as four overlapping, looks the same.
     */
    setDensity(share: number) {
      const next = THREE.MathUtils.clamp(share, 0.01, 1);
      if (Math.abs(next - density) < 0.01) return;
      density = next;
      for (const mesh of meshes) {
        const total = mesh.userData.groomStrands as number;
        mesh.geometry.setDrawRange(0, Math.max(1, Math.round(total * density)) * (mesh.userData.groomIndicesPerStrand as number));
      }
      uniforms.uGroomStack.value = 1 / density;
    },
    get density() { return density; },
  };
}

/** A fixed shuffle of 0..n-1 (the same every load, so the cat never looks different between runs). */
function shuffledOrder(n: number): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  let seed = 0x9e3779b9;
  for (let i = n - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return order;
}
