// Full-screen effects layer ("特效").
//
// A DOM/SVG overlay sitting on top of the WebGL canvas, NOT geometry in the 3D scene. Three
// reasons: these effects are meant to read as marks on the glass of your monitor rather than
// as objects in the cat's world; CSS/SVG animation is the right tool for streaks and floating
// particles and costs nothing per frame when idle; and the layer is `pointer-events: none`
// throughout, so a full-screen effect can never swallow a click. That last point is not a
// detail - the companion window covers the entire work area, and anything here that captured
// input would make the desktop unusable for the duration of the effect.
//
// Every effect cleans itself up on animationend, so nothing accumulates across a long session.

/** Who a speech bubble speaks for - see StageFx.setBubbleAttribution. */
export interface BubbleAttribution {
  name: string;
  title?: string;
  badge?: string;
  logo?: string | null;
  markUrl?: string;
  color?: string;
}

export interface StageFx {
  mount(container: HTMLElement): void;
  /** Three tapered scratch marks, as if clawed into the screen at this point. */
  clawSlash(x: number, y: number, options?: { scale?: number; rotation?: number }): void;
  /** A burst of hearts drifting up from a point. */
  hearts(x: number, y: number, count?: number): void;
  /** Shake the cat (the WebGL canvas), not the marks - the marks are on the glass. */
  shake(pixels: number, durationMs: number): void;
  /**
   * 集中線 - radial speed lines converging on a point. The single most recognisable piece of
   * anime action grammar: lines bursting in at a moment of impact, or streaking past during a
   * charge. Deliberately reserved for performance beats rather than used continuously, because
   * the effect works by interrupting the normal look of the screen.
   */
  speedLines(
    x: number,
    y: number,
    options?: { durationMs?: number; intensity?: number; color?: string; track?: boolean },
  ): void;
  /** Re-centre every effect that asked to `track`, plus any speech bubble. Called once a frame
   *  by the host with the cat's current screen position. */
  anchorEffects(x: number, y: number): void;
  /**
   * Impact frame - the one- or two-frame solid flash that punctuates contact. It works by
   * interrupting the visual flow entirely and forcing the eye to reset, which is why it is a
   * flat fill rather than a glow.
   */
  impactFrame(options?: { durationMs?: number; color?: string }): void;
  /** Darken the edges of the screen to push attention to the middle. Returns a release fn. */
  vignette(durationMs: number, strength?: number): void;
  /** Roll the whole frame a few degrees - a dutch angle, for aggression. */
  tilt(degrees: number, durationMs: number): void;
  /**
   * A comic speech bubble above the cat's head. Only one at a time: a second line replaces the
   * first rather than stacking, because a pet talking over itself reads as a bug.
   * @param durationMs how long it stays up; it is sized from the text length if omitted.
   */
  say(text: string, durationMs?: number): void;
  /** Move the current bubble to sit above this screen point. Called every frame while one is
   *  up, because the cat it is anchored to is walking around. */
  anchorBubble(x: number, y: number): void;
  /**
   * Set who the next speech bubble is speaking for.
   *
   * Attribution rides on the BUBBLE rather than floating next to the cat: a mark pinned beside
   * the body is a HUD element that competes with the pet for attention and has no natural moment
   * to leave, whereas a bubble already has a reason to appear and a reason to go away. So the
   * logo lives in the bubble's corner and dies with it.
   *
   * `logo` is whatever the agent generated for itself - an SVG document or a data: URI. It is
   * rendered through an <img>, never inlined into the DOM, because an <img> cannot run script or
   * fetch anything external no matter what the markup says. That is the browser's own guarantee
   * and it is worth more than any sanitiser we could write.
   *
   * `markUrl` is the app's own bundled mark for a known host (ui/icons.ts), used when the agent
   * supplied no logo. `name` is the visible text - the session name when there is one - and
   * `title` the fuller hover text ("Claude Code · 会话名").
   */
  setBubbleAttribution(attribution: BubbleAttribution | null): void;
  /** True while a bubble is showing - the host uses it to skip the anchor work otherwise. */
  readonly speaking: boolean;
  /** Take any bubble down immediately. */
  hush(): void;
  /** Restyle the speech bubble. See BubbleStyle; a partial object leaves the rest alone. */
  setBubbleStyle(style: Partial<BubbleStyle>): void;
  /** Remove everything currently playing (a performance being cancelled). */
  clear(): void;
  dispose(): void;
}

