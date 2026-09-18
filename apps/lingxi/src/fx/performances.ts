// Performances ("特效编排"): short scripted set-pieces that take over the whole screen.
//
// Why a separate layer rather than more entries in actions.json: an action clip can only pose
// the skeleton. A performance is a *sequence* across four systems that have to be timed
// against each other - where the cat walks (life engine), what its body does (clip), what its
// face does (expression), what the camera does, and what appears on the glass (stage-fx). The
// emotional payload lives entirely in that timing: the claw only lands if the scratch marks
// and the screen shake hit on the exact frame the paw reaches the front of its swipe.
//
// Design rules these all obey:
//   - Never take control away for long. Every performance is a few seconds and then hands the
//     cat straight back to its own autonomy; nothing here can strand it.
//   - Never block input. stage-fx is pointer-events:none throughout, and the cat's own
//     click-through hit region is untouched.
//   - Restore what you changed. A performance that borrows the camera angle puts it back.
import type { Renderer } from '../../../../packages/desktop-host-contract/index.d.ts';
import type { StageFx } from './stage-fx.ts';

export interface PerformanceContext {
  /** Only the slice of the life engine a performance is allowed to touch. */
  engine: {
    suggestMoveTo(point: { x: number; y: number }, now: number, holdMs?: number, speedMultiplier?: number): void;
    clearIntent(): void;
    readonly position: { x: number; y: number };
  };
  renderer: Renderer;
  fx: StageFx;
  /** Logical (CSS-pixel) size of the work area. */
  viewport(): { width: number; height: number };
  /** Where the cat is on screen right now, in the same logical pixels. */
  petPosition(): { x: number; y: number };
  /** The camera preset to go back to when the performance ends. */
  restoreCamera(): void;
  now(): number;
}

interface Beat {
  atMs: number;
  run(context: PerformanceContext): void;
}

export interface PerformanceDef {
  id: string;
  name: string;
  description: string;
  durationMs: number;
  beats: Beat[];
}

/**
 * The grammar these are built on, taken from how film and anime actually stage an action beat
 * rather than invented here:
 *
 *   ANTICIPATION (溜め)   a held beat before the move. Without it a charge has no weight.
 *   LOW-ANGLE DOLLY IN    the camera pushes toward the subject as it approaches - the standard
 *                         grammar for a fight climax. Our camera is orthographic, so distance
 *                         cannot produce this; `setPerformanceZoom` scales the model instead,
 *                         which is the same read (starts far and small, arrives huge).
 *   集中線 SPEED LINES    radial lines converging on the subject during the charge and again
 *                         on contact. Used only on these beats - they work by interrupting the
 *                         normal look of the screen, so continuous use kills them.
 *   IMPACT FRAME          a one-to-two-frame flat colour flash at the moment of contact. It
 *                         resets the viewer's eye and is what makes a hit land rather than
 *                         merely happen.
 *   FOLLOW-THROUGH        the cat does not snap back to neutral; it recoils, cools off, and
 *                         only then retreats.
 *
 * Timings below are in milliseconds from the start of the performance and are matched to the
 * actual keyframes in the clips (claw-screen swipes at 1.35s and 2.65s; kiss-nuzzle closes its
 * eyes at 1.7s), because the entire emotional payload is in that synchronisation.
 */
/**
 * Where a charge starts from: upstage, but deliberately OFF the centre line, alternating sides
 * between runs. A charge straight down the middle from directly above is the one approach with
 * no depth in it at all - the cat grows but never crosses the frame, so nothing moves laterally
 * and the eye gets no parallax to read distance from ("出发点可以从不是正上方，效果应该更优立
 * 体感"). Coming in from a corner makes it cross the screen as it closes, which is what sells
 * the approach as three-dimensional. It also means the cat has to TURN as it charges, which the
 * steering and spine flex now make worth watching.
 */
let approachFromLeft = Math.random() < 0.5;
function approachMark(context: PerformanceContext) {
  approachFromLeft = !approachFromLeft;
  const { width, height } = context.viewport();
  return {
    x: approachFromLeft ? width * 0.2 : width * 0.8,
    y: height * 0.13,
  };
}

/** Where it ends up: front and centre, close to the viewer's edge of the screen. */
function stageMark(context: PerformanceContext) {
  const { width, height } = context.viewport();
  return { x: width * 0.5, y: height * 0.75 };
}

