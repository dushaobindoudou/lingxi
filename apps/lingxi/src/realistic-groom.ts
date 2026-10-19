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

// How a strand is shaded, matched by eye against the Cycles review renders (Principled Hair) at desktop size and close up:
// - coverage: square root of the drawn width's true share - the physical (linear) share left the coat thin
// - absorption: Principled Hair scatters light through many strands, each absorbing - the mass reads darker and richer
//   than one strand's colour. Raising the colour to this power stands in for it; white stays white
// - melanin: no two hairs are the same shade. Without it every strand matched the undercoat under it and close up the
//   coat read as a painted, smooth surface - the variation is what makes single hairs visible
// - occlusion: light reaches a root through the coat over it - roots in shade, tips in the light
// - three highlight lobes along the strand (Marschner): R, a thin white line off the surface, shifted toward the root;
//   TRT, through the hair and back, broader and in the coat's own colour, toward the tip; TT, straight through - the
//   warm glow of a backlit coat's edge
const GROOM = {
  coverageExp: '0.50',
  absorption: '1.45',
  melanin: '0.30',
  rootShade: '0.62',
  // diffuse wrap: light carries round a fur volume further than round a hard surface
  wrap: '0.45',
  // tight and bright, gathered into a band (glossFocus): a broad lobe lit a little of every hair at once and washed
  // the coat in a grey haze - dull - instead of a few hairs catching the light in bright lines. The coat's warm sheen is
  // TRT's, in the hair's own colour: made broader and the main one, R kept a thin bright line (a broader, stronger R
  // only greyed the tabby over)
  r: { shift: '0.10', exp: '300.0', strength: '2.6' },
  glossFocus: '5.0',
  trt: { shift: '-0.18', exp: '30.0', strength: '3.2' },
  tt: { exp: '5.0', strength: '1.6' },
  // the room the cat stands in (the other materials' RoomEnvironment at 0.5): soft light from everywhere
  ambient: '0.32',
  lidVeil: '0.4',
  // the lids' rows of strands lie about this far apart (model units)
  lidRowSpacing: '0.012',
  // How far a tip trails the body's motion (see the coat's inertia in createGroom): this share of where it would be
  // with the skeleton's sprung copy, at most this share of the strand's length.
  lagGain: '0.9', lagMax: '0.75',
  // the narrowest a strand is drawn (half-width, device pixels): thinner, a small cat's coat was a faint haze over the
  // undercoat; drawn this wide (with less coverage, see coverageExp) the strands read as fur
  minimumWidthPx: '0.5',
  // A child hair (see GROOM_CHILDREN) grows this far from its parent, in the parent's spacing (its part's average
  // distance between roots), and ends between these shares of its parent's length.
  childSpread: '0.7', childShortest: '0.62',
} as const;
// Close up the coat gets denser rather than coarser: each drawn strand gains up to this many child hairs beside it, the
// way an offline groom interpolates children between its guides - fine single hairs, a parent's copy moved a little
// across the skin and ending at its own length. (A strand widened into a lock of three hairs had been tried: close up it
// read as yarn, parallel threads in a ribbon.) Drawn only once the cat is big on screen (setDensity above 1).
export const GROOM_CHILDREN = 2;
// The coat's inertia (simulate): Hz, damping ratio, and a jump (model units) that is a teleport, not a motion
const GROOM_LAG = { hz: 2.2, damping: 0.4, snapDistance: 1.5 };
// The coat a touch shorter than the Blender groom (lids as groomed, the tail its own): longer (1.15-1.25, tried to make
// the coat read at desktop size) the strands stood out one by one, long and sparse; shorter and drawn denser (the
// renderer's GROOM_MIN_DENSITY) it is a thick, soft coat
const COAT_LENGTH = 0.95;
const KEEP_LENGTH = /_LX_Lid/;
// The tail's own coat: shorter than groomed. At its groomed length (kept when the body's grew) it was a bottle brush
// twice the kitten's body thickness; a kitten's tail is slim, its fur short and soft.
const TAIL_LENGTH = 0.62;
const TAIL = /_LX_(Tail|TailTip)/;
/** How much of its groomed length a part's strands keep (see COAT_LENGTH). */
export function coatLength(partName: string) {
  return KEEP_LENGTH.test(partName) ? 1 : TAIL.test(partName) ? TAIL_LENGTH : COAT_LENGTH;
}
// The lids' strands lie flat in rows along the lid; at their own width the rows showed as lines of lit hair with the
// undercoat dark between them, ring after ring round a closed eye. This much wider they overlap into one coat.
const LID_STRAND_WIDTH = 8;

