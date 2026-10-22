import * as THREE from 'three';
import { neckStrandScale } from './realistic-neck.ts';

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
// Fur grows in clumps: the tips of neighbouring hairs gather, so the coat reads as locks and partings rather than a
// comb of parallel lines - and a sparse layer of longer guard hairs stands over the dense down ("没有细毛和长毛的错综复杂
// 的感觉"). strength: how far a tip is drawn toward its clump's centre; cell: a clump's size, in the part's root
// spacings; guard: the share of strands that are guard hairs; guardExtra: how much longer they are.
export const CLUMP = { strength: 0.7, cell: 3.0, guard: 0.06, guardExtra: 0.45 };
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
  // How far a tip trails the body's motion (see the coat's inertia in createGroom): this share of where it would be
  // with the skeleton's sprung copy, at most this share of the strand's length.
  lagGain: '0.9', lagMax: '0.75',
  // the narrowest a strand is drawn (half-width, device pixels): thinner, a small cat's coat was a faint haze over the
  // undercoat; drawn this wide (with less coverage, see coverageExp) the strands read as fur
  minimumWidthPx: '0.5',
  // A child hair (see GROOM_CHILDREN) grows this far from its parent, in the parent's spacing (its part's average
  // distance between roots), and ends between these shares of its parent's length.
  childSpread: '0.7', childShortest: '0.62',
  // A real hair thins to a point and lets light through its last third, so a coat's edge is a soft halo; drawn the same
  // width and opacity to the end, straight, the strands read as wire. Taper: the radius lost by the tip; tipFade: the
  // opacity lost over the outer half; wave: a lateral wave along the strand (share of its length, at the tip), waveFreq
  // cycles of it; tipLight: the tip's lift toward a paler, warmer shade.
  taper: '0.45', tipFade: '0.5', wave: '0.07', waveFreq: '1.6', tipLight: '0.3',
} as const;
// Close up the coat gets denser rather than coarser: each drawn strand gains up to this many child hairs beside it, the
// way an offline groom interpolates children between its guides - fine single hairs, a parent's copy moved a little
// across the skin and ending at its own length. (A strand widened into a lock of three hairs had been tried: close up it
// read as yarn, parallel threads in a ribbon.) Drawn only once the cat is big on screen (setDensity above 1), this many
// more for each step of density past it - on the face's coat only (CHILD_PASSES): a close-up (kiss-rush, angry-claw: the
// cat taller than the window) is the face, and passes over the whole coat cost it its frame rate - 17 fps with none, 6
// with four everywhere, 12 with these, which look as dense.
export const GROOM_CHILDREN = 4;
const CHILDREN_PER_DENSITY = 1;
const CHILD_PASSES = /_LX_(Head|NoseVelvet|EarOuter)/;
// ...and close up each strand is drawn as though this many more overlapped it (up to `extra`, from density `from` to
// `full`): at its own coverage a zoomed-in coat let the painted undercoat through - a thin veil of hairs over a smooth
// head (the user: "头上的毛有点透明的感觉…放大非常难看"). Small, the stack already makes up for the strands left out
// (setDensity).
const CLOSE_STACK = { extra: 1, from: 1, full: 2 };
// The first time a pass of child hairs was drawn - the cat coming close, mid-performance - the frame took seconds (2.7-21
// s in WebKit; the same zoom again later, a few milliseconds): kiss-rush froze as the cat reached the viewer. So every
// pass draws one strand for the first few frames after loading, and the cost is paid there (load time unchanged).
const WARM_FRAMES = 3;
// The coat's inertia (simulate): Hz, damping ratio, and a jump (model units) that is a teleport, not a motion
const GROOM_LAG = { shortHz: 4.5, shortDamping: 0.8, longHz: 1.8, longDamping: 0.48, snapDistance: 1.5 };
// Only the exported guard hairs get free tips. The shorter skin-close fibres are carried by the live skeleton.
const GROOM_FLEX = { short: 0.015, long: 0.065, slowFrom: 0.48, gravity: 0.24 };
// The coat a touch shorter than the Blender groom (the tail its own): longer (1.15-1.25, tried to make
// the coat read at desktop size) the strands stood out one by one, long and sparse; shorter and drawn denser (the
// renderer's GROOM_MIN_DENSITY) it is a thick, soft coat. At .95 it was still too long and too few (the user, by eye on
// the desktop): frizzy at the outline, single hairs standing off the back; .85 and drawn denser it is a close, soft coat
// that shows the tabby crisply. The face keeps a little more (FACE_LENGTH): its fluff is the kitten's round cheeks.
const COAT_LENGTH = 0.85;
const FACE_LENGTH = 0.9;
const FACE = /_LX_Head$/;
// The tail's own coat: shorter than groomed. At its groomed length (kept when the body's grew) it was a bottle brush
// twice the kitten's body thickness; a kitten's tail is slim, its fur short and soft.
const TAIL_LENGTH = 0.62;
const TAIL = /_LX_(Tail|TailTip)/;
/** How much of its groomed length a part's strands keep (see COAT_LENGTH). */
export function coatLength(partName: string) {
  return TAIL.test(partName) ? TAIL_LENGTH : FACE.test(partName) ? FACE_LENGTH : COAT_LENGTH;
}
// The lids' own strands (groom.bin's _LX_Lid parts) are not drawn. Rooted in rows across a lid a centimetre wide, they
// drew a closed eye as rings of bands; widened, veiled and shaded even to hide that, as a pale felt pad; as plain fine
// hairs, as stripes again. A closed lid is its skin and short undercoat in the face's colour (the renderer's lidCoat),
// with the face's coat combed in over its edge (EYE_LEAN).
const LIDS = /_LX_Lid/;
// A closed eye's lids were a pad with an edge round it: the face's coat stopped at the eye's rim, where its strands
// (some 20 mm long there) are groomed away from the eye. Closing, the face's coat round the eye is combed in over the
// lids instead - each strand laid from its root toward the eye's middle, along the closed lid's dome - leaving the lash
// line between. Strands rooted within `near` of the eye's axis go all the way, fading out by `far`, only on the face's
// front (`depth` in front of the eye's centre, back to minus this); laid over this share of their length, never under
// the shut lid (LID_DOME) and this far above it (model units). `shut`: how much each of the upper lid's keys closes the
// eye; followed over `settle` seconds and from `from` shut on, so a blink leaves the coat alone (the fur round the eye
// twitched with every one) and a sleeping, slow-blinking or petted cat's closed eye gets it.
const EYE_LEAN = {
  near: 0.056, far: 0.072, depth: 0.012, comb: 0.9, lift: 0.0015,
  shut: { Blink: 1, Smile: 0.5, Squint: 0.25 }, settle: 0.35, from: 0.45,
};
// A closed eye sat in a hollow (lids.glb, Blink on): its lids 24.5 mm in front of the eye's centre on its axis but only
// 7-8 mm at their edge, 40-48 mm off it, where the face round them stands at 17-24 mm - the hollow's wall was the hard
// edge round a closed eye, a pad sunk in the face. Shut, the lids are lifted onto this dome instead: `crown` in front of
// the eye's centre on its axis, falling to `edge` (level with the face) at `rim` off it, lifted no more from `rim` to
// `fade` (where LID_TUCK has them gone). On the Blink key only (the renderer's raiseShutLid): an open eye is untouched,
// and a closing lid rises onto the dome as it shuts.
export const LID_DOME = { crown: 0.027, edge: 0.02, rim: 0.044, fade: 0.05 };
export interface EyeFrame { centre: readonly [number, number, number]; axis: readonly [number, number, number] }
/** How far out along the eye's axis a lid point, where it lies shut, is lifted onto LID_DOME (rest space). */
export function shutLidLift(x: number, y: number, z: number, eye: EyeFrame): number {
  const d = [x - eye.centre[0], y - eye.centre[1], z - eye.centre[2]];
  const al = Math.hypot(eye.axis[0], eye.axis[1], eye.axis[2]) || 1;
  const depth = (d[0] * eye.axis[0] + d[1] * eye.axis[1] + d[2] * eye.axis[2]) / al;
  const r = Math.sqrt(Math.max(0, d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - depth * depth));
  const dome = LID_DOME.crown - (LID_DOME.crown - LID_DOME.edge) * (r / LID_DOME.rim) ** 2;
  return Math.max(0, dome - depth) * (1 - THREE.MathUtils.smoothstep(r, LID_DOME.rim, LID_DOME.fade));
}