export const PERFORMANCES: PerformanceDef[] = [
  {
    id: 'angry-claw',
    name: '愤怒抓屏',
    description: '从屏幕深处炸毛冲过来，越来越大，对着你连抓两爪（集中线＋闪白＋震屏），然后退回去',
    durationMs: 9200,
    beats: [
      {
        atMs: 0,
        run(context) {
          // Low angle: a charge shot from eye level reads as coming AT you. From a 3/4 angle it
          // reads as running past you.
          context.renderer.setCameraPreset?.('eye-level');
          context.renderer.playExpression?.('警觉', 1400);
          // Retreat upstage and shrink - this is the "far away" the whole shot is built on.
          context.renderer.setPerformanceZoom?.(0.4, 0.45);
          context.engine.suggestMoveTo(approachMark(context), context.now(), 1400, 6);
          context.fx.vignette(8600, 0.6);
        },
      },
      {
        // ANTICIPATION: it has arrived upstage, turns, and holds. Nothing moves for ~600ms.
        atMs: 1200,
        run(context) {
          context.engine.clearIntent();
          context.renderer.playExpression?.('生气', 7200);
          context.renderer.playAction?.('tail-alert');
        },
      },
      {
        // THE CHARGE: dolly in. The zoom ramp and the travel are deliberately the same length,
        // so it grows exactly as fast as it closes.
        atMs: 1900,
        run(context) {
          context.engine.suggestMoveTo(stageMark(context), context.now(), 1700, 7);
          context.renderer.setPerformanceZoom?.(2.7, 1.2);
          const at = context.petPosition();
          context.fx.speedLines(at.x, at.y, { durationMs: 1400, intensity: 0.95, track: true });
          context.fx.tilt(2.2, 1500);
        },
      },
      {
        atMs: 3200,
        run(context) {
          context.renderer.playAction?.('claw-screen');
        },
      },
      {
        // IMPACT 1 - 1.35s into claw-screen, where the left paw reaches the end of its swipe.
        atMs: 4550,
        run(context) {
          const at = context.petPosition();
          context.fx.impactFrame({ durationMs: 80 });
          context.fx.clawSlash(at.x - 60, at.y - 170, { scale: 1.35, rotation: -0.24 });
          context.fx.speedLines(at.x, at.y, { durationMs: 420, intensity: 0.5, track: true });
          context.fx.shake(18, 340);
        },
      },
      {
        // IMPACT 2 - 2.65s in, the right paw. Harder than the first: a second hit that lands
        // softer than the first reads as the scene losing energy.
        atMs: 5850,
        run(context) {
          const at = context.petPosition();
          context.fx.impactFrame({ durationMs: 110, color: '#fff2f5' });
          context.fx.clawSlash(at.x + 70, at.y - 140, { scale: 1.5, rotation: 0.28 });
          context.fx.speedLines(at.x, at.y, { durationMs: 520, intensity: 0.8, track: true });
          context.fx.shake(26, 440);
          context.fx.tilt(-3, 500);
        },
      },
      {
        // FOLLOW-THROUGH: still cross, still big, breathing it off.
        atMs: 7100,
        run(context) {
          context.renderer.playExpression?.('不爽', 2000);
          context.renderer.playAction?.('shake-fur');
        },
      },
      {
        // RETREAT: back off and shrink away, the reverse of the opening.
        atMs: 8000,
        run(context) {
          const { width, height } = context.viewport();
          context.renderer.setPerformanceZoom?.(1, 0.9);
          context.engine.suggestMoveTo({ x: width * 0.5, y: height * 0.45 }, context.now(), 1100, 3);
        },
      },
      {
        atMs: 9200,
        run(context) {
          context.renderer.setPerformanceZoom?.(1, 0.4);
          context.restoreCamera();
        },
      },
    ],
  },
  {
    id: 'kiss-rush',
    name: '飞奔亲亲',
    description: '从屏幕深处跑过来，越来越大，凑到最近处闭眼亲一下（粉色集中线＋爱心满屏），再退回去',
    durationMs: 9400,
    beats: [
      {
        atMs: 0,
        run(context) {
          context.renderer.setCameraPreset?.('eye-level');
          context.renderer.playExpression?.('期待', 3400);
          context.renderer.setPerformanceZoom?.(0.42, 0.45);
          context.engine.suggestMoveTo(approachMark(context), context.now(), 1400, 6);
          context.fx.vignette(8800, 0.45);
        },
      },
      {
        // Anticipation, but a warm one: it spots you and perks up rather than coiling.
        atMs: 1200,
        run(context) {
          context.engine.clearIntent();
          context.renderer.playAction?.('tail-greeting');
        },
      },
      {
        atMs: 1900,
        run(context) {
          context.engine.suggestMoveTo(stageMark(context), context.now(), 1800, 6);
          context.renderer.setPerformanceZoom?.(2.5, 1.3);
          const at = context.petPosition();
          // Pink lines rather than white: same grammar, different emotion.
          context.fx.speedLines(at.x, at.y, { durationMs: 1500, intensity: 0.7, color: 'rgba(255,190,214,0.9)', track: true });
        },
      },
      {
        atMs: 3300,
        run(context) {
          context.renderer.playExpression?.('撒娇', 3600);
          context.renderer.playAction?.('kiss-nuzzle');
        },
      },
      {
        // THE KISS - 1.7s into kiss-nuzzle, exactly where the clip shuts its eyes.
        atMs: 5000,
        run(context) {
          const at = context.petPosition();
          context.fx.impactFrame({ durationMs: 150, color: '#ffe3ee' });
          context.fx.hearts(at.x, at.y - 150, 14);
          context.fx.shake(7, 260); // a bump, not a blow
        },
      },
      {
        atMs: 5800,
        run(context) {
          const { width, height } = context.viewport();
          context.fx.hearts(width * 0.28, height * 0.5, 7);
          context.fx.hearts(width * 0.72, height * 0.46, 7);
          context.renderer.playExpression?.('满足', 2400);
        },
      },
      {
        atMs: 7400,
        run(context) {
          const { width, height } = context.viewport();
          context.renderer.setPerformanceZoom?.(1, 1.0);
          context.engine.suggestMoveTo({ x: width * 0.5, y: height * 0.45 }, context.now(), 1300, 3);
        },
      },
      {
        atMs: 9400,
        run(context) {
          context.renderer.setPerformanceZoom?.(1, 0.4);
          context.restoreCamera();
        },
      },
    ],
  },
  {
    id: 'zoomies',
    name: '半夜暴走',
    description: '突然疯跑：贴着屏幕四角冲刺一圈，每次折返都带一串速度线，跑完自己坐下喘气',
    durationMs: 9600,
    beats: [
      {
        atMs: 0,
        run(context) {
          // Stays at the 3/4 angle: this one is about watching it tear around the desktop, which
          // needs ground plane. It is a wide shot, not a close-up.
          context.renderer.setCameraPreset?.('game');
          context.renderer.playExpression?.('玩心', 8000);
          const { width, height } = context.viewport();
          context.engine.suggestMoveTo({ x: width * 0.1, y: height * 0.16 }, context.now(), 1700, 6);
        },
      },
      {
        atMs: 1700,
        run(context) {
          const { width, height } = context.viewport();
          context.engine.suggestMoveTo({ x: width * 0.9, y: height * 0.84 }, context.now(), 1900, 6);
          const at = context.petPosition();
          context.fx.speedLines(at.x, at.y, { durationMs: 620, intensity: 0.45, track: true });
        },
      },
      {
        atMs: 3600,
        run(context) {
          const { width, height } = context.viewport();
          context.engine.suggestMoveTo({ x: width * 0.9, y: height * 0.16 }, context.now(), 1700, 6);
          const at = context.petPosition();
          context.fx.speedLines(at.x, at.y, { durationMs: 620, intensity: 0.45, track: true });
        },
      },
      {
        atMs: 5300,
        run(context) {
          const { width, height } = context.viewport();
          context.engine.suggestMoveTo({ x: width * 0.18, y: height * 0.7 }, context.now(), 1900, 6);
          const at = context.petPosition();
          context.fx.speedLines(at.x, at.y, { durationMs: 620, intensity: 0.45, track: true });
        },
      },
      {
        atMs: 7400,
        run(context) {
          context.engine.clearIntent();
          context.renderer.playAction?.('sit');
          context.renderer.playExpression?.('困困', 2800);
        },
      },
      {
        atMs: 9600,
        run(context) {
          context.restoreCamera();
        },
      },
    ],
  },
];

