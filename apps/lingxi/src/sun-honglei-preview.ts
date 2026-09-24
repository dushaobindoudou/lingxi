// 「孙红雷」皮肤预览 harness - 与 rig-preview.ts 同一套构图方式（= renderer.ts 的组装顺序），
// 但皮肤固定为自定义的 sun-honglei：手绘 body atlas 覆盖层 + faceSheet 脸谱贴花。
// 仅供开发期 headless 截图验证，不进入构建（vite.config.ts 的 build.input 不含此页）。
// ?cell=N  选择脸谱格子（0 平静 / 1 眯眼笑 / 2 得意 / 3 不爽 / 4 惊 / 5 困 / 6 委屈 / 7 满足）
// ?view=front|three  机位；?frames=N 渲染帧数上限。
import * as THREE from 'three';
import { buildRig, type Rig, type SkeletonData } from './rig/skeleton.ts';
import skeletonData from './data/skeleton.json';
import { refineSkeleton } from './rig/anatomy.ts';
import { paintSkin, type ArtSkin } from './rig/art.ts';
import { createBodyController } from './anim/body-controller.ts';

// Imported through Vite rather than dropped in public/: public/ is copied verbatim into dist/
// (dot-directories included), so a probe texture parked there ships inside the .app. This page
// is not a build entry, so an import here is emitted for `vite dev` only - which is the whole
// point of a probe. The two PNGs live beside the skin they belong to.
import bodyTextureUrl from '../../../assets/characters/lingxi/skins/sunhonglei-inspired/textures/sun-honglei-body.png';
import faceSheetUrl from '../../../assets/characters/lingxi/skins/sunhonglei-inspired/textures/sun-honglei-face.png';

const params = new URLSearchParams(location.search);
const CELL = Number(params.get('cell') ?? '0');
const VIEW = params.get('view') ?? 'front';
const MAX_FRAMES = Number(params.get('frames') ?? '24');

// Headless 调试陷阱：任何未捕获错误写进 DOM，让 --dump-dom / 截图能读到处径。
window.addEventListener('error', (e) => {
  document.body.style.background = '#401010';
  document.body.textContent = `PAGE ERROR: ${e.message}\n${e.error?.stack ?? ''}`;
});
window.addEventListener('unhandledrejection', (e) => {
  document.body.style.background = '#401010';
  document.body.textContent = `PAGE REJECTION: ${String(e.reason)}`;
});

const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const FACE_BOX = /^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/;

const SKIN: ArtSkin & {
  bodyTexture?: { src: string };
  faceSheet?: { src: string; columns: number; rows: number; fallback: number };
} = {
  schemaVersion: 1,
  id: 'sun-honglei',
  name: '红雷大叔',
  rigId: 'lingxi-cat-v1',
  description: '',
  pattern: 'plain',
  materials: {
    fur: '#B88254', pattern: '#1E1610', cream: '#F5E9D2', iris: '#382618',
    pupil: '#241610', nose: '#8A5836', paw: '#F6F3EC', mouth: '#2C1B11',
    whisker: '#F5E9D2', tongue: '#E08A92',
  },
  proportions: {
    footL: { size: [3.2, 3.0, 3.2] },
    footR: { size: [3.2, 3.0, 3.2] },
  },
  bodyTexture: { src: bodyTextureUrl },
  faceSheet: { src: faceSheetUrl, columns: 4, rows: 2, fallback: 0 },
};

const stage = document.getElementById('stage')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2e26, 1.1));
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(-1.2, 2, 1.5);
scene.add(key);

const faceCanvas = document.createElement('canvas');
faceCanvas.width = faceCanvas.height = 256;
const faceTexture = new THREE.CanvasTexture(faceCanvas);
faceTexture.colorSpace = THREE.SRGBColorSpace;
faceTexture.generateMipmaps = false;
faceTexture.minFilter = faceTexture.magFilter = THREE.LinearFilter;

let rig!: Rig;
let bodyTexture!: THREE.CanvasTexture;
let bodyMaterial!: THREE.MeshStandardMaterial;
let faceMaterial!: THREE.MeshBasicMaterial;
let faceGeometry!: THREE.PlaneGeometry;

