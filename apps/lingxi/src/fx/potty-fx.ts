// What the cat leaves on the floor, and the air round it. A poop comes down onto the floor under its rump the way soft
// serve does - a soft coil laid round and round from the bottom up, narrowing to a curled tip - and is later covered
// over with sand. (Flung at the glass, the first version read as two potatoes stuck to the screen; a cat does its
// business on the ground.) A fart is a few soft puffs of air from under the tail, swelling and drifting off.
//
// Both are drawn on their own 2D canvas / elements over the cat: the cat does this with its rump to the viewer, so what
// lands on the floor under the rump lies in front of the cat (on the floor layer, under the cat, it was hidden behind
// its haunches the whole time it came down).

// sizes in CSS px for a cat ~250 px tall (the effect's `scale`): the coil's base `width` and `height`, how many `turns`
// it makes, its rope's `thickness` at the bottom (thinning toward the top by `thinning`), and how far the strand it
// comes down on reaches up toward the rump
const SOFT_SERVE = { width: 46, height: 40, turns: 3.1, thickness: 9, thinning: 0.5, steps: 150 };
// pee: the puddle's size when the stream is done (CSS px for a cat ~250 px tall), how long it takes to dry after, and
// the stream's thickness where it leaves the cat and where it lands
const PUDDLE = { width: 100, height: 28, drySeconds: 4, streamFrom: 1.6, streamTo: 3.4 };
// the puffs: how many, how big (CSS px for a cat ~250 px tall), how long, how far they drift
const PUFF = { count: 5, size: 54, seconds: 1.7, drift: 75 };

export interface PottyFx {
  /**
   * A soft-serve poop under the rump: comes down over `buildMs` from `from` (the rump) onto the floor at `at`, sits,
   * and from `coverAtMs` is buried under sand, gone by `goneAtMs`.
   */
  softServe(from: () => { x: number; y: number }, at: { x: number; y: number }, scale: number, buildMs: number, coverAtMs: number, goneAtMs: number): void;
  /**
   * Pee from `from` (the rump, asked every frame) down onto the floor at `at` for `ms`: a stream arcing down and a
   * puddle spreading under it, with a little splash where it lands; the puddle dries off afterwards.
   */
  puddle(from: () => { x: number; y: number }, at: { x: number; y: number }, ms: number, scale: number): void;
  /** A few puffs of air from `at`, drifting toward `drift` (a unit-ish vector, screen px). */
  fart(at: { x: number; y: number }, scale: number, drift?: { x: number; y: number }): void;
  clear(): void;
}