const GROOM_VERTEX = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 groomTangent;
attribute vec4 groomData;   // across -1/1, radius, root 0 -> tip 1 (squared), phase
attribute vec3 groomStrand; // length (model units), random 0..1, 1 on the lids' coat
uniform float uGroomTime, uGroomHeight, uGroomGust;
uniform vec3 uGroomWind;    // tip bend, share of the strand's length, world axes
uniform vec4 uGroomStroke;  // pointer (NDC xy), radius (view units), bend
uniform vec2 uGroomStrokeDir;
uniform float uGroomChild;  // 0 the strand itself, 1.. its child hairs
uniform highp sampler2D uGroomLagBones; // the skeleton's sprung copy, laid out as three's boneTexture
mat4 groomLagMatrix(const in float i) {
  int size = textureSize(uGroomLagBones, 0).x;
  int j = int(i) * 4;
  int x = j % size, y = j / size;
  return mat4(texelFetch(uGroomLagBones, ivec2(x, y), 0), texelFetch(uGroomLagBones, ivec2(x + 1, y), 0),
    texelFetch(uGroomLagBones, ivec2(x + 2, y), 0), texelFetch(uGroomLagBones, ivec2(x + 3, y), 0));
}
varying float vGroomEdge, vGroomCoverage, vGroomAlong, vGroomRandom, vGroomShadow, vGroomLid, vGroomChildEnd;
varying vec3 vGroomT, vGroomN, vGroomColor, vGroomRest;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  struct DirectionalLightShadow { float shadowIntensity; float shadowBias; float shadowNormalBias; float shadowRadius; vec2 shadowMapSize; };
  uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
  uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
  #ifdef SHADOWMAP_TYPE_PCF
    uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
  #else
    uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
  #endif
