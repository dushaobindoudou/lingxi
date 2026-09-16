// Action director: the layer that decides WHAT the cat does, as opposed to idle.ts (which
// only ever runs the involuntary baseline) and body-controller.ts (which only applies a set
// of channel offsets it is handed).
//
// The clip library itself is data (data/actions.json, validated by parseMotions), so adding
// or retuning an action never touches this file. What lives here is only the policy: which
// categories suit which life-engine state, how long to wait between actions, and how a clip
// crossfades in and out.
import { sampleMotion, parseMotions, type Motion } from './motion.ts';
import { expressions, layers, type FaceState } from '../rig/art.ts';
import { POSES } from './poses.ts';
import actionData from '../data/actions.json';

export type PetState = 'idle' | 'dragged' | 'ai_directed' | 'follow_cursor' | 'wander';

/**
 * Which action categories suit which life-engine state. Walking states map to nothing on
 * purpose: a clip that re-poses the legs would fight the gait, so locomotion owns the body
 * outright until it stops.
 */
const STATE_CATEGORIES: Record<PetState, readonly string[]> = {
  idle: ['休息', '清洁', '伸展', '尾巴', '互动', '探索', '玩耍'],
  follow_cursor: ['互动', '尾巴'],
  ai_directed: ['互动', '尾巴'],
  wander: [],
  dragged: [],
};

/**
 * Relative pick weight per category. Calm, short, frequent behaviours (a tail sweep, an ear
 * flick) should read as the cat's normal texture; the big set pieces (a roll, a pounce) are
 * punctuation and get rarer weights so they stay surprising.
 */
const CATEGORY_WEIGHT: Record<string, number> = {
  尾巴: 3.0,
  互动: 2.4,
  清洁: 2.0,
  休息: 1.6,
  探索: 1.2,
  伸展: 1.0,
  玩耍: 0.6,
};

/** Reactions that fire on a state transition rather than on the idle timer. */
const REACTION: Partial<Record<PetState, string>> = {
  dragged: 'startle',
};

/** Resting expression when no clip is driving the face. */
const DEFAULT_EXPRESSION = '安然';

const IDLE_GAP_MIN = 2.6;
const IDLE_GAP_MAX = 7.5;
/** Crossfade length. Long enough to hide the pose jump, short enough to feel responsive. */
const BLEND_SECONDS = 0.22;

export interface DirectorFrame {
  /** Channel offsets to hand to the body controller. */
  offsets: Record<string, number>;
  face: FaceState;
  blink: boolean;
  /** True only on frames where face/blink actually changed - repainting the 256x256 face
   *  decal every frame would be pure waste, so the renderer gates on this. */
  faceDirty: boolean;
}

export interface Director {
  update(dt: number, petState: string, moving: boolean): DirectorFrame;
  /** Force a specific clip (used by the tray/management "试试看" buttons). */
  play(id: string): boolean;
  readonly actions: readonly Motion[];
  readonly currentAction: Motion | null;
}

function isPetState(value: string): value is PetState {
  return value in STATE_CATEGORIES;
}