export interface PerformanceRunner {
  /** Start one by id. Returns false for an unknown id. Starting one cancels any other. */
  play(id: string): boolean;
  /** Cancel whatever is running, clear its effects, and restore the camera. */
  stop(): void;
  readonly active: string | null;
  list(): { id: string; name: string; description: string; durationMs: number }[];
}

export function createPerformanceRunner(context: PerformanceContext): PerformanceRunner {
  let active: string | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];

  function cancelTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  return {
    get active() {
      return active;
    },

    list() {
      return PERFORMANCES.map(({ id, name, description, durationMs }) => ({ id, name, description, durationMs }));
    },

    play(id: string) {
      const performance = PERFORMANCES.find((entry) => entry.id === id);
      if (!performance) return false;
      // One at a time. Two performances sharing the camera and the cat's destination would
      // fight each other and leave whichever finished last holding a borrowed camera.
      this.stop();
      active = performance.id;
      for (const beat of performance.beats) {
        timers.push(setTimeout(() => beat.run(context), beat.atMs));
      }
      timers.push(
        setTimeout(() => {
          active = null;
          timers = [];
        }, performance.durationMs + 50),
      );
      return true;
    },

    stop() {
      if (!active) return;
      cancelTimers();
      active = null;
      context.fx.clear();
      context.engine.clearIntent();
      // Put back everything a performance borrows. The zoom especially: leaving it scaled would
      // silently override the user's own size preset until they next changed it.
      context.renderer.setPerformanceZoom?.(1, 0.3);
      context.restoreCamera();
    },
  };
}