export function createPottyFx(floor: () => HTMLElement | null, top: () => HTMLElement | null): PottyFx {
  const live = new Set<{ stop(): void }>();
  return {
    softServe(from, at, scale, buildMs, coverAtMs, goneAtMs) {
      const host = top() ?? floor();
      if (!host) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = SOFT_SERVE.width * scale * 2.2, h = SOFT_SERVE.height * scale * 1.9;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.cssText = `position:absolute;left:${at.x - w / 2}px;top:${at.y - h + SOFT_SERVE.height * scale * 0.3}px;width:${w}px;height:${h}px;pointer-events:none`;
      host.append(canvas);
      // the strand coming down from the rump
      const strand = document.createElement('canvas');
      strand.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
      const rect = host.getBoundingClientRect();
      strand.width = Math.round(rect.width * dpr); strand.height = Math.round(rect.height * dpr);
      host.append(strand);
      const g = canvas.getContext('2d')!, sg = strand.getContext('2d')!;
      const sand = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()), s: 0.6 + Math.random() * 1.4, t: Math.random() }));
      const start = performance.now();
      let frame = 0;
      const stop = () => { cancelAnimationFrame(frame); canvas.remove(); strand.remove(); live.delete(handle); };
      const handle = { stop };
      live.add(handle);
      const tick = (now: number) => {
        const ms = now - start;
        if (ms >= goneAtMs) { stop(); return; }
        const built = Math.min(1, ms / buildMs);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const base = { x: w / 2, y: h - SOFT_SERVE.height * scale * 0.3 };
        drawSoftServe(g, base, scale, easeOut(built));
        // buried: sand heaped over it, then the heap settles away
        const cover = clamp01((ms - coverAtMs) / 900);
        if (cover > 0) drawSand(g, base, scale, cover, sand);
        const fade = clamp01((goneAtMs - ms) / 500);
        canvas.style.opacity = String(fade);
        // the strand from the rump while it is still coming
        sg.setTransform(dpr, 0, 0, dpr, 0, 0);
        sg.clearRect(0, 0, rect.width, rect.height);
        if (built < 1) {
          const top = from(), tipY = at.y - SOFT_SERVE.height * scale * easeOut(built) * 0.95;
          sg.strokeStyle = '#6f4527'; sg.lineCap = 'round'; sg.lineWidth = SOFT_SERVE.thickness * scale * 0.7;
          sg.beginPath(); sg.moveTo(top.x - rect.left, top.y - rect.top); sg.lineTo(at.x - rect.left, tipY - rect.top); sg.stroke();
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    puddle(from, at, ms, scale) {
      const under = floor(), over = top();
      if (!under || !over) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const make = (host: HTMLElement) => {
        const rect = host.getBoundingClientRect();
        const c = document.createElement('canvas');
        c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr);
        c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
        host.append(c);
        return { c, g: c.getContext('2d')!, rect };
      };
      // the puddle on the floor, under the cat (its paws stand in it); the stream over it, from the rump in front
      const pool = make(under), stream = make(over);
      const splashes = Array.from({ length: 14 }, () => ({ a: Math.random() * Math.PI * 2, d: 0.4 + Math.random() * 0.9, r: 0.8 + Math.random() * 1.8, t: Math.random() }));
      const start = performance.now(), end = ms + PUDDLE.drySeconds * 1000;
      let frame = 0;
      const stop = () => { cancelAnimationFrame(frame); pool.c.remove(); stream.c.remove(); live.delete(handle); };
      const handle = { stop };
      live.add(handle);
      const tick = (now: number) => {
        const t = now - start;
        if (t >= end) { stop(); return; }
        const flowing = t < ms;
        // spreads fast at first, then slowly; dries (fades, shrinking a touch) once it stops
        const spread = 1 - Math.exp(-t / (ms * 0.35));
        const dry = flowing ? 1 : 1 - (t - ms) / (PUDDLE.drySeconds * 1000);
        const x = at.x - pool.rect.left, y = at.y - pool.rect.top;
        const rx = PUDDLE.width * scale * 0.5 * spread * (0.85 + 0.15 * dry), ry = PUDDLE.height * scale * 0.5 * spread * (0.85 + 0.15 * dry);
        const pg = pool.g;
        pg.setTransform(dpr, 0, 0, dpr, 0, 0);
        pg.clearRect(0, 0, pool.rect.width, pool.rect.height);
        if (rx > 0.5) {
          pg.globalAlpha = Math.max(0, dry);
          // a wobbly edge: a few lobes so it is a spill, not an ellipse
          pg.beginPath();
          for (let k = 0; k <= 48; k++) {
            const a = (k / 48) * Math.PI * 2;
            const wob = 1 + 0.08 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 5 + 0.4);
            const px = x + Math.cos(a) * rx * wob, py = y + Math.sin(a) * ry * wob;
            if (k === 0) pg.moveTo(px, py); else pg.lineTo(px, py);
          }
          pg.closePath();
          const fill = pg.createRadialGradient(x, y, 1, x, y, rx);
          fill.addColorStop(0, 'rgba(226, 196, 92, 0.42)');
          fill.addColorStop(0.8, 'rgba(214, 180, 74, 0.36)');
          fill.addColorStop(1, 'rgba(176, 140, 50, 0.45)');
          pg.fillStyle = fill; pg.fill();
          // the room's light lying on its wet surface: a soft streak along the far side
          pg.fillStyle = 'rgba(255, 250, 225, 0.45)';
          pg.beginPath(); pg.ellipse(x - rx * 0.15, y - ry * 0.35, rx * 0.5, ry * 0.16, -0.08, 0, Math.PI * 2); pg.fill();
          // a little splash round where it lands, while it is still coming
          if (flowing) for (const s of splashes) {
            const phase = (t / 420 + s.t) % 1;
            const d = s.d * rx * (0.3 + 0.7 * phase);
            pg.fillStyle = `rgba(232, 206, 110, ${0.5 * (1 - phase)})`;
            pg.beginPath(); pg.arc(x + Math.cos(s.a) * d, y + Math.sin(s.a) * d * 0.35 - Math.sin(Math.PI * phase) * 6 * scale, s.r * scale, 0, Math.PI * 2); pg.fill();
          }
          pg.globalAlpha = 1;
        }
        // the stream: from the rump, arcing out and down onto the floor - thin where it leaves the cat
        const sg = stream.g;
        sg.setTransform(dpr, 0, 0, dpr, 0, 0);
        sg.clearRect(0, 0, stream.rect.width, stream.rect.height);
        const fade = Math.min(1, t / 150, (ms - t) / 250);
        if (fade > 0) {
          const f = from(), fx0 = f.x - stream.rect.left, fy0 = f.y - stream.rect.top;
          const cx = fx0 + (x - fx0) * 0.55 + (x > fx0 ? 8 : -8) * scale, cy = fy0 + (y - fy0) * 0.15;
          const at2 = (u: number) => ({ x: (1 - u) ** 2 * fx0 + 2 * (1 - u) * u * cx + u * u * x, y: (1 - u) ** 2 * fy0 + 2 * (1 - u) * u * cy + u * u * y });
          sg.lineCap = 'round';
          for (let i = 0; i < 16; i++) {
            const a = at2(i / 16), b = at2((i + 1) / 16);
            const w = (PUDDLE.streamFrom + (PUDDLE.streamTo - PUDDLE.streamFrom) * (i / 16)) * scale;
            sg.strokeStyle = `rgba(226, 192, 80, ${0.75 * fade})`; sg.lineWidth = w;
            sg.beginPath(); sg.moveTo(a.x, a.y); sg.lineTo(b.x, b.y); sg.stroke();
            sg.strokeStyle = `rgba(255, 250, 225, ${0.6 * fade})`; sg.lineWidth = w * 0.3;
            sg.beginPath(); sg.moveTo(a.x - w * 0.2, a.y); sg.lineTo(b.x - w * 0.2, b.y); sg.stroke();
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    fart(at, scale, drift = { x: 0, y: -1 }) {
      const host = top();
      if (!host) return;
      for (let i = 0; i < PUFF.count; i++) {
        const puff = document.createElement('div');
        const size = PUFF.size * scale * (0.6 + 0.22 * i);
        const spread = (i - (PUFF.count - 1) / 2) * 18 * scale;
        puff.style.cssText = [
          'position:absolute;pointer-events:none;border-radius:50%',
          `left:${at.x - size / 2}px;top:${at.y - size / 2}px;width:${size}px;height:${size}px`,
          // greenish yellow, soft, mostly air - with a paler rim, so it reads as a puff and not a stain on the fur
          'background:radial-gradient(circle at 42% 40%, rgba(236,240,186,.62), rgba(196,208,128,.42) 48%, rgba(226,232,180,.30) 62%, rgba(170,180,110,0) 74%)',
          'filter:blur(1px)',
        ].join(';');
        host.append(puff);
        const dx = drift.x * PUFF.drift * scale + spread, dy = drift.y * PUFF.drift * scale - i * 8 * scale;
        const animation = puff.animate([
          { transform: 'translate(0,0) scale(.25)', opacity: 0 },
          { transform: `translate(${dx * 0.35}px,${dy * 0.35}px) scale(.9)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${dx}px,${dy}px) scale(1.7)`, opacity: 0 },
        ], { duration: PUFF.seconds * 1000, delay: i * 90, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
        const handle = { stop: () => { animation.cancel(); puff.remove(); live.delete(handle); } };
        live.add(handle);
        animation.onfinish = handle.stop;
      }
    },
    clear() {
      for (const h of [...live]) h.stop();
    },
  };
}

/** The coil laid so far (`built` 0..1, from the bottom up), round a base point on the floor. */
function drawSoftServe(g: CanvasRenderingContext2D, base: { x: number; y: number }, scale: number, built: number) {
  if (built <= 0) return;
  const S = SOFT_SERVE;
  // its shadow on the floor
  g.fillStyle = 'rgba(40, 24, 12, 0.18)';
  g.beginPath(); g.ellipse(base.x, base.y + 2 * scale, S.width * scale * 0.62, S.width * scale * 0.18, 0, 0, Math.PI * 2); g.fill();
  // the rope as overlapping round blobs along a narrowing spiral, the ones round the back drawn first
  const blobs: { x: number; y: number; r: number; depth: number; t: number }[] = [];
  const last = Math.floor(S.steps * built);
  for (let i = 0; i <= last; i++) {
    const t = i / S.steps;
    const angle = t * S.turns * Math.PI * 2;
    const radius = S.width * scale * 0.5 * (1 - t) ** 0.85;
    const thick = S.thickness * scale * (1 - S.thinning * t);
    blobs.push({
      x: base.x + Math.cos(angle) * radius,
      // seen from a little above: the coil's round squashed, each turn higher
      y: base.y - S.height * scale * t + Math.sin(angle) * radius * 0.32 - thick * 0.6,
      r: thick, depth: Math.sin(angle) + t * 3, t,
    });
  }
  // the curled tip
  if (built >= 1) {
    const top = blobs[blobs.length - 1];
    for (let k = 1; k <= 6; k++) blobs.push({ x: top.x + Math.sin(k * 0.55) * 3 * scale, y: top.y - k * 1.3 * scale, r: top.r * (1 - k / 8), depth: 10 + k, t: 1 });
  }
  blobs.sort((a, b) => a.depth - b.depth);
  for (const b of blobs) {
    const shade = g.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    shade.addColorStop(0, '#a87a52');
    shade.addColorStop(0.55, '#7c5132');
    shade.addColorStop(1, '#4f311c');
    g.fillStyle = shade;
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
  }
  // a soft gloss along the coil's upper edges
  g.fillStyle = 'rgba(255, 236, 214, 0.28)';
  for (const b of blobs) if (b.depth > 0.3) { g.beginPath(); g.ellipse(b.x - b.r * 0.3, b.y - b.r * 0.45, b.r * 0.35, b.r * 0.18, -0.4, 0, Math.PI * 2); g.fill(); }
}

/** Sand heaped over it (`cover` 0..1): grains falling in from round it, then a low mound. */
function drawSand(g: CanvasRenderingContext2D, base: { x: number; y: number }, scale: number, cover: number, grains: { a: number; r: number; s: number; t: number }[]) {
  const S = SOFT_SERVE;
  const mound = g.createRadialGradient(base.x, base.y - S.height * scale * 0.25, 2, base.x, base.y - S.height * scale * 0.2, S.width * scale * 0.75);
  mound.addColorStop(0, `rgba(222, 200, 156, ${0.95 * cover})`);
  mound.addColorStop(0.7, `rgba(206, 182, 134, ${0.9 * cover})`);
  mound.addColorStop(1, 'rgba(206, 182, 134, 0)');
  g.fillStyle = mound;
  g.beginPath(); g.ellipse(base.x, base.y - S.height * scale * 0.28 * cover, S.width * scale * 0.72, S.height * scale * (0.25 + 0.45 * cover), 0, 0, Math.PI * 2); g.fill();
  for (const grain of grains) {
    if (grain.t > cover) continue;
    const x = base.x + Math.cos(grain.a) * grain.r * S.width * scale * 0.7;
    const y = base.y - S.height * scale * 0.3 * cover + Math.sin(grain.a) * grain.r * S.height * scale * 0.5;
    g.fillStyle = 'rgba(176, 150, 104, 0.8)';
    g.beginPath(); g.arc(x, y, grain.s * scale, 0, Math.PI * 2); g.fill();
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - (1 - v) * (1 - v);