const GROOM_VERTEX = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 groomTangent;
attribute vec3 groomPawOffset; // short paw-fibre lift, applied after the exported curve's rest position
attribute vec3 groomBreath;    // the skin's Breath shape key under the strand's root (createGroom options.breath)
uniform float uGroomBreath;    // that key's influence this frame
attribute vec2 groomLean;      // a face strand round an eye: weight (negative round the left eye), its root's distance from the eye's axis
uniform vec3 uGroomEyeL, uGroomEyeR, uGroomEyeAxisL, uGroomEyeAxisR; // the eyes in the rest pose (createGroom options.eyes)
uniform vec2 uGroomShut;       // how closed each eye is (left, right)
attribute vec4 groomData;   // across -1/1, radius, root 0 -> tip 1 (squared), phase
attribute vec3 groomStrand; // length (model units), random 0..1, the part's root spacing
attribute float groomFlex;   // free-tip compliance, 0 for short/skin-close fibres
uniform float uGroomTime, uGroomHeight, uGroomGust;
uniform vec3 uGroomWind;    // tip bend, share of the strand's length, world axes
uniform vec4 uGroomStroke;  // pointer (NDC xy), radius (view units), bend
uniform vec2 uGroomStrokeDir;
uniform vec4 uGroomStrokeTrail; // delayed hand position and force: adjacent strands recover in sequence
uniform vec2 uGroomImpact; // landing impulse and seconds since contact
uniform float uGroomChild;  // 0 the strand itself, 1.. its child hairs
uniform vec3 uGroomClump;   // CLUMP: strength, cell (in root spacings), guard share
uniform highp sampler2D uGroomLagBones; // the skeleton's sprung copy, laid out as three's boneTexture
uniform highp sampler2D uGroomSlowBones;
mat4 groomLagMatrix(const in float i, const in bool soft) {
  int size = textureSize(uGroomLagBones, 0).x;
  int j = int(i) * 4;
  int x = j % size, y = j / size;
  if (soft) return mat4(texelFetch(uGroomSlowBones, ivec2(x, y), 0), texelFetch(uGroomSlowBones, ivec2(x + 1, y), 0),
    texelFetch(uGroomSlowBones, ivec2(x + 2, y), 0), texelFetch(uGroomSlowBones, ivec2(x + 3, y), 0));
  return mat4(texelFetch(uGroomLagBones, ivec2(x, y), 0), texelFetch(uGroomLagBones, ivec2(x + 1, y), 0),
    texelFetch(uGroomLagBones, ivec2(x + 2, y), 0), texelFetch(uGroomLagBones, ivec2(x + 3, y), 0));
}
varying float vGroomEdge, vGroomCoverage, vGroomAlong, vGroomRandom, vGroomShadow, vGroomChildEnd;
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
  float spacing = groomStrand.z, random = groomStrand.y;
  vGroomChildEnd = 2.0;
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
  transformed += groomPawOffset + groomBreath * uGroomBreath;
  // Clumps and guard hairs (CLUMP), in the rest pose so they ride the body. Not round the eyes (groomLean).
  if (groomLean.x == 0.0 && groomStrand.x > 0.0) {
    float tc = sqrt(groomData.z);
    vec3 dir = normalize(groomTangent + vec3(1e-6));
    vec3 root = transformed - dir * groomStrand.x * tc;
    float cellSize = spacing * uGroomClump.y;
    vec3 cell = floor(root / cellSize);
    vec3 jitter = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
    vec3 toCentre = (cell + 0.2 + 0.6 * jitter) * cellSize - root;
    toCentre -= normal * dot(toCentre, normal);
    float pull = uGroomClump.x * (0.55 + 0.45 * jitter.x);
    transformed += toCentre * pull * smoothstep(0.15, 1.0, tc);
    // a few long guard hairs over the down, standing a little further off the coat
    if (fract(random * 13.37) < uGroomClump.z) {
      transformed += (dir + normal * 0.25) * groomStrand.x * ${CLUMP.guardExtra} * tc * tc;
    }
  }
  // the face's coat round a closing eye combed in over its lids (EYE_LEAN)
  vec3 groomT = groomTangent;
  if (groomLean.x != 0.0) {
    bool left = groomLean.x < 0.0;
    float shut = (left ? uGroomShut.x : uGroomShut.y) * abs(groomLean.x);
    if (shut > 0.001) {
      vec3 eye = left ? uGroomEyeL : uGroomEyeR, axis = left ? uGroomEyeAxisL : uGroomEyeAxisR;
      vec3 d = transformed - eye;
      float depth = dot(d, axis);
      vec3 across = d - axis * depth;
      float r = max(length(across), 1e-5);
      vec3 inward = -across / r;
      float laid = max(0.0, groomLean.y - groomStrand.x * sqrt(groomData.z) * ${EYE_LEAN.comb});
      float r2 = mix(r, laid, shut);
      // over the eye: across the hollow at the face's height, never into the shut lid's dome
      float dome = ${LID_DOME.crown} - ${LID_DOME.crown - LID_DOME.edge} * (r2 / ${LID_DOME.rim}) * (r2 / ${LID_DOME.rim}) + ${EYE_LEAN.lift};
      float depth2 = r2 < ${LID_DOME.rim} ? max(depth, mix(depth, dome, shut)) : depth;
      transformed = eye + axis * depth2 - inward * r2;
      groomT = mix(groomTangent, inward * length(groomTangent), shut);
    }
  }
  vec3 groomRest = transformed;
  vGroomRest = groomRest;
  #include <skinning_vertex>
  // where this point would be on the sprung skeleton: the coat's inertia, in object space. By the point's main bone only
  // (its first, heaviest weight): the lag hardly differs between the bones a point blends, and four lagged matrices a
  // vertex - sixteen texture reads, on millions of strand vertices - cost the small desktop cat a third of its frame
  vec3 lagDelta = vec3(0.0);
  #ifdef USE_SKINNING
    if (groomFlex > 0.02) {
      vec4 restSkin = bindMatrix * vec4(groomRest, 1.0);
      lagDelta = (bindMatrixInverse * ((groomLagMatrix(skinIndex.x, groomFlex > ${GROOM_FLEX.slowFrom}) - boneMatX) * restSkin)).xyz;
    }
  #endif
  vec3 hairTangent = groomT;
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
  bend *= (0.18 + 0.82 * groomFlex) * (1.0 + uGroomGust * 0.55 * wave + 0.12 * flutter);
  bend += cross(N, bend) * 0.25 * flutter * groomFlex;
  // Gravity is in world space, so the same free tip hangs down when the cat rolls over.
  vec3 down = normalize((viewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
  bend += down * (${GROOM_FLEX.gravity} * groomFlex * groomFlex);
  // a hand through the coat: the strands under the pointer go along with it, lifting a little
  vec2 fromPointer = (projectionMatrix * mvPosition).xy - uGroomStroke.xy;
  fromPointer /= vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  vec2 fromTrail = (projectionMatrix * mvPosition).xy - uGroomStrokeTrail.xy;
  fromTrail /= vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float touch = 0.65 * uGroomStroke.w * exp(-dot(fromPointer, fromPointer) / max(1e-6, uGroomStroke.z * uGroomStroke.z));
  touch += 0.45 * uGroomStrokeTrail.w * exp(-dot(fromTrail, fromTrail) / max(1e-6, uGroomStrokeTrail.z * uGroomStrokeTrail.z));
  vec3 hand = normalize(vec3(uGroomStrokeDir, 0.0));
  float against = max(0.0, -dot(T, hand));
  // Along the lay: comb toward the skin. Against it: the free tips turn out before springing back.
  bend += (hand - N * dot(hand, N)) * touch * (0.3 + 0.7 * groomFlex);
  bend += N * touch * groomFlex * (0.05 + 0.45 * against);
  // the body's own motion: the tip trails where the sprung skeleton still has it, swings past when it stops
  vec3 lagView = mat3(modelViewMatrix) * lagDelta * ${GROOM.lagGain} * groomFlex;
  float lagLength = length(lagView), lagMost = ${GROOM.lagMax} * strandLength;
  if (lagLength > lagMost) lagView *= lagMost / lagLength;
  bend += lagView / max(strandLength, 1e-6);
  // Contact shock travels through the loose chest/belly/tail tips and damps before the next step.
  float jolt = uGroomImpact.x * sin(uGroomImpact.y * mix(16.0, 8.0, groomFlex) + groomData.w * 0.18);
  bend += (down + cross(N, down) * 0.3) * jolt * groomFlex;
  bend -= N * min(0.0, dot(bend, N));
  // slow breathing of the coat, so a still cat's fur is never frozen
  bend += vec3(sin(uGroomTime * 1.7 + groomData.w), 0.25 * sin(uGroomTime * 1.3 + groomData.w), 0.45 * cos(uGroomTime * 1.5 + groomData.w)) * (0.003 + 0.009 * groomFlex);
  float bendSize = length(bend);
  if (bendSize > 0.9) bend *= 0.9 / bendSize;
  vec3 tipShift = bend * strandLength;
  // the tip moves along an arc, not out of the strand's length: what it gains sideways it loses along the strand
  vec3 shiftView = tipShift * along - T * (dot(tipShift, tipShift) / max(1e-6, 2.0 * strandLength)) * along * along;
  // Arc shortening can otherwise pull a heavily bent strand under its own opaque skin.
  shiftView -= N * min(0.0, dot(shiftView, N));
  mvPosition.xyz += shiftView;
  T = normalize(T * strandLength + 2.0 * t * tipShift);

  vGroomT = T;
  vGroomColor = vColor.rgb;
  vGroomN = N;
  vGroomAlong = along;
  vGroomRandom = random;
  vec2 across = vec2(-T.y, T.x);
  across = length(across) > 0.0001 ? normalize(across) : vec2(1.0, 0.0);
  float radiusView = groomData.y * viewScale * (1.0 - ${GROOM.taper} * along);
  float pixelsPerView = projectionMatrix[1][1] * uGroomHeight * 0.5;
  float minimumRadius = ${GROOM.minimumWidthPx} / pixelsPerView;
  float drawnRadius = max(radiusView, minimumRadius);
  // A strand drawn wider than it is covers that much less of each pixel it touches.
  vGroomCoverage = pow(min(1.0, radiusView / drawnRadius), ${GROOM.coverageExp});
  vGroomEdge = groomData.x;
  mvPosition.xy += across * groomData.x * drawnRadius;
  // a lateral wave toward the tip, its phase the strand's own
  mvPosition.xy += across * sin(t * ${GROOM.waveFreq} * 6.2831853 + random * 6.2831853) * ${GROOM.wave} * strandLength * t;
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
varying float vGroomEdge, vGroomCoverage, vGroomAlong, vGroomRandom, vGroomShadow, vGroomChildEnd;
varying vec3 vGroomT, vGroomN, vGroomColor, vGroomRest;
${part}
float hairLobe(vec3 T, vec3 H, float e) { float d = dot(T, H); return pow(sqrt(max(0.0, 1.0 - d * d)), e); }
void main() {
  float alpha = vGroomCoverage * (1.0 - smoothstep(0.65, 1.0, abs(vGroomEdge)));
  // a child hair ends at its own length
  alpha *= 1.0 - smoothstep(vGroomChildEnd - 0.12, vGroomChildEnd, sqrt(vGroomAlong));
  // each strand drawn stands for uGroomStack of them (see setDensity): the opacity of that many overlapping
  alpha = 1.0 - pow(1.0 - min(alpha, 0.999), uGroomStack);
  vec3 base = pow(max(vGroomColor, vec3(1e-4)), vec3(${GROOM.absorption}));
  base *= 1.0 + ${GROOM.melanin} * (vGroomRandom - 0.5);
  // the coat grade the undercoat and skin get (COAT_GRADE), so strands do not veil them in another shade
  float lumC = dot(base, vec3(0.2126, 0.7152, 0.0722));
  base = max(mix(vec3(lumC), base, 1.25) * vec3(1.06, 1.0, 0.90), 0.0);
  // along the strand, root to tip - the lids' coat too (held even from root to tip, as it once was against rings round a
  // closed eye, it was a flat felt pad: see LID_STRAND_WIDTH)
  float t = sqrt(vGroomAlong);
  // the root rises out of the undercoat: drawn from inside it, a strand's dark root showed as a speck (most of all
  // at desktop size, where each drawn strand stands for several)
  alpha *= smoothstep(0.0, 0.3, t);
  alpha *= 1.0 - ${GROOM.tipFade} * smoothstep(0.5, 1.0, t);
  base = mix(base, min(base * 1.22 + 0.03, vec3(1.0)), ${GROOM.tipLight} * t * t);
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
export function createGroom(asset: GroomAsset, base: THREE.SkinnedMesh, root: THREE.Object3D = base.parent!, options: {
  part?: string;
  /** The Breath shape key's offset at a rest-pose point (the skin under a strand's root), or null where it has none. */
  breath?: (x: number, y: number, z: number) => readonly [number, number, number] | null;
  /** The eyes in the rest pose, left then right: their centres and the way they look (see EYE_LEAN). */
  eyes?: readonly EyeFrame[];
  /** Rest-pose proximity to the shoulder, shared with the head's solid undercoat. */
  neckBlend?: (x: number, y: number, z: number) => number;
} = {}) {
  const uniforms = {
    uGroomClump: { value: new THREE.Vector3(CLUMP.strength, CLUMP.cell, CLUMP.guard) },
    uGroomTime: { value: 0 }, uGroomHeight: { value: 1 }, uGroomStack: { value: 1 }, uGroomGust: { value: 0 },
    uGroomWind: { value: new THREE.Vector3() }, uGroomStroke: { value: new THREE.Vector4() }, uGroomStrokeDir: { value: new THREE.Vector2(1, 0) },
    uGroomStrokeTrail: { value: new THREE.Vector4() }, uGroomImpact: { value: new THREE.Vector2() },
    uGroomChild: { value: 0 },
    uGroomLagBones: { value: null as THREE.DataTexture | null },
    uGroomSlowBones: { value: null as THREE.DataTexture | null },
    uGroomBreath: { value: 0 },
    uGroomEyeL: { value: new THREE.Vector3() }, uGroomEyeR: { value: new THREE.Vector3() },
    uGroomEyeAxisL: { value: new THREE.Vector3(0, 0, 1) }, uGroomEyeAxisR: { value: new THREE.Vector3(0, 0, 1) },
    uGroomShut: { value: new THREE.Vector2() },
  };
  const eyes = options.eyes?.length === 2 ? options.eyes : null;
  if (eyes) {
    uniforms.uGroomEyeL.value.fromArray(eyes[0].centre); uniforms.uGroomEyeR.value.fromArray(eyes[1].centre);
    uniforms.uGroomEyeAxisL.value.fromArray(eyes[0].axis).normalize(); uniforms.uGroomEyeAxisR.value.fromArray(eyes[1].axis).normalize();
  }
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
  Object.assign(material.defaultAttributeValues, { groomPawOffset: [0, 0, 0], groomBreath: [0, 0, 0], groomLean: [0, 0] });
  // merge() cloned the values: keep the material's own uniform objects as the ones update() writes
  Object.assign(uniforms, Object.fromEntries(Object.keys(uniforms).map((k) => [k, material.uniforms[k]])));
  const boneIndex = new Map(base.skeleton.bones.map((b, i) => [(b.userData.name as string | undefined) ?? b.name, i]));
  const jointMap = asset.spec.jointNames.map((name) => {
    const index = boneIndex.get(name);
    if (index == null) throw new Error(`Groom joint missing: ${name}`);
    return index;
  });
  const floats = (b: Block) => new Float32Array(asset.bytes, b.offset, b.count);
  // the upper lids' shape keys, for how closed each eye is (EYE_LEAN)
  const shutters: { left: boolean; influences: number[]; keys: Record<string, number> }[] = [];
  root.traverse((o) => {
    const upper = /^LX_LidUpper\.([LR])$/.exec(((o.userData.name as string | undefined) ?? '') as string);
    const lid = o as THREE.Mesh;
    if (upper && lid.morphTargetInfluences && lid.morphTargetDictionary) shutters.push({ left: upper[1] === 'L', influences: lid.morphTargetInfluences, keys: lid.morphTargetDictionary });
  });
  const eyeShut = [0, 0];
  const meshes = asset.spec.parts.filter((part) => !LIDS.test(part.name)).map((part) => {
    const source = floats(part.positions), radii = floats(part.radii);
    const colors = floats(part.colors);
    const normals = floats(part.normals), weights = floats(part.weights);
    const joints = new Uint16Array(asset.bytes, part.joints.offset, part.joints.count);
    const count = part.strands * part.points * 2;
    const pawCoat = /_LX_(Body|Legs)$/.test(part.name);
    const position = new Float32Array(count * 3), color = new Float32Array(count * 3), normal = new Float32Array(count * 3);
    const tangent = new Float32Array(count * 3), pawOffset = pawCoat ? new Float32Array(count * 3) : null;
    // Strands in a shuffled order, so any leading run of them (setDensity's draw range) is an even sample of the part.
    const order = shuffledOrder(part.strands);
    // the skin's breathing under each strand's root: the whole strand rides it, as it rides the bones
    let breath: Float32Array | null = null;
    if (options.breath) {
      const roots = Array.from({ length: part.strands }, (_, s) => options.breath!(source[s * part.points * 3], source[s * part.points * 3 + 1], source[s * part.points * 3 + 2]));
      if (roots.some((d) => d && (d[0] || d[1] || d[2]))) {
        breath = new Float32Array(count * 3);
        for (let slot = 0; slot < part.strands; slot++) {
          const d = roots[order[slot]];
          if (d) for (let k = 0; k < part.points * 2; k++) breath.set(d, ((slot * part.points * 2) + k) * 3);
        }
      }
    }
    // the face's strands round each eye (EYE_LEAN): which eye, how much, and how far out their roots are
    let lean: Float32Array | null = null;
    if (eyes && FACE.test(part.name)) {
      lean = new Float32Array(count * 2);
      for (let slot = 0; slot < part.strands; slot++) {
        const root = order[slot] * part.points * 3;
        let best: [number, number] | null = null;
        eyes.forEach((eye, k) => {
          const d = [0, 1, 2].map((c) => source[root + c] - eye.centre[c]);
          const al = Math.hypot(...eye.axis);
          const depth = (d[0] * eye.axis[0] + d[1] * eye.axis[1] + d[2] * eye.axis[2]) / al;
          const r = Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - depth * depth));
          const weight = depth < -EYE_LEAN.depth ? 0 : 1 - THREE.MathUtils.smoothstep(r, EYE_LEAN.near, EYE_LEAN.far);
          if (weight > 0 && (!best || Math.abs(best[0]) < weight)) best = [k === 0 ? -weight : weight, r];
        });
        if (best) for (let k = 0; k < part.points * 2; k++) lean.set(best, ((slot * part.points * 2) + k) * 2);
      }
    }
    const data = new Float32Array(count * 4), strandData = new Float32Array(count * 3), flexData = new Float32Array(count);
    const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
    const indices = new Uint32Array(part.strands * (part.points - 1) * 6);
    const pawLength = part.name.includes('_under_') ? 0.006 : 0.012;
    const spacing = rootSpacing(source, part.strands, part.points);
    const shorten = coatLength(part.name);
    const headCoat = FACE.test(part.name);
    const guard = part.name.startsWith('LX_Fur_guard_');
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
      const root = strand * part.points * 3;
      // The exported lower rear cheek guards are longer than the shoulder's coat. Ease their tips into the shoulder
      // where the two skins actually meet, keeping the free round muzzle and all strand roots in their original place.
      const strandShorten = shorten * (headCoat && options.neckBlend
        ? neckStrandScale(options.neckBlend(source[root], source[root + 1], source[root + 2]), guard) : 1);
      // The exported paw curves are only 2-6 mm long, shorter than the body's opaque undercoat. Let their tips clear
      // that layer without lengthening the already groomed ankle. Leave downward-facing sole fibres and pads alone.
      const paw = pawCoat
        ? (1 - THREE.MathUtils.smoothstep(source[root + 1], 0.055, 0.13))
          * THREE.MathUtils.smoothstep(normals[strand * 3 + 1], -0.65, -0.2)
        : 0;
      const pawExtension = paw * Math.max(0, pawLength - strandLength * strandShorten);
      const pawScale = pawExtension / Math.max(strandLength, 1e-6);
      strandLength = strandLength * strandShorten + pawExtension;
      const flex = guard ? THREE.MathUtils.smoothstep(strandLength, GROOM_FLEX.short, GROOM_FLEX.long) : 0;
      for (let point = 0; point < part.points; point++) {
        const p = strand * part.points + point;
        const before = (strand * part.points + Math.max(0, point - 1)) * 3;
        const after = (strand * part.points + Math.min(part.points - 1, point + 1)) * 3;
        const out = slot * part.points + point;
        for (let side = 0; side < 2; side++) {
          const v = out * 2 + side;
          for (let c = 0; c < 3; c++) {
            position[v * 3 + c] = source[root + c] + (source[p * 3 + c] - source[root + c]) * strandShorten;
            if (pawOffset) pawOffset[v * 3 + c] = (source[p * 3 + c] - source[root + c]) * pawScale;
            color[v * 3 + c] = colors[p * 3 + c];
            normal[v * 3 + c] = normals[strand * 3 + c];
            tangent[v * 3 + c] = source[after + c] - source[before + c];
          }
          data.set([side ? 1 : -1, radii[p] * part.widthCompensation, (point / (part.points - 1)) ** 2, phase], v * 4);
          strandData.set([strandLength, random, spacing], v * 3);
          flexData[v] = flex;
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
      ['groomData', data, 4], ['groomStrand', strandData, 3], ['groomFlex', flexData, 1],
      ['skinIndex', skinIndex, 4], ['skinWeight', skinWeight, 4],
    ] as const) geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    if (pawOffset) geometry.setAttribute('groomPawOffset', new THREE.BufferAttribute(pawOffset, 3));
    if (breath) geometry.setAttribute('groomBreath', new THREE.BufferAttribute(breath, 3));
    if (lean) geometry.setAttribute('groomLean', new THREE.BufferAttribute(lean, 2));
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
      // drawn a strand each for the first frames (see WARM_FRAMES), then hidden until setDensity asks for them
      child.geometry.setDrawRange(0, parent.userData.groomIndicesPerStrand as number);
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
  const lagMatrices = [new Float32Array(lagSize * lagSize * 4), new Float32Array(lagSize * lagSize * 4)];
  // The copy is sprung in a frame that turns with the cat (the armature's rotation), not the world's. Sprung in the world, the cat turning
  // round - its whole body swinging through half a circle in a few frames - flung every strand on it at once: for a
  // tenth of a second the coat stood off the body, thinned to the undercoat, and a leg flashed bare ("右前腿我觉得走路
  // 的时候偶尔会闪一下"). A real coat does not do that when a kitten turns; it follows what moves under it.
  const lagRelative = [new Float32Array(boneCount * 16), new Float32Array(boneCount * 16)];
  const lagVelocity = [new Float32Array(boneCount * 16), new Float32Array(boneCount * 16)];
  const frame = new THREE.Matrix4(), frameInverse = new THREE.Matrix4(), lagWorld = new THREE.Matrix4();
  const lagTextures = lagMatrices.map((data) => new THREE.DataTexture(data, lagSize, lagSize, THREE.RGBAFormat, THREE.FloatType));
  lagTextures.forEach((texture) => { texture.needsUpdate = true; });
  material.uniforms.uGroomLagBones.value = lagTextures[0];
  material.uniforms.uGroomSlowBones.value = lagTextures[1];
  const offsetMatrix = new THREE.Matrix4();
  const target = new Float32Array(16);
  let lagPrimed = false;
  let impactStrength = 0, impactAge = 0;
  let trailTime = 0, trailStrength = 0;
  const springs = [[GROOM_LAG.shortHz, GROOM_LAG.shortDamping], [GROOM_LAG.longHz, GROOM_LAG.longDamping]];
  function simulate(seconds: number) {
    if (warming > 0 && --warming === 0) applyDensity();
    if (eyes) {
      const shut = [0, 0];
      for (const s of shutters) {
        let v = 0;
        for (const [key, share] of Object.entries(EYE_LEAN.shut)) v += (s.influences[s.keys[key] ?? -1] ?? 0) * share;
        shut[s.left ? 0 : 1] = Math.max(shut[s.left ? 0 : 1], Math.min(1, v));
      }
      const k = 1 - Math.exp(-Math.max(0, seconds) / EYE_LEAN.settle);
      for (let i = 0; i < 2; i++) eyeShut[i] += (shut[i] - eyeShut[i]) * k;
      const lean = (v: number) => THREE.MathUtils.smoothstep(v, EYE_LEAN.from, 1);
      uniforms.uGroomShut.value.set(lean(eyeShut[0]), lean(eyeShut[1]));
    }
    // a jump (the first frame, a long stall, a teleport) starts the copy where the skeleton is
    const snap = !lagPrimed || seconds > 0.25;
    const steps = Math.max(1, Math.ceil(seconds * 240));
    const dt = seconds / steps;
    const armature = skeleton.bones[0].parent;
    // its turning only: where it walks to still trails the coat behind it
    frame.extractRotation(armature ? armature.matrixWorld : base.matrixWorld);
    frameInverse.copy(frame).transpose();
    for (let i = 0; i < boneCount; i++) {
      offsetMatrix.multiplyMatrices(skeleton.bones[i].matrixWorld, skeleton.boneInverses[i]).premultiply(frameInverse).toArray(target);
      const o = i * 16;
      for (let layer = 0; layer < 2; layer++) {
        const relative = lagRelative[layer], velocity = lagVelocity[layer];
        const far = Math.hypot(target[12] - relative[o + 12], target[13] - relative[o + 13], target[14] - relative[o + 14]) > GROOM_LAG.snapDistance;
        if (snap || far) {
          relative.set(target, o);
          velocity.fill(0, o, o + 16);
        } else {
          const w = 2 * Math.PI * springs[layer][0], zeta = springs[layer][1];
          for (let k = 0; k < 16; k++) {
            if (k % 4 === 3) continue; // the bottom row stays 0 0 0 1
            let x = relative[o + k], v = velocity[o + k];
            for (let n = 0; n < steps; n++) {
              v += ((target[k] - x) * w * w - 2 * zeta * w * v) * dt;
              x += v * dt;
            }
            relative[o + k] = x; velocity[o + k] = v;
          }
        }
        lagWorld.fromArray(relative, o).premultiply(frame).toArray(lagMatrices[layer], o);
      }
    }
    lagPrimed = true;
    lagTextures.forEach((texture) => { texture.needsUpdate = true; });
    impactAge += Math.max(0, seconds);
    impactStrength *= Math.exp(-Math.max(0, seconds) * 9);
    uniforms.uGroomImpact.value.set(impactStrength, impactAge);
  }
  let density = 1;
  function applyDensity() {
    const drawn = (mesh: THREE.Mesh, share: number) => {
      const total = mesh.userData.groomStrands as number, perStrand = mesh.userData.groomIndicesPerStrand as number;
      // still warming up: a strand of each, so its first draw is behind us (WARM_FRAMES)
      mesh.visible = share > 0 || warming > 0;
      mesh.geometry.setDrawRange(0, Math.max(1, Math.round(total * Math.min(1, Math.max(0, share)))) * perStrand);
    };
    for (const mesh of meshes) drawn(mesh, density);
    children.forEach((pass, k) => { for (const mesh of pass) drawn(mesh, CHILD_PASSES.test(mesh.name) ? (density - 1) * CHILDREN_PER_DENSITY - k : 0); });
    uniforms.uGroomStack.value = density < 1 ? 1 / density
      : 1 + CLOSE_STACK.extra * THREE.MathUtils.smoothstep(density, CLOSE_STACK.from, CLOSE_STACK.full);
  }
  let warming = WARM_FRAMES;
  return {
    /** Advance the coat's inertia; after the skeleton is posed for the frame (world matrices up to date). */
    simulate,
    dispose() { lagTextures.forEach((texture) => texture.dispose()); },
    /** A paw touching down sends a small decaying ripple through free tips. */
    impact(strength: number) { impactStrength = Math.max(impactStrength, Math.min(0.18, strength)); impactAge = 0; },
    /** the strands themselves, and (drawn only close up) their child hairs */
    meshes, children: children.flat(), material, materials: [material, ...childMaterials],
    /** How far the skin is breathing in this frame (its Breath shape key's influence): the strands rise and fall with it. */
    setBreath(influence: number) { uniforms.uGroomBreath.value = influence; },
    update(seconds: number, viewportHeight: number) {
      uniforms.uGroomTime.value = seconds;
      uniforms.uGroomHeight.value = viewportHeight;
    },
    /** The air (see realistic-wind.ts); the stroke already in NDC, its radius in view units. */
    setWind(wind: readonly [number, number, number], gust: number, stroke?: { x: number; y: number; radius: number; dx: number; dy: number; amount: number }) {
      uniforms.uGroomWind.value.set(wind[0], wind[1], wind[2]);
      uniforms.uGroomGust.value = gust;
      if (stroke) {
        const amount = Math.max(0, stroke.amount);
        const trail = uniforms.uGroomStrokeTrail.value;
        const dt = Math.min(0.05, Math.max(0, uniforms.uGroomTime.value - trailTime));
        if (trailStrength < 0.01) trail.set(stroke.x, stroke.y, stroke.radius, 0);
        const follow = 1 - Math.exp(-dt / 0.085);
        trail.x += (stroke.x - trail.x) * follow;
        trail.y += (stroke.y - trail.y) * follow;
        trail.z = stroke.radius;
        trailStrength += (amount - trailStrength) * (1 - Math.exp(-dt / 0.11));
        trail.w = trailStrength;
        trailTime = uniforms.uGroomTime.value;
        uniforms.uGroomStroke.value.set(stroke.x, stroke.y, stroke.radius, amount);
        uniforms.uGroomStrokeDir.value.set(stroke.dx, stroke.dy);
      } else { uniforms.uGroomStroke.value.w = 0; uniforms.uGroomStrokeTrail.value.w = trailStrength = 0; }
    },
    /**
     * Draw only this share of every part's strands, each standing for 1/share of them. Small on the desktop a cat is a
     * few hundred pixels across and 276k strands are far more than it has pixels - they cost ~95 ms a frame on an M4
     * (WebKit), the cat ran at ~10 fps - while a quarter of them, each as opaque as four overlapping, looks the same.
     * Above 1, all of them and that many more of their child hairs (1.5: every strand, and half of them a first child).
     */
    setDensity(share: number) {
      const next = THREE.MathUtils.clamp(share, 0.01, 1 + GROOM_CHILDREN / CHILDREN_PER_DENSITY);
      if (Math.abs(next - density) < 0.01) return;
      density = next;
      applyDensity();
    },
    get density() { return density; },
  };
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
