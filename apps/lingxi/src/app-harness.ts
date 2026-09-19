// Reproduces main.ts's exact renderer driving sequence WITHOUT Tauri, so a failure in the
// companion window can be diagnosed in a browser with a console instead of by rebuilding the
// macOS bundle. renderer.ts imports nothing from Tauri at runtime (only erased types), which
// is what makes this possible - keep it that way.
//
// Dev-only entry: not in vite.config.ts's build inputs.
import { createThreeRenderer } from './renderer.ts';
import { createStageFx } from './fx/stage-fx.ts';
import { createPerformanceRunner } from './fx/performances.ts';
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';

const log = document.getElementById('log')!;
const lines: string[] = [];
function say(message: string) {
  lines.push(message);
  log.textContent = lines.slice(-14).join('\n');
  console.log('[harness]', message);
}

window.addEventListener('error', (e) => say(`window error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => say(`unhandled rejection: ${String(e.reason)}`));

const stage = document.getElementById('stage')!;
const t0 = performance.now();
const renderer = createThreeRenderer();
say(`renderer created in ${(performance.now() - t0).toFixed(0)}ms`);
renderer.mount(stage);
const fx = createStageFx();
fx.mount(stage);
say('renderer + fx mounted');

const width = stage.clientWidth;
const height = stage.clientHeight;
renderer.resize(width, height);
say(`resized ${width}x${height}`);
renderer.setScale(0.5);
say('scale 0.5 applied');

const engine = createLifeEngine({
  bounds: { width, height },
  position: { x: width / 2, y: height / 2 },
});
say('life engine created');

let cursor: { x: number; y: number } | null = null;
window.addEventListener('mousemove', (e) => { cursor = { x: e.clientX, y: e.clientY }; });

let lastFrameAt: number | null = null;
let first = true;
let errors = 0;
function frame(now: number) {
  try {
    const dt = lastFrameAt == null ? 0 : Math.min(0.1, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    const snapshot = engine.tick(now, cursor);
    renderer.render(snapshot, dt, cursor);
    fx.anchorEffects(snapshot.position.x, snapshot.position.y);
    if (fx.speaking) {
      const head = renderer.headScreenPoint?.();
      if (head) fx.anchorBubble(head.x, head.y - 18);
    }
    if (first) { first = false; say(`first frame ok, state=${snapshot.state}`); }
    if (cursor) renderer.hitTest(cursor);
  } catch (error) {
    errors += 1;
    if (errors <= 3) {
      say(`frame error #${errors}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      if (error instanceof Error && error.stack) console.error(error.stack);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev probe: lets a driving script (or the console) reach the live objects to measure what
// actually moves on screen, instead of reasoning about what should. Harness-only.
const performances = createPerformanceRunner({
  engine,
  renderer,
  fx,
  viewport: () => ({ width, height }),
  petPosition: () => engine.position,
  restoreCamera: () => renderer.setCameraPreset?.('game'),
  now: () => performance.now(),
});
(window as unknown as Record<string, unknown>).__lingxi = { renderer, engine, stage, fx, performances };