/**
 * How the speech bubble looks. Every value is a CSS custom property on the bubble element, so a
 * user-supplied bubble.json reaches the rendering without any of this code knowing what is in
 * it - which is what makes "colours, fonts and shapes" one mechanism rather than three.
 */
export interface BubbleStyle {
  background: string;
  text: string;
  /** Attribution label; body text keeps `text`. */
  accentText: string;
  border: string;
  borderWidth: number;
  radius: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** round = a normal bubble, rect = square corners, cloud = a thought bubble, spiky = a shout. */
  shape: 'round' | 'rect' | 'cloud' | 'spiky';
  shadow: boolean;
}

export const DEFAULT_BUBBLE_STYLE: BubbleStyle = {
  background: '#fffdf8',
  // Softer than ink: a warm dark grey reads gentle at small sizes, and the hairline border
  // keeps the bubble present without a heavy comic outline.
  text: '#4a4149',
  accentText: '#8c7b6b',
  border: 'rgba(47, 42, 51, 0.3)',
  borderWidth: 1,
  radius: 18,
  fontFamily: '"PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  shape: 'round',
  shadow: true,
};

const STYLE_ID = 'lingxi-fx-styles';

/** Injected once. Keyframes live here rather than inline so each effect element stays cheap. */
const CSS = `
.lingxi-fx-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}
.lingxi-fx-claw {
  position: absolute;
  transform-origin: 50% 50%;
  animation: lingxi-claw-fade 1150ms ease-out forwards;
}
.lingxi-fx-claw path {
  stroke-linecap: round;
  fill: none;
  stroke-dasharray: var(--len);
  stroke-dashoffset: var(--len);
  animation: lingxi-claw-draw 130ms ease-in forwards;
}
@keyframes lingxi-claw-draw { to { stroke-dashoffset: 0; } }
@keyframes lingxi-claw-fade {
  0%   { opacity: 0; }
  9%   { opacity: 1; }
  55%  { opacity: 1; }
  100% { opacity: 0; }
}
.lingxi-fx-heart {
  position: absolute;
  font-size: 26px;
  line-height: 1;
  will-change: transform, opacity;
  animation: lingxi-heart-rise var(--dur) cubic-bezier(.25,.6,.3,1) forwards;
}
@keyframes lingxi-heart-rise {
  0%   { opacity: 0; transform: translate(-50%, 0) scale(.4) rotate(var(--tilt)); }
  14%  { opacity: 1; transform: translate(-50%, -14px) scale(1.12) rotate(var(--tilt)); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--drift)), var(--rise)) scale(.85) rotate(var(--tilt)); }
}
/* 集中線. Centred ON the focus point rather than covering the layer, so the element can simply
   be moved to follow a subject that is travelling. The group scales down toward its own centre
   while fading, so the lines appear to rush inward at whatever they are centred on. */
.lingxi-fx-speed {
  position: absolute;
  left: 0;
  top: 0;
  animation: lingxi-speed var(--dur) cubic-bezier(.2,.75,.35,1) forwards;
  transform-origin: 50% 50%;
}
@keyframes lingxi-speed {
  0%   { opacity: 0;   transform: translate(-50%, -50%) scale(1.55); }
  16%  { opacity: 1;   transform: translate(-50%, -50%) scale(1.12); }
  70%  { opacity: .75; transform: translate(-50%, -50%) scale(1.0); }
  100% { opacity: 0;   transform: translate(-50%, -50%) scale(.92); }
}
/* Impact frame: a flat fill, not a glow. It has to interrupt the image, not decorate it. */
.lingxi-fx-impact {
  position: absolute;
  inset: 0;
  animation: lingxi-impact var(--dur) steps(3, end) forwards;
}
@keyframes lingxi-impact {
  0%   { opacity: .92; }
  60%  { opacity: .55; }
  100% { opacity: 0; }
}
.lingxi-fx-vignette {
  position: absolute;
  inset: 0;
  animation: lingxi-vignette var(--dur) ease-in-out forwards;
}
@keyframes lingxi-vignette {
  0%, 100% { opacity: 0; }
  18%, 76% { opacity: 1; }
}
.lingxi-fx-tilted { animation: lingxi-tilt var(--dur) cubic-bezier(.36,.07,.19,.97); }
@keyframes lingxi-tilt {
  0%, 100% { transform: rotate(0deg); }
  22%, 70% { transform: rotate(var(--deg)); }
}
/* Comic speech bubble. The tail is a rotated square rather than a triangle so it inherits the
   same border and background as the body and always joins it cleanly. */
.lingxi-fx-bubble {
  position: absolute;
  --bubble-y: -100%;
  transform: translate(-50%, var(--bubble-y));
  /* Keep intrinsic width independent from the left edge. With width:auto an absolutely
     positioned bubble can shrink-to-fit the remaining space after we move it toward the
     right edge; for CJK that degenerates into one glyph per line. */
  width: max-content;
  max-width: min(280px, calc(100% - 24px));
  box-sizing: border-box;
  padding: 9px 15px;
  border-radius: var(--bubble-radius);
  border: var(--bubble-border-width) solid var(--bubble-border);
  background: var(--bubble-bg);
  color: var(--bubble-text);
  font-family: var(--bubble-font);
  font-size: var(--bubble-size);
  font-weight: var(--bubble-weight);
  line-height: 1.6;
  letter-spacing: 0.01em;
  text-align: left;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
  /* A long line scrolls inside the body, not the bubble: the tail below is the bubble's own
     ::after and sits half outside it, so a bubble that clips its overflow cuts the tail off. */
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--bubble-shadow);
  animation: lingxi-bubble-in 260ms cubic-bezier(.22,1,.36,1) forwards;
  transform-origin: 50% 100%;
}
/* The tail. A rotated square rather than a triangle so it inherits the same border and
   background as the body and always joins it cleanly, whatever the shape. */
.lingxi-fx-bubble::after {
  content: "";
  position: absolute;
  left: var(--bubble-tail-x, 50%);
  bottom: calc(var(--bubble-border-width) * -3.6);
  width: 15px;
  height: 15px;
  margin-left: -7px;
  background: var(--bubble-bg);
  border-right: var(--bubble-border-width) solid var(--bubble-border);
  border-bottom: var(--bubble-border-width) solid var(--bubble-border);
  border-bottom-right-radius: 3px;
  transform: rotate(45deg);
}
.lingxi-fx-bubble.below {
  --bubble-y: 0%;
}
.lingxi-fx-bubble.below::after {
  top: calc(var(--bubble-border-width) * -3.6);
  bottom: auto;
  border-right: 0;
  border-bottom: 0;
  border-left: var(--bubble-border-width) solid var(--bubble-border);
  border-top: var(--bubble-border-width) solid var(--bubble-border);
  transform: rotate(45deg);
}
/* A thought bubble trails little puffs instead of a pointer. */
.lingxi-fx-bubble.shape-cloud::after {
  width: 11px;
  height: 11px;
  margin-left: -5px;
  bottom: -14px;
  border: var(--bubble-border-width) solid var(--bubble-border);
  border-radius: 50%;
  transform: none;
  box-shadow: -10px 13px 0 calc(var(--bubble-border-width) * -0.8) var(--bubble-bg),
    -10px 13px 0 calc(var(--bubble-border-width) * 0.2) var(--bubble-border);
}
.lingxi-fx-bubble.shape-cloud.below::after {
  top: -14px;
  bottom: auto;
  border: var(--bubble-border-width) solid var(--bubble-border);
  border-radius: 50%;
  transform: none;
  box-shadow: 10px -13px 0 calc(var(--bubble-border-width) * -0.8) var(--bubble-bg),
    10px -13px 0 calc(var(--bubble-border-width) * 0.2) var(--bubble-border);
}
/* A shout: the outline itself is jagged, so the tail is folded into the clip path. */
.lingxi-fx-bubble.shape-spiky {
  border: none;
  border-radius: 0;
  padding: 16px 22px 22px;
  filter: drop-shadow(0 0 0 var(--bubble-border)) drop-shadow(0 3px 0 var(--bubble-border))
    drop-shadow(0 -3px 0 var(--bubble-border)) drop-shadow(3px 0 0 var(--bubble-border))
    drop-shadow(-3px 0 0 var(--bubble-border));
  clip-path: polygon(
    0% 22%, 7% 14%, 4% 4%, 16% 9%, 22% 0%, 32% 8%, 42% 2%, 50% 10%, 58% 2%, 68% 8%,
    78% 0%, 84% 9%, 96% 4%, 93% 14%, 100% 22%, 93% 32%, 100% 44%, 92% 52%, 98% 62%,
    88% 68%, 92% 80%, 56% 78%, 48% 100%, 42% 78%, 10% 80%, 14% 68%, 3% 62%, 9% 52%,
    0% 44%, 7% 32%
  );
}
.lingxi-fx-bubble.shape-spiky::after { display: none; }
.lingxi-fx-bubble.leaving { animation: lingxi-bubble-out 260ms ease-in forwards; }

/* Who the cat is speaking for. Sits on the bubble's corner and leaves with it - attribution is
   only meaningful while there is something to attribute, so it needs no life of its own. */
.lingxi-bubble-source {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--bubble-accent-text);
  font-size: .82em;
  font-weight: 600;
  letter-spacing: .02em;
  line-height: 1.2;
}
.lingxi-bubble-source-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lingxi-bubble-source { flex: none; }
.lingxi-bubble-body {
  min-height: 0;
  overflow: auto;
}
.lingxi-bubble-body.short { text-align: center; }
.lingxi-bubble-mark {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 6px;
  object-fit: contain;
  background: var(--mark-color, rgba(255, 255, 255, 0.14));
  padding: 2px;
  box-sizing: border-box;
  pointer-events: none;
}
.lingxi-bubble-badge {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--mark-color, rgba(255, 255, 255, 0.14));
  color: var(--bubble-text);
  font: 700 9px/1 system-ui, sans-serif;
  overflow: hidden;
  pointer-events: none;
}
@keyframes lingxi-bubble-in {
  0%   { opacity: 0; transform: translate(-50%, var(--bubble-y, -100%)) scale(.92); }
  100% { opacity: 1; transform: translate(-50%, var(--bubble-y, -100%)) scale(1); }
}
@keyframes lingxi-bubble-out {
  0%   { opacity: 1; transform: translate(-50%, var(--bubble-y, -100%)) scale(1); }
  100% { opacity: 0; transform: translate(-50%, calc(var(--bubble-y, -100%) - 8%)) scale(.94); }
}
.lingxi-fx-shaking { animation: lingxi-shake var(--dur) cubic-bezier(.36,.07,.19,.97); }
@keyframes lingxi-shake {
  0%, 100% { transform: translate(0, 0); }
  10% { transform: translate(calc(var(--amp) * -1), calc(var(--amp) * .4)); }
  22% { transform: translate(var(--amp), calc(var(--amp) * -.5)); }
  35% { transform: translate(calc(var(--amp) * -.75), calc(var(--amp) * -.3)); }
  48% { transform: translate(calc(var(--amp) * .7), calc(var(--amp) * .45)); }
  62% { transform: translate(calc(var(--amp) * -.45), calc(var(--amp) * .2)); }
  78% { transform: translate(calc(var(--amp) * .28), calc(var(--amp) * -.18)); }
  90% { transform: translate(calc(var(--amp) * -.12), 0); }
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const HEART_GLYPHS = ['💗', '💖', '❤️', '💕', '💞'];

/** How long a set attribution waits for its bubble before it is dropped unused. */
const ATTRIBUTION_TTL_MS = 3000;

export function createStageFx(): StageFx {
  let layer: HTMLDivElement | null = null;
  /** Who the next bubble speaks for, or null for the cat speaking as itself. */
  let attribution: BubbleAttribution | null = null;
  let attributionAt = 0;
  let shakeTarget: HTMLElement | null = null;
  let bubbleStyle: BubbleStyle = { ...DEFAULT_BUBBLE_STYLE };
  let bubble: HTMLDivElement | null = null;
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where the current bubble was last anchored, so a cat sitting still does not re-lay it out. */
  let bubbleAnchoredAt: { bubble: HTMLDivElement; x: number; y: number } | null = null;
  /** Effects that follow the cat rather than staying where they were fired. */
  const tracked = new Set<SVGElement>();

  function moveTo(node: SVGElement, x: number, y: number) {
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
  }

  /** Remove `node` once ITS OWN animation finishes, with a timer as the backstop for the case
   *  where the element never actually animates (reduced-motion, a backgrounded window).
   *
   *  The `event.target === node` guard is load-bearing, not defensive: animationend bubbles.
   *  A claw slash is an <svg> with a 1150ms fade whose three child <path>s each run their own
   *  130ms stroke-draw; without the guard the first path finishing drawing bubbled up here and
   *  tore the whole slash down after 130ms, so the marks flickered and vanished instead of
   *  being raked across the screen and fading. */
  function autoRemove(node: Element, maxMs: number, onRemove?: () => void) {
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      onRemove?.();
      node.remove();
    };
    node.addEventListener('animationend', (event) => {
      if (event.target === node) remove();
    });
    setTimeout(remove, maxMs);
  }

  return {
    mount(container: HTMLElement) {
      ensureStyles();
      layer = document.createElement('div');
      layer.className = 'lingxi-fx-layer';
      container.append(layer);
      shakeTarget = container.querySelector('canvas');
    },

    clawSlash(x, y, options = {}) {
      if (!layer) return;
      const scale = options.scale ?? 1;
      const width = 260 * scale;
      const height = 300 * scale;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'lingxi-fx-claw');
      svg.setAttribute('viewBox', '0 0 260 300');
      svg.style.width = `${width}px`;
      svg.style.height = `${height}px`;
      svg.style.left = `${x - width / 2}px`;
      svg.style.top = `${y - height / 2}px`;
      const rotation = options.rotation ?? (Math.random() - 0.5) * 0.5;
      svg.style.transform = `rotate(${rotation}rad)`;

      // Four strokes, close together and thin. Claw marks read as claw marks because they are
      // a tight parallel set - spread them out or thicken them and they stop being scratches
      // and become bars of light, which is exactly what the first version looked like on
      // screen. The middle two are the longest and heaviest, as with a real paw.
      const strokes: [number, number, number, number][] = [
        // startX, stroke width, start delay, length fraction
        [96, 3.4, 0, 0.82],
        [120, 5.2, 26, 1.0],
        [144, 4.8, 48, 0.96],
        [167, 3.0, 72, 0.78],
      ];
      for (const [startX, thickness, delayMs, lengthFraction] of strokes) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const drift = (Math.random() - 0.5) * 9;
        const top = 12 + (1 - lengthFraction) * 120;
        const bottom = 292 - (1 - lengthFraction) * 80;
        const mid = (top + bottom) / 2;
        // Slight S-curve: a swipe arcs, it does not travel in a straight line.
        const d =
          `M ${startX} ${top} C ${startX + 9 + drift} ${mid - 40}, ` +
          `${startX + 2 + drift} ${mid + 40}, ${startX + 17 + drift} ${bottom}`;
        path.setAttribute('d', d);
        path.setAttribute('stroke', 'rgba(255,252,252,0.95)');
        path.setAttribute('stroke-width', String(thickness));
        path.style.setProperty('--len', '340');
        path.style.animationDelay = `${delayMs}ms`;
        path.style.filter = 'drop-shadow(0 0 3px rgba(255,120,150,0.9)) drop-shadow(0 0 8px rgba(255,60,110,0.45))';
        svg.append(path);
      }
      layer.append(svg);
      autoRemove(svg, 1600);
    },

    hearts(x, y, count = 9) {
      if (!layer) return;
      for (let i = 0; i < count; i += 1) {
        const heart = document.createElement('div');
        heart.className = 'lingxi-fx-heart';
        heart.textContent = HEART_GLYPHS[Math.floor(Math.random() * HEART_GLYPHS.length)];
        heart.style.left = `${x + (Math.random() - 0.5) * 90}px`;
        heart.style.top = `${y + (Math.random() - 0.5) * 30}px`;
        heart.style.fontSize = `${18 + Math.random() * 20}px`;
        heart.style.setProperty('--rise', `${-130 - Math.random() * 170}px`);
        heart.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
        heart.style.setProperty('--tilt', `${(Math.random() - 0.5) * 40}deg`);
        heart.style.setProperty('--dur', `${1500 + Math.random() * 900}ms`);
        heart.style.animationDelay = `${i * 55}ms`;
        layer.append(heart);
        autoRemove(heart, 3200);
      }
    },

    shake(pixels, durationMs) {
      if (!shakeTarget) return;
      const target = shakeTarget;
      // Restart cleanly if a second shake lands while the first is still running - without
      // this, re-adding the class mid-animation does nothing at all.
      target.classList.remove('lingxi-fx-shaking');
      void target.offsetWidth; // force reflow so the animation can be re-triggered
      target.style.setProperty('--amp', `${pixels}px`);
      target.style.setProperty('--dur', `${durationMs}ms`);
      target.classList.add('lingxi-fx-shaking');
      setTimeout(() => target.classList.remove('lingxi-fx-shaking'), durationMs + 60);
    },

    speedLines(x, y, options = {}) {
      if (!layer) return;
      const durationMs = options.durationMs ?? 700;
      const intensity = Math.max(0.1, Math.min(1, options.intensity ?? 0.75));
      const color = options.color ?? 'rgba(255,255,255,0.85)';
      const rect = layer.getBoundingClientRect();
      // One square canvas centred on the focus, big enough to reach every corner from anywhere.
      const span = Math.hypot(rect.width || 1600, rect.height || 1000) * 2;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'lingxi-fx-speed');
      svg.setAttribute('viewBox', `${-span / 2} ${-span / 2} ${span} ${span}`);
      svg.style.width = `${span}px`;
      svg.style.height = `${span}px`;
      svg.style.setProperty('--dur', `${durationMs}ms`);

      // Each line is a thin triangle: wide out at the edge, converging to a point near the
      // centre. Angles are jittered rather than evenly spaced - a perfectly regular fan reads
      // as a machine part, not as drawn speed lines.
      const count = Math.round(34 + intensity * 46);
      const outer = span / 2;
      // The clear middle is what keeps the subject readable inside the burst.
      const innerBase = Math.min(rect.width || 1600, rect.height || 1000) * (0.16 + (1 - intensity) * 0.1);
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI * 2) / count;
        const inner = innerBase * (0.75 + Math.random() * 0.6);
        const spread = (0.004 + Math.random() * 0.016) * (0.5 + intensity);
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute(
          'points',
          `${Math.cos(angle) * inner},${Math.sin(angle) * inner} ` +
            `${Math.cos(angle - spread) * outer},${Math.sin(angle - spread) * outer} ` +
            `${Math.cos(angle + spread) * outer},${Math.sin(angle + spread) * outer}`,
        );
        poly.setAttribute('fill', color);
        poly.setAttribute('opacity', String(0.35 + Math.random() * 0.6));
        svg.append(poly);
      }
      svg.style.transform = 'translate(-50%, -50%)';
      moveTo(svg, x, y);
      // Tracked effects follow the cat. A burst fired at the moment a charge STARTS is centred
      // wherever the cat was standing then - and the cat immediately runs away from it, leaving
      // the focus burning on an empty patch of desktop while the subject is elsewhere. Anchoring
      // it to the cat is what makes it read as the cat bursting out of the focus.
      if (options.track) tracked.add(svg);
      layer.append(svg);
      autoRemove(svg, durationMs + 260, () => tracked.delete(svg));
    },

    impactFrame(options = {}) {
      if (!layer) return;
      const durationMs = options.durationMs ?? 90;
      const flash = document.createElement('div');
      flash.className = 'lingxi-fx-impact';
      flash.style.background = options.color ?? '#ffffff';
      flash.style.setProperty('--dur', `${durationMs}ms`);
      layer.append(flash);
      autoRemove(flash, durationMs + 200);
    },

    vignette(durationMs, strength = 0.7) {
      if (!layer) return;
      const node = document.createElement('div');
      node.className = 'lingxi-fx-vignette';
      node.style.background =
        `radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(0,0,0,${strength * 0.55}) 78%, rgba(0,0,0,${strength}) 100%)`;
      node.style.setProperty('--dur', `${durationMs}ms`);
      layer.append(node);
      autoRemove(node, durationMs + 200);
    },

    tilt(degrees, durationMs) {
      if (!shakeTarget) return;
      const target = shakeTarget;
      target.classList.remove('lingxi-fx-tilted');
      void target.offsetWidth;
      target.style.setProperty('--deg', `${degrees}deg`);
      target.style.setProperty('--dur', `${durationMs}ms`);
      target.classList.add('lingxi-fx-tilted');
      setTimeout(() => target.classList.remove('lingxi-fx-tilted'), durationMs + 60);
    },

    get speaking() {
      return bubble != null;
    },

    setBubbleAttribution(next) {
      attribution = next;
      attributionAt = performance.now();
    },

    say(text, durationMs) {
      if (!layer) return;
      const trimmed = text.trim().slice(0, 140);
      if (!trimmed) return;
      this.hush();
      // Long lines need longer on screen; short ones should not linger.
      const hold = durationMs ?? Math.min(9000, 1800 + trimmed.length * 130);
      const node = document.createElement('div');
      node.className = `lingxi-fx-bubble shape-${bubbleStyle.shape}`;
      node.style.setProperty('--bubble-bg', bubbleStyle.background);
      node.style.setProperty('--bubble-text', bubbleStyle.text);
      node.style.setProperty('--bubble-accent-text', bubbleStyle.accentText);
      node.style.setProperty('--bubble-border', bubbleStyle.border);
      node.style.setProperty('--bubble-border-width', `${bubbleStyle.borderWidth}px`);
      node.style.setProperty('--bubble-radius', bubbleStyle.shape === 'rect' ? '2px' : `${bubbleStyle.radius}px`);
      node.style.setProperty('--bubble-font', bubbleStyle.fontFamily);
      node.style.setProperty('--bubble-size', `${bubbleStyle.fontSize}px`);
      node.style.setProperty('--bubble-weight', String(bubbleStyle.fontWeight));
      // The hard offset shadow is comic-book depth - right for a shout (spiky), too loud for a
      // quiet line. Soft shapes get a diffuse lift instead.
      node.style.setProperty(
        '--bubble-shadow',
        !bubbleStyle.shadow
          ? 'none'
          : bubbleStyle.shape === 'spiky'
            ? '0 6px 0 rgba(47, 42, 51, 0.18), 0 10px 22px rgba(0, 0, 0, 0.28)'
            : '0 2px 6px rgba(47, 42, 51, 0.07), 0 14px 32px rgba(47, 42, 51, 0.13)',
      );
      const body = document.createElement('div');
      body.className = `lingxi-bubble-body${trimmed.length <= 12 && !trimmed.includes('\n') ? ' short' : ''}`;
      body.textContent = trimmed;
      // Attribution is for the ONE bubble it was set for, which arrives right behind it. It used
      // to stick: after any agent spoke once, every later bubble - a reminder, the cat's own
      // line when petted - wore that agent's mark and session name.
      const source = attribution && performance.now() - attributionAt < ATTRIBUTION_TTL_MS ? attribution : null;
      attribution = null;
      const sourceRow = source ? document.createElement('div') : null;
      if (sourceRow) sourceRow.className = 'lingxi-bubble-source';
      const makeBadge = () => {
        if (!source?.badge) return null;
        const fallback = document.createElement('span');
        fallback.className = 'lingxi-bubble-badge';
        fallback.textContent = source.badge.slice(0, 2);
        fallback.title = source.name;
        if (source.color) fallback.style.setProperty('--mark-color', source.color);
        return fallback;
      };
      // The agent's own logo wins; a known host without one falls back to the mark the app
      // ships for it (a bundled asset URL, not agent-supplied markup).
      const markSrc = source?.logo
        ? source.logo.startsWith('data:')
          ? source.logo
          : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source.logo)}`
        : source?.markUrl;
      if (source && markSrc) {
        // <img> rather than inline markup, deliberately: an <img> is a hard sandbox for SVG -
        // no script, no external fetches - so an agent-generated document cannot reach anything.
        const mark = document.createElement('img');
        mark.className = 'lingxi-bubble-mark';
        mark.alt = source.name;
        mark.title = source.title ?? source.name;
        mark.src = markSrc;
        if (source.color) mark.style.setProperty('--mark-color', source.color);
        // Fall back to the short registered badge if a supplied image cannot be decoded.
        mark.addEventListener('error', () => {
          const fallback = makeBadge();
          if (fallback) mark.replaceWith(fallback);
          else mark.remove();
        });
        sourceRow?.append(mark);
      } else if (source?.badge) {
        sourceRow?.append(makeBadge()!);
      }
      if (sourceRow && source) {
        const name = document.createElement('span');
        name.className = 'lingxi-bubble-source-name';
        name.textContent = source.name;
        if (source.title) name.title = source.title;
        sourceRow.append(name);
        node.append(sourceRow);
      }
      node.append(body);
      layer.append(node);
      bubble = node;
      bubbleTimer = setTimeout(() => {
        node.classList.add('leaving');
        bubbleTimer = setTimeout(() => {
          node.remove();
          if (bubble === node) bubble = null;
        }, 280);
      }, hold);
    },

    setBubbleStyle(style) {
      bubbleStyle = { ...bubbleStyle, ...style };
    },

    anchorEffects(x, y) {
      for (const node of tracked) moveTo(node, x, y);
    },

    anchorBubble(x, y) {
      if (!bubble) return;
      // Called every frame. Measuring the bubble below forces a layout whenever the previous frame
      // moved it, so a bubble over a cat that has not moved is left exactly where it is.
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (bubbleAnchoredAt?.bubble === bubble && bubbleAnchoredAt.x === rx && bubbleAnchoredAt.y === ry) return;
      bubbleAnchoredAt = { bubble, x: rx, y: ry };
      // Keep the entire bubble inside the transparent companion window. The cat is allowed to
      // roam to the display edge, but a centred bubble there would lose its left/right half.
      // Width is explicit in CSS (rather than auto) so measuring it here cannot create a
      // right-edge feedback loop where each reposition makes the next layout narrower.
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const viewportWidth = layer?.clientWidth ?? width;
      const viewportHeight = layer?.clientHeight ?? height;
      const inset = 12;
      const minCenter = Math.min(viewportWidth / 2, width / 2 + inset);
      const maxCenter = Math.max(viewportWidth / 2, viewportWidth - width / 2 - inset);
      const safeX = Math.max(minCenter, Math.min(maxCenter, x));
      const left = safeX - width / 2;
      // The tail should continue to point toward the cat after the bubble is pulled inward,
      // while staying away from a rounded corner where it would look detached.
      const tailPercent = Math.max(8, Math.min(92, ((x - left) / Math.max(1, width)) * 100));
      bubble.style.setProperty('--bubble-tail-x', `${tailPercent}%`);

      // Prefer above-head placement. If the cat is near the top edge, flip below it; when
      // neither side has enough room (small window / unusually long text), clamp the visible
      // rectangle instead of letting it disappear off-screen.
      const aboveTop = y - height;
      const belowTop = y;
      const canFitAbove = aboveTop >= inset;
      const canFitBelow = belowTop + height <= viewportHeight - inset;
      const below = !canFitAbove && canFitBelow;
      bubble.classList.toggle('below', below);
      const visualTop = below
        ? belowTop
        : Math.max(inset, Math.min(Math.max(inset, viewportHeight - height - inset), aboveTop));
      bubble.style.left = `${Math.round(safeX)}px`;
      bubble.style.top = `${Math.round(below ? visualTop : visualTop + height)}px`;
    },

    hush() {
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = null;
      bubble?.remove();
      bubble = null;
    },

    clear() {
      this.hush();
      tracked.clear();
      if (layer) layer.replaceChildren();
      shakeTarget?.classList.remove('lingxi-fx-shaking');
      shakeTarget?.classList.remove('lingxi-fx-tilted');
    },

    dispose() {
      layer?.remove();
      layer = null;
      shakeTarget = null;
    },
  };
}