export function createDirector(nodeIds: readonly string[]): Director {
  // Validating at load rather than trusting the bundle keeps a hand-edited or user-supplied
  // clip library from silently producing a cat that bends a joint through itself.
  const actions = parseMotions(actionData, nodeIds, Object.keys(expressions), Object.keys(POSES));
  const byId = new Map(actions.map((action) => [action.id, action]));

  let active: { motion: Motion; elapsed: number } | null = null;
  let blendFrom: Record<string, number> = {};
  let blendTime = 1;
  let lastOffsets: Record<string, number> = {};
  let gap = IDLE_GAP_MIN;
  let sinceAction = 0;
  let previousState: string | null = null;

  let face: FaceState = { ...expressions[DEFAULT_EXPRESSION] };
  let blink = false;
  let blinkEnd = 0;
  let nextBlink = 2.4 + Math.random() * 3.8;
  let clock = 0;

  function start(motion: Motion) {
    // Blend out of whatever the previous clip was mid-way through, not out of the rest pose -
    // otherwise interrupting an action snaps the body before the new one eases in.
    blendFrom = { ...lastOffsets };
    blendTime = 0;
    active = { motion, elapsed: 0 };
    sinceAction = 0;
    gap = IDLE_GAP_MIN + Math.random() * (IDLE_GAP_MAX - IDLE_GAP_MIN);
  }

  function pick(petState: PetState): Motion | null {
    const allowed = STATE_CATEGORIES[petState];
    if (!allowed.length) return null;
    const pool = actions.filter((action) => allowed.includes(action.category ?? ''));
    if (!pool.length) return null;
    let total = 0;
    for (const action of pool) total += CATEGORY_WEIGHT[action.category ?? ''] ?? 1;
    let roll = Math.random() * total;
    for (const action of pool) {
      roll -= CATEGORY_WEIGHT[action.category ?? ''] ?? 1;
      if (roll <= 0) return action;
    }
    return pool[pool.length - 1];
  }

  return {
    actions,
    get currentAction() {
      return active?.motion ?? null;
    },

    play(id: string) {
      const motion = byId.get(id);
      if (!motion) return false;
      start(motion);
      return true;
    },

    update(dt, rawState, moving) {
      clock += dt;
      const petState: PetState = isPetState(rawState) ? rawState : 'idle';

      // --- state transitions fire reactions immediately, outranking the idle timer ---
      if (rawState !== previousState) {
        const reaction = REACTION[petState];
        if (reaction && byId.has(reaction)) start(byId.get(reaction)!);
        previousState = rawState;
      }

      // --- walking owns the body: cancel any clip rather than fighting the gait ---
      if (moving && active) {
        blendFrom = { ...lastOffsets };
        blendTime = 0;
        active = null;
      }

      // --- idle scheduling ---
      if (!active && !moving) {
        sinceAction += dt;
        if (sinceAction >= gap) {
          const next = pick(petState);
          if (next) start(next);
          else sinceAction = 0;
        }
      }

      if (active) {
        active.elapsed = Math.min(active.motion.duration, active.elapsed + dt);
      }

      // --- crossfade between the previous offsets and the current clip's sample ---
      const target = active ? sampleMotion(active.motion, active.elapsed) : {};
      blendTime = Math.min(1, blendTime + dt / BLEND_SECONDS);
      const weight = blendTime * blendTime * (3 - 2 * blendTime); // smoothstep
      const offsets: Record<string, number> = {};
      for (const channel of new Set([...Object.keys(blendFrom), ...Object.keys(target)])) {
        offsets[channel] = (blendFrom[channel] ?? 0) * (1 - weight) + (target[channel] ?? 0) * weight;
      }
      // Once fully blended back to "no clip", stop emitting near-zero channels entirely so
      // the body controller has nothing to apply.
      if (!active && blendTime === 1) for (const channel of Object.keys(offsets)) delete offsets[channel];
      lastOffsets = offsets;

      if (active && active.elapsed >= active.motion.duration) active = null;

      // --- face: the clip's expression while it plays, resting expression otherwise ---
      const wanted = active ? (expressions[active.motion.expression] ?? expressions[DEFAULT_EXPRESSION]) : expressions[DEFAULT_EXPRESSION];
      // Clips may drive the mouth directly (a meow opens it, a play clip shows tongue);
      // those channels outrank the expression's own mouth.
      const mouth: FaceState['mouth'] | undefined =
        offsets['face.tongue'] !== undefined ? (offsets['face.tongue'] > 0.55 ? 'tongue' : 'cat')
        : offsets['face.open'] !== undefined ? (offsets['face.open'] > 0.3 ? 'open' : 'cat')
        : undefined;
      const nextFace: FaceState = mouth && layers.mouth.includes(mouth) ? { ...wanted, mouth } : wanted;

      // Blink is either clip-driven or spontaneous. A fixed blink period is the clearest
      // tell of a fake creature, so the fallback interval stays random.
      if (clock >= nextBlink) {
        blinkEnd = clock + 0.13;
        nextBlink = clock + 2.4 + Math.random() * 3.8;
      }
      const nextBlinkState = offsets['face.blink'] !== undefined ? offsets['face.blink'] > 0.5 : clock < blinkEnd;

      const faceDirty =
        nextBlinkState !== blink ||
        nextFace.eye !== face.eye || nextFace.brow !== face.brow || nextFace.mouth !== face.mouth ||
        nextFace.ear !== face.ear || nextFace.symbol !== face.symbol;
      face = nextFace;
      blink = nextBlinkState;

      return { offsets, face, blink, faceDirty };
    },
  };
}
