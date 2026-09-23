// Cat Life Engine (docs/05-technical-architecture.md module boundaries).
//
// Pure behavior state machine: no rendering, no DOM, no Tauri. It only knows a 2D
// world made of `bounds` (the desktop work area, in the same units as `position`)
// and a `cursor` (nullable, the same units). It is deterministic given
// (state, now, cursor) so it can be unit tested and swapped behind any renderer.
//
// The renderer/host layers are expected to call `tick(now, cursor)` on every
// animation frame and read back `{ state, position, facing, speed }` to drive
// whatever visual representation they have capability for. A renderer that can't
// walk should just ignore `position` changes and stay in place - the engine does
// not know or care what capabilities the renderer has.

export const BEHAVIOR_STATES = Object.freeze([
  'idle', 'wander', 'dragged', 'ai_directed', 'play_toy',
  // Asleep. The one autonomous state the cat ENTERS rather than being put into, and the only
  // one whose exit condition is internal (rested enough) rather than a timer or an input.
  //
  // It exists because the other five make a cat that is always equally awake: it walks, it
  // rests for a few seconds, it walks again, forever and identically at 04:00 and at 14:00.
  // Sleep is what turns that loop into a day - it is the low end of a range the rest of the
  // behaviour now sits inside.
  'sleep',
]);

/**
 * The five personality sliders, matching `PersonalityTraits` in src-tauri and the
 * `validatePersonality` contract. All 0..1, all 0.5 by default - the midpoint is "no claim
 * made", not "average cat".
 */
export const PERSONALITY_TRAITS = Object.freeze([
  'independence', 'curiosity', 'gentleness', 'playfulness', 'sleepiness',
]);

const NEUTRAL_PERSONALITY = Object.freeze({
  independence: 0.5, curiosity: 0.5, gentleness: 0.5, playfulness: 0.5, sleepiness: 0.5,
});

// There is one mode. There used to be two - "工作模式" (stay out of the way) and "逗猫模式"
// (chase the cursor) - and the split was wrong: it made the user declare in a menu what they
// already say by their actions. Putting a toy out IS asking to play, and taking it away IS
// asking to be left alone, so the toy is the switch and the mode setting was redundant
// ceremony on top of it ("去掉工作模式和逗猫模式，跟猫玩游戏就是逗猫").
//
// What remains is free roaming: the cat wanders the desktop doing its own thing and actively
// keeps clear of wherever the pointer is, because that is where the user is working. The laser
// pointer covers the one thing the old "play" mode did that a toy did not - chasing the cursor
// itself - and does it better, because it is a thing on screen rather than an invisible state.
export const INTERACTION_MODES = Object.freeze(['free']);

/**
 * Toys ("玩具"). A toy is a second body in the same 2D world as the cat, and it is what turns
 * the pet from something you watch into something you play with - the cat acquires a goal it
 * did not choose for itself, and you get to interfere with it.
 *
 * The three differ in who moves the toy, which is the whole design axis:
 *   'yarn'   毛线球  - free physics. You throw it; it rolls, slows, bounces off the screen
 *                      edges. The cat chases it down and BATS it, which re-launches it. The
 *                      cat can therefore keep its own game going with no input from you.
 *   'feather' 逗猫棒 - you move it (it trails the cursor on a lag, like a real wand's tip
 *                      lagging your hand). The cat chases and pounces but never truly holds
 *                      it. This is the one that needs a human.
 *   'laser'  激光笔  - pinned exactly to the cursor, and batting does nothing at all, because
 *                      that is the joke: it can never be caught.
 */
export const TOY_KINDS = Object.freeze(['yarn', 'feather', 'laser']);

