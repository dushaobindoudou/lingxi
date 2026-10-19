import type { PettingRegion } from '../../../../packages/desktop-host-contract/index.d.ts';

type Point = { x: number; y: number };
export interface PettingReaction { region: PettingRegion; clip: string | null; expression: string }

/** Only an actual press-and-stroke earns affection. Hovering or a stationary click does not. */
export function createPettingSession() {
  let enabled = false, pressed = false;
  let previous: Point | null = null;
  let previousAt = 0, travel = 0, nextAt = 0;
  let region: PettingRegion | null = null;
  const resetStroke = () => { previous = null; region = null; travel = 0; };
  return {
    get enabled() { return enabled; },
    get pressed() { return pressed; },
    setEnabled(value: boolean) { enabled = value; pressed = false; resetStroke(); nextAt = 0; },
    press() { if (enabled) { pressed = true; resetStroke(); } },
    release() { pressed = false; resetStroke(); },
    tick(point: Point | null, hit: PettingRegion | null, now: number): PettingReaction | null {
      if (!enabled || !pressed || !point || !hit) { resetStroke(); return null; }
      if (hit !== region) { resetStroke(); region = hit; }
      if (previous) {
        const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
        const dt = now - previousAt;
        // Re-entry, a long pause or a fast sweep is not a gentle stroke.
        if (now >= nextAt && dt > 0 && dt < 180 && distance / dt < 1.2) travel += distance;
        else travel = 0;
      }
      previous = { ...point }; previousAt = now;
      if (now < nextAt || travel < 28) return null;
      travel = 0; nextAt = now + (hit === 'belly' ? 1800 : 2200);
      return { region: hit, clip: hit === 'head' ? 'pet-head' : hit === 'body' ? 'pet-back' : null,
        expression: hit === 'belly' ? '撒娇' : '陶醉' };
    },
  };
}

/** The middle of the roll exposes the belly; the standing/rolling transitions do not. */
export function bellyIsExposed(action: { id: string; remainingMs: number } | null | undefined, durationMs: number): boolean {
  if (action?.id !== 'belly-up' || durationMs <= 0) return false;
  const progress = 1 - action.remainingMs / durationMs;
  return progress >= 0.25 && progress <= 0.72;
}
