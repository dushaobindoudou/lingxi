// What lands on the glass: the screen as a window pane the cat can hit. A stream of pee splashes into drops that sit,
// gather, merge and - once heavy enough - slide down in fits and starts, leaving a line of tiny drops behind them, the
// way rain runs down a window. A poop flies at the pane, squashes flat, sticks, and sags slowly down it, smearing.
//
// A 2D canvas over the stage, pointer-events none, running its own frame loop only while something is on the glass. The
// drops are sprites drawn once per kind and stretched as they run; a running drop wets the pane behind it (a second
// canvas that dries off slowly).
//
// The pane is right in front of the viewer, the cat behind it: what reaches it is big on screen, and a drop of water on
// a window is a lens - it shows the room behind it upside down, so its upper rim reads dark and a bright crescent
// gathers inside its lower edge, with one sharp reflection of the light up and to the left; almost clear, barely tinted.
// (Drawn as small solid beads below the cat, the first version read as pebbles on the floor, not wet on the glass.)

type Kind = 'pee' | 'poop';
interface Drop {
  kind: Kind;
  x: number; y: number; r: number;
  vx: number; vy: number;
  age: number; life: number;
  /** seconds left stuck before it may slide again */
  stuck: number;
  /** distance slid since it last left a drop behind */
  trail: number;
  /** a poop's squash as it lands (1 = settled) */
  squash: number;
  variant: number;
  /** the effect's scale it came with (1 = a cat ~250 px tall) */
  scale: number;
}
interface Flight { from: { x: number; y: number }; to: { x: number; y: number }; t: number; seconds: number; r: number; scale: number }
interface Stream { from: () => { x: number; y: number }; to: { x: number; y: number }; age: number; seconds: number; scale: number; nextDrop: number }

// sizes in CSS px for a cat ~250 px tall (the effect's `scale`): drops `drop` (smallest + up to `spread`) splashed within
// `reach` of where the stream hits; a drop over `slideRadius` runs down; merging, none grows past `largest` (left to
// grow, two or three merged into one swollen bubble a quarter of the cat's height)
const PEE = {
  slideRadius: 9, gravity: 520, drag: 2.2, stickPerSecond: 1.6, lifeFrom: 6, lifeTo: 9.5, mergeAt: 0.8,
  drop: 3, spread: 15, reach: 55, every: 0.028, largest: 13,
};
// a poop sags down the pane slowly and in fits (catching on it), and smears in uneven streaks: sliding at a drop's pace
// and leaving one even band it read as two potatoes on stalks
const POOP = { slideRadius: 9, gravity: 14, drag: 1.8, stickPerSecond: 1.2, lifeFrom: 7.5, lifeTo: 9, size: 30 };
// how fast the wet trails dry: the share of what is left wiped each frame
const DRY = 0.012;
const SPRITE = 128;

