// Real-time preview of the v5 look-dev cat (assets/characters/lingxi/v5), for checking the
// clips in motion. The model is exported by scripts/blender/export_lingxi_v5_glb.py; the
// Cycles render uses ~500k curve hairs, which a browser cannot draw, so here the coat is
// SHELL fur: each skinned coat mesh is drawn N more times, pushed out along its (skinned)
// normal, and a 3D cell noise discards everything that is not inside a strand. Root dark,
// tip light, a little gravity. It is an approximation of the look, not of the Cycles render.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const CLIP_NAMES: Record<string, string> = {
  Idle: '待机', Walk: '走', Run: '跑', Jump: '跳', LieDown: '趴下', SideLie: '侧躺', Sleep: '睡觉',
  Curious: '好奇', Happy: '开心', Yawn: '打哈欠', Lick: '舔爪', Bite: '咬', Knead: '踩奶',
  Stretch: '伸懒腰', PawPlay: '扑',
};
// Coat meshes that get shells, and their strand length (m) and density (cells per m).
const FUR: Record<string, { len: number; den: number }> = {
  LX_Head: { len: 0.022, den: 520 },
  LX_Body: { len: 0.045, den: 380 },
  LX_Tail: { len: 0.060, den: 360 },
};

const stage = document.getElementById('stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xefe7dc);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0.9, 0.55, 1.55);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.3, -0.05);
controls.enableDamping = true;
controls.minDistance = 0.3;
controls.maxDistance = 6;

const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.position.set(-1.2, 2.2, 1.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -1;
key.shadow.camera.right = key.shadow.camera.top = 1;
key.shadow.radius = 8;
key.shadow.blurSamples = 16;
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new THREE.DirectionalLight(0xffe2cc, 1.6);
rim.position.set(0.4, 1.4, -1.8);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xfff6ec, 0xd9c7b4, 0.9));

const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------------------------------------
// Materials. The exporter writes Principled-BSDF approximations; the few that were procedural
// node trees in Blender (iris with its painted pupil, cornea, vertex-coloured skin) are
// rebuilt here by material name.
const PUPIL = 0.33;
function irisMaterial(src: THREE.MeshStandardMaterial) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.45, color: 0xffffff });
  if (!m.map) m.color.set(0x5a5a24);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPupil = { value: PUPIL };
    sh.fragmentShader = 'uniform float uPupil;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      #ifdef USE_MAP
        float irisD = distance(vMapUv, vec2(0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.085, 0.04), smoothstep(0.48, 0.50, irisD));
        diffuseColor.rgb = mix(vec3(0.003), diffuseColor.rgb, smoothstep(uPupil - 0.010, uPupil + 0.008, irisD));
      #endif`);
  };
  return m;
}
const corneaMat = new THREE.MeshPhysicalMaterial({
  // Only the reflection should show: a wet highlight, never a grey glass dome over the iris.
  color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.0,
  specularIntensity: 1, envMapIntensity: 0.9, depthWrite: false, premultipliedAlpha: true,
});