function mountSkin(next: typeof SKIN) {
  rig = buildRig(next, SKELETON);
  scene.add(rig.root);

  const atlas = paintSkin(SKELETON.nodes, next);
  bodyTexture = new THREE.CanvasTexture(atlas.canvas);
  bodyTexture.colorSpace = THREE.SRGBColorSpace;
  bodyTexture.magFilter = bodyTexture.minFilter = THREE.NearestFilter;
  bodyTexture.generateMipmaps = false;
  bodyMaterial = new THREE.MeshStandardMaterial({ map: bodyTexture, roughness: 1, metalness: 0 });
  rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = bodyMaterial; });
  for (const node of SKELETON.nodes) {
    if (!FACE_BOX.test(node.id)) continue;
    for (const child of rig.node(node.id).children) if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).visible = false;
  }

  // 手绘 body atlas 覆盖生成层（renderer.mountSkin 同款：同画布覆盖，UV 不变）
  const bodyImage = new Image();
  bodyImage.onload = () => {
    const ctx = atlas.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, atlas.canvas.width, atlas.canvas.height);
    ctx.drawImage(bodyImage, 0, 0, atlas.canvas.width, atlas.canvas.height);
    bodyTexture.needsUpdate = true;
  };
  bodyImage.src = next.bodyTexture!.src;

  // 脸贴花平面（renderer.mountSkin 同款位置与材质参数）
  const headSpec = SKELETON.nodes.find((n) => n.id === 'head')!;
  const [hx, hy, hz] = headSpec.box.size;
  faceGeometry = new THREE.PlaneGeometry(hx, hy);
  faceMaterial = new THREE.MeshBasicMaterial({
    map: faceTexture, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
  faceMesh.position.set(headSpec.box.offset[0], headSpec.box.offset[1], headSpec.box.offset[2] + hz / 2 + 0.025);
  rig.node('head').add(faceMesh);

  // faceSheet 格子 → 脸画布（renderer.repaintFace 同款）
  const sheet = new Image();
  sheet.onload = () => {
    const ctx = faceCanvas.getContext('2d')!;
    const cw = sheet.width / next.faceSheet!.columns;
    const ch = sheet.height / next.faceSheet!.rows;
    const cell = Math.min(CELL, next.faceSheet!.columns * next.faceSheet!.rows - 1);
    const sx = (cell % next.faceSheet!.columns) * cw;
    const sy = Math.floor(cell / next.faceSheet!.columns) * ch;
    ctx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
    ctx.drawImage(sheet, sx, sy, cw, ch, 0, 0, faceCanvas.width, faceCanvas.height);
    faceTexture.needsUpdate = true;
  };
  sheet.src = next.faceSheet!.src;

  createBodyController(rig, SKELETON).reset();
}

try {
  mountSkin(SKIN);
} catch (error) {
  document.body.style.background = '#401010';
  document.body.textContent = `mountSkin failed: ${error instanceof Error ? error.stack : String(error)}`;
}

// 取景：与 rig-preview 相同，按包围盒取整
const focus = new THREE.Vector3();
let fitRadius = 26;
{
  const box = new THREE.Box3().setFromObject(rig.root);
  box.getCenter(focus);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  fitRadius = sphere.radius * 1.15;
}
function resize() {
  const w = stage.clientWidth || 520;
  const h = stage.clientHeight || 560;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, true);
  const aspect = w / h;
  const halfH = aspect >= 1 ? fitRadius : fitRadius / aspect;
  const halfW = halfH * aspect;
  camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
resize();

const theta = VIEW === 'front' ? 0 : Math.PI * 0.25;
let frames = 0;
function frame() {
  camera.position.set(focus.x + Math.sin(theta) * 80, focus.y + 6, focus.z + Math.cos(theta) * 80);
  camera.lookAt(focus);
  renderer.render(scene, camera);
  frames += 1;
  if (frames < MAX_FRAMES) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