#endif
void main() {
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  // groomStrand.z: the part's root spacing, negative on the lids' coat
  float spacing = abs(groomStrand.z), random = groomStrand.y;
  vGroomChildEnd = 2.0;
  if (groomStrand.z < 0.0) {
    // the lids' strands are rooted in rows across the lid, each row's tips ending short of the next row's roots: each
    // moved along itself by up to a row's spacing, or the gaps read as rings round a closed eye (not across: moved
    // sideways they strayed over the lash line)
    vec3 along = normalize(groomTangent + vec3(1e-5, 0.0, 0.0));
    transformed += along * (fract(random * 31.7) - 0.5) * ${GROOM.lidRowSpacing};
  }
  if (uGroomChild > 0.5) {
    // a child hair: the parent moved across the skin (rest space, before skinning, so it rides the body the same way)
    vec3 h = fract(sin(vec3(12.9898, 78.233, 37.719) * (random * 57.3 + uGroomChild * 11.17)) * 43758.5453);
    vec3 across1 = normalize(cross(normal, groomTangent) + vec3(1e-5, 0.0, 0.0));
    vec3 across2 = cross(across1, normal);
    float a = h.x * 6.2831853;
    transformed += (across1 * cos(a) + across2 * sin(a)) * spacing * ${GROOM.childSpread} * sqrt(h.y);
    random = h.z;
    vGroomChildEnd = mix(${GROOM.childShortest}, 1.0, fract(h.z * 7.31));
  }
  vec3 groomRest = transformed;
  vGroomRest = groomRest;
  #include <skinning_vertex>
  // where this point would be on the sprung skeleton: the coat's inertia, in object space
  vec3 lagDelta = vec3(0.0);
  #ifdef USE_SKINNING
    vec4 restSkin = bindMatrix * vec4(groomRest, 1.0);
    vec4 lagged = groomLagMatrix(skinIndex.x) * restSkin * skinWeight.x + groomLagMatrix(skinIndex.y) * restSkin * skinWeight.y
      + groomLagMatrix(skinIndex.z) * restSkin * skinWeight.z + groomLagMatrix(skinIndex.w) * restSkin * skinWeight.w;
    lagDelta = (bindMatrixInverse * lagged).xyz - transformed;
  #endif
  vec3 hairTangent = groomTangent;
  #ifdef USE_SKINNING
    hairTangent = (skinMatrix * vec4(hairTangent, 0.0)).xyz;
  #endif
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(transformedNormal);
  vec3 T = normalize(mat3(modelViewMatrix) * hairTangent);
  float viewScale = length(modelViewMatrix[0].xyz);
  float along = groomData.z, t = sqrt(along);
  float strandLength = groomStrand.x * viewScale;

  // Air. A gust travels through the coat as waves (rest position, so they keep their place on the body as it moves);
  // each strand flutters a little on its own. The bend can lift a strand off the body, never push it into it.
  float wave = sin(dot(position, vec3(0.0, 7.0, 17.0)) - uGroomTime * 5.5 + 1.7 * sin(dot(position.xz, vec2(13.0, 4.0)) + uGroomTime * 0.9));
  float flutter = sin(uGroomTime * (7.0 + 3.0 * groomStrand.y) + groomData.w);
  vec3 bend = (viewMatrix * vec4(uGroomWind, 0.0)).xyz;
  bend *= 1.0 + uGroomGust * 0.55 * wave + 0.12 * flutter;
  bend += cross(N, bend) * 0.25 * flutter;
  // a hand through the coat: the strands under the pointer go along with it, lifting a little
  vec2 fromPointer = (projectionMatrix * mvPosition).xy - uGroomStroke.xy;
  fromPointer /= vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float touch = uGroomStroke.w * exp(-dot(fromPointer, fromPointer) / max(1e-6, uGroomStroke.z * uGroomStroke.z));
  bend += vec3(uGroomStrokeDir, 0.0) * touch + N * abs(touch) * 0.6;
  // the body's own motion: the tip trails where the sprung skeleton still has it, swings past when it stops
  vec3 lagView = mat3(modelViewMatrix) * lagDelta * ${GROOM.lagGain};
  float lagLength = length(lagView), lagMost = ${GROOM.lagMax} * strandLength;
  if (lagLength > lagMost) lagView *= lagMost / lagLength;
  bend += lagView / max(strandLength, 1e-6);
  bend -= N * min(0.0, dot(bend, N));
  // slow breathing of the coat, so a still cat's fur is never frozen
  bend += vec3(sin(uGroomTime * 1.7 + groomData.w), 0.25 * sin(uGroomTime * 1.3 + groomData.w), 0.45 * cos(uGroomTime * 1.5 + groomData.w)) * 0.012;
  vec3 tipShift = bend * strandLength;
  // the tip moves along an arc, not out of the strand's length: what it gains sideways it loses along the strand
  vec3 shiftView = tipShift * along - T * (dot(tipShift, tipShift) / max(1e-6, 2.0 * strandLength)) * along * along;
  mvPosition.xyz += shiftView;
  T = normalize(T * strandLength + 2.0 * t * tipShift);

  vGroomT = T;
  vGroomColor = vColor.rgb;
  vGroomN = N;
  vGroomAlong = along;
  vGroomRandom = random;
  vGroomLid = step(groomStrand.z, 0.0);
  vec2 across = vec2(-T.y, T.x);
  across = length(across) > 0.0001 ? normalize(across) : vec2(1.0, 0.0);
  float radiusView = groomData.y * viewScale;
  float pixelsPerView = projectionMatrix[1][1] * uGroomHeight * 0.5;
  float minimumRadius = ${GROOM.minimumWidthPx} / pixelsPerView;
  float drawnRadius = max(radiusView, minimumRadius);
  // A strand drawn wider than it is covers that much less of each pixel it touches.
  vGroomCoverage = pow(min(1.0, radiusView / drawnRadius), ${GROOM.coverageExp});
  vGroomEdge = groomData.x;
  mvPosition.xy += across * groomData.x * drawnRadius;
  gl_Position = projectionMatrix * mvPosition;

  // The key light's shadow, looked up once per strand point rather than for every pixel of every strand: a hair is
  // far thinner than a shadow-map texel, and per pixel this lookup was half the coat's cost.
  vGroomShadow = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    worldPosition.xyz += (vec4(shiftView, 0.0) * viewMatrix).xyz;
    vec3 worldNormal = inverseTransformDirection(N, viewMatrix);
    vec4 shadowCoord = directionalShadowMatrix[0] * (worldPosition + vec4(worldNormal * directionalLightShadows[0].shadowNormalBias, 0.0));
    shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.z += directionalLightShadows[0].shadowBias;
    if (all(greaterThanEqual(shadowCoord.xyz, vec3(0.0))) && all(lessThanEqual(shadowCoord.xyz, vec3(1.0)))) {
      vec2 texel = directionalLightShadows[0].shadowRadius / directionalLightShadows[0].shadowMapSize;
      #ifdef SHADOWMAP_TYPE_PCF
        float lit = (texture(directionalShadowMap[0], vec3(shadowCoord.xy + vec2(-0.7, -0.3) * texel, shadowCoord.z))
          + texture(directionalShadowMap[0], vec3(shadowCoord.xy + vec2(0.3, -0.7) * texel, shadowCoord.z))
          + texture(directionalShadowMap[0], vec3(shadowCoord.xy + vec2(0.7, 0.3) * texel, shadowCoord.z))
          + texture(directionalShadowMap[0], vec3(shadowCoord.xy + vec2(-0.3, 0.7) * texel, shadowCoord.z))) * 0.25;
      #else
        float lit = step(shadowCoord.z, texture(directionalShadowMap[0], shadowCoord.xy).r);
      #endif
      vGroomShadow = mix(1.0, lit, directionalLightShadows[0].shadowIntensity);
    }
  #endif
}`;

const groomFragment = (part: string) => /* glsl */ `
#include <common>
#include <lights_pars_begin>
uniform float uGroomStack;
varying float vGroomEdge, vGroomCoverage, vGroomAlong, vGroomRandom, vGroomShadow, vGroomLid, vGroomChildEnd;
varying vec3 vGroomT, vGroomN, vGroomColor, vGroomRest;
${part}
float hairLobe(vec3 T, vec3 H, float e) { float d = dot(T, H); return pow(sqrt(max(0.0, 1.0 - d * d)), e); }
void main() {
  float alpha = vGroomCoverage * (1.0 - smoothstep(0.65, 1.0, abs(vGroomEdge)));
  // a child hair ends at its own length; so does each of the lids' strands, whose tips otherwise end row by row in
  // lines round a closed eye
  float end = mix(vGroomChildEnd, 0.55 + 0.45 * fract(vGroomRandom * 13.7), vGroomLid);
  alpha *= 1.0 - smoothstep(end - 0.12, end, sqrt(vGroomAlong));
  // each strand drawn stands for uGroomStack of them (see setDensity): the opacity of that many overlapping
  alpha = 1.0 - pow(1.0 - min(alpha, 0.999), uGroomStack);
  vec3 base = pow(max(vGroomColor, vec3(1e-4)), vec3(${GROOM.absorption}));
  base *= 1.0 + ${GROOM.melanin} * (vGroomRandom - 0.5);
  // the coat grade the undercoat and skin get (COAT_GRADE), so strands do not veil them in another shade
  float lumC = dot(base, vec3(0.2126, 0.7152, 0.0722));
  base = max(mix(vec3(lumC), base, 1.25) * vec3(1.06, 1.0, 0.90), 0.0);
  // The lids' short coat is drawn even from root to tip: 20k strands rooted in rows on a lid a centimetre across,
  // anything that changes along a strand - the root fading in, the tip out, the shaded root - lined up row by row
  // into rings of light and dark bands round a closed eye. So for it the shading's along-the-strand parameter is held
  // at the tip, and it is a light veil over the lids' own undercoat.
  float t = mix(sqrt(vGroomAlong), 1.0, vGroomLid);
  // the root rises out of the undercoat: drawn from inside it, a strand's dark root showed as a speck (most of all
  // at desktop size, where each drawn strand stands for several)
  alpha *= smoothstep(0.0, 0.3, t);
  alpha *= 1.0 - vGroomLid * ${GROOM.lidVeil};
  // where the face wants its coat parted (createGroom's options.part): the closed mouth's line
  alpha *= groomPart(vGroomRest);
  float occlusion = mix(${GROOM.rootShade}, 1.0, t);

  vec3 N = normalize(vGroomN), T = normalize(vGroomT);
  vec3 V = vec3(0.0, 0.0, 1.0); // the desktop camera is orthographic
  vec3 tR = normalize(T + N * ${GROOM.r.shift}), tTRT = normalize(T + N * ${GROOM.trt.shift});
  vec3 coatTint = sqrt(base);
  vec3 diffuse = vec3(0.0), shine = vec3(0.0);
  #if NUM_DIR_LIGHTS > 0
    #pragma unroll_loop_start
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) { {
      vec3 L = directionalLights[ i ].direction;
      vec3 C = directionalLights[ i ].color * (UNROLLED_LOOP_INDEX == 0 ? vGroomShadow : 1.0);
      float nl = dot(N, L);
      float lit = clamp((nl + ${GROOM.wrap}) / (1.0 + ${GROOM.wrap}), 0.0, 1.0);
      float tl = dot(T, L);
      diffuse += C * lit * mix(1.0, sqrt(max(0.0, 1.0 - tl * tl)), 0.3);
      vec3 H = normalize(L + V);
      // the coat's gloss gathers where its surface faces the half-vector: a soft band across a round head or flank
      // (strand lobes alone lit every strand at once and greyed the whole coat over rather than making it shine)
      float facing = smoothstep(-0.2, 0.3, nl) * (0.25 + 0.75 * pow(max(0.0, dot(N, H)), ${GROOM.glossFocus}));
      shine += C * facing * (vec3(1.0, 0.98, 0.95) * hairLobe(tR, H, ${GROOM.r.exp}) * ${GROOM.r.strength}
        + base * hairLobe(tTRT, H, ${GROOM.trt.exp}) * ${GROOM.trt.strength});
      // through the hair: a light behind the cat, seen past the coat's edge
      float behind = max(0.0, -dot(L, V));
      float edge = 1.0 - abs(dot(N, V));
      shine += C * coatTint * pow(behind, ${GROOM.tt.exp}) * edge * edge * ${GROOM.tt.strength} * (0.3 + 0.7 * t);
    } }
    #pragma unroll_loop_end
  #endif
  vec3 ambient = vec3(${GROOM.ambient}) * PI;
  #if NUM_HEMI_LIGHTS > 0
    ambient += getHemisphereLightIrradiance(hemisphereLights[0], N);
  #endif
  vec3 color = base * (diffuse + ambient) * RECIPROCAL_PI * occlusion + shine * RECIPROCAL_PI * t;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

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
/**
 * `options.part`: GLSL defining `float groomPart(vec3 rest)` - how much of a strand to draw at a point of the model's rest
 * pose (0 parts the coat there). Default: everywhere.
 */