function shellMaterial(len: number, den: number, t: number) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShell = { value: t };
    sh.uniforms.uLen = { value: len };
    sh.uniforms.uDen = { value: den };
    m.userData.shader = sh;
    sh.vertexShader = 'uniform float uShell; uniform float uLen; attribute float furScale; varying vec3 vRest; varying float vScale;\n'
      + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vRest = position; vScale = furScale;')
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
          float h = uShell * uLen * furScale;
          transformed += normalize(objectNormal) * h;
          transformed.y -= 0.35 * h * uShell;   // strands sag a little toward the tip`);
    sh.fragmentShader = 'uniform float uShell; uniform float uDen; varying vec3 vRest; varying float vScale;\n'
      + 'float furHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
      + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec3 q = vRest * uDen;
          vec3 cell = floor(q);
          float strand = furHash(cell);
          float r = length(fract(q) - 0.5);
          // every strand has its own length; it thins toward the tip
          if (vScale < 0.02 || strand < uShell * 0.85 || r > 0.62 * (1.0 - uShell) + 0.06) discard;
          diffuseColor.rgb *= mix(0.62, 1.12, uShell);`);
  };
  m.customProgramCacheKey = () => 'fur-shell';
  return m;
}

// Per-vertex fur length scale: short around the eyes and on the nose/mouth so the face reads.
function furScaleAttribute(mesh: THREE.SkinnedMesh, bones: Record<string, THREE.Vector3>) {
  const pos = mesh.geometry.getAttribute('position');
  const out = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let s = 1;
    if (mesh.name === 'LX_Head') {
      for (const k of ['EyeL', 'EyeR']) {
        const e = bones[k];
        if (e) s = Math.min(s, THREE.MathUtils.clamp((v.distanceTo(e) - 0.036) / 0.03, 0, 1));
      }
      const n = bones['Nose'];
      if (n) s = Math.min(s, THREE.MathUtils.clamp((v.distanceTo(n) - 0.012) / 0.05, 0.25, 1));
    }
    out[i] = s;
  }
  mesh.geometry.setAttribute('furScale', new THREE.BufferAttribute(out, 1));
}

// ---------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
let mixer: THREE.AnimationMixer | null = null;
let actions: Record<string, THREE.AnimationAction> = {};
let current: THREE.AnimationAction | null = null;
let playing = true;
const shells: { mesh: THREE.SkinnedMesh; mat: THREE.MeshStandardMaterial; i: number; base: number }[] = [];
let skeletonHelper: THREE.SkeletonHelper | null = null;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

new GLTFLoader().load('/v5/lingxi-v5.glb', (gltf) => {
  document.getElementById('loading')!.remove();
  const root = gltf.scene;
  scene.add(root);
  const bonePos: Record<string, THREE.Vector3> = {};
  root.updateMatrixWorld(true);
  // GLTFLoader sanitises node names ('Eye.L' -> 'EyeL'), so look bones up without the dot.
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bonePos[o.name.replace(/[._]/g, '')] = o.getWorldPosition(new THREE.Vector3()); });

  const coat: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    const name = mat.name || '';
    if (name.includes('IrisLayer')) m.material = irisMaterial(mat);
    else if (name.includes('Cornea')) { m.material = corneaMat; m.castShadow = false; m.renderOrder = 2; }
    else if (m.geometry.getAttribute('color')) {
      m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: name.includes('Lid') ? 0.85 : 0.9, map: mat.map ?? null, side: THREE.DoubleSide });
    } else if (mat.isMaterial) { mat.side = THREE.DoubleSide; }
    const baseName = m.name.split('.')[0].replace(/_\d+$/, '');
    if ((m as THREE.SkinnedMesh).isSkinnedMesh && FUR[baseName]) coat.push(m as THREE.SkinnedMesh);
  });

  for (const base of coat) {
    const f = FUR[base.name.split('.')[0].replace(/_\d+$/, '')];
    furScaleAttribute(base, bonePos);
    for (let i = 1; i <= 32; i++) {
      const mat = shellMaterial(f.len, f.den, i / 32);
      const s = new THREE.SkinnedMesh(base.geometry, mat);
      s.bind(base.skeleton, base.bindMatrix);
      s.morphTargetInfluences = base.morphTargetInfluences;
      s.morphTargetDictionary = base.morphTargetDictionary;
      s.position.copy(base.position); s.quaternion.copy(base.quaternion); s.scale.copy(base.scale);
      s.frustumCulled = false;
      s.castShadow = false;
      base.parent!.add(s);
      shells.push({ mesh: s, mat, i, base: f.len });
    }
  }
  applyShells();

  mixer = new THREE.AnimationMixer(root);
  const box = document.getElementById('clips')!;
  const ordered = Object.keys(CLIP_NAMES).map((n) => gltf.animations.find((a) => a.name === n)).filter(Boolean) as THREE.AnimationClip[];
  for (const clip of [...ordered, ...gltf.animations.filter((a) => !CLIP_NAMES[a.name])]) {
    actions[clip.name] = mixer.clipAction(clip);
    const b = document.createElement('button');
    b.textContent = CLIP_NAMES[clip.name] ?? clip.name;
    b.dataset.clip = clip.name;
    b.onclick = () => play(clip.name);
    box.appendChild(b);
  }
  skeletonHelper = new THREE.SkeletonHelper(root);
  skeletonHelper.visible = false;
  scene.add(skeletonHelper);
  const q = new URLSearchParams(location.search);
  play(q.get('clip') && actions[q.get('clip')!] ? q.get('clip')! : (actions.Idle ? 'Idle' : Object.keys(actions)[0]));
  if (q.has('t') && current) {
    playing = false; $('play').textContent = '播放';
    current.time = Number(q.get('t')) * current.getClip().duration; mixer.update(0);
  }
  const cams: Record<string, [number, number, number]> = { front: [0, 0.45, 1.7], side: [1.8, 0.45, 0], q34: [0.9, 0.55, 1.55], face: [0, 0.5, 0.75], back: [-0.6, 0.6, -1.6] };
  const c = cams[q.get('cam') ?? ''];
  if (c) camera.position.set(...c);
  if (q.get('cam') === 'face') controls.target.set(0, 0.44, -0.25);
  status();
}, (e) => {
  const el = document.getElementById('loading');
  if (el && e.total) el.textContent = `正在加载模型… ${Math.round((e.loaded / e.total) * 100)}%`;
}, (err) => {
  document.getElementById('loading')!.textContent = '模型加载失败：请先运行 scripts/blender/export_lingxi_v5_glb.py 导出 apps/lingxi/public/v5/lingxi-v5.glb';
  console.error(err);
});

function play(name: string) {
  const next = actions[name];
  if (!next) return;
  next.reset();
  next.setLoop($('loop').checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  next.clampWhenFinished = true;
  next.play();
  if (current && current !== next) current.crossFadeTo(next, 0.25, false);
  current = next;
  document.querySelectorAll<HTMLButtonElement>('#clips button').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
  status();
}

function applyShells() {
  const n = Number($('shells').value);
  const k = Number($('furlen').value);
  for (const s of shells) {
    s.mesh.visible = n > 0 && s.i % Math.max(1, Math.round(32 / Math.max(n, 1))) === 0;
    const sh = s.mat.userData.shader;
    if (sh) sh.uniforms.uLen.value = s.base * k;
    s.mat.userData.len = s.base * k;
  }
  $('shellsv').value = String(n);
  $('furlenv').value = k.toFixed(1);
}
function status() {
  const el = document.getElementById('status')!;
  if (!current) return;
  const clip = current.getClip();
  el.textContent = `动作：${CLIP_NAMES[clip.name] ?? clip.name}（${clip.name}）\n时长：${clip.duration.toFixed(2)} s · 共 ${Object.keys(actions).length} 个动作`;
}

$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '暂停' : '播放'; };
$('speed').oninput = () => { $('speedv').value = Number($('speed').value).toFixed(1); };
$('shells').oninput = applyShells;
$('furlen').oninput = applyShells;
$('loop').onchange = () => { if (current) current.setLoop($('loop').checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); };
$('bones').onchange = () => { if (skeletonHelper) skeletonHelper.visible = $('bones').checked; };
$('scrub').oninput = () => {
  if (!current) return;
  playing = false; $('play').textContent = '播放';
  current.time = Number($('scrub').value) * current.getClip().duration;
  mixer?.update(0);
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer && playing) mixer.update(dt * Number($('speed').value));
  if (current) {
    const f = (current.time % current.getClip().duration) / current.getClip().duration;
    if (playing) $('scrub').value = String(f);
    $('scrubv').value = `${Math.round(f * 100)}%`;
  }
  for (const s of shells) { const sh = s.mat.userData.shader; if (sh && s.mat.userData.len) sh.uniforms.uLen.value = s.mat.userData.len; }
  controls.autoRotate = $('rotate').checked;
  controls.update();
  renderer.render(scene, camera);
});
