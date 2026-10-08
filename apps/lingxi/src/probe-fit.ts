// Fitted-canvas + merged-body probe - dev-only, NOT a build input.
//
// The companion renders the body as one skinned draw call (rig/merged-body.ts) into a canvas the
// size of the cat that moves with it (renderer.ts, fitCanvasToFrame), instead of one call per box
// into a full-screen canvas. Both are supposed to be invisible: the same picture, cut out of the
// same frame. This checks that, pixel by pixel, against the old path.
//
// Two renderers are driven with identical input - the same engine snapshots, the same random
// stream - one the old way (full frame, a draw call per box), one the shipped way. Each frame the
// fitted canvas is pasted back at its offset and the two images are diffed.
//
// Healthy output: "differing" is 0 (or a handful of edge pixels at most) for every case, and
// "clipped" - pixels the old path drew that fall outside the fitted canvas - is always 0.
import { createThreeRenderer, CAMERA_PRESETS } from './renderer.ts';
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';

const WIDTH = 1470;
const HEIGHT = 956;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

// One seeded stream, rewound so both renderers see the same numbers.
let seed = 0x5eed;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = random;

function stage() {
  const element = document.createElement('div');
  element.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;visibility:hidden`;
  document.body.appendChild(element);
  return element;
}

// ?isolate=merge compares merged vs per-box with both full-frame; ?isolate=fit compares fitted vs
// full-frame with both merged. The default compares the shipped path against the old one.
const isolate = new URLSearchParams(location.search).get('isolate');
const quick = new URLSearchParams(location.search).has('quick');
const startSeed = seed;
const reference = createThreeRenderer({ mergeBody: isolate === 'fit' });
seed = startSeed;
const fitted = createThreeRenderer({ fitCanvasToCat: isolate !== 'merge' });
const referenceStage = stage();
const fittedStage = stage();
reference.mount(referenceStage);
fitted.mount(fittedStage);
reference.resize(WIDTH, HEIGHT);
fitted.resize(WIDTH, HEIGHT);
const referenceCanvas = referenceStage.querySelector('canvas')!;
const fittedCanvas = fittedStage.querySelector('canvas')!;

const engine = createLifeEngine({ bounds: { width: WIDTH, height: HEIGHT }, position: { x: WIDTH / 2, y: HEIGHT / 2 } });

const paper = (w: number, h: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true })!;
};
const a = paper(WIDTH * DPR, HEIGHT * DPR);
const b = paper(WIDTH * DPR, HEIGHT * DPR);

interface Tally { frames: number; differing: number; worst: number; clipped: number; area: number }
/** Where the single worst pixel was, for a look at it. */
let worstAt: { x: number; y: number; diff: number; a: number[]; b: number[] } | null = null;
const tally = (): Tally => ({ frames: 0, differing: 0, worst: 0, clipped: 0, area: 0 });

function compare(into: Tally) {
  a.clearRect(0, 0, a.canvas.width, a.canvas.height);
  b.clearRect(0, 0, b.canvas.width, b.canvas.height);
  a.drawImage(referenceCanvas, 0, 0);
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(fittedCanvas.style.transform);
  const ox = match ? Number(match[1]) : 0;
  const oy = match ? Number(match[2]) : 0;
  b.drawImage(fittedCanvas, ox * DPR, oy * DPR);
  const left = ox * DPR;
  const top = oy * DPR;
  const right = left + fittedCanvas.width;
  const bottom = top + fittedCanvas.height;
  const pa = a.getImageData(0, 0, a.canvas.width, a.canvas.height).data;
  const pb = b.getImageData(0, 0, b.canvas.width, b.canvas.height).data;
  const w = a.canvas.width;
  for (let i = 0; i < pa.length; i += 4) {
    const diff = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3]));
    if (diff > 2) into.differing += 1;
    if (diff > into.worst) into.worst = diff;
    if (diff > (worstAt?.diff ?? 2)) {
      const p = i / 4;
      worstAt = { x: p % w, y: Math.floor(p / w), diff, a: [...pa.slice(i, i + 4)], b: [...pb.slice(i, i + 4)] };
    }
    if (pa[i + 3] > 0) {
      const p = i / 4;
      const x = p % w;
      const y = (p - x) / w;
      if (x < left || x >= right || y < top || y >= bottom) into.clipped += 1;
    }
  }
  into.area += (fittedCanvas.width * fittedCanvas.height) / (a.canvas.width * a.canvas.height);
  into.frames += 1;
}

let now = 1000;
function step(dt: number, cursor: { x: number; y: number } | null, check: Tally | null) {
  now += dt * 1000;
  const snapshot = engine.tick(now, cursor);
  const before = seed;
  reference.render(snapshot, dt, cursor);
  seed = before;
  fitted.render(snapshot, dt, cursor);
  if (check) compare(check);
}

const lines: string[] = [];
lines.push(`Fitted + merged renderer vs the old full-frame, per-box one. dpr ${DPR}, ${WIDTH}x${HEIGHT}.`);
lines.push('differing = pixels off by more than 2/255; clipped = old-path pixels outside the fitted canvas.');
lines.push('');
const report = (label: string, t: Tally) =>
  lines.push(
    `${label.padEnd(30)} frames ${String(t.frames).padStart(3)}  differing ${String(t.differing).padStart(6)}  ` +
    `worst ${String(t.worst).padStart(3)}  clipped ${String(t.clipped).padStart(5)}  canvas ${((t.area / Math.max(1, t.frames)) * 100).toFixed(1)}% of frame`,
  );

const actions = (fitted.describeCapabilities?.() as { actions: { id: string }[] } | undefined)?.actions.map((action) => action.id) ?? [];
const pick = ['stretch-front', 'curled-sleep', 'hop-catch', 'head-bump', 'groom-face'].filter((id) => actions.includes(id));

let total = tally();
for (const scale of quick ? [0.5] : [0.25, 0.5, 1]) {
  reference.setScale(scale);
  fitted.setScale(scale);
  for (const preset of CAMERA_PRESETS) {
    reference.setCameraPreset?.(preset.id);
    fitted.setCameraPreset?.(preset.id);
    for (let i = 0; i < 40; i++) step(1 / 60, null, null); // let the camera ease land
    const t = tally();
    // Walking about, with a cursor nearby for the head to follow.
    for (let i = 0; i < 90; i++) step(1 / 60, { x: WIDTH * 0.3 + i * 4, y: HEIGHT * 0.6 }, i % 15 === 0 ? t : null);
    for (const id of pick) {
      const before = seed;
      reference.playAction?.(id);
      seed = before;
      fitted.playAction?.(id);
      for (let i = 0; i < 48; i++) step(1 / 60, null, i % 12 === 6 ? t : null);
    }
    report(`scale ${scale} ${preset.id}`, t);
    total = { frames: total.frames + t.frames, differing: total.differing + t.differing, worst: Math.max(total.worst, t.worst), clipped: total.clipped + t.clipped, area: total.area + t.area };
  }
}
lines.push('');
report('ALL', total);
lines.push(`actions exercised: ${pick.join(', ') || '(none found)'}`);
lines.push(`isolate: ${isolate ?? '(none - shipped vs old)'}; worst pixel: ${JSON.stringify(worstAt)}`);
document.getElementById('out')!.textContent = lines.join('\n');

// ?snap: the last compared frame, cropped to the cat - old | shipped | differences (red).
if (new URLSearchParams(location.search).has('snap')) {
  const box = fittedCanvas;
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(box.style.transform);
  const ox = (match ? Number(match[1]) : 0) * DPR;
  const oy = (match ? Number(match[2]) : 0) * DPR;
  const cw = box.width;
  const ch = box.height;
  const out = paper(cw * 3, ch);
  out.fillStyle = '#7a8a99';
  out.fillRect(0, 0, cw * 3, ch);
  out.drawImage(a.canvas, ox, oy, cw, ch, 0, 0, cw, ch);
  out.drawImage(b.canvas, ox, oy, cw, ch, cw, 0, cw, ch);
  const pa = a.getImageData(ox, oy, cw, ch).data;
  const pb = b.getImageData(ox, oy, cw, ch).data;
  const diff = out.createImageData(cw, ch);
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3]));
    diff.data[i] = d > 2 ? 255 : pa[i + 3] > 0 ? 40 : 0;
    diff.data[i + 1] = d > 2 ? 0 : pa[i + 3] > 0 ? 40 : 0;
    diff.data[i + 2] = d > 2 ? 0 : pa[i + 3] > 0 ? 40 : 0;
    diff.data[i + 3] = 255;
  }
  out.putImageData(diff, cw * 2, 0);
  const pre = document.createElement('pre');
  pre.id = 'snap';
  pre.textContent = out.canvas.toDataURL('image/png');
  document.body.appendChild(pre);
}
