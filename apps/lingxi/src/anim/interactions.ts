// Affection and play reactions - the small, unprompted responses that decide whether the thing
// on your desktop feels like a pet or like a screensaver.
//
// Two families live here, and they are separated because they answer different questions:
//
//   POINTER   what the cat does about YOU. Noticing the pointer resting on it, leaning into a
//             stroke, bumping its head at a double-click. None of this is requested by the
//             user in a menu - it is the cat responding to being touched, which is the whole
//             emotional point of a desktop pet.
//   TOY       what the cat does about the thing it is chasing. A real cat at a wand does not
//             walk over and tap it: it crouches, stalks, rears up, springs. Picking a reaction
//             from the toy's own state is what turns "the cat walks to a dot" into play.
//
// Everything here is advisory: it returns a clip id and the caller decides. Nothing in this
// file touches the rig, the engine, or the DOM, so it can be reasoned about (and tested)
// without any of them.

export interface ToySituation {
  kind: 'yarn' | 'feather' | 'laser';
  /** Distance from the cat to the toy, in logical pixels. */
  distance: number;
  /** How fast the toy itself is travelling, px/s. */
  toySpeed: number;
  /** True while the yarn ball is in the user's hand. */
  held: boolean;
}

export interface Reaction {
  clip: string;
  /** Don't consider another toy reaction until this many ms have passed. */
  cooldownMs: number;
}

/** Within this many pixels the cat is close enough to strike at the toy. */
const STRIKE_RANGE = 90;
/** Beyond this it is still closing the distance and should just run. */
const STALK_RANGE = 300;
/** Above this the toy is moving too fast to set up for; the cat just chases. */
const FAST_TOY = 220;

/**
 * What should the cat do about the toy right now? `null` means "nothing special - keep
 * chasing", which is the common case and deliberately the default: a cat that is constantly
 * performing never reads as actually pursuing anything.
 */
export function pickToyReaction(situation: ToySituation, random = Math.random): Reaction | null {
  const { kind, distance, toySpeed, held } = situation;

  // A wand held still just out of reach is the classic set-up: the cat drops, waits, and
  // springs. This is the single most recognisable thing a cat does at a toy.
  if (distance > STRIKE_RANGE && distance < STALK_RANGE && toySpeed < 60) {
    return random() < 0.55 ? { clip: 'stalk-crouch', cooldownMs: 3200 } : { clip: 'pounce', cooldownMs: 2600 };
  }

  // In range and the toy is dangling or being twitched about: rear up for it or jump at it.
  // The wand hangs from above, so reaching upward is the honest response; the laser is on the
  // floor, so the cat swats rather than rears.
  if (distance <= STRIKE_RANGE && toySpeed < FAST_TOY) {
    if (kind === 'feather') {
      return random() < 0.5 ? { clip: 'hop-catch', cooldownMs: 2200 } : { clip: 'rear-up', cooldownMs: 2600 };
    }
    if (kind === 'yarn' && held) {
      // Held out of reach on the pointer - it stretches up for it rather than batting your hand.
      return { clip: 'rear-up', cooldownMs: 2800 };
    }
    if (random() < 0.35) return { clip: 'play-bow', cooldownMs: 3000 };
  }

  return null;
}

export interface PointerSituation {
  /** True while the pointer is over the cat's own hit region. */
  hovering: boolean;
  /** Milliseconds the pointer has been resting on the cat. */
  hoverMs: number;
  /** Pointer travel accumulated while over the cat, in pixels - see the stroke comment. */
  strokeDistance: number;
}

export type PointerReaction =
  | { kind: 'notice'; clip: string; expression: string }
  | { kind: 'stroke'; clip: string; expression: string }
  | null;

/** Pointer travel over the cat that counts as being stroked rather than merely hovered over. */
export const STROKE_THRESHOLD_PX = 220;
/** How long the pointer must rest before the cat looks up at it. */
const NOTICE_AFTER_MS = 320;

/**
 * Being hovered over, and being stroked, are different things and should look different.
 *
 * A pointer that arrives and stops is attention: the cat's ears come up and it looks at you.
 * A pointer that keeps moving back and forth across the cat is a hand stroking it, and that is
 * measured by TRAVEL, not by time - which is what separates it from someone who simply parked
 * their mouse on the cat and walked away.
 */
export function pickPointerReaction(situation: PointerSituation): PointerReaction {
  if (!situation.hovering) return null;
  if (situation.strokeDistance >= STROKE_THRESHOLD_PX) {
    return { kind: 'stroke', clip: 'purr-settle', expression: '陶醉' };
  }
  if (situation.hoverMs >= NOTICE_AFTER_MS) {
    return { kind: 'notice', clip: 'notice-you', expression: '温柔' };
  }
  return null;
}

/** Lines the cat says when you double-click it. Short, warm, and never the same twice running. */
export const AFFECTION_LINES = [
  '喵～',
  '在的在的',
  '摸摸我',
  '呼噜呼噜…',
  '你回来啦',
  '再摸一下嘛',
  '我一直都在哦',
  '今天也辛苦啦',
];

/** Pick a line, avoiding an immediate repeat. */
export function pickAffectionLine(previous: string | null, random = Math.random): string {
  const pool = AFFECTION_LINES.filter((line) => line !== previous);
  return pool[Math.floor(random() * pool.length)] ?? AFFECTION_LINES[0];
}
