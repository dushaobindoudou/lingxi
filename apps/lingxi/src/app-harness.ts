// Reproduces main.ts's exact renderer driving sequence WITHOUT Tauri, so a failure in the
// companion window can be diagnosed in a browser with a console instead of by rebuilding the
// macOS bundle. renderer.ts imports nothing from Tauri at runtime (only erased types), which
// is what makes this possible - keep it that way.
//
// Dev-only entry: not in vite.config.ts's build inputs.
import { createThreeRenderer } from './renderer.ts';
import { createRealisticRenderer } from './realistic-renderer.ts';
import { frameDelta } from './animation-clock.ts';
import { createRendererSwitcher, type RenderStyle } from './renderer-switcher.ts';
import { createStageFx } from './fx/stage-fx.ts';
import { createPerformanceRunner } from './fx/performances.ts';
import { pickPointerReaction } from './anim/interactions.ts';
import { createLifeEngine, DEFAULT_WANDER_SPEED } from '../../../packages/life-engine/src/index.mjs';

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
const params = new URLSearchParams(location.search);
let readyAt: number | null = null;
let nextAuditAt = 0;
window.addEventListener('securitypolicyviolation', (e) => say(`CSP blocked ${e.violatedDirective}: ${e.blockedURI.split(':')[0]}`));
if (params.has('nolog')) log.style.display = 'none';
// ?bg=<css colour>: what is behind the (transparent) window - the app floats over the desktop, not over this page's dark grey
if (params.get('bg')) document.documentElement.style.background = document.body.style.background = params.get('bg')!;
const REALISTIC_URL = `${import.meta.env.BASE_URL}characters/lingxi-realistic/current/cat.glb`;
const renderer = createRendererSwitcher({
  voxel: () => createThreeRenderer(),
  realistic: () => createRealisticRenderer({ assetUrl: REALISTIC_URL, shells: Number(params.get('shells') ?? 32), originalGroom: params.get('fur') !== 'shells', autonomous: !params.has('still'), clipBlinks: !params.has('noblink'), fitCanvasToCat: params.has('fit') }),
});
if (params.get('style') === 'realistic') {
  void renderer.switchStyle('realistic').then((r) => { say(`style realistic: ${JSON.stringify(r)}`);
    if (r.applied) {
      readyAt = performance.now();
      if (params.get('perform')) setTimeout(() => performances.play(params.get('perform')!), 300);
      if (params.get('toy') === 'pet') engine.setToy('pet');
    }
    // ?expr=<name>: hold that expression (look-dev face sheets); ?clip=<host action id> plays one first
    if (params.get('clip')) say(`clip ${params.get('clip')}: ${renderer.playAction?.(params.get('clip')!)}`);
    if (params.get('expr')) say(`expr ${params.get('expr')}: ${renderer.playExpression?.(params.get('expr')!, 1e9)}`);
    const problems = (renderer.describeCapabilities?.() as { faceProblems?: string[] }).faceProblems;
    if (problems?.length) say(`face: ${problems.join('; ')}`); const d = (renderer.describeCapabilities?.() as { debug?: { restHeight: number; box: number[][]; tallest: [string, number][] } }).debug; if (d) { say(`rest ${d.restHeight} box ${JSON.stringify(d.box)}`); for (const t of d.tallest) say(`  ${t[0]} ${t[1]}`); } });
}
say(`renderer created in ${(performance.now() - t0).toFixed(0)}ms`);
renderer.mount(stage);
const fx = createStageFx();
fx.mount(stage);
say('renderer + fx mounted');
// for scripted look-dev captures (Chrome DevTools protocol): the renderer, to hold expressions and find the head
(window as unknown as { __harness: unknown }).__harness = { renderer, get engine() { return engine; } };

const width = stage.clientWidth;
const height = stage.clientHeight;
renderer.resize(width, height);
say(`resized ${width}x${height}`);
renderer.setScale(Number(params.get('scale') ?? 0.5));
if (params.get('camera')) renderer.setCameraPreset?.(params.get('camera')!);
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
    const dt = frameDelta(lastFrameAt, now, renderer.activeStyle);
    lastFrameAt = now;
    const pace = renderer.locomotionPace?.();
    engine.setPace(pace ? Math.min(1, pace / DEFAULT_WANDER_SPEED) : 1);
    // ?still=1: a fixed, centred, idle cat for look-dev comparisons (no wandering between screenshots)
    let snapshot = params.has('still')
      ? ({ ...engine.tick(now, null), state: 'idle', position: { x: width / 2, y: height * 0.62 }, facing: 1 } as ReturnType<typeof engine.tick>)
      : engine.tick(now, cursor, cursor ? renderer.hitTest(cursor, true) : false);
    if (params.has('walk') && readyAt != null) {
      const speed = Number(params.get('walk'));
      const span = width * .5;
      const p = ((now - readyAt) / 1000 * speed) % (span * 2);
      const forward = p < span;
      snapshot = { ...snapshot, state: 'wander', heading: forward ? 0 : Math.PI,
        position: { x: width * .25 + (forward ? p : span * 2 - p), y: height * .68 } };
    }
    renderer.render(snapshot, dt, cursor);
    if (params.get('toy') === 'pet' && snapshot.toy?.kind === 'pet' && cursor && renderer.hitTest(cursor, true)) {
      if (lastStrokePoint) strokeTravel += Math.hypot(cursor.x - lastStrokePoint.x, cursor.y - lastStrokePoint.y);
      lastStrokePoint = { ...cursor };
      if (now > nextPurrAt && pickPointerReaction({ hovering: true, hoverMs: 1000, strokeDistance: strokeTravel })?.kind === 'stroke') {
        renderer.playAction?.('purr-settle'); renderer.playExpression?.('陶醉', 4200);
        nextPurrAt = now + 3500; strokeTravel = 0;
      }
    } else { lastStrokePoint = null; strokeTravel = 0; }
    if (params.has('audit') && readyAt != null && now >= nextAuditAt) {
      nextAuditAt = now + 2000;
      const d = renderer.describeCapabilities?.() as { textures?: unknown; torsoScreenPoint?: { x: number; y: number }; gait?: unknown; fur?: unknown; animation?: unknown };
      const canvas = stage.querySelector<HTMLCanvasElement>('canvas[data-render-style="realistic"]');
      let alpha: number | null = null;
      if (canvas && d.torsoScreenPoint) {
        const sample = document.createElement('canvas'); sample.width = sample.height = 1;
        const g = sample.getContext('2d')!;
        g.drawImage(canvas, d.torsoScreenPoint.x * canvas.width / width, d.torsoScreenPoint.y * canvas.height / height, 1, 1, 0, 0, 1, 1);
        alpha = g.getImageData(0, 0, 1, 1).data[3];
      }
      say(`runtime ${JSON.stringify({ torsoAlpha: alpha, textures: d.textures, gait: d.gait, fur: d.fur, animation: d.animation })}`);
    }
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

let lastStrokePoint: { x: number; y: number } | null = null;
let strokeTravel = 0;
let nextPurrAt = 0;

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
(window as unknown as Record<string, unknown>).__lingxi = {
  renderer, engine, stage, fx, performances,
  switchStyle: (style: RenderStyle) => renderer.switchStyle(style),
};
if (params.get('style') !== 'realistic') {
  if (params.get('perform')) setTimeout(() => performances.play(params.get('perform')!), 300);
  if (params.get('toy') === 'pet') engine.setToy('pet');
}
