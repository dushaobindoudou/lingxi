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

export const BEHAVIOR_STATES = Object.freeze(['idle', 'wander', 'follow_cursor', 'dragged', 'ai_directed']);

// 'auto' (default, "工作模式"): the cat stays out of the way - it never chases the cursor on
// its own, and its idle/wander resting spot is always a corner of the work area on the far
// side of the cursor from wherever it currently is, so it never sits on top of whatever the
// user is actually looking at. 'play' ("逗猫模式"): the cat unconditionally seeks out the
// cursor's position, at any distance, like an actual cat chasing a hand. Switching is exposed
// both to the tray/management UI and to a future AI driver - see suggestMoveTo's sibling
// setInteractionMode below and packages/perception-contract's AIIntent.mode.
export const INTERACTION_MODES = Object.freeze(['auto', 'play']);

const DEFAULTS = Object.freeze({
  bounds: { width: 1280, height: 800 },
  speed: 90, // units/second, autonomous wander pace
  idleDurationMsRange: [1500, 4500],
  wanderRadius: 260,
  followSpeedMultiplier: 2.5, // 'play' mode moves faster than idle wandering, to actually keep up
  followStandoff: 46, // 'play' mode: stop this far from the cursor, not exactly on top of it
  avoidRadius: 150, // 'auto' mode: if the cursor closes to within this, retarget away right away
  // 'auto' mode: how far across the safe half of the work area (as a fraction of that axis's
  // full range, 0-0.5) the rest point may land, instead of always the exact same corner
  // pixel. Large enough that the cat visibly roams the desktop rather than parking in place
  // (reported as "工作模式也不能看不到，需要在桌面上四处游走一下") while still biased to
  // whichever half is away from the cursor.
  edgeRestJitterFraction: 0.4,
  dragStaleMs: 700, // release a drag that stops getting updateDrag() calls (a lost mouseup)
  arriveThreshold: 6,
  margin: 24, // keep the cat's anchor point away from the very edge of the work area
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * @param {Partial<typeof DEFAULTS> & { position?: {x:number,y:number} }} [config]
 */
export function createLifeEngine(config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  let bounds = cfg.bounds;
  let state = 'idle';
  let position = config.position ?? { x: bounds.width / 2, y: bounds.height / 2 };
  let facing = 1; // +1 = facing +x, -1 = facing -x
  let target = null;
  let idleUntil = null; // lazily set on the first tick, once we know "now"
  let lastTickAt = null;
  let dragOffset = { x: 0, y: 0 };
  let aiIntent = null; // { target: {x,y}, until: msTimestamp } | null
  let dragUpdatedSinceLastTick = false;
  let dragStuckSinceMs = null;
  let interactionMode = 'auto';

  function pickWanderTarget() {
    const angle = randomBetween(0, Math.PI * 2);
    const radius = randomBetween(cfg.wanderRadius * 0.3, cfg.wanderRadius);
    const raw = { x: position.x + Math.cos(angle) * radius, y: position.y + Math.sin(angle) * radius };
    return {
      x: clamp(raw.x, cfg.margin, Math.max(cfg.margin, bounds.width - cfg.margin)),
      y: clamp(raw.y, cfg.margin, Math.max(cfg.margin, bounds.height - cfg.margin)),
    };
  }

  /**
   * A point on whichever half of the work area is farthest from `cursor` (or, with no cursor
   * signal, whichever half the cat is already in, so it doesn't have to cross the whole
   * screen to "get out of the way") - biased toward that half's outer corner, but roaming
   * broadly across it rather than always landing on the exact same pixel. This is 'auto'
   * mode's rest spot: a wander/avoid target picked as a random hop from the *current*
   * position - the original approach - is bounded by `wanderRadius` and a random angle each
   * time, so on a screen much larger than that radius it essentially never actually reaches
   * an edge (reported as "上下左右似乎无法移动到边缘位置"). Anchoring directly to a corner's
   * coordinates guarantees it gets there; the wide jitter (see `edgeRestJitterFraction`)
   * keeps it from reading as "always frozen in the same corner" instead of genuinely roaming.
   */
  function pickEdgeRestTarget(cursor) {
    const minX = cfg.margin;
    const maxX = Math.max(cfg.margin, bounds.width - cfg.margin);
    const minY = cfg.margin;
    const maxY = Math.max(cfg.margin, bounds.height - cfg.margin);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const goMinX = cursor ? cursor.x > midX : position.x < midX;
    const goMinY = cursor ? cursor.y > midY : position.y < midY;
    const fraction = Math.min(0.5, Math.max(0, cfg.edgeRestJitterFraction));
    const jitterX = randomBetween(0, (maxX - minX) * fraction);
    const jitterY = randomBetween(0, (maxY - minY) * fraction);
    return {
      x: clamp(goMinX ? minX + jitterX : maxX - jitterX, minX, maxX),
      y: clamp(goMinY ? minY + jitterY : maxY - jitterY, minY, maxY),
    };
  }

  /** A point `standoff` away from `target`, on the ray from `target` through `fromPos`. */
  function standoffPoint(fromPos, target, standoff) {
    const dx = fromPos.x - target.x;
    const dy = fromPos.y - target.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return { x: target.x + standoff, y: target.y };
    const scale = standoff / d;
    return { x: target.x + dx * scale, y: target.y + dy * scale };
  }

  function moveToward(dest, deltaSeconds, speed = cfg.speed) {
    const d = distance(position, dest);
    if (d <= cfg.arriveThreshold) {
      position = { ...dest };
      return true; // arrived
    }
    const step = Math.min(d, speed * deltaSeconds);
    const nx = position.x + ((dest.x - position.x) / d) * step;
    const ny = position.y + ((dest.y - position.y) / d) * step;
    facing = dest.x >= position.x ? 1 : -1;
    position = { x: nx, y: ny };
    // the step above can itself cover the remaining distance (large speed or delta),
    // so check again rather than always waiting one more tick to notice arrival
    return distance(position, dest) <= cfg.arriveThreshold;
  }

  /**
   * Resize the world (e.g. the OS work area changed, or a monitor was unplugged).
   * Clamps the current position back into the new bounds.
   */
  function setBounds(next) {
    bounds = next;
    position = {
      x: clamp(position.x, cfg.margin, Math.max(cfg.margin, bounds.width - cfg.margin)),
      y: clamp(position.y, cfg.margin, Math.max(cfg.margin, bounds.height - cfg.margin)),
    };
  }

  /** User grabbed the character (window drag start). Position becomes host-driven. */
  function beginDrag(cursor) {
    state = 'dragged';
    dragOffset = { x: position.x - cursor.x, y: position.y - cursor.y };
    target = null;
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
    position = {
      x: clamp(cursor.x + dragOffset.x, cfg.margin, Math.max(cfg.margin, bounds.width - cfg.margin)),
      y: clamp(cursor.y + dragOffset.y, cfg.margin, Math.max(cfg.margin, bounds.height - cfg.margin)),
    };
    dragUpdatedSinceLastTick = true;
  }

  /** User released the character; resume autonomous behavior. */
  function endDrag(now) {
    if (state !== 'dragged') return;
    state = 'idle';
    idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
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
   */
  function suggestMoveTo(targetPoint, now, holdMs = 4000) {
    if (state === 'dragged') return; // the user's hands-on control always wins
    aiIntent = {
      target: {
        x: clamp(targetPoint.x, cfg.margin, Math.max(cfg.margin, bounds.width - cfg.margin)),
        y: clamp(targetPoint.y, cfg.margin, Math.max(cfg.margin, bounds.height - cfg.margin)),
      },
      until: now + holdMs,
    };
  }

  /** Cancel any pending AI suggestion and return to autonomous behavior next tick. */
  function clearIntent() {
    aiIntent = null;
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
   * Switch between 'auto' ("工作模式": rests at a corner of the work area, out of the
   * cursor's way) and 'play' ("逗猫模式": unconditionally seeks out and hovers near the
   * cursor). Callable from the tray/management UI and from an external AI driver
   * (packages/perception-contract's AIIntent.mode) - both go through this same entry point.
   * @param {'auto'|'play'} mode
   */
  function setInteractionMode(mode) {
    if (!INTERACTION_MODES.includes(mode) || mode === interactionMode) return;
    interactionMode = mode;
    if (mode === 'auto' && state === 'follow_cursor') {
      // don't leave it stranded mid-chase when play mode is switched off
      state = 'idle';
      idleUntil = null;
      target = null;
    }
  }

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
  }

  /**
   * Advance the simulation. Call once per animation frame.
   * @param {number} now performance.now()-style milliseconds
   * @param {{x:number,y:number}|null} cursor world-space cursor position, or null if unknown/outside bounds
   */
  function tick(now, cursor) {
    const deltaSeconds = lastTickAt == null ? 0 : Math.min(0.25, (now - lastTickAt) / 1000);
    lastTickAt = now;

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
          idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
          dragStuckSinceMs = null;
          return snapshot();
        }
      }
      return snapshot();
    }

    if (aiIntent && now >= aiIntent.until) {
      aiIntent = null; // suggestion expired; fall through to normal autonomous logic below
      if (state === 'ai_directed') {
        state = 'idle';
        idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
      }
    }
    if (aiIntent) {
      state = 'ai_directed';
      const arrived = moveToward(aiIntent.target, deltaSeconds);
      if (arrived) aiIntent = null; // reached it early; next tick resumes autonomy
      return snapshot();
    }

    if (interactionMode === 'play') {
      // Unconditional: as long as a cursor position is known, at any distance, seek it.
      // Previously this only engaged inside `followRadius`, so unless the cursor happened to
      // wander near the cat first, "play" mode did nothing (reported as "逗猫模式时候，他会
      // 自动去找鼠标的位置" not actually happening) - an active tease-the-cat mode should
      // always go looking for the cursor, not wait for it to come close.
      if (cursor) {
        if (state !== 'follow_cursor') {
          state = 'follow_cursor';
          target = null;
        }
      } else if (state === 'follow_cursor') {
        state = 'idle';
        idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
        target = null;
      }
    } else if (state === 'follow_cursor') {
      // mode was switched away from 'play' mid-chase (should already be handled by
      // setInteractionMode, this is just a safety net)
      state = 'idle';
      idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
      target = null;
    }

    // 'auto' mode courtesy: if the cursor closes in on the cat's current spot or its rest
    // target, retarget to a fresh corner right away rather than waiting for the current
    // wander/idle cycle to finish. Unconditional on cursor presence alone (not "recent mouse
    // movement") - a cursor sitting still on top of the cat still blocks the view.
    if (interactionMode === 'auto' && cursor && (state === 'idle' || state === 'wander') && distance(position, cursor) < cfg.avoidRadius) {
      state = 'wander';
      target = pickEdgeRestTarget(cursor);
    } else if (interactionMode === 'auto' && cursor && state === 'wander' && target && distance(target, cursor) < cfg.avoidRadius) {
      target = pickEdgeRestTarget(cursor);
    }

    if (state === 'follow_cursor' && cursor) {
      // Clamped, same as every other destination-producing path (setBounds, drag,
      // pickEdgeRestTarget/pickWanderTarget, suggestMoveTo): `cursor` itself is host-reported
      // and was never guaranteed to be inside bounds (e.g. a second monitor, or a momentary
      // out-of-range reading), and standoffPoint can overshoot even a valid cursor further
      // outward. Unclamped, 'play' mode chasing such a cursor walks the cat out of bounds and
      // leaves it there once it "arrives" (idle has no reason to move again) - this was the
      // one moveToward() destination with no such guard.
      const dest = standoffPoint(position, cursor, cfg.followStandoff);
      const clampedDest = {
        x: clamp(dest.x, cfg.margin, Math.max(cfg.margin, bounds.width - cfg.margin)),
        y: clamp(dest.y, cfg.margin, Math.max(cfg.margin, bounds.height - cfg.margin)),
      };
      moveToward(clampedDest, deltaSeconds, cfg.speed * cfg.followSpeedMultiplier);
      // Face the cursor itself, not the standoff destination: once the cat has mostly
      // arrived, position and the standoff point can sit on nearly the same x, so the
      // direction moveToward() derives from them gets noisy and the cat flickers which
      // way it's facing (reported as "方向有时候也有问题"). Facing what it's actually
      // following is both more correct and numerically stable (cursor and position only
      // coincide exactly at the one instant it's grabbed).
      if (Math.abs(cursor.x - position.x) > 1) facing = cursor.x >= position.x ? 1 : -1;
    } else if (state === 'idle') {
      if (idleUntil == null) idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
      if (now >= idleUntil) {
        state = 'wander';
        // 'auto' mode always heads for a corner of the work area (see pickEdgeRestTarget);
        // 'play' mode only reaches here when the cursor is unknown, so it just fidgets in
        // place with the original local wander.
        target = interactionMode === 'auto' ? pickEdgeRestTarget(cursor) : pickWanderTarget();
      }
    } else if (state === 'wander') {
      if (!target) target = interactionMode === 'auto' ? pickEdgeRestTarget(cursor) : pickWanderTarget();
      const arrived = moveToward(target, deltaSeconds);
      if (arrived) {
        state = 'idle';
        idleUntil = now + randomBetween(...cfg.idleDurationMsRange);
        target = null;
      }
    }

    return snapshot();
  }

  function snapshot() {
    return { state, position: { ...position }, facing, target: target ? { ...target } : null, mode: interactionMode };
  }

  return {
    get state() { return state; },
    get position() { return { ...position }; },
    get mode() { return interactionMode; },
    setBounds,
    beginDrag,
    updateDrag,
    endDrag,
    suggestMoveTo,
    clearIntent,
    setInteractionMode,
    setAvoidRadius,
    resetPosition,
    tick,
  };
}
