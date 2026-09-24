// Action director: the layer that decides WHAT the cat does, as opposed to idle.ts (which
// only ever runs the involuntary baseline) and body-controller.ts (which only applies a set
// of channel offsets it is handed).
//
// The clip library itself is data (data/actions.json, validated by parseMotions), so adding
// or retuning an action never touches this file. What lives here is only the policy: which
// categories suit which life-engine state, how long to wait between actions, and how a clip
// crossfades in and out.
import { sampleMotion, parseMotions, leavesFloor, type Motion } from './motion.ts';
import { expressions, layers, type FaceState } from '../rig/art.ts';
import { POSES } from './poses.ts';
import actionData from '../data/actions.json' with { type: 'json' };

export type PetState = 'idle' | 'dragged' | 'ai_directed' | 'wander' | 'play_toy';

/**
 * Which action categories suit which life-engine state. Walking states map to nothing on
 * purpose: a clip that re-poses the legs would fight the gait, so locomotion owns the body
 * outright until it stops.
 */
const STATE_CATEGORIES: Record<PetState, readonly string[]> = {
  idle: ['休息', '清洁', '伸展', '尾巴', '互动', '探索', '玩耍'],
  ai_directed: ['互动', '尾巴'],
  // Walking is no longer a dead state. It used to be empty because a clip that re-poses the
  // legs fights the gait - but that is a property of individual CLIPS, not of the categories,
  // and plenty of them never touch a leg at all. Those are filtered for automatically (see
  // `legFree`), so a patrolling cat can still flick its tail and look around at you, which is
  // most of what makes it feel alive while it is crossing the desktop.
  wander: ['尾巴', '互动'],
  dragged: [],
  // Chasing a toy owns the body outright, same reasoning as walking: the swat clip is fired
  // explicitly on the frame contact happens (see the `batted` snapshot flag), never rolled by
  // the idle timer.
  play_toy: [],
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

/**
 * Joints the walk cycle owns. A clip touching any of them cannot play while the cat is moving -
 * it would be fighting the gait for the same bones - so such clips are reserved for when it
 * stops. Everything else (tails, ears, faces, head turns) is free to play over the top.
 */
const LOCOMOTION_JOINTS = /^(thigh|shin|foot|paw|upper|lower|scap|hip)/;

/** True if this clip leaves the legs and the body's height alone. */
function isLegFree(motion: Motion): boolean {
  return motion.tracks.every((track) => {
    const [id, kind] = track.channel.split('.');
    // Any pose blend re-poses the whole body, including the legs.
    if (id === 'pose') return false;
    if (id === 'root') return kind !== 'position';
    return !LOCOMOTION_JOINTS.test(id);
  });
}

/** Reactions that fire on a state transition rather than on the idle timer. */
const REACTION: Partial<Record<PetState, string>> = {
  dragged: 'startle',
};

/** Resting expression when no clip is driving the face. */
const DEFAULT_EXPRESSION = '安然';

// How long the cat goes without doing anything in particular. Shortened from 2.6-7.5s: with
// the walking-cancels-clips bug fixed these now actually play to the end, and at the old
// spacing a patrolling cat in 'auto' mode did something roughly once a minute, which is not
// enough to read as alive ("工作模式动作也没有随机做").
const IDLE_GAP_MIN = 3.0;
const IDLE_GAP_MAX = 8.0;
/** Crossfade length. Long enough to hide the pose jump, short enough to feel responsive. */
const BLEND_SECONDS = 0.22;

export interface DirectorFrame {
  /** Channel offsets to hand to the body controller. */
  offsets: Record<string, number>;
  face: FaceState;
  /** Name of the expression currently in effect - a custom face sheet indexes its cells by it. */
  expressionName: string;
  blink: boolean;
  /** True only on frames where face/blink actually changed - repainting the 256x256 face
   *  decal every frame would be pure waste, so the renderer gates on this. */
  faceDirty: boolean;
}

export interface Director {
  update(dt: number, petState: string, moving: boolean): DirectorFrame;
  /** The clip playing right now and how much of it is left, so the caller can hold the cat
   *  still for the duration rather than letting it wander out from under its own animation. */
  readonly playing: { id: string; remainingMs: number; legFree: boolean } | null;
  /** Force a specific clip (used by the debug console and by an external agent driver). */
  play(id: string): boolean;
  /**
   * Hold one named expression for `holdMs`, overriding whatever the current clip would put on
   * the face. Separate from play() on purpose: expressions and actions are independent axes
   * (any of the 30 faces can sit on top of any of the 40 clips), and a debug console / agent
   * needs to exercise them independently to see what it is actually choosing between.
   * Returns false for an unknown name rather than silently doing nothing visible.
   */
  playExpression(name: string, holdMs?: number): boolean;
  readonly actions: readonly Motion[];
  readonly expressionNames: readonly string[];
  readonly currentAction: Motion | null;
  /**
   * The face the cat is actually wearing this frame, and whether it is being held by an
   * explicit request or merely implied by the clip that is playing.
   *
   * This was the one control in the whole app that could be SET but never READ, which made a
   * misspelled expression indistinguishable from a correct one from the outside - both came
   * back "ok" and nothing anywhere could tell them apart.
   */
  readonly currentExpression: { name: string; held: boolean };
}

function isPetState(value: string): value is PetState {
  return value in STATE_CATEGORIES;
}

/**
 * @param custom a validated clip library to use instead of the bundled one (see
 *   rig/custom-assets.ts). Already-parsed, because validation has to happen before anything is
 *   swapped in - by the time a director exists it is too late to reject a bad file gracefully.
 */
export function createDirector(nodeIds: readonly string[], custom?: readonly Motion[]): Director {
  // Validating at load rather than trusting the bundle keeps a hand-edited or user-supplied
  // clip library from silently producing a cat that bends a joint through itself.
  const actions = custom?.length
    ? (custom as Motion[])
    : parseMotions(actionData, nodeIds, Object.keys(expressions), Object.keys(POSES));
  const byId = new Map(actions.map((action) => [action.id, action]));
  const legFree = new Map(actions.map((action) => [action.id, isLegFree(action)]));

  let active: { motion: Motion; elapsed: number; forced: boolean; legFree: boolean } | null = null;
  let blendFrom: Record<string, number> = {};
  let blendTime = 1;
  let lastOffsets: Record<string, number> = {};
  let gap = IDLE_GAP_MIN;
  let sinceAction = 0;
  let previousState: string | null = null;

  let face: FaceState = { ...expressions[DEFAULT_EXPRESSION] };
  let expressionOverride: { name: string; until: number } | null = null;
  let blink = false;
  let expressionNameNow = DEFAULT_EXPRESSION;
  let blinkEnd = 0;
  let nextBlink = 2.4 + Math.random() * 3.8;
  let clock = 0;

  function start(motion: Motion, forced = false) {
    // Blend out of whatever the previous clip was mid-way through, not out of the rest pose -
    // otherwise interrupting an action snaps the body before the new one eases in.
    blendFrom = { ...lastOffsets };
    blendTime = 0;
    active = { motion, elapsed: 0, forced, legFree: legFree.get(motion.id) ?? false };
    sinceAction = 0;
    gap = IDLE_GAP_MIN + Math.random() * (IDLE_GAP_MAX - IDLE_GAP_MIN);
  }

  function pick(petState: PetState, movingNow: boolean): Motion | null {
    const allowed = STATE_CATEGORIES[petState];
    if (!allowed.length) return null;
    // Never a jump: those are reactions to a toy or to a caller asking by name (see leavesFloor).
    let pool = actions.filter((action) => allowed.includes(action.category ?? '') && !leavesFloor(action));
    // While moving, only clips that leave the legs alone are eligible - anything else would be
    // cancelled the moment it started.
    if (movingNow) pool = pool.filter((action) => legFree.get(action.id));
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
    expressionNames: Object.keys(expressions),
    get currentAction() {
      return active?.motion ?? null;
    },

    get currentExpression() {
      const held = !!expressionOverride && clock < expressionOverride.until;
      return {
        name: held
          ? expressionOverride!.name
          : active && expressions[active.motion.expression]
            ? active.motion.expression
            : DEFAULT_EXPRESSION,
        held,
      };
    },

    get playing() {
      if (!active) return null;
      return {
        id: active.motion.id,
        remainingMs: Math.max(0, (active.motion.duration - active.elapsed) * 1000),
        // A leg-free clip does not need the cat to stand still, so the host must not pin it.
        legFree: active.legFree,
      };
    },

    playExpression(name: string, holdMs = 4000) {
      if (!(name in expressions)) return false;
      expressionOverride = { name, until: clock + Math.max(0, holdMs) / 1000 };
      return true;
    },

    play(id: string) {
      const motion = byId.get(id);
      if (!motion) return false;
      // `forced`: an explicitly requested clip is not the idle scheduler's suggestion, it is an
      // instruction, and it must survive the cat happening to be walking. Without this, the
      // walking-cancels-clips rule below silently ate every clip triggered from the debug
      // console ("调试控制台的动作点击后没有效果") and every clip a performance fired while the
      // cat was still arriving on its mark ("特效...猫没有配合动作").
      start(motion, true);
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

      // --- walking owns the body, EXCEPT for clips that were explicitly requested ---
      // The gait and a full-body clip both want the legs, so an idly-scheduled clip yields to
      // locomotion. One that was asked for by name does not: the caller wants to see it.
      if (moving && active && !active.forced && !active.legFree) {
        blendFrom = { ...lastOffsets };
        blendTime = 0;
        active = null;
      }

      // --- idle scheduling ---
      // The timer runs whenever no clip is playing, INCLUDING while walking. It used to pause
      // during locomotion, which meant a cat that spent most of its time patrolling (exactly
      // what 'auto' mode does) almost never accumulated enough idle time to trigger anything.
      // Now the wait counts down while it walks and the action fires as soon as it settles.
      if (!active) {
        sinceAction += dt;
        if (sinceAction >= gap) {
          const next = pick(petState, moving);
          // Only reset the wait when a clip actually started. Zeroing it because the CURRENT
          // state has no clips (walking states have none by design) threw away a wait the cat
          // had already served, so in 'auto' mode - where it is walking much of the time - the
          // timer kept getting knocked back to zero just as it came due.
          if (next) start(next);
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
      if (expressionOverride && clock >= expressionOverride.until) expressionOverride = null;
      const wantedName = expressionOverride
        ? expressionOverride.name
        : active && expressions[active.motion.expression]
          ? active.motion.expression
          : DEFAULT_EXPRESSION;
      const wanted = expressions[wantedName] ?? expressions[DEFAULT_EXPRESSION] ?? Object.values(expressions)[0];
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
        wantedName !== expressionNameNow ||
        nextBlinkState !== blink ||
        nextFace.eye !== face.eye || nextFace.brow !== face.brow || nextFace.mouth !== face.mouth ||
        nextFace.ear !== face.ear || nextFace.symbol !== face.symbol;
      face = nextFace;
      expressionNameNow = wantedName;
      blink = nextBlinkState;

      return { offsets, face, expressionName: wantedName, blink, faceDirty };
    },
  };
}