export function createGroom(asset: GroomAsset, base: THREE.SkinnedMesh, root: THREE.Object3D = base.parent!, options: { part?: string } = {}) {
  const uniforms = {
    uGroomTime: { value: 0 }, uGroomHeight: { value: 1 }, uGroomStack: { value: 1 }, uGroomGust: { value: 0 },
    uGroomWind: { value: new THREE.Vector3() }, uGroomStroke: { value: new THREE.Vector4() }, uGroomStrokeDir: { value: new THREE.Vector2(1, 0) },
    uGroomChild: { value: 0 },
    uGroomLagBones: { value: null as THREE.DataTexture | null },
  };
  // Its own shader, not MeshStandardMaterial's: a strand is a fibre, not a surface - its light runs along it - and the
  // standard one's per-pixel soft shadow and environment lookups, on millions of sub-pixel strand fragments, were most
  // of the frame.
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, uniforms]),
    vertexShader: GROOM_VERTEX, fragmentShader: groomFragment(options.part ?? 'float groomPart(vec3 rest) { return 1.0; }'),
    lights: true, vertexColors: true, side: THREE.DoubleSide,
    // Blended, not alpha-to-coverage: A2C turns a given alpha into the same MSAA samples every time, so overlapping
    // strands kept landing on the same samples and a dense coat never got past its first strand's coverage - the tail's
    // 15k dark-brown strands read as a pale grey haze round a thin core. Blended strands accumulate as fur does. They
    // draw after the opaque body and undercoat (transparent pass) and are depth-tested against them, but write no
    // depth, so a strand in front never punches a hole in the ones behind it.
    transparent: true, depthWrite: false,
    // DoubleSide + transparent would draw every strand twice (back faces, then front); a ribbon has no inside
    forceSinglePass: true,
    // Explicit source-over alpha preserves an already opaque torso: replacing alpha
    // with a fractional fibre alpha made the original desktop coat transparent.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  // merge() cloned the values: keep the material's own uniform objects as the ones update() writes
  Object.assign(uniforms, Object.fromEntries(Object.keys(uniforms).map((k) => [k, material.uniforms[k]])));
  const boneIndex = new Map(base.skeleton.bones.map((b, i) => [(b.userData.name as string | undefined) ?? b.name, i]));
  const jointMap = asset.spec.jointNames.map((name) => {
    const index = boneIndex.get(name);
    if (index == null) throw new Error(`Groom joint missing: ${name}`);
    return index;
  });
  const meshes = asset.spec.parts.map((part) => {
    const floats = (b: Block) => new Float32Array(asset.bytes, b.offset, b.count);
    const source = floats(part.positions), radii = floats(part.radii);
    const colors = /_LX_Lid/.test(part.name) ? evened(floats(part.colors), part.points, LID_COLOUR_EVENING) : floats(part.colors);
    const normals = floats(part.normals), weights = floats(part.weights);
    const joints = new Uint16Array(asset.bytes, part.joints.offset, part.joints.count);
    const count = part.strands * part.points * 2;
    const position = new Float32Array(count * 3), color = new Float32Array(count * 3), normal = new Float32Array(count * 3);
    const tangent = new Float32Array(count * 3), data = new Float32Array(count * 4), strandData = new Float32Array(count * 3), skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
    const indices = new Uint32Array(part.strands * (part.points - 1) * 6);
    // Strands in a shuffled order, so any leading run of them (setDensity's draw range) is an even sample of the part.
    const order = shuffledOrder(part.strands);
    const lidCoat = /_LX_Lid/.test(part.name) ? 1 : 0;
    const spacing = rootSpacing(source, part.strands, part.points);
    const shorten = coatLength(part.name);
    let ii = 0;
    for (let slot = 0; slot < part.strands; slot++) {
      const strand = order[slot];
      const phase = ((strand * .61803398875) % 1) * Math.PI * 2;
      const random = (Math.imul(strand + 1, 0x9e3779b1) >>> 0) / 4294967296;
      let strandLength = 0;
      for (let point = 1; point < part.points; point++) {
        const a = (strand * part.points + point - 1) * 3, b = a + 3;
        strandLength += Math.hypot(source[b] - source[a], source[b + 1] - source[a + 1], source[b + 2] - source[a + 2]);
      }
      strandLength *= shorten;
      const root = strand * part.points * 3;
      for (let point = 0; point < part.points; point++) {
        const p = strand * part.points + point;
        const before = (strand * part.points + Math.max(0, point - 1)) * 3;
        const after = (strand * part.points + Math.min(part.points - 1, point + 1)) * 3;
        const out = slot * part.points + point;
        for (let side = 0; side < 2; side++) {
          const v = out * 2 + side;
          for (let c = 0; c < 3; c++) {
            position[v * 3 + c] = source[root + c] + (source[p * 3 + c] - source[root + c]) * shorten;
            color[v * 3 + c] = colors[p * 3 + c];
            normal[v * 3 + c] = normals[strand * 3 + c];
            tangent[v * 3 + c] = source[after + c] - source[before + c];
          }
          data.set([side ? 1 : -1, radii[p] * part.widthCompensation * (lidCoat ? LID_STRAND_WIDTH : 1), (point / (part.points - 1)) ** 2, phase], v * 4);
          strandData.set([strandLength, random, lidCoat ? -spacing : spacing], v * 3);
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
      ['groomData', data, 4], ['groomStrand', strandData, 3], ['skinIndex', skinIndex, 4], ['skinWeight', skinWeight, 4],
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
  // The child hairs: the same strands drawn again (the same attribute buffers, each with its own draw range), each
  // pass with its own child index. Hidden until setDensity asks for them.
  const childMaterials: THREE.ShaderMaterial[] = [];
  const children = Array.from({ length: GROOM_CHILDREN }, (_, k) => {
    const childMaterial = material.clone();
    // the parent's uniform objects (time, air, lights), its own child index
    childMaterial.uniforms = { ...material.uniforms, uGroomChild: { value: k + 1 } };
    childMaterials.push(childMaterial);
    return meshes.map((parent) => {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(parent.geometry.attributes)) geometry.setAttribute(name, attribute);
      geometry.setIndex(parent.geometry.getIndex());
      geometry.morphAttributes = parent.geometry.morphAttributes;
      geometry.morphTargetsRelative = parent.geometry.morphTargetsRelative;
      const child = new THREE.SkinnedMesh(geometry, childMaterial);
      child.name = `${parent.name}.child${k + 1}`;
      child.morphTargetInfluences = parent.morphTargetInfluences;
      child.morphTargetDictionary = parent.morphTargetDictionary;
      child.bind(parent.skeleton, parent.bindMatrix);
      child.position.copy(parent.position); child.quaternion.copy(parent.quaternion); child.scale.copy(parent.scale);
      child.frustumCulled = false;
      child.receiveShadow = true;
      child.castShadow = false;
      child.visible = false;
      child.userData = { ...parent.userData };
      return child;
    });
  });
  // The coat's inertia: a sprung copy of every bone's skinning matrix, chasing the real one (natural frequency, damping
  // ratio a little under critical - it swings past and settles). The strands bend toward where this copy still has
  // them, so a leg's swing, a turn of the head, a step's bounce or a run sweep the coat after them and let it settle.
  // Uploaded in three's boneTexture layout. Before, the coat only knew the whole cat's speed across the screen.
  const skeleton = base.skeleton;
  const boneCount = skeleton.bones.length;
  const lagSize = Math.max(4, Math.ceil(Math.sqrt(boneCount * 4) / 4) * 4);
  const lagMatrices = new Float32Array(lagSize * lagSize * 4);
  const lagVelocity = new Float32Array(boneCount * 16);
  const lagTexture = new THREE.DataTexture(lagMatrices, lagSize, lagSize, THREE.RGBAFormat, THREE.FloatType);
  lagTexture.needsUpdate = true;
  material.uniforms.uGroomLagBones.value = lagTexture;
  const offsetMatrix = new THREE.Matrix4();
  const target = new Float32Array(16);
  let lagPrimed = false;
  function simulate(seconds: number) {
    const w = 2 * Math.PI * GROOM_LAG.hz, zeta = GROOM_LAG.damping;
    // a jump (the first frame, a long stall, a teleport) starts the copy where the skeleton is
    const snap = !lagPrimed || seconds > 0.25;
    const steps = Math.max(1, Math.ceil(seconds * 240));
    const dt = seconds / steps;
    for (let i = 0; i < boneCount; i++) {
      offsetMatrix.multiplyMatrices(skeleton.bones[i].matrixWorld, skeleton.boneInverses[i]).toArray(target);
      const o = i * 16;
      const far = Math.hypot(target[12] - lagMatrices[o + 12], target[13] - lagMatrices[o + 13], target[14] - lagMatrices[o + 14]) > GROOM_LAG.snapDistance;
      if (snap || far) {
        lagMatrices.set(target, o);
        lagVelocity.fill(0, o, o + 16);
        continue;
      }
      for (let k = 0; k < 16; k++) {
        if (k % 4 === 3) continue; // the bottom row stays 0 0 0 1
        let x = lagMatrices[o + k], v = lagVelocity[o + k];
        for (let n = 0; n < steps; n++) {
          v += ((target[k] - x) * w * w - 2 * zeta * w * v) * dt;
          x += v * dt;
        }
        lagMatrices[o + k] = x; lagVelocity[o + k] = v;
      }
    }
    lagPrimed = true;
    lagTexture.needsUpdate = true;
  }
  let density = 1;
  return {
    /** Advance the coat's inertia; after the skeleton is posed for the frame (world matrices up to date). */
    simulate,
    dispose() { lagTexture.dispose(); },
    /** the strands themselves, and (drawn only close up) their child hairs */
    meshes, children: children.flat(), material, materials: [material, ...childMaterials],
    update(seconds: number, viewportHeight: number) {
      uniforms.uGroomTime.value = seconds;
      uniforms.uGroomHeight.value = viewportHeight;
    },
    /** The air (see realistic-wind.ts); the stroke already in NDC, its radius in view units. */
    setWind(wind: readonly [number, number, number], gust: number, stroke?: { x: number; y: number; radius: number; dx: number; dy: number; amount: number }) {
      uniforms.uGroomWind.value.set(wind[0], wind[1], wind[2]);
      uniforms.uGroomGust.value = gust;
      if (stroke) {
        uniforms.uGroomStroke.value.set(stroke.x, stroke.y, stroke.radius, stroke.amount);
        uniforms.uGroomStrokeDir.value.set(stroke.dx, stroke.dy);
      } else uniforms.uGroomStroke.value.w = 0;
    },
    /**
     * Draw only this share of every part's strands, each standing for 1/share of them. Small on the desktop a cat is a
     * few hundred pixels across and 276k strands are far more than it has pixels - they cost ~95 ms a frame on an M4
     * (WebKit), the cat ran at ~10 fps - while a quarter of them, each as opaque as four overlapping, looks the same.
     * Above 1, all of them and that many more of their child hairs (1.5: every strand, and half of them a first child).
     */
    setDensity(share: number) {
      const next = THREE.MathUtils.clamp(share, 0.01, 1 + GROOM_CHILDREN);
      if (Math.abs(next - density) < 0.01) return;
      density = next;
      const drawn = (mesh: THREE.Mesh, share: number) => {
        const total = mesh.userData.groomStrands as number;
        mesh.visible = share > 0;
        if (share > 0) mesh.geometry.setDrawRange(0, Math.max(1, Math.round(total * Math.min(1, share))) * (mesh.userData.groomIndicesPerStrand as number));
      };
      for (const mesh of meshes) drawn(mesh, density);
      children.forEach((pass, k) => { for (const mesh of pass) drawn(mesh, density - 1 - k); });
      uniforms.uGroomStack.value = 1 / Math.min(1, density);
    },
    get density() { return density; },
  };
}

// The lids' strands take their colour from the face texture under them - the tabby's dark stripes and the muzzle's
// white side by side. Open, the lid hides them; closed, they lay round the eye as rings of dark and light bands, a
// striped pad under the lash line. Each lid's coat is drawn this much of the way to its own average (point by point,
// root to tip); the shader's per-strand melanin keeps it from going flat.
const LID_COLOUR_EVENING = 0.75;
function evened(colors: Float32Array, points: number, share: number): Float32Array {
  const strands = colors.length / (points * 3);
  const mean = new Float64Array(points * 3);
  for (let i = 0; i < colors.length; i++) mean[i % (points * 3)] += colors[i] / strands;
  const out = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i++) out[i] = colors[i] + (mean[i % (points * 3)] - colors[i]) * share;
  return out;
}

/**
 * A part's typical distance between neighbouring roots (model units): the surface its roots cover, from the cells of a
 * grid they fall in, shared between them.
 */
function rootSpacing(source: Float32Array, strands: number, points: number): number {
  if (strands < 2) return 1e-3;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let s = 0; s < strands; s++) for (let c = 0; c < 3; c++) {
    const v = source[s * points * 3 + c];
    lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v);
  }
  // cells a few spacings across: fine enough to follow the surface, coarse enough that each holds several roots
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-4);
  let cell = extent / 8;
  for (let pass = 0; pass < 6; pass++) {
    const occupied = new Set<string>();
    for (let s = 0; s < strands; s++) {
      const r = s * points * 3;
      occupied.add(`${Math.floor((source[r] - lo[0]) / cell)},${Math.floor((source[r + 1] - lo[1]) / cell)},${Math.floor((source[r + 2] - lo[2]) / cell)}`);
    }
    const perCell = strands / occupied.size;
    if (perCell < 12 || pass === 5) return Math.max(1e-5, Math.sqrt((occupied.size * cell * cell) / strands));
    cell /= 2;
  }
  return 1e-3;
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
