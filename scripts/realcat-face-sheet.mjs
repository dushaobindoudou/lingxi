#!/usr/bin/env node
// Face sheet of the realistic cat as the app draws it: one headless Chrome (GPU), the dev harness loaded once, every
// expression held in turn and the head cropped - the app-side twin of lingxi-v5fix's v6_face_apply.py sheets.
//
//   node scripts/realcat-face-sheet.mjs <out dir> [names, comma separated (default: all)]
// Needs the Vite dev server (apps/lingxi: npm run dev, port 1447) and the installed asset
// (scripts/install-realcat-asset.mjs). Env: PORT (1447), SCALE (2.4), CAMERA (eye-level), CROP (css px, 200).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [outArg, namesArg] = process.argv.slice(2);
if (!outArg) {
  console.error('usage: node scripts/realcat-face-sheet.mjs <out dir> [names]');
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = process.env.PORT ?? '1447';
const scale = process.env.SCALE ?? '2.4';
const camera = process.env.CAMERA ?? 'eye-level';
const crop = Number(process.env.CROP ?? 200);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9300 + Math.floor(Math.random() * 600);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'realcat-sheet-'))}`,
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=900,800', '--force-device-scale-factor=2',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await wait(200);
    target = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  if (!target) throw new Error('Chrome did not come up');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
  };
  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${port}/app-harness.html?style=realistic&scale=${scale}&camera=${camera}&still=1&nolog&noblink` });
  let names = [];
  for (let i = 0; i < 300 && !names.length; i++) {
    await wait(500);
    // the voxel cat draws until the realistic one has loaded, and lists its own expressions meanwhile
    names = await evaluate("(() => { const d = window.__harness?.renderer.describeCapabilities?.(); return d?.style === 'realistic' ? d.expressions : []; })()").catch(() => []);
  }
  if (!names.length) throw new Error('no expressions after 150 s (asset installed? face.json?)');
  const problems = await evaluate('window.__harness.renderer.describeCapabilities().faceProblems');
  if (problems?.length) console.warn('face problems:', problems.join('; '));
  const wanted = namesArg ? namesArg.split(',') : names;
  const items = [];
  await wait(2500); // the camera eases into its preset (renderer CAMERA_EASE_SECONDS)
  for (const [i, name] of wanted.entries()) {
    const ok = await evaluate(`window.__harness.renderer.playExpression(${JSON.stringify(name)}, 1e9)`);
    if (!ok) { console.warn('unknown expression', name); continue; }
    await wait(900);
    const head = await evaluate('window.__harness.renderer.headScreenPoint()');
    // headScreenPoint is the bubble anchor, near the ear tips: the crop starts a little above it
    const clip = { x: head.x - crop / 2, y: Math.max(0, head.y - crop * 0.22), width: crop, height: crop, scale: 1 };
    const shot = await send('Page.captureScreenshot', { format: 'png', clip });
    const file = join(out, `${String(i).padStart(2, '0')}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    items.push([name, file]);
    console.log('FACE_ITEM', i, name);
  }
  writeFileSync(join(out, 'items.json'), JSON.stringify(items, null, 1));
  console.log('FACE_SHEET', out, items.length);
} finally {
  ws?.close();
  proc.kill();
}