function dropSprite(kind: Kind, variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d')!;
  const m = SPRITE / 2, r = SPRITE * 0.42;
  if (kind === 'pee') {
    g.save();
    g.translate(m, m);
    // a faint shade under it, so it reads over a light desktop as well as a dark one
    const shade = g.createRadialGradient(0, r * 0.1, r * 0.6, 0, r * 0.1, r * 1.04);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.07)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = shade;
    g.beginPath(); g.arc(0, r * 0.1, r * 1.04, 0, Math.PI * 2); g.fill();
    // bottom-heavy on an upright pane
    const outline = () => { g.beginPath(); g.ellipse(0, r * 0.04, r, r * 0.96, 0, 0, Math.PI * 2); };
    outline();
    g.save();
    g.clip();
    // the body: nearly clear, a little pee-yellow, deeper toward the rim
    const body = g.createRadialGradient(0, -r * 0.25, r * 0.1, 0, 0, r);
    body.addColorStop(0, 'rgba(255, 248, 214, 0.08)');
    body.addColorStop(0.7, 'rgba(236, 206, 112, 0.15)');
    body.addColorStop(1, 'rgba(160, 118, 30, 0.32)');
    g.fillStyle = body;
    g.fillRect(-r, -r, r * 2, r * 2);
    // the dark upper rim: the room's darker upper half, turned over
    const rim = g.createLinearGradient(0, -r, 0, r * 0.3);
    rim.addColorStop(0, 'rgba(46, 32, 8, 0.55)');
    rim.addColorStop(1, 'rgba(46, 32, 8, 0)');
    g.strokeStyle = rim; g.lineWidth = r * 0.22;
    outline(); g.stroke();
    // the bright crescent inside the lower edge, where the light comes through focused
    const caustic = g.createRadialGradient(0, r * 0.62, r * 0.05, 0, r * 0.62, r * 0.62);
    caustic.addColorStop(0, 'rgba(255, 252, 232, 0.75)');
    caustic.addColorStop(1, 'rgba(255, 252, 232, 0)');
    g.fillStyle = caustic;
    g.beginPath(); g.ellipse(0, r * 0.62, r * 0.66, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    // a thin edge, and the light's reflection: one sharp spot up and to the left, a fleck beside it
    g.strokeStyle = 'rgba(70, 52, 14, 0.22)'; g.lineWidth = r * 0.035;
    outline(); g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.95)';
    g.beginPath(); g.ellipse(-r * 0.36, -r * 0.44, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.7)';
    g.beginPath(); g.arc(r * 0.16, -r * 0.6, r * 0.05, 0, Math.PI * 2); g.fill();
    g.restore();
    return c;
  }
  // poop: an uneven soft blob, shaded, glossy on top, with a few darker lumps
  const bumps = 13;
  const rnd = (i: number) => (Math.sin((i + 1) * 12.9898 * (variant + 1)) * 43758.5453) % 1;
  g.beginPath();
  for (let i = 0; i <= bumps * 4; i++) {
    const a = (i / (bumps * 4)) * Math.PI * 2;
    const k = 1 + 0.12 * Math.sin(a * 3 + variant) + 0.12 * Math.abs(rnd(i % bumps));
    const x = m + Math.cos(a) * r * k, y = m + Math.sin(a) * r * k * 0.82;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.save(); g.translate(r * 0.06, r * 0.12); g.fillStyle = 'rgba(40, 24, 10, 0.18)'; g.fill(); g.restore();
  const fill = g.createRadialGradient(m - r * 0.3, m - r * 0.35, r * 0.1, m, m, r * 1.1);
  fill.addColorStop(0, '#a57852');
  fill.addColorStop(0.55, '#7a5233');
  fill.addColorStop(1, '#4e321e');
  g.fillStyle = fill; g.fill();
  g.fillStyle = 'rgba(60, 36, 18, 0.35)';
  for (let i = 0; i < 6; i++) {
    const a = rnd(i + 3) * Math.PI * 2, d = Math.abs(rnd(i + 7)) * r * 0.6;
    g.beginPath(); g.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, r * (0.08 + 0.06 * Math.abs(rnd(i))), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(255, 240, 220, 0.45)';
  g.beginPath(); g.ellipse(m - r * 0.35, m - r * 0.4, r * 0.25, r * 0.12, -0.5, 0, Math.PI * 2); g.fill();
  return c;
}

export interface Glass {
  /** A stream of pee from `from` (re-read every frame: the cat's own rump) splashing on the pane at `to`. */
  stream(from: () => { x: number; y: number }, to: { x: number; y: number }, seconds: number, scale: number): void;
  /** A poop flung from `from` at the pane, landing at `to`. */
  fling(from: { x: number; y: number }, to: { x: number; y: number }, scale: number): void;
  clear(): void;
  dispose(): void;
}

export function createGlass(host: HTMLElement): Glass {
  let canvas: HTMLCanvasElement | null = null;
  let g: CanvasRenderingContext2D | null = null;
  let smear: HTMLCanvasElement | null = null;
  let smearG: CanvasRenderingContext2D | null = null;
  let width = 0, height = 0, dpr = 1;
  let frame = 0, last = 0;
  const drops: Drop[] = [];
  const flights: Flight[] = [];
  const streams: Stream[] = [];
  const sprites = new Map<string, HTMLCanvasElement>();
  const sprite = (kind: Kind, variant: number) => {
    const key = `${kind}${variant}`;
    if (!sprites.has(key)) sprites.set(key, dropSprite(kind, variant));
    return sprites.get(key)!;
  };

  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
    host.append(canvas);
    g = canvas.getContext('2d');
    smear = document.createElement('canvas');
    smearG = smear.getContext('2d');
    resize();
  }
  function resize() {
    if (!canvas || !smear) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = host.clientWidth; height = host.clientHeight;
    canvas.width = smear.width = Math.max(1, Math.round(width * dpr));
    canvas.height = smear.height = Math.max(1, Math.round(height * dpr));
  }
  function start() {
    ensure();
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }

  function add(kind: Kind, x: number, y: number, r: number, vx = 0, vy = 0, scale = 1): Drop {
    const p = kind === 'pee' ? PEE : POOP;
    const drop: Drop = {
      kind, x, y, r, vx, vy, age: 0, life: p.lifeFrom + Math.random() * (p.lifeTo - p.lifeFrom),
      stuck: Math.random() * 0.4, trail: 0, squash: kind === 'poop' ? 0 : 1, variant: Math.floor(Math.random() * 3), scale,
    };
    drops.push(drop);
    return drop;
  }

  function step(dt: number) {
    // the streams: drops splashing out round where each hits
    for (let i = streams.length - 1; i >= 0; i--) {
      const s = streams[i];
      s.age += dt;
      if (s.age > s.seconds) { streams.splice(i, 1); continue; }
      s.nextDrop -= dt;
      while (s.nextDrop <= 0) {
        s.nextDrop += PEE.every;
        // the glass is right in front of the viewer: what hits it is big, and spatters wide
        const a = Math.random() * Math.PI * 2, d = Math.abs(gauss()) * PEE.reach * s.scale;
        const r = (PEE.drop + Math.random() ** 2 * PEE.spread) * s.scale;
        add('pee', s.to.x + Math.cos(a) * d, s.to.y + Math.sin(a) * d * 0.8, r, Math.cos(a) * 60 * s.scale, Math.sin(a) * 40 * s.scale, s.scale);
      }
    }
    // flung poops: fly, then squash onto the pane with a spatter round them
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      f.t += dt;
      if (f.t < f.seconds) continue;
      flights.splice(i, 1);
      add('poop', f.to.x, f.to.y, f.r);
      for (let k = 0; k < 9; k++) {
        const a = Math.random() * Math.PI * 2, d = f.r * (1.1 + Math.random() * 1.6);
        add('poop', f.to.x + Math.cos(a) * d, f.to.y + Math.sin(a) * d, (1.2 + Math.random() * 3.5) * f.scale).squash = 1;
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      if (d.squash < 1) d.squash = Math.min(1, d.squash + dt / 0.3);
      const p = d.kind === 'pee' ? PEE : POOP;
      // a splash's own outward burst dies at once on the glass
      d.vx *= Math.exp(-dt * 14);
      const heavy = (d.r - p.slideRadius) / p.slideRadius;
      if (d.stuck > 0) { d.stuck -= dt; d.vy *= Math.exp(-dt * 20); }
      else if (heavy > 0) {
        d.vy += p.gravity * Math.min(1.5, heavy) * dt;
        d.vy *= Math.exp(-dt * p.drag);
        d.vx += (Math.random() - 0.5) * 30 * dt;
        // stick-slip: a run catches on the glass now and then
        if (Math.random() < (d.kind === 'pee' ? PEE.stickPerSecond : POOP.stickPerSecond) * dt) d.stuck = 0.08 + Math.random() * (d.kind === 'pee' ? 0.35 : 0.8);
      } else d.vy *= Math.exp(-dt * 25);
      const dy = d.vy * dt;
      d.x += d.vx * dt; d.y += dy;
      if (dy > 0) {
        d.trail += dy;
        if (d.kind === 'pee' && smearG && d.r > 3) {
          // a running drop wets the pane behind it: a faint streak with a glint down one side
          smearG.lineCap = 'round';
          smearG.strokeStyle = 'rgba(214, 184, 96, 0.07)'; smearG.lineWidth = d.r * 0.85 * dpr;
          smearG.beginPath(); smearG.moveTo(d.x * dpr, (d.y - dy - d.r * 0.4) * dpr); smearG.lineTo(d.x * dpr, (d.y - d.r * 0.4) * dpr); smearG.stroke();
          smearG.strokeStyle = 'rgba(255, 255, 255, 0.10)'; smearG.lineWidth = Math.max(1, d.r * 0.14) * dpr;
          smearG.beginPath(); smearG.moveTo((d.x - d.r * 0.25) * dpr, (d.y - dy - d.r * 0.4) * dpr); smearG.lineTo((d.x - d.r * 0.25) * dpr, (d.y - d.r * 0.4) * dpr); smearG.stroke();
        }
        if (d.kind === 'pee' && d.trail > d.r * 1.2 && d.r > 2.5) {
          // a run leaves a line of little drops behind it, and gets that much smaller
          d.trail = 0;
          const r = d.r * (0.18 + Math.random() * 0.17);
          add('pee', d.x + (Math.random() - 0.5) * d.r * 0.3, d.y - d.r * 0.9, r).stuck = 99;
          d.r = Math.sqrt(Math.max(0, d.r * d.r - r * r));
        }
        if (d.kind === 'poop' && smearG && d.r > 3) {
          // and a poop smears
          // a few uneven streaks across its width, now and then a blot
          smearG.lineCap = 'round';
          for (let k = 0; k < 4; k++) {
            const off = (Math.sin(k * 2.3 + d.variant) * 0.55) * d.r;
            smearG.strokeStyle = `rgba(${96 + k * 6}, ${60 + k * 4}, 32, ${0.03 + 0.05 * Math.random()})`;
            smearG.lineWidth = d.r * (0.12 + 0.22 * Math.random()) * dpr;
            smearG.beginPath(); smearG.moveTo((d.x + off) * dpr, (d.y - dy - d.r * 0.5) * dpr); smearG.lineTo((d.x + off) * dpr, (d.y - d.r * 0.5) * dpr); smearG.stroke();
          }
          if (Math.random() < 0.08) {
            smearG.fillStyle = 'rgba(92, 58, 30, 0.10)';
            smearG.beginPath(); smearG.ellipse((d.x + (Math.random() - 0.5) * d.r) * dpr, (d.y - d.r * 0.6) * dpr, d.r * 0.25 * dpr, d.r * 0.18 * dpr, 0, 0, Math.PI * 2); smearG.fill();
          }
        }
      }
      if (d.age > d.life || d.y - d.r > height) drops.splice(i, 1);
    }
    // drops that touch run together (the bigger one takes the other in)
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (a.kind !== 'pee') continue;
      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j];
        if (b.kind !== 'pee') continue;
        const dx = a.x - b.x, dy = a.y - b.y, reach = (a.r + b.r) * PEE.mergeAt;
        if (dx * dx + dy * dy > reach * reach) continue;
        const [big, small] = a.r >= b.r ? [a, b] : [b, a];
        const area = big.r * big.r + small.r * small.r;
        big.x = (big.x * big.r * big.r + small.x * small.r * small.r) / area;
        big.y = (big.y * big.r * big.r + small.y * small.r * small.r) / area;
        big.r = Math.min(Math.sqrt(area), PEE.largest * big.scale);
        big.vy = Math.max(big.vy, small.vy);
        big.stuck = Math.min(big.stuck, 0.05);
        big.age = Math.min(big.age, small.age);
        drops.splice(drops.indexOf(small), 1);
        if (small === a) { i--; break; }
        j--;
      }
    }
  }

  function draw() {
    if (!g || !canvas) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    // the wet trails and the smear, drying off - slower while a poop is still up there
    if (smear) {
      const poopLeft = drops.some((d) => d.kind === 'poop' && d.r > 3);
      if (smearG) {
        smearG.globalCompositeOperation = 'destination-out';
        smearG.fillStyle = `rgba(0,0,0,${poopLeft ? DRY * 0.25 : DRY})`;
        smearG.fillRect(0, 0, smear.width, smear.height);
        smearG.globalCompositeOperation = 'source-over';
      }
      g.drawImage(smear, 0, 0);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of streams) drawStream(g, s);
    for (const f of flights) {
      // flying at the viewer: growing as it comes
      const t = Math.min(1, f.t / f.seconds);
      const x = f.from.x + (f.to.x - f.from.x) * t, y = f.from.y + (f.to.y - f.from.y) * t - Math.sin(Math.PI * t) * 20 * f.scale;
      const r = f.r * (0.3 + 0.7 * t * t);
      g.drawImage(sprite('poop', 0), x - r, y - r, r * 2, r * 2);
    }
    for (const d of drops) {
      const fade = Math.min(1, (d.life - d.age) / 1.5, d.age / 0.05);
      if (fade <= 0) continue;
      g.globalAlpha = fade;
      // a running drop draws out long; a landing poop squashes flat and settles
      const stretch = 1 + Math.min(0.45, Math.max(0, d.vy) / 300);
      const sx = d.kind === 'poop' ? 1 + 0.6 * (1 - d.squash) : 1 / Math.sqrt(stretch);
      const sy = d.kind === 'poop' ? (0.45 + 0.55 * d.squash) * (1 + Math.max(0, d.vy) / 80) : stretch;
      const img = sprite(d.kind, d.kind === 'poop' ? d.variant : 0);
      g.drawImage(img, d.x - d.r * sx * 1.19, d.y - d.r * sy * 1.19, d.r * sx * 2.38, d.r * sy * 2.38);
    }
    g.globalAlpha = 1;
  }

  function drawStream(g: CanvasRenderingContext2D, s: Stream) {
    const from = s.from(), to = s.to;
    const fadeIn = Math.min(1, s.age / 0.15), fadeOut = Math.min(1, (s.seconds - s.age) / 0.3);
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0) return;
    // out of the rump and at the viewer: thin where it leaves the cat, thick as it reaches the pane in front of the eye
    const cx = (from.x + to.x) / 2 + (to.x - from.x) * 0.2, cy = from.y + (to.y - from.y) * 0.15;
    const at = (t: number) => ({
      x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x,
      y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y,
    });
    const steps = 22;
    g.lineCap = 'round';
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      if (t1 > 0.9) break;
      const a = at(t0), b = at(t1), w = (1.2 + 6 * t1 ** 1.6) * s.scale;
      // the stream itself, a translucent amber, and the light along its near edge
      g.strokeStyle = `rgba(222, 184, 70, ${0.72 * alpha})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = `rgba(255, 252, 232, ${0.65 * alpha})`; g.lineWidth = w * 0.28;
      g.beginPath(); g.moveTo(a.x - w * 0.2, a.y); g.lineTo(b.x - w * 0.2, b.y); g.stroke();
    }
    const flicker = Math.sin(s.age * 40) * 0.5 + 0.5;
    g.globalAlpha = alpha;
    // breaking into big drops just before the pane
    for (let k = 0; k < 5; k++) {
      const t = 0.88 + ((s.age * 2.5 + k * 0.21) % 0.12);
      const p = at(t);
      const r = (2.5 + k * 0.9 + flicker) * s.scale;
      g.drawImage(sprite('pee', 0), p.x + Math.sin(k * 7 + s.age * 20) * 4 * s.scale - r * 1.19, p.y - r * 1.19, r * 2.38, r * 2.38);
    }
    g.globalAlpha = 1;
  }
  function tick(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (canvas && (host.clientWidth !== width || host.clientHeight !== height)) resize();
    step(dt);
    draw();
    const smearLeft = drops.length > 0;
    if (drops.length || flights.length || streams.length || smearLeft) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      if (g && canvas) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); }
      if (smearG && smear) smearG.clearRect(0, 0, smear.width, smear.height);
    }
  }

  return {
    stream(from, to, seconds, scale) {
      streams.push({ from, to, age: 0, seconds, scale, nextDrop: 0.05 });
      start();
    },
    fling(from, to, scale) {
      flights.push({ from, to, t: 0, seconds: 0.32, r: POOP.size * scale, scale });
      start();
    },
    clear() {
      drops.length = flights.length = streams.length = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (g && canvas) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); }
      if (smearG && smear) smearG.clearRect(0, 0, smear.width, smear.height);
    },
    dispose() {
      this.clear();
      canvas?.remove();
      canvas = smear = null;
      g = smearG = null;
    },
  };
}

/** A standard normal sample (Box-Muller). */
function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