const DEFAULTS = Object.freeze({
  bounds: { width: 1280, height: 800 },
  speed: 90, // units/second, autonomous wander pace
  // How long it rests between trips. Lengthened from 1500-4500: the cat can only perform an
  // action while it is standing still, and with short rests it spent ~72% of its time walking
  // and managed something interesting only about once every 19 seconds - which is what "工作
  // 模式动作也没有随机做" is describing. Longer rests are also simply more in character for a
  // mode whose whole job is to stay out of your way.
  idleDurationMsRange: [1800, 5000],
  wanderRadius: 260,
  // How close the pointer may get before the cat gets out of the way. This is the core
  // courtesy of the whole app: the pointer marks where the user is actually working, so it is
  // the one place on the desktop the cat must not be ("在自由模式的时候不要往这个周围走").
  avoidRadius: 150,
  // Rest targets are additionally rejected outright if they fall within this of the pointer -
  // avoidance used to be purely reactive (flee once it is already too close), which meant the
  // cat would happily pick a destination right next to the pointer and walk there first.
  cursorKeepOut: 220,
  // Close enough to count as contact - the pointer is ON the cat, not merely near it. Smaller
  // than avoidRadius on purpose: there is a band where the cat is politely getting out of the
  // way, and then there is being touched.
  pointerEngageRadius: 90,
  // Recent travel is tracked with this time constant (seconds) for both the pointer and the
  // cat, so "who closed the gap" is answered over a moment rather than a single frame.
  pointerAttributionEase: 0.35,
  // How much more the pointer must have moved than the cat for the contact to be read as the
  // user reaching out. Above 1 so that a cat walking into a parked pointer never qualifies,
  // and so a near-tie resolves to "the cat did it" - the conservative answer, since guessing
  // wrong in that direction merely withholds a purr instead of parking the cat on the cursor.
  pointerInitiativeRatio: 1.6,
  // How welcome the cat is on each edge, as a multiplier on that edge's pick weight.
  //
  // Screen edges are NOT interchangeable. On macOS the right edge is the emptiest thing on a
  // desktop; the left is nearly as free; the bottom has the Dock; and the top is the worst by a
  // distance - the menu bar runs along all of it and the window controls sit at the left end of
  // it. So a pet that treats the four edges as equivalent spends a quarter of its life sitting on
  // the one strip of screen the user clicks most.
  //
  // Defaults are macOS's layout. A host on another platform should override this: Windows puts
  // the taskbar along the bottom and the window controls at the TOP RIGHT, which reverses two of
  // these. See setEdgePreference.
  edgePreference: { right: 1.6, left: 1.15, bottom: 0.7, top: 0.25 },
  // Extra penalty for the single worst corner, applied to targets that land near it. On macOS
  // that is the top-left: Apple menu, app menu and the close/minimise buttons all live there.
  worstCorner: { x: 0, y: 0 },
  worstCornerPenalty: 0.35,
  // How strongly to prefer an edge ADJACENT to the one the cat is on over the opposite one.
  // Crossing to the opposite edge means walking through the middle of the screen, which is
  // exactly where the user is working ("尽量别从中间横穿整个屏幕").
  // Tuned by measurement, not by feel: at 0.12 with edgePatrolBias 1.4, a ten-minute simulation
  // with the user working mid-screen crosses the full width 7 times instead of 17, and the time
  // spent in the middle of the screen is back to where it was before the edge preferences were
  // introduced (7%) while the edge distribution is now correct.
  oppositeEdgePenalty: 0.12,
  // Extra pick weight for the edge the cat is already standing on, so it patrols
  // along a border for a while instead of crossing the middle of the screen (i.e. straight
  // through the user's actual work) on every single hop.
  edgePatrolBias: 1.4,
  // The shortest time between two consecutive "the cursor is too close, flee"
  // retargets. Without it, a cursor parked inside avoidRadius satisfies the flee condition on
  // EVERY frame, and each frame threw away the escape target and rolled a brand new random
  // one - so the cat never actually travelled anywhere, it just vibrated in place chasing 60
  // different directions per second (reported as "在停下的时候一直在晃" / "一直晃眼都要瞎
  // 了"). Committing to one escape target for at least this long is what makes fleeing read
  // as walking away rather than as a seizure.
  avoidRetargetCooldownMs: 1400,
  // An escape target closer than this isn't worth walking to - it produces a
  // sub-second shuffle that reads as twitching rather than as moving out of the way. Targets
  // are re-rolled (bounded attempts) until one is at least this far off.
  minRetargetDistance: 120,
  // --- vitals: what makes a day different from a loop ------------------------------------
  //
  // Two numbers, both 0..1, both changing on the scale of hours rather than frames:
  //
  //   energy      how much the cat has left to spend. Drains while awake (faster while
  //               walking), restores while asleep. Low energy slows the walk and lengthens
  //               the rests, so a tired cat LOOKS tired before it does anything about it.
  //   sleepiness  how much it wants to stop. Rises while awake, faster at night, faster still
  //               on a cat whose `sleepiness` trait is high. Crossing a threshold is what
  //               sends it to sleep.
  //
  // They are deliberately separate: a cat can be wide awake and out of energy (late in a long
  // session) or rested but sleepy (3am). Collapsing them into one "tiredness" number loses
  // exactly the distinction that makes the behaviour read as a living thing rather than as a
  // battery meter.
  //
  // Rates are per HOUR because that is the unit they are reasoned about in - a full day's
  // swing should take a working day, not a coffee break.
  energyDrainPerHour: 0.10,        // ~10 hours awake at rest to run flat
  energyDrainMovingMultiplier: 2.4, // walking costs more than sitting
  energyRestorePerHour: 0.42,      // ~2.5 hours of sleep for a full recharge
  sleepinessRisePerHour: 0.13,
  sleepinessFallPerHour: 0.55,
  // How far the day/night cycle can push the sleepiness rate, as a multiplier. Noon is the
  // low end, 03:00 the high end.
  circadianSleepinessSwing: [0.55, 1.75],
  // Peak nightness, as a local hour. 3am: the deepest part of the night for the person the
  // cat is keeping company, which is what this is actually modelling - not a real cat's
  // crepuscular rhythm, which would have it most active at dawn and dusk and asleep through
  // the working day, i.e. invisible exactly when someone is there to see it.
  circadianPeakHour: 3,
  // Sleepiness at which a settled cat will lie down, and the energy above which it will
  // refuse to no matter how sleepy (a cat with plenty in the tank stays up).
  sleepEnterSleepiness: 0.78,
  sleepRefuseAboveEnergy: 0.92,
  // Woken when BOTH are satisfied - rested and no longer sleepy. Requiring both is what stops
  // it waking up at the threshold and immediately qualifying to sleep again.
  sleepWakeEnergy: 0.85,
  sleepWakeSleepiness: 0.25,
  // A cat does not drop where it stands. It has to have been settled this long first, which
  // is also what keeps sleep from interrupting a walk.
  sleepSettleMs: 6000,
  // The most wall-clock time one tick may apply to the vitals.
  //
  // `deltaSeconds` is already capped at 0.25s so a stalled frame cannot teleport the cat, but
  // vitals need a much larger cap and a different reason for it: closing the laptop for eight
  // hours produces one tick with an eight-hour gap, and the cat did not spend those eight
  // hours awake - it did not exist. Advancing vitals by the full gap would have it wake from
  // a lid-open bone tired, or (asleep) fully charged the instant the screen comes back, both
  // of which read as the state being fake. Capping at fifteen minutes means a long gap moves
  // the needle a little, in the right direction, and no more.
  vitalsGapCapMs: 15 * 60 * 1000,
  // How far a trait may scale the thing it governs. Traits tune tuned behaviour - the
  // defaults above were measured, so a slider at either extreme must bend them, not replace
  // them. Every trait factor is clamped into this band.
  traitInfluence: [0.6, 1.6],

  // --- toys (see TOY_KINDS) -------------------------------------------------------------
  toyChaseSpeedMultiplier: 3.2, // a cat going after a toy sprints; this is not a stroll
  toyReach: 34, // how close the cat's anchor gets before it can bat the toy
  toyBatCooldownMs: 520, // one swat per approach, not one per frame
  toyBatSpeed: 520, // px/s imparted to the yarn ball by a swat
  toyFriction: 1.9, // per-second exponential decay of the yarn ball's speed
  toyRestSpeed: 12, // below this the ball counts as stopped
  toyBounceLoss: 0.62, // speed kept after bouncing off a screen edge
  // Per-second catch-up rate of the wand tip toward the cursor. High enough that the wand is
  // effectively ON your pointer (the ask was for the cursor to BE the toy), but not infinite -
  // the small remaining whip is what the cat overshoots and pounces at.
  toyFeatherLag: 16,
  toyChargeMaxMs: 900, // hold this long for a full-power throw
  toyThrowSpeedMin: 260, // px/s at zero charge
  toyThrowSpeedMax: 1250, // px/s at full charge
  // --- steering ---------------------------------------------------------------------------
  // Radians per second the body can swing its heading. Roughly 170 deg/s: fast enough that a
  // cat reacting to something does not look sluggish, slow enough that a reversal is visibly a
  // turn rather than a teleport.
  turnRate: 3.0,
  // Tightest circle the cat can carve, in pixels. This is a floor UNDER the turn rate, not a
  // cap on it: a fixed angular rate means the faster it moves the wider it must swing, and at
  // the 'play' mode chase speed the resulting circle (225px/s over 3rad/s = 75px radius) was
  // wider than the standoff it was trying to reach, so it orbited the cursor forever instead
  // of arriving. Deriving the rate from speed/radius keeps the circle constant instead.
  minTurnRadius: 28,
  // Ceiling on how fast the body may swing, radians/second. There was only a FLOOR before, and
  // the rate is derived from speed/turnRadius - so an agent or a performance asking for a 7x
  // dash got 1130 deg/s, three full rotations a second. The body snapped round and shot off,
  // which is what "猫咪会闪回到一个固定位置" actually is: not a teleport, a pivot too fast to
  // read as a turn. 5 rad/s is ~286 deg/s, brisk for a cat and still legible. Cornering already
  // drops the pace to minTurnSpeedFactor while the turn is happening, so capping the rate makes
  // it turn on the spot and then go, rather than carving a wide arc at speed.
  maxTurnRate: 5,
  // Widest turning circle we are willing to let a fast mover have, in pixels. Speed is clamped
  // so that speed/maxTurnRate never exceeds this.
  //
  // Capping the turn rate without capping speed reintroduces a bug this codebase has already
  // had once: the turn rate used to be a fixed angular rate, which meant the faster the cat
  // moved the wider it had to swing, and at chase speed the circle was wider than the standoff
  // it was aiming for - so it orbited its target forever instead of arriving. The two limits
  // have to move together, and expressing the pair as "a turning circle no wider than this" is
  // what keeps them consistent.
  maxTurnRadius: 200,
  // Distance at which the cat starts slowing for its destination. Without an arrival taper it
  // can only ever fly past a close target and come back around.
  slowingRadius: 120,
  // Speed retained when the destination is at right angles or behind. Well under 1 so sharp
  // corners are taken slowly (and a full reversal is close to a pivot in place), which is both
  // how animals move and what keeps the turning circle from overshooting the target.
  minTurnSpeedFactor: 0.18,
  dragStaleMs: 700, // release a drag that stops getting updateDrag() calls (a lost mouseup)
  arriveThreshold: 6,
  // Upper bound on an externally-supplied hold. Without one, `holdMs: 99999999` parks the cat
  // for 27 hours and nothing short of a restart brings it back - a caller typo should not be
  // able to take the pet away for a day.
  maxHoldMs: 10 * 60 * 1000,
  // Fallback keep-out from each edge, used until the host measures the character (see
  // setMargins). A single number cannot be right for all four edges: the cat's anchor is its
  // FEET, so the body extends upward from it and nothing extends below, which means the same
  // number hides almost the whole cat at the top and none of it at the bottom.
  margin: 24,
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** True only for a point whose coordinates are both real numbers. See suggestMoveTo. */
function isFinitePoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function randomBetween(min, max, random = Math.random) {
  return min + random() * (max - min);
}

/**
 * @param {Partial<typeof DEFAULTS> & { position?: {x:number,y:number} }} [config]
 */
export function createLifeEngine(config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  // Injectable so behaviour can be replayed exactly. Every choice the cat makes runs through
  // here, which is what lets a test pin one seed and compare two builds on the SAME decisions
  // instead of on two different random walks - the difference between measuring a change and
  // measuring the weather.
  const random = typeof config.random === 'function' ? config.random : Math.random;
  const rand = (min, max) => randomBetween(min, max, random);
  let bounds = cfg.bounds;
  let state = 'idle';
  let position = config.position ?? { x: bounds.width / 2, y: bounds.height / 2 };
  let facing = 1; // +1 = facing +x, -1 = facing -x
  // The direction the body points, in radians, screen space (0 = +x, +PI/2 = down). This is
  // the authoritative orientation: the cat can only travel along it, and the renderer reads it
  // rather than deriving one from position deltas.
  let heading = Math.PI / 2;
  let turning = 0; // rad/s actually applied this tick - drives the spine bend in the renderer
  let target = null;
  let idleUntil = null; // lazily set on the first tick, once we know "now"
  let lastTickAt = null;
  let dragOffset = { x: 0, y: 0 };
  let aiIntent = null; // { target: {x,y}, until: msTimestamp } | null
  let dragUpdatedSinceLastTick = false;
  let dragStuckSinceMs = null;
  let lastAvoidRetargetAt = -Infinity; // see cfg.avoidRetargetCooldownMs
  // How close the anchor may get to each edge. Negative is allowed and meaningful: it lets the
  // anchor pass the edge so part of the body goes off-screen, which is what makes the cat look
  // like it is walking off the side rather than bumping into an invisible wall.
  //
  // There are deliberately TWO of these, because "how far may it go" and "how far does it
  // choose to go" are different questions and were being answered by one number.
  //
  //   margins      the HARD LIMIT. Only reached by things that are already extreme - a
  //                performance charging the camera, being dragged by the user, chasing a toy
  //                into a corner. Letting half the cat leave the screen here is what makes
  //                those moments read as extreme ("有时候有些操作我们需要更极致").
  //   roamMargins  where the cat sends ITSELF when nothing is going on. Tighter, because the
  //                whole point of a desktop pet is that you can see it ("自由运动的时候，要
  //                一直能看到猫咪很重要").
  //
  // Both come from the host, which is the only layer that knows how big the cat currently draws.
  let margins = { top: cfg.margin, bottom: cfg.margin, left: cfg.margin, right: cfg.margin };
  let roamMargins = { ...margins };
  // Per-edge welcome, overridable by the host - see setEdgePreference.
  const edgePreference = { ...cfg.edgePreference };

  // --- vitals ----------------------------------------------------------------------------
  // Start rested rather than at the midpoint: the first thing a user sees after launching
  // should be a cat that is up and about, not one that lies down because it booted tired.
  let energy = clamp(config.energy ?? 0.85, 0, 1);
  let sleepiness = clamp(config.sleepiness ?? 0.15, 0, 1);
  let personality = { ...NEUTRAL_PERSONALITY };
  // When the cat last settled. Sleep needs a cat that has been still for a while, and
  // `idleUntil` cannot answer that - it says when the rest ENDS, and is pushed forward by
  // petting and by performances, so a cat being stroked would otherwise look "settled" for
  // as long as the stroking lasted.
  let settledSince = null;
  let wokeAt = null;
  let sleptAt = null;

  /**
   * How much the day is pulling toward sleep, 0..1, from the local clock.
   *
   * Derived from `now` rather than from a wall clock of its own, so the engine stays a pure
   * function of its inputs: a test can hand it 03:00 and get the night behaviour without
   * waiting for 03:00, and a replay with a pinned seed replays identically.
   */
  function nightness(now) {
    const date = new Date(now);
    const hour = date.getHours() + date.getMinutes() / 60;
    const phase = ((hour - cfg.circadianPeakHour) / 24) * Math.PI * 2;
    return (1 + Math.cos(phase)) / 2;
  }

  /**
   * A trait's influence as a multiplier, clamped into cfg.traitInfluence.
   *
   * `trait` is 0..1 with 0.5 meaning "no opinion", so 0.5 must map to exactly 1.0 or moving a
   * slider off centre and back would not return the cat to its tuned defaults. `strength` is
   * how far the extremes reach.
   */
  function traitFactor(trait, strength) {
    const [lo, hi] = cfg.traitInfluence;
    const value = Number.isFinite(trait) ? clamp(trait, 0, 1) : 0.5;
    return clamp(1 + (value - 0.5) * 2 * strength, lo, hi);
  }

  /**
   * How long the cat stands still before it next goes somewhere.
   *
   * This is where three separate things meet, which is why it is one function rather than
   * six call sites each doing their own arithmetic:
   *   - low energy lengthens rests (a tired cat sits)
   *   - `curiosity` shortens them (a curious cat goes to look)
   *   - `independence` lengthens them (an independent cat is content where it is)
   */
  function idleWindow() {
    const [lo, hi] = cfg.idleDurationMsRange;
    const tired = 1 + (1 - energy) * 0.9;
    const factor = tired
      * traitFactor(1 - personality.curiosity, 0.35)
      * traitFactor(personality.independence, 0.3);
    return rand(lo, hi) * factor;
  }

  /**
   * The autonomous walking pace. A flat cat walks slower, and a gentle one ambles.
   * Never below a third of the tuned speed: past that the gait animation stops reading as
   * walking and starts reading as a stutter.
   */
  function walkSpeed() {
    const factor = (0.55 + 0.45 * energy) * traitFactor(1 - personality.gentleness, 0.2);
    return cfg.speed * Math.max(0.33, factor);
  }

  /** Sleepiness at which THIS cat lies down, pulled by its `sleepiness` trait. */
  function sleepThreshold() {
    return clamp(cfg.sleepEnterSleepiness / traitFactor(personality.sleepiness, 0.28), 0.35, 0.98);
  }

  /**
   * Advance energy and sleepiness, and return whether anything about them changed enough to
   * matter. Called once per tick, before any state decision reads them.
   */
  function updateVitals(now, elapsedMs, moving) {
    // See cfg.vitalsGapCapMs: a lid-open hands us the whole gap, and the cat did not live it.
    const hours = Math.max(0, Math.min(elapsedMs, cfg.vitalsGapCapMs)) / 3600000;
    if (hours <= 0) return;
    if (state === 'sleep') {
      energy = clamp(energy + cfg.energyRestorePerHour * hours, 0, 1);
      sleepiness = clamp(sleepiness - cfg.sleepinessFallPerHour * hours, 0, 1);
      return;
    }
    const drain = cfg.energyDrainPerHour * (moving ? cfg.energyDrainMovingMultiplier : 1);
    energy = clamp(energy - drain * hours, 0, 1);

    const [dayLow, nightHigh] = cfg.circadianSleepinessSwing;
    const circadian = dayLow + (nightHigh - dayLow) * nightness(now);
    const rise = cfg.sleepinessRisePerHour * circadian * traitFactor(personality.sleepiness, 0.5);
    // Running out of energy makes you sleepy regardless of the hour - this is what guarantees
    // the loop closes even for a cat whose sleepiness trait is at zero.
    const exhaustion = energy < 0.2 ? (0.2 - energy) * 2.5 : 0;
    sleepiness = clamp(sleepiness + (rise + exhaustion) * hours, 0, 1);
  }

  /** Everything that outranks sleep, i.e. every reason to be awake right now. */
  function sleepDisturbed() {
    return Boolean(toy) || Boolean(aiIntent) || pointerEngagedByUser || state === 'dragged';
  }

  function fallAsleep(now) {
    state = 'sleep';
    target = null;
    sleptAt = now;
    settledSince = null;
  }

  function wakeUp(now) {
    state = 'idle';
    wokeAt = now;
    sleptAt = null;
    settledSince = now;
    // A cat that just woke does not immediately set off - it lies there a moment first.
    idleUntil = now + idleWindow();
  }

  /**
   * Replace the personality. Unknown keys are ignored and missing ones keep their current
   * value, so a host that only knows about three sliders cannot blank the other two.
   */
  function setPersonality(next) {
    if (!next || typeof next !== 'object') return;
    for (const trait of PERSONALITY_TRAITS) {
      const value = next[trait];
      if (Number.isFinite(value)) personality[trait] = clamp(value, 0, 1);
    }
  }

  const minX = () => margins.left;
  const maxX = () => Math.max(margins.left, bounds.width - margins.right);
  const minY = () => margins.top;
  const maxY = () => Math.max(margins.top, bounds.height - margins.bottom);

  // Never wider than the hard limit: a roam box that escaped it would have the cat choosing
  // destinations it is not allowed to reach, and it would stall against the clamp instead.
  const roamMinX = () => Math.max(minX(), roamMargins.left);
  const roamMaxX = () => Math.max(roamMinX(), Math.min(maxX(), bounds.width - roamMargins.right));
  const roamMinY = () => Math.max(minY(), roamMargins.top);
  const roamMaxY = () => Math.max(roamMinY(), Math.min(maxY(), bounds.height - roamMargins.bottom));

  /**
   * Set the keep-out per edge. The host measures the character's actual on-screen extent
   * relative to its anchor and works these out, because the engine has no idea how big the cat
   * is or which way up it is drawn - and that is exactly the information this needs.
   *
   * Top-level values are the hard limit; `next.roam` is the tighter box the cat confines its
   * own wandering to. Passing only the hard limit leaves roaming pinned to it, which is the
   * old single-box behaviour.
   */
  /**
   * Which screen edges the character is welcome on, as multipliers (1 = neutral).
   *
   * The engine cannot know this: it has no idea where the menu bar, Dock or taskbar are, and
   * those differ per platform and per user. The host does, so the host says. `worstCorner` is
   * given in normalised coordinates (0,0 = top-left) and marks the one corner to stay out of.
   */
  function setEdgePreference(next) {
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      const value = next?.[edge];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        edgePreference[edge] = value;
      }
    }
    const corner = next?.worstCorner;
    if (corner && Number.isFinite(corner.x) && Number.isFinite(corner.y)) {
      cfg.worstCorner = { x: corner.x, y: corner.y };
    }
  }

  function setMargins(next) {
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      const value = next?.[edge];
      if (typeof value === 'number' && Number.isFinite(value)) {
        margins[edge] = value;
        // Keep the two in step unless the caller is explicitly managing both, so a host that
        // knows nothing about roaming still gets sane behaviour.
        if (!next?.roam) roamMargins[edge] = value;
      }
      const roamValue = next?.roam?.[edge];
      if (typeof roamValue === 'number' && Number.isFinite(roamValue)) roamMargins[edge] = roamValue;
    }
    // Keep the cat inside whatever the new margins allow.
    position = { x: clamp(position.x, minX(), maxX()), y: clamp(position.y, minY(), maxY()) };
  }
  // Which way round the pointer the cat committed to walking: -1, +1, or 0 for "not detouring".
  // Sticky on purpose - see detourAround.
  let detourSide = 0;
  // Timestamp of the last time enforceInvariants() had to repair the simulation, or null.
  let recoveredAt = null;
  /** Where the body is being asked to point while standing still, radians, or null. */
  let turnTarget = null;
  // --- who started it -----------------------------------------------------------------------
  // The cat's reaction to the pointer being on it should depend entirely on who moved. A user
  // reaching over to touch the cat wants affection; a cat that has wandered onto a parked
  // pointer is standing in the way and should move. Both look identical at the instant of
  // contact - the only thing that separates them is which of the two closed the distance, so
  // that is what gets measured ("这样能够比较准确的识别是主动还是被动").
  let lastCursor = null;
  let lastPosition = null;
  let cursorTravel = 0; // decaying recent travel, pixels
  let catTravel = 0;
  // Latched for the duration of one contact: once the user has reached out, the cat does not
  // change its mind about that just because the hand then holds still on top of it.
  let pointerEngagedByUser = false;
  let pointerEngaged = false;
  let toy = null; // { kind, position:{x,y}, velocity:{x,y} } | null - see TOY_KINDS
  let lastBatAt = -Infinity;
  let batThisTick = false; // one-frame flag the renderer turns into a pounce/swat clip
  let holdUntil = 0; // stand still until this timestamp - see hold()
  // Yarn ball only: the user is holding it at the cursor and winding up a throw. `since` is
  // when they pressed; the longer they hold, the harder it goes.
  let charge = null; // { since:number } | null
  // True while the ball is in your hand rather than loose on the desktop. It starts held: a
  // yarn ball you have to go and find is not a game, and the ask was for it to arrive on the
  // pointer ("默认出现的时候应该跟随鼠标移动"). A throw releases it; clicking it picks it up.
  let toyHeld = false;
  // Snapshot-friendly mirror of the charge level. snapshot() has no `now` of its own, and
  // threading one through every call site would be worse than recomputing it once per tick.
  let chargeAmount = 0;

  /**
   * 'auto' mode's rest spot: a point on the work area's border, far enough away to be worth
   * walking to. A wander target picked as a random hop from the *current* position - the
   * original approach - is bounded by `wanderRadius` and a random angle, so on a screen much
   * larger than that radius it essentially never reaches an edge at all (reported as
   * "上下左右似乎无法移动到边缘位置"); anchoring to the perimeter guarantees it gets there,
   * and the patrol weighting in rollEdgeRestTarget keeps it roaming along borders
   * ("我希望它在屏幕的边缘进行游走") rather than parking on one pixel forever.
   */
  function pickEdgeRestTarget(cursor) {
    // Two things disqualify a candidate rest spot, and re-rolls are bounded so a pathological
    // screen (a pointer parked in the only safe corner) still terminates with the best of a
    // handful rather than looping.
    //
    //   too close to here     - a rest point a few pixels away makes the cat shuffle rather
    //                           than travel, and a shuffle is the micro-movement the renderer
    //                           then has to read a heading out of (it can't).
    //   too close to the      - avoidance used to be purely REACTIVE: flee once the pointer is
    //   pointer                 already on top of you. That let the cat cheerfully choose a
    //                           destination right beside the pointer and walk all the way
    //                           there before noticing. Rejecting such targets up front is what
    //                           makes it actually stay out of the user's way.
    const scoreOf = (point) => {
      const reach = distance(position, point);
      const clearance = cursor ? distance(point, cursor) : Infinity;
      if (clearance < cfg.cursorKeepOut) return -1e9 + clearance; // disqualified, least-bad first
      return Math.min(reach, 600); // otherwise prefer a target worth the walk
    };
    let best = rollEdgeRestTarget(cursor);
    let bestScore = scoreOf(best);
    for (let attempt = 0; attempt < 10 && (bestScore < 0 || bestScore < cfg.minRetargetDistance); attempt += 1) {
      const next = rollEdgeRestTarget(cursor);
      const score = scoreOf(next);
      if (score > bestScore) {
        best = next;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * One point ON the perimeter of the work area - literally on an edge, not merely in the
   * half-screen nearest one. 'auto' mode is the "I'm working, stay out of my way" mode, and
   * the desktop's border is the only place on a screen that is reliably not where the user is
   * looking; a cat parked 300px inside the frame is still sitting on top of a window.
   *
   * Edge choice is weighted, not uniform: edges far from the cursor are strongly preferred,
   * and the edge the cat is already on gets a bonus so it patrols along a border for a while
   * instead of ping-ponging corner to corner across the middle of the screen every time.
   */
  function rollEdgeRestTarget(cursor) {
    // The roam box, so "on the border" means the border of the area the cat keeps itself
    // visible in - not the hard limit, which would park it half off the screen for hours.
    const [left, right, top, bottom] = [roamMinX(), roamMaxX(), roamMinY(), roamMaxY()];
    const reference = cursor ?? position;
    // Distance from the reference point to each edge, in pixels, normalised by ONE scale for
    // both axes.
    //
    // It used to divide x by the box's width and y by its height, which sounds reasonable and is
    // not: the roam box is far wider than it is tall (the top margin is a whole body height), so
    // the same physical distance scored about 2.5x higher vertically. The bottom edge therefore
    // looked "much further from the cursor" than the right edge did while actually being closer,
    // and won almost every roll on that arithmetic alone. Measured: 62% of its life on the bottom
    // border, against 18% on the right - which is backwards from where a desktop is actually free.
    const scale = Math.max(1, right - left, bottom - top);
    const edges = [
      { id: 'left', safety: (reference.x - left) / scale },
      { id: 'right', safety: (right - reference.x) / scale },
      { id: 'top', safety: (reference.y - top) / scale },
      { id: 'bottom', safety: (bottom - reference.y) / scale },
    ];
    const currentEdge = nearestEdge(position, left, right, top, bottom);
    const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
    let total = 0;
    for (const edge of edges) {
      // Cubed so "clearly the far side" dominates, plus a floor so no edge is ever impossible
      // (a cat that can only ever use one border reads as broken, not as polite).
      edge.weight = Math.max(0.05, edge.safety) ** 3 * (edge.id === currentEdge ? 1 + cfg.edgePatrolBias : 1);
      // How welcome the cat is on that edge at all. The four borders of a desktop are not
      // interchangeable - see edgePreference.
      edge.weight *= edgePreference[edge.id] ?? 1;
      // Going to the OPPOSITE edge means crossing the middle of the screen, which is the one
      // place the user is certainly working. An adjacent edge gets there along a border instead.
      if (currentEdge && edge.id === OPPOSITE[currentEdge]) edge.weight *= cfg.oppositeEdgePenalty;
      total += edge.weight;
    }
    let roll = random() * total;
    let chosen = edges[edges.length - 1];
    for (const edge of edges) {
      roll -= edge.weight;
      if (roll <= 0) { chosen = edge; break; }
    }
    // Somewhere along that edge, avoiding the exact corners (a cat wedged in a corner reads
    // as stuck) - and keeping clear of the cursor's own coordinate on the travel axis.
    const alongX = rand(left + (right - left) * 0.08, right - (right - left) * 0.08);
    const alongY = rand(top + (bottom - top) * 0.08, bottom - (bottom - top) * 0.08);
    const point = (() => {
      switch (chosen.id) {
        case 'left': return { x: left, y: alongY };
        case 'right': return { x: right, y: alongY };
        case 'top': return { x: alongX, y: top };
        default: return { x: alongX, y: bottom };
      }
    })();
    // Push away from the single worst corner. Landing ON an edge is fine; landing in the corner
    // where the menu bar meets the window controls is sitting on top of the buttons the user
    // reaches for most.
    const corner = {
      x: cfg.worstCorner.x <= 0.5 ? left : right,
      y: cfg.worstCorner.y <= 0.5 ? top : bottom,
    };
    const span = Math.hypot(right - left, bottom - top);
    const fromCorner = distance(point, corner) / Math.max(1, span);
    if (fromCorner < 0.22 && random() > cfg.worstCornerPenalty) {
      // Slide along the chosen edge to the far end instead of rerolling the edge entirely -
      // the edge choice was already made on its own merits.
      if (chosen.id === 'left' || chosen.id === 'right') {
        point.y = corner.y === top ? bottom - (bottom - top) * 0.15 : top + (bottom - top) * 0.15;
      } else {
        point.x = corner.x === left ? right - (right - left) * 0.15 : left + (right - left) * 0.15;
      }
    }
    return point;
  }

  /** Which border the cat is actually standing on, or null if it isn't on one. "Nearest" alone
   *  is not enough: a cat in the dead centre of the screen is nearest to *some* edge, and
   *  handing that edge a patrol bonus would tilt the choice toward a border the cat has no
   *  relationship with - including one the cursor is sitting on. */
  function nearestEdge(point, left, right, top, bottom) {
    const gaps = [
      ['left', point.x - left],
      ['right', right - point.x],
      ['top', point.y - top],
      ['bottom', bottom - point.y],
    ];
    const [id, gap] = gaps.reduce((best, candidate) => (candidate[1] < best[1] ? candidate : best));
    const onIt = gap <= Math.min(right - left, bottom - top) * 0.12;
    return onIt ? id : null;
  }

  // --- toys ---------------------------------------------------------------------------
  // The cat's own drives (wander, avoid, follow) are all "where should I be"; a toy is the
  // one input that gives it "what am I trying to DO". It therefore outranks every autonomous
  // behavior below and is outranked only by a drag, which is the user's literal hand.

  /**
   * Put a toy on the desktop. Spawns clear of the cat so there is something to run at, rather
   * than materialising under its nose. An unknown kind is ignored rather than throwing - this
   * is reachable from a tray click and from an agent's HTTP POST.
   * @param {'yarn'|'feather'|'laser'} kind
   * @param {{x:number,y:number}|null} [at] where to drop it; defaults to a point across the
   *   work area from the cat.
   */
  function setToy(kind, at = null) {
    if (!TOY_KINDS.includes(kind)) return;
    // `at` arrives from an agent's HTTP POST and from tray state restore, so it has exactly
    // the trust level of any other remote input. clamp() cannot sanitise it - Math.min/max
    // propagate NaN - and a NaN toy position reaches chaseToy's moveToward, whose bearing
    // computation turns it into a NaN heading, which is how the cat vanished the last time
    // this class of input slipped through. A spawn point that is not a point falls back to
    // the default "across the work area" placement.
    const spawn = isFinitePoint(at)
      ? at
      : {
          x: position.x < bounds.width / 2 ? bounds.width * 0.75 : bounds.width * 0.25,
          y: clamp(position.y + rand(-120, 120), cfg.margin, Math.max(cfg.margin, bounds.height - cfg.margin)),
        };
    toy = {
      kind,
      position: {
        x: clamp(spawn.x, minX(), maxX()),
        y: clamp(spawn.y, minY(), maxY()),
      },
      velocity: { x: 0, y: 0 },
    };
    lastBatAt = -Infinity;
    charge = null;
    // The yarn ball arrives in your hand; the other two are cursor-driven anyway.
    toyHeld = kind === 'yarn';
  }

  /** Take the toy away; the cat goes back to whatever it was doing on the next tick. */
  function clearToy() {
    toy = null;
    charge = null;
    toyHeld = false;
    if (state === 'play_toy') {
      state = 'idle';
      idleUntil = null;
      target = null;
    }
  }

  /**
   * Throw the yarn ball (the user flicking it, or an agent). No-op for the wand and the laser,
   * which are driven by the cursor and have no momentum of their own.
   */
  function throwToy(velocity) {
    if (!toy || toy.kind !== 'yarn') return;
    // Same reasoning as setToy: the velocity comes from the bridge. NaN here reaches the
    // integrator directly (position += velocity * dt) and then the bounce clamp, which passes
    // NaN through, and the next chaseToy turns it into a NaN heading. A throw that cannot be
    // honoured is ignored, not half-applied.
    if (!isFinitePoint(velocity)) return;
    charge = null;
    toyHeld = false;
    toy.velocity = { x: velocity.x, y: velocity.y };
  }

  /**
   * Start winding up a throw: the ball comes to hand and stays at the cursor until released.
   * This is what makes the yarn ball a game rather than an object - you aim it, and how long
   * you hold decides how hard it goes ("毛线球跟随鼠标，当我点击，蓄力，然后跑出去").
   */
  function beginCharge(now) {
    if (!toy || toy.kind !== 'yarn') return false;
    toyHeld = true;
    charge = { since: now };
    toy.velocity = { x: 0, y: 0 };
    return true;
  }

  /** 0..1, how far the wind-up has got. The renderer draws this. */
  function chargeLevel(now) {
    if (!charge) return 0;
    return Math.min(1, (now - charge.since) / cfg.toyChargeMaxMs);
  }

  /**
   * Let go. `aim` is the direction to throw in (usually the cursor's recent travel, falling
   * back to away-from-the-cat so a motionless release still launches it somewhere useful).
   */
  function releaseCharge(now, aim) {
    if (!toy || !charge) return false;
    const level = chargeLevel(now);
    charge = null;
    toyHeld = false;
    let angle;
    if (aim && Math.hypot(aim.x, aim.y) > 1e-3) {
      angle = Math.atan2(aim.y, aim.x);
    } else {
      const dx = toy.position.x - position.x;
      const dy = toy.position.y - position.y;
      angle = Math.hypot(dx, dy) < 1e-6 ? rand(0, Math.PI * 2) : Math.atan2(dy, dx);
    }
    const speed = cfg.toyThrowSpeedMin + (cfg.toyThrowSpeedMax - cfg.toyThrowSpeedMin) * level;
    toy.velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
    return true;
  }

  /** Move the yarn ball (a drag), or reposition any toy. */
  function moveToy(point) {
    if (!toy) return;
    // A drag that is not a point is ignored whole: clamping would place a NaN-centred toy
    // that the cat then chases into a NaN heading (see setToy for that post-mortem).
    if (!isFinitePoint(point)) return;
    toy.position = {
      x: clamp(point.x, minX(), maxX()),
      y: clamp(point.y, minY(), maxY()),
    };
    toy.velocity = { x: 0, y: 0 };
  }

  /** Advance the toy itself. Who drives it is the whole difference between the three kinds. */
  function stepToy(deltaSeconds, cursor) {
    if (!toy) return;
    // The cursor-driven toys (laser dot, feather tip) get the plain work-area margin, NOT the
    // cat's body-aware per-edge margins. Those exist because the cat's anchor is its feet and
    // its body sticks up from there; a toy is a small thing centred on its own position, and
    // clamping a cursor-driven toy to the cat's keep-out would stop the laser from ever
    // reaching the top of the screen.
    //
    // The yarn ball is the exception, and which box it bounces in decides whether the game can
    // end at all. The cat chases with moveToward, which clamps to the cat's HARD margins - its
    // anchor box, top edge around (above-below)/2 when scaled up. Bouncing the ball in the
    // plain cfg.margin box let it settle up there, outside the cat's reachable set by far more
    // than toyReach (34px), and `if (toy)` in tick() has no timeout: the result was a cat
    // standing at the boundary of its own box forever, swatting air at a ball it could see but
    // never touch. The ball therefore bounces in the cat's box; only the cat can be there, so
    // every point of the ball's box is within its reach.
    const inCatBox = toy.kind === 'yarn';
    const loX = inCatBox ? minX() : cfg.margin;
    const hiX = inCatBox ? maxX() : Math.max(cfg.margin, bounds.width - cfg.margin);
    const loY = inCatBox ? minY() : cfg.margin;
    const hiY = inCatBox ? maxY() : Math.max(cfg.margin, bounds.height - cfg.margin);

    // In hand (whether or not you are winding up): the ball sits at the cursor and does not roll.
    if ((charge || toyHeld) && toy.kind === 'yarn') {
      if (cursor) {
        toy.position = { x: clamp(cursor.x, loX, hiX), y: clamp(cursor.y, loY, hiY) };
      }
      toy.velocity = { x: 0, y: 0 };
      return;
    }

    if (toy.kind === 'laser') {
      // Pinned to the cursor exactly. With no cursor it simply stays where it last was, which
      // reads as the dot being held still rather than the toy vanishing.
      if (cursor) toy.position = { x: clamp(cursor.x, loX, hiX), y: clamp(cursor.y, loY, hiY) };
      toy.velocity = { x: 0, y: 0 };
      return;
    }
    if (toy.kind === 'feather') {
      // Trails the cursor with a lag - a wand tip does not teleport with your hand, and the
      // lag is exactly what gives the cat something to overshoot.
      if (cursor) {
        const catchUp = 1 - Math.exp(-deltaSeconds * cfg.toyFeatherLag);
        toy.position = {
          x: clamp(toy.position.x + (cursor.x - toy.position.x) * catchUp, loX, hiX),
          y: clamp(toy.position.y + (cursor.y - toy.position.y) * catchUp, loY, hiY),
        };
      }
      toy.velocity = { x: 0, y: 0 };
      return;
    }

    // 'yarn': free physics - roll, slow down, bounce off the edges of the desktop.
    const decay = Math.exp(-deltaSeconds * cfg.toyFriction);
    toy.velocity = { x: toy.velocity.x * decay, y: toy.velocity.y * decay };
    let nx = toy.position.x + toy.velocity.x * deltaSeconds;
    let ny = toy.position.y + toy.velocity.y * deltaSeconds;
    if (nx < loX || nx > hiX) {
      nx = clamp(nx, loX, hiX);
      toy.velocity.x *= -cfg.toyBounceLoss;
    }
    if (ny < loY || ny > hiY) {
      ny = clamp(ny, loY, hiY);
      toy.velocity.y *= -cfg.toyBounceLoss;
    }
    toy.position = { x: nx, y: ny };
    if (Math.hypot(toy.velocity.x, toy.velocity.y) < cfg.toyRestSpeed) toy.velocity = { x: 0, y: 0 };
  }

  /** The cat's half of the game: run the toy down, and swat it when in reach. */
  function chaseToy(now, deltaSeconds) {
    state = 'play_toy';
    target = { ...toy.position };
    const gap = distance(position, toy.position);
    if (gap > cfg.toyReach) {
      // Aim at the toy itself rather than a standoff point: the cat is trying to reach it, not
      // to keep a polite distance from it.
      // A playful cat commits harder to the chase; a reserved one trots after it.
      moveToward(
        toy.position,
        deltaSeconds,
        cfg.speed * cfg.toyChaseSpeedMultiplier * traitFactor(personality.playfulness, 0.25),
      );
    }
    // Face what it is playing with, always - even standing over a stopped ball.
    if (Math.abs(toy.position.x - position.x) > 1) facing = toy.position.x >= position.x ? 1 : -1;

    // In your hand: the cat gathers itself just short of it rather than batting your fingers,
    // which is also what builds the anticipation for the throw.
    if (charge || toyHeld) return;

    if (gap <= cfg.toyReach && now - lastBatAt >= cfg.toyBatCooldownMs) {
      lastBatAt = now;
      batThisTick = true;
      // Only the yarn ball can actually be sent flying. Swatting the wand or the laser plays
      // the swat animation and achieves nothing, which is correct and is the joke.
      if (toy.kind === 'yarn') {
        // Away from the cat, with a wide random spread so the rally never turns into the ball
        // shuttling along one line forever.
        const dx = toy.position.x - position.x;
        const dy = toy.position.y - position.y;
        const base = Math.hypot(dx, dy) < 1e-6 ? rand(0, Math.PI * 2) : Math.atan2(dy, dx);
        const angle = base + rand(-0.9, 0.9);
        const speed = cfg.toyBatSpeed * rand(0.65, 1);
        toy.velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
      }
    }
  }

  function shortestAngle(radians) {
    return Math.atan2(Math.sin(radians), Math.cos(radians));
  }

  /**
   * Bend a desired bearing around the pointer instead of driving through it.
   *
   * Avoidance used to be all-or-nothing: pick a destination away from the cursor, and bolt if
   * the cursor lands on you. Nothing handled the ordinary case of a perfectly good destination
   * on the far side of where the user happens to be working, so the cat walked straight over
   * the pointer to get there. What was asked for is the obvious third option - go around it
   * ("自由活动的时候猫咪尽量不要去用户的鼠标附近和光标附近，可以绕过去").
   *
   * This aims at the TANGENT of the keep-out circle rather than applying a sideways shove. A
   * push scales with how badly you are already intruding, so it fights the approach and dies
   * out just as you reach the thing you were avoiding; a tangent is the actual edge of the
   * region to miss, so the path curves smoothly past and rejoins the original line by itself.
   *
   * Only the DESIRED bearing changes. Turn rate, the cornering taper and the step length are
   * untouched below, which is what keeps this from disturbing the gait: the cat walks the
   * detour exactly the way it walks anything else.
   */
  function detourAround(bearing, avoid) {
    if (!avoid) {
      detourSide = 0;
      return bearing;
    }
    const gap = distance(position, avoid);
    const radius = cfg.cursorKeepOut;
    // Outside the keep-out plus a little hysteresis: nothing to do, and forget which way round
    // we were going so the next approach is decided fresh.
    if (gap > radius * 1.15) {
      detourSide = 0;
      return bearing;
    }
    // Dead on the pointer. There is no "around" from here - the direction to it is undefined -
    // so leave the bearing alone and let the flee retarget in tick() deal with it.
    if (gap < 1e-6) return bearing;

    const toCursor = Math.atan2(avoid.y - position.y, avoid.x - position.x);
    const offBearing = shortestAngle(bearing - toCursor);
    // The pointer is behind us, or off to one side and we are already drawing away from it.
    // Steering here would be the cat swerving at something it has safely passed.
    if (Math.abs(offBearing) > Math.PI / 2) {
      detourSide = 0;
      return bearing;
    }

    // Half-angle subtended by the keep-out circle. Saturates at a right angle once we are
    // inside it, which turns the detour into "leave, sideways" - the correct escape.
    const half = gap <= radius ? Math.PI / 2 : Math.asin(Math.min(1, radius / gap));
    // Commit to a side and stay on it. Re-deciding every frame is precisely the pattern that
    // made the cat vibrate in place when avoidance was purely reactive, and a target that sits
    // near the line to the cursor would otherwise flip the choice on rounding noise alone.
    if (detourSide === 0) detourSide = offBearing >= 0 ? 1 : -1;
    return shortestAngle(toCursor + detourSide * half);
  }

  /**
   * Steer toward `dest` and move along the way the body is actually pointing.
   *
   * This used to translate straight at the destination on every tick, with the body's
   * orientation inferred afterwards from where it had ended up. Two things follow from that,
   * and both were reported: a change of destination teleported the direction of travel, so the
   * cat slid sideways or straight backwards into its new route rather than turning
   * ("猫应该会拐弯，现在只会直行和后退"); and since orientation was a derivative of position,
   * every wobble in position became a wobble in orientation.
   *
   * Now the engine owns a `heading` - the way the body points - and that heading is the ONLY
   * direction it can travel. Turning is therefore a real manoeuvre with a real turning circle:
   * to get somewhere behind it, the cat has to swing around. The renderer reads the heading
   * directly instead of differentiating position, which removes the noise path entirely.
   */
  function moveToward(dest, deltaSeconds, requestedSpeed = cfg.speed, avoid = null) {
    // Bounded by what the body can actually steer at - see maxTurnRadius.
    const speed = Math.min(requestedSpeed, cfg.maxTurnRate * cfg.maxTurnRadius);
    const d = distance(position, dest);
    if (d <= cfg.arriveThreshold) {
      position = { ...dest };
      return true; // arrived
    }

    turnTarget = null; // walking sets its own heading; a pending stand-still turn is moot
    const bearing = detourAround(Math.atan2(dest.y - position.y, dest.x - position.x), avoid);
    const error = shortestAngle(bearing - heading);
    // Arrival taper first, because the speed it produces is what the turn rate is derived from.
    const arrival = Math.min(1, d / Math.max(1, cfg.slowingRadius));
    const alignmentNow = Math.max(0, Math.cos(error));
    const paceFactor = (cfg.minTurnSpeedFactor + (1 - cfg.minTurnSpeedFactor) * alignmentNow) * arrival;
    const turnRate = Math.min(
      cfg.maxTurnRate,
      Math.max(cfg.turnRate, (speed * paceFactor) / Math.max(1, cfg.minTurnRadius)),
    );
    const maxTurn = turnRate * deltaSeconds;
    turning = Math.abs(error) <= maxTurn ? error / Math.max(deltaSeconds, 1e-6) : Math.sign(error) * turnRate;
    heading = shortestAngle(heading + (Math.abs(error) <= maxTurn ? error : Math.sign(error) * maxTurn));

    // Slow down for the corner. An animal that has to turn sharply cannot also sprint, and
    // without this the cat carves enormous arcs past its target and has to come back around.
    // At a right angle it is down to a crawl, which is what lets it pivot on the spot when the
    // destination is directly behind it.
    const alignment = Math.max(0, Math.cos(shortestAngle(bearing - heading)));
    const pace = (cfg.minTurnSpeedFactor + (1 - cfg.minTurnSpeedFactor) * alignment) * arrival;
    const step = Math.min(d, speed * pace * deltaSeconds);
    // Clamped, like every other position-setting path. Travelling along a heading rather than
    // straight at a (already clamped) destination means the arc of a turn can now swing wide of
    // the target, and without this that arc could carry the cat off the edge of the desktop.
    position = {
      x: clamp(position.x + Math.cos(heading) * step, minX(), maxX()),
      y: clamp(position.y + Math.sin(heading) * step, minY(), maxY()),
    };
    facing = Math.cos(heading) >= 0 ? 1 : -1;
    // the step above can itself cover the remaining distance (large speed or delta),
    // so check again rather than always waiting one more tick to notice arrival
    return distance(position, dest) <= cfg.arriveThreshold;
  }

  /**
   * Resize the world (e.g. the OS work area changed, or a monitor was unplugged).
   * Clamps the current position back into the new bounds.
   *
   * `next` comes from the host's window/monitor events. The other position-setting paths
   * validate their inputs because clamp() propagates NaN; this one used to trust its caller
   * and assign straight through, so one malformed resize event could make width NaN and - via
   * the clamp below - erase the cat in the same frame. A resize that is not a resize is
   * ignored and the current world kept.
   */
  function setBounds(next) {
    if (!next || !Number.isFinite(next.width) || !Number.isFinite(next.height) || next.width <= 0 || next.height <= 0) {
      return;
    }
    bounds = next;
    position = {
      x: clamp(position.x, minX(), maxX()),
      y: clamp(position.y, minY(), maxY()),
    };
  }

  /** User grabbed the character (window drag start). Position becomes host-driven. */
  function beginDrag(cursor) {
    state = 'dragged';
    dragOffset = { x: position.x - cursor.x, y: position.y - cursor.y };
    target = null;
    // The user's hand outranks everything, and a suggestion that was pending when the grab
    // started must not resume the moment they let go: the doc below promises "dragged always
    // wins", but an intent that merely SAT OUT the drag came back afterwards and the cat
    // walked off to obey a command the user had just overridden - put it down, it leaves.
    // Same for a mid-flight turnTo: the body should look where the user puts it, not finish
    // rotating towards somewhere else.
    aiIntent = null;
    turnTarget = null;
  }

  /** Drag continues; host reports the current cursor position each frame. */
  function updateDrag(cursor) {
    if (state !== 'dragged') return;
    // Clamped defensively, same as every other position-setting path (setBounds, wander/
    // avoid targets, resetPosition): the cursor itself can't leave the monitor, so a
    // legitimate grab should never need to either. This is the one path that previously
    // had no such guard - observed carrying the cat far off-bounds during a live test
    // (position (-490, 1400) against a 1470x956 screen) from a cause not yet root-caused;
    // clamping here prevents that outcome regardless of what produces a bad dragOffset.
    const next = {
      x: clamp(cursor.x + dragOffset.x, minX(), maxX()),
      y: clamp(cursor.y + dragOffset.y, minY(), maxY()),
    };
    // Keep the heading pointing the way it is being carried, so putting it down doesn't make
    // the body snap round to an orientation left over from before the grab.
    const dx = next.x - position.x;
    const dy = next.y - position.y;
    if (Math.hypot(dx, dy) > 2) heading = Math.atan2(dy, dx);
    position = next;
    dragUpdatedSinceLastTick = true;
  }

  /** User released the character; resume autonomous behavior. */
  function endDrag(now) {
    if (state !== 'dragged') return;
    state = 'idle';
    idleUntil = now + idleWindow();
    dragStuckSinceMs = null;
  }

  /**
   * An external driver (an "AI brain" - see packages/perception-contract) asks the cat to
   * walk to a specific point for a bounded time. This is a *suggestion*, not a takeover:
   * it is dropped immediately if the user grabs the cat (dragged always wins), and it
   * expires on its own so a misbehaving or disconnected driver can never strand the cat
   * in AI-directed mode forever.
   * @param {{x:number,y:number}} targetPoint
   * @param {number} now
   * @param {number} [holdMs] how long the suggestion stays valid, default 4000ms
   * @param {number} [speedMultiplier] 1 = the ordinary wander pace. Higher is a run: the
   *   scripted performances ("冲向屏幕", "跑过来亲亲") are only legible if the cat actually
   *   charges, and an ambling 90px/s crossing of a 1500px screen takes 17 seconds.
   */
  function suggestMoveTo(targetPoint, now, holdMs = 4000, speedMultiplier = 1) {
    if (state === 'dragged') return false; // the user's hands-on control always wins
    // Validated, not clamped. This used to lean on clamp() to sanitise the input, which does
    // not work at all for the case that actually happens: clamp is Math.min/Math.max, and
    // those propagate NaN rather than rejecting it, so `{"targetPoint":{}}` turned position
    // and heading into NaN and the cat vanished from the desktop - with every API call still
    // reporting success. NaN is self-sustaining once it reaches heading, so there is no later
    // point at which this could be caught. An intent that cannot be honoured is dropped.
    if (!isFinitePoint(targetPoint)) return false;
    const holdFor = Number.isFinite(holdMs) ? clamp(holdMs, 0, cfg.maxHoldMs) : 4000;
    aiIntent = {
      target: {
        x: clamp(targetPoint.x, minX(), maxX()),
        y: clamp(targetPoint.y, minY(), maxY()),
      },
      until: now + holdFor,
      speed: cfg.speed * (Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1),
    };
    return true;
  }

  /**
   * Turn on the spot to face `angle` (radians, screen space) without walking anywhere.
   *
   * Exists because a performance ends with the cat retreating, and retreating means walking
   * away, and walking away means the heading - and therefore the face - points into the screen.
   * The spine's presentation twist only recovers about 30 degrees of that, so the set piece
   * finished with the cat's expression turned away from the person it was performing for
   * ("头有时候会扭到右边...这样看不清楚表情"). Turning is a real manoeuvre at the body's own
   * turn rate, never a snap.
   */
  function turnTo(angle) {
    if (!Number.isFinite(angle)) return false;
    turnTarget = angle;
    return true;
  }

  /** Cancel any pending AI suggestion and return to autonomous behavior next tick. */
  function clearIntent() {
    aiIntent = null;
  }

  /**
   * Stand still for `ms`, without changing what the cat is otherwise doing.
   *
   * This exists because an action clip and locomotion both want the body. Playing, say, a
   * six-second grooming clip while the wander timer decides it is time to cross the desktop
   * gives you a cat gliding across the screen washing its face - and in 'auto' mode, where the
   * idle windows are short, it also meant scheduled clips were usually cut off a second in, so
   * they effectively never played ("工作模式动作也没有随机做"). A hold is deliberately weaker
   * than an AI intent: it suppresses autonomous movement only, and a drag, a toy or an explicit
   * intent all still override it.
   */
  function hold(ms, now) {
    if (!Number.isFinite(ms)) return;
    holdUntil = Math.max(holdUntil, now + clamp(ms, 0, cfg.maxHoldMs));
  }

  /**
   * Live-update how close the cursor has to get in 'auto' mode before the cat retargets
   * away (see `avoidRadius` above) - the management window's "性格行为" behavior presets
   * (安静/均衡/活泼) drive this at runtime, rather than only at construction time, since the
   * user can change the preset without restarting the app. Ignored if not a positive
   * number, so a bad/missing value from a corrupt settings file just leaves the previous
   * radius in effect instead of breaking avoidance entirely.
   * @param {number} radius
   */
  function setAvoidRadius(radius) {
    if (typeof radius === 'number' && Number.isFinite(radius) && radius > 0) {
      cfg.avoidRadius = radius;
    }
  }

  /**
   * Retained only so an older caller (a persisted setting, an agent written against the
   * previous build) does not blow up. There is one mode now - see INTERACTION_MODES - and this
   * does nothing. It is deliberately not an error: silently ignoring a setting that no longer
   * exists is kinder to an external driver than rejecting its whole request.
   */
  function setInteractionMode() {}

  /**
   * A hard recovery action, not a suggestion: recenter the cat and drop whatever it was
   * doing (drag, AI intent, mid-wander). For the tray/management "重置位置" button - a
   * safety valve for "it wandered/avoided its way somewhere I can't easily find it."
   * Always takes effect immediately, including overriding an active drag - a deliberate
   * menu click is an explicit override, not something that should be silently dropped.
   */
  function resetPosition() {
    position = { x: bounds.width / 2, y: bounds.height / 2 };
    state = 'idle';
    idleUntil = null;
    target = null;
    aiIntent = null;
    dragStuckSinceMs = null;
    dragUpdatedSinceLastTick = false;
    lastAvoidRetargetAt = -Infinity;
    holdUntil = 0;
    // Everything below was missing, and that is why "重置位置" did not rescue a cat that had
    // been fed a NaN: heading feeds straight back into moveToward, so a NaN left here
    // regenerates a NaN position on the very next tick and the reset appears to do nothing.
    heading = 0;
    turning = 0;
    facing = 1;
    turnTarget = null;
    detourSide = 0;
    lastCursor = null;
    lastPosition = null;
    cursorTravel = 0;
    catTravel = 0;
    pointerEngaged = false;
    pointerEngagedByUser = false;
  }

  /**
   * Last line of defence: if the simulation's own state has gone non-finite, put it back.
   *
   * Every known way in is now guarded at the input, so reaching this means something
   * unanticipated got through - and the failure mode is the worst one the app has, a cat that
   * silently ceases to exist while every API call still returns ok. Self-healing beats
   * preserving a broken state that nothing can inspect: `degraded` on the snapshot is how the
   * outside world finds out it happened, rather than being told a comforting `null`.
   */
  function enforceInvariants() {
    let repaired = false;
    if (!(isFinitePoint(position) && Number.isFinite(heading))) {
      resetPosition();
      repaired = true;
    }
    // The toy is simulation state too, and it reaches the cat's heading through chaseToy - a
    // toy at NaN is a cat at NaN one frame later. Where the body gets reset, the toy gets
    // taken away: it "rolled off the desk". Cheaper than repairing a corrupt toy into
    // somewhere plausible, and a broken toy is not worth a second enforcement round.
    if (toy && !isFinitePoint(toy.position)) {
      clearToy();
      repaired = true;
    }
    return repaired;
  }

  /**
   * Advance the simulation. Call once per animation frame.
   * @param {number} now performance.now()-style milliseconds
   * @param {{x:number,y:number}|null} cursor world-space cursor position, or null if unknown/outside bounds
   */
  /**
   * Decide whether the pointer being on the cat is the user reaching out, or the cat having
   * blundered into a pointer that was sitting still.
   *
   * These are the same picture at the moment of contact, and the app was treating them the
   * same: any pointer inside avoidRadius made the cat bolt, including one the user had just
   * deliberately moved onto it. The only thing that actually distinguishes them is WHO CLOSED
   * THE DISTANCE, so both parties' recent travel is tracked and compared.
   *
   * Decaying sums rather than per-frame deltas: a single frame is far too short a window to
   * tell a deliberate reach from sensor noise, and a hand that arrives and then rests would
   * otherwise stop counting as having arrived at all.
   *
   * The verdict LATCHES for the duration of one contact. A user who reaches over, touches the
   * cat and holds still has not stopped meaning it, and re-deciding as the travel sums decay
   * would have the cat warm up and then flee without the user doing anything.
   */
  function updatePointerInitiative(cursor, deltaSeconds) {
    if (!cursor) {
      pointerEngaged = false;
      pointerEngagedByUser = false;
      lastCursor = null;
      cursorTravel = 0;
      catTravel = 0;
      return;
    }
    const decay = deltaSeconds > 0 ? Math.exp(-deltaSeconds / cfg.pointerAttributionEase) : 1;
    cursorTravel *= decay;
    catTravel *= decay;
    if (lastCursor) cursorTravel += distance(cursor, lastCursor);
    if (lastPosition) catTravel += distance(position, lastPosition);
    lastCursor = { ...cursor };
    lastPosition = { ...position };

    pointerEngaged = distance(position, cursor) < cfg.pointerEngageRadius;
    if (!pointerEngaged) {
      pointerEngagedByUser = false;
      return;
    }
    // Already latched - the contact is still the same contact.
    if (pointerEngagedByUser) return;
    pointerEngagedByUser = cursorTravel > catTravel * cfg.pointerInitiativeRatio && cursorTravel > 4;
  }

  function tick(now, cursor) {
    // Before anything reads position or heading. A recovery here is recorded rather than
    // hidden, because "the cat vanished and then came back and nobody could say why" is
    // exactly the report this is meant to make impossible to file again.
    if (enforceInvariants()) recoveredAt = now;
    // A cursor is an input from outside and gets the same treatment as any other: a malformed
    // one is treated as "no cursor", never fed into the simulation.
    if (!isFinitePoint(cursor)) cursor = null;
    const elapsedMs = lastTickAt == null ? 0 : Math.max(0, now - lastTickAt);
    const deltaSeconds = lastTickAt == null ? 0 : Math.min(0.25, elapsedMs / 1000);
    lastTickAt = now;
    // Before any state decision reads them. `moving` is what the cat was doing over the
    // interval just ended, which is the interval the drain applies to.
    updateVitals(now, elapsedMs, state === 'wander' || state === 'play_toy' || state === 'ai_directed');
    batThisTick = false;
    turning = 0; // set by moveToward when it actually steers this tick
    chargeAmount = charge ? Math.min(1, (now - charge.since) / cfg.toyChargeMaxMs) : 0;
    updatePointerInitiative(cursor, deltaSeconds);

    // The toy moves whatever the cat is doing - a thrown ball keeps rolling while the cat is
    // being held, and the wand still follows your hand.
    stepToy(deltaSeconds, cursor);

    if (state === 'dragged') {
      // Safety net for a lost mouseup: a real drag calls updateDrag() every frame (the
      // host polls the cursor at 60Hz - see main.ts). If that stream goes quiet for too
      // long while we're still nominally "dragged", the release event almost certainly
      // never reached us (e.g. a fast drag briefly left the window's captured region and
      // the OS routed the mouseup elsewhere) - don't strand the cat in an undraggable,
      // unfollowable state forever because of it.
      if (dragUpdatedSinceLastTick) {
        dragUpdatedSinceLastTick = false;
        dragStuckSinceMs = null;
      } else {
        if (dragStuckSinceMs == null) dragStuckSinceMs = now;
        else if (now - dragStuckSinceMs > cfg.dragStaleMs) {
          state = 'idle';
          idleUntil = now + idleWindow();
          dragStuckSinceMs = null;
          return snapshot();
        }
      }
      return snapshot();
    }

    // Waking comes before every autonomous drive and before the intent handling below,
    // because all of them assume a cat that is up. A disturbance wakes it immediately; being
    // rested wakes it on its own terms.
    if (state === 'sleep') {
      if (sleepDisturbed()) {
        wakeUp(now);
      } else if (energy >= cfg.sleepWakeEnergy && sleepiness <= cfg.sleepWakeSleepiness) {
        wakeUp(now);
      } else {
        // Asleep and undisturbed: the body does nothing at all. No target, no heading change,
        // no idle timer - the renderer reads `state === 'sleep'` and plays the curl.
        return snapshot();
      }
    }

    if (aiIntent && now >= aiIntent.until) aiIntent = null; // suggestion expired
    if (aiIntent) {
      state = 'ai_directed';
      const arrived = moveToward(aiIntent.target, deltaSeconds, aiIntent.speed ?? cfg.speed);
      if (arrived) aiIntent = null; // reached it early; autonomy resumes next tick
      return snapshot();
    }
    // An intent ends three ways - it expires, it is cancelled, or the cat ARRIVES - and all
    // three have to hand the body back. Only the expiry path used to, so a cat that reached
    // its destination, or whose intent was cleared, was left standing in 'ai_directed'
    // forever: nothing below this line handles that state, so it simply stopped living. That
    // is one frame after every successful intent, which makes it the most reachable way to
    // freeze the cat in the whole engine.
    if (state === 'ai_directed') {
      state = 'idle';
      idleUntil = now + idleWindow();
      target = null;
    }

    // A toy outranks every autonomous drive below (wander, edge-avoidance, cursor-following):
    // while there is something to play with, that IS what the cat wants to do. It is outranked
    // only by a drag and by an explicit AI intent, both handled above.
    if (toy) {
      chaseToy(now, deltaSeconds);
      return snapshot();
    }

    // A hold suppresses only the autonomous drives below it. Everything that outranks it -
    // dragging, an AI intent, a toy - has already returned by this point.
    if (now < holdUntil) {
      if (state === 'wander') {
        state = 'idle';
        target = null;
      }
      // The time spent performing COUNTS as rest - it should not also buy a fresh full idle
      // window on top. Stacking the two meant every clip cost its own duration plus another
      // few seconds of standing about, and the cat barely patrolled at all.
      idleUntil = Math.max(idleUntil ?? 0, holdUntil);
      return snapshot();
    }

    // Courtesy: keep clear of the pointer. This is the cat's one hard social rule - the
    // pointer is where the user is working, so it is the one part of the desktop the cat must
    // not occupy. Rate-limited and commitment-based, NOT re-evaluated from scratch every
    // frame: "the cursor is on top of me" stays true for as long as the cursor sits there, so
    // re-rolling an escape target on each such frame is what used to make the cat vibrate in
    // place instead of walking away.
    //
    // The one exception is the user reaching out to touch it. That used to flee too, so
    // deliberately putting the pointer on the cat made it run away - affectionate clip playing
    // all the while, because the renderer was reading contact and the engine was reading
    // proximity and the two disagreed about what was happening.
    if (cursor && (state === 'idle' || state === 'wander') && !pointerEngagedByUser) {
      const cursorOnTopOfMe = distance(position, cursor) < cfg.avoidRadius;
      const routeUnsafe = state === 'wander' && target != null && distance(target, cursor) < cfg.avoidRadius;
      const cooledDown = now - lastAvoidRetargetAt >= cfg.avoidRetargetCooldownMs;
      if ((cursorOnTopOfMe || routeUnsafe) && cooledDown) {
        state = 'wander';
        target = pickEdgeRestTarget(cursor);
        lastAvoidRetargetAt = now;
      }
    }

    // Being petted: stand still and take it. Without this the wander timer eventually fires
    // mid-stroke and the cat walks out from under the user's hand, which reads as the cat
    // losing interest at exactly the moment the user was showing some.
    if (pointerEngagedByUser) {
      if (state === 'wander') {
        state = 'idle';
        target = null;
      }
      idleUntil = now + idleWindow();
    }

    // Turning on the spot outranks the idle timer but not locomotion: anything that actually
    // walks sets its own heading, so the request is simply dropped once the cat moves off.
    if (turnTarget != null) {
      const error = shortestAngle(turnTarget - heading);
      const maxTurn = cfg.maxTurnRate * deltaSeconds;
      if (Math.abs(error) <= maxTurn) {
        heading = shortestAngle(turnTarget);
        turning = error / Math.max(deltaSeconds, 1e-6);
        turnTarget = null;
      } else {
        heading = shortestAngle(heading + Math.sign(error) * maxTurn);
        turning = Math.sign(error) * cfg.maxTurnRate;
      }
      facing = Math.cos(heading) >= 0 ? 1 : -1;
    }

    if (state === 'idle') {
      if (idleUntil == null) idleUntil = now + idleWindow();
      if (settledSince == null) settledSince = now;
      // Lying down is checked before the wander timer, so a cat that got sleepy while resting
      // sleeps instead of setting off on one more trip it did not want to take.
      //
      // All four conditions matter: sleepy enough FOR THIS CAT (the trait moves the bar),
      // not still full of energy, settled rather than mid-anything, and undisturbed.
      if (
        sleepiness >= sleepThreshold()
        && energy < cfg.sleepRefuseAboveEnergy
        && now - settledSince >= cfg.sleepSettleMs
        && !sleepDisturbed()
      ) {
        fallAsleep(now);
        return snapshot();
      }
      if (now >= idleUntil) {
        state = 'wander';
        target = pickEdgeRestTarget(cursor);
        settledSince = null;
      }
    } else if (state === 'wander') {
      if (!target) target = pickEdgeRestTarget(cursor);
      // The cursor is passed as an obstacle here and nowhere else: this is the one state where
      // the cat is going somewhere purely because it felt like it, so it is the one state that
      // can afford to take the long way round. Chasing a toy or obeying an explicit intent must
      // still be able to go where it was told - including right at the pointer.
      const arrived = moveToward(target, deltaSeconds, walkSpeed(), cursor);
      if (arrived) {
        state = 'idle';
        idleUntil = now + idleWindow();
        target = null;
      }
    }

    return snapshot();
  }

  function snapshot() {
    return {
      state,
      position: { ...position },
      facing,
      heading,
      turning,
      target: target ? { ...target } : null,
      mode: 'free',
      /**
       * The pointer's relationship with the cat right now. `engaged` is contact; `byUser` says
       * the user brought the pointer here rather than the cat having walked into it. Renderers
       * gate affection on `byUser`, so a cat that blunders onto a parked cursor does not act
       * as though it was just petted.
       */
      pointer: { engaged: pointerEngaged, byUser: pointerEngagedByUser },
      /**
       * What the engine is currently being asked to do by an outside driver, and when that
       * expires. Previously write-only: an agent could post an intent but nothing could read
       * back what intent was in force, so "why does it keep walking that way" was unanswerable.
       */
      intent: aiIntent
        ? { target: { ...aiIntent.target }, until: aiIntent.until, speed: aiIntent.speed }
        : null,
      /**
       * Non-null only when the engine has had to repair its own state (see enforceInvariants).
       * The value is the timestamp of the last repair. Callers that see it move have proof
       * something fed the engine a value it could not represent - which beats the previous
       * behaviour of serialising NaN to `null` and leaving the driver unable to tell a broken
       * cat from a missing field.
       */
      recoveredAt,
      // Renderers that can draw a toy read this; ones that can't ignore it, same contract as
      // every other field here.
      toy: toy
        ? {
            kind: toy.kind,
            position: { ...toy.position },
            velocity: { ...toy.velocity },
            /** 0 when not being held, 0..1 while the user winds up a throw. */
            charge: chargeAmount,
            /** True while the ball is on the pointer rather than loose on the desktop. */
            held: toyHeld,
          }
        : null,
      /** True for exactly the one frame the cat swats the toy - drives the swat animation. */
      batted: batThisTick,
      /**
       * The slow-moving inner state: what makes 14:00 different from 04:00, and hour six of a
       * session different from hour one.
       *
       * Published rather than kept private because it is the only way anything outside can
       * explain the cat's behaviour. "Why is it so slow today" and "why has it been lying
       * there for twenty minutes" were previously unanswerable from any interface; with these
       * on the snapshot the debug console, the bridge and an agent can all read the reason.
       *
       * `nightness` is derived from the clock, not accumulated, so it is safe to read as the
       * current time-of-day weight rather than as history.
       */
      vitals: {
        energy,
        sleepiness,
        nightness: nightness(lastTickAt ?? Date.now()),
        /** The bar THIS cat has to cross to lie down, after its personality moves it. */
        sleepThreshold: sleepThreshold(),
        asleep: state === 'sleep',
        /** When it last fell asleep / last woke, or null. */
        sleptAt,
        wokeAt,
      },
      /** The traits in force, so a reader can tell a sleepy cat from a sleepy hour. */
      personality: { ...personality },
    };
  }

  return {
    get state() { return state; },
    get position() { return { ...position }; },
    get mode() { return 'free'; },
    get heading() { return heading; },
    get personality() { return { ...personality }; },
    get vitals() { return { energy, sleepiness, asleep: state === 'sleep' }; },
    setBounds,
    beginDrag,
    updateDrag,
    endDrag,
    suggestMoveTo,
    turnTo,
    clearIntent,
    hold,
    setInteractionMode,
    setPersonality,
    setAvoidRadius,
    setMargins,
    setEdgePreference,
    resetPosition,
    setToy,
    clearToy,
    throwToy,
    beginCharge,
    releaseCharge,
    chargeLevel,
    moveToy,
    get toy() {
      return toy
        ? { kind: toy.kind, position: { ...toy.position }, velocity: { ...toy.velocity }, held: toyHeld, charge: chargeAmount }
        : null;
    },
    tick,
  };
}
