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
  const uniforms = { uGroomTime: { value: 0 }, uGroomMotion: { value: 0 }, uGroomHeight: { value: 1 } };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .86, metalness: 0, side: THREE.DoubleSide,
    alphaToCoverage: true, transparent: false, depthWrite: true,
    // MSAA smooths individual fibres without the salt-and-pepper alphaHash pattern.
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
varying float vGroomEdge, vGroomCoverage;\n` + shader.vertexShader;
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
      vec2 across = vec2(-tangentView.y, tangentView.x);
      across = length(across) > 0.0001 ? normalize(across) : vec2(1.0, 0.0);
      float radiusView = groomData.y * length(modelViewMatrix[0].xyz);
      float minimumRadius = 0.30 / (projectionMatrix[1][1] * uGroomHeight * 0.5);
      float drawnRadius = max(radiusView, minimumRadius);
      // Coverage affects both the MSAA sample mask and source-over opacity. A linear
      // factor squared the intended coverage, making fine hair vanish at pet size.
      vGroomCoverage = sqrt(min(1.0, radiusView / drawnRadius));
      vGroomEdge = groomData.x;
      mvPosition.xy += across * groomData.x * drawnRadius;
      gl_Position = projectionMatrix * mvPosition;
    `);
    shader.fragmentShader = 'varying float vGroomEdge, vGroomCoverage;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.a *= vGroomCoverage * (1.0 - smoothstep(0.65, 1.0, abs(vGroomEdge)));
    `);
    // Use the groom's outward surface normal on both sides of the thin ribbon.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      outgoingLight += diffuseColor.rgb * 0.055 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'original-groom-v1';
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
    let ii = 0;
    for (let strand = 0; strand < part.strands; strand++) {
      const phase = ((strand * .61803398875) % 1) * Math.PI * 2;
      for (let point = 0; point < part.points; point++) {
        const p = strand * part.points + point;
        const before = (strand * part.points + Math.max(0, point - 1)) * 3;
        const after = (strand * part.points + Math.min(part.points - 1, point + 1)) * 3;
        for (let side = 0; side < 2; side++) {
          const v = p * 2 + side;
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
          const v = p * 2;
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
          const strand = Math.floor(v / (part.points * 2));
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
    return mesh;
  });
  return { meshes, material, update(seconds: number, motion: number, viewportHeight: number) {
    uniforms.uGroomTime.value = seconds;
    uniforms.uGroomMotion.value = THREE.MathUtils.clamp(motion, 0, 1);
    uniforms.uGroomHeight.value = viewportHeight;
  } };
}
