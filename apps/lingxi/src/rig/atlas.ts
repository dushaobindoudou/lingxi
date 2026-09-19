// Texture atlas layout for the box rig - the Minecraft model: every box gets one rectangular
// region of a single shared image, unwrapped as the standard six-face cross.
//
// This is what lifts the skin system off its per-box-flat-colour ceiling. Flat colours cannot
// express tabby banding, a pale belly, white socks, or a muzzle patch - all of which are
// where a blocky cat's charm actually comes from. It's also what makes a PNG skin possible:
// the layout is deterministic from skeleton.json, so a painted PNG and the generated default
// are interchangeable as long as they agree on this layout.

import type { NodeSpec } from './skeleton.ts';

// ─── colour utilities ─────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * amount, g * amount, b * amount);
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** One box's six-face footprint, in texels, with its origin in the atlas. */
export interface BoxRegion {
  /** Texel origin (left, top) of the whole six-face cross. */
  x: number;
  y: number;
  /** Box dimensions in texels. */
  w: number;
  h: number;
  d: number;
}

export interface AtlasLayout {
  size: number;
  texelsPerUnit: number;
  regions: Record<string, BoxRegion>;
}

/** Standard box unwrap. Total footprint is (2d + 2w) x (d + h):
 *
 *        .--d--..--w--..--d--..--w--.
 *        |     ||     ||     ||     |
 *   d    |     || top ||     ||botm |
 *        '-----''-----''-----''-----'
 *        .-----..-----..-----..-----.
 *   h    |right||front|| left|| back|
 *        '-----''-----''-----''-----'
 */
function footprint(region: Pick<BoxRegion, 'w' | 'h' | 'd'>): { width: number; height: number } {
  return { width: 2 * region.d + 2 * region.w, height: region.d + region.h };
}

export interface FaceRects {
  /** Order matches THREE.BoxGeometry's material groups: +X, -X, +Y, -Y, +Z, -Z. */
  px: [number, number, number, number];
  nx: [number, number, number, number];
  py: [number, number, number, number];
  ny: [number, number, number, number];
  pz: [number, number, number, number];
  nz: [number, number, number, number];
}

export function faceRects(r: BoxRegion): FaceRects {
  const { x, y, w, h, d } = r;
  return {
    px: [x, y + d, d, h], // right
    pz: [x + d, y + d, w, h], // front (the cat faces +Z)
    nx: [x + d + w, y + d, d, h], // left
    nz: [x + 2 * d + w, y + d, w, h], // back
    py: [x + d, y, w, d], // top
    ny: [x + d + w, y, w, d], // bottom
  };
}

/**
 * Shelf packer. Boxes are sorted tallest-first and laid left to right until the row is full,
 * then a new shelf starts below. Good enough here: the box set is fixed, small, and packed
 * once at build time, so packing quality matters far less than the layout being stable and
 * reproducible (a PNG painted against it must stay valid).
 */
export function computeAtlasLayout(nodes: readonly NodeSpec[], texelsPerUnit = 4): AtlasLayout {
  const measured = nodes.map((node) => {
    const [sx, sy, sz] = node.box.size;
    return {
      id: node.id,
      // Never round a box down to zero texels - whiskers are 0.15 units wide.
      w: Math.max(1, Math.round(sx * texelsPerUnit)),
      h: Math.max(1, Math.round(sy * texelsPerUnit)),
      d: Math.max(1, Math.round(sz * texelsPerUnit)),
    };
  });

  const order = [...measured].sort((a, b) => footprint(b).height - footprint(a).height);

  // Try successively larger power-of-two atlases until everything fits. Starting small keeps
  // the texture cheap for simple rigs and lets a heavier one grow without a magic constant.
  for (let size = 64; size <= 2048; size *= 2) {
    const regions: Record<string, BoxRegion> = {};
    let shelfY = 0;
    let shelfHeight = 0;
    let cursorX = 0;
    let ok = true;

    for (const box of order) {
      const { width, height } = footprint(box);
      if (width > size) {
        ok = false;
        break;
      }
      if (cursorX + width > size) {
        shelfY += shelfHeight;
        shelfHeight = 0;
        cursorX = 0;
      }
      if (shelfY + height > size) {
        ok = false;
        break;
      }
      regions[box.id] = { x: cursorX, y: shelfY, w: box.w, h: box.h, d: box.d };
      cursorX += width;
      shelfHeight = Math.max(shelfHeight, height);
    }

    if (ok) return { size, texelsPerUnit, regions };
  }
  throw new Error('atlas layout does not fit in 2048 texels');
}

// ─── atlas painter ────────────────────────────────────────────────────────────

type Ctx2D = CanvasRenderingContext2D;

/** Fill the six-face cross for one node using its atlas region. */
function fillRegion(ctx: Ctx2D, r: BoxRegion, color: string): void {
  ctx.fillStyle = color;
  // Full cross bounding rect (safe over-fill; background is opaque, so ordering is fine)
  ctx.fillRect(r.x, r.y, 2 * r.d + 2 * r.w, r.d + r.h);
}

/** Fill one named face with a colour. */
function fillFace(ctx: Ctx2D, r: BoxRegion, face: keyof FaceRects, color: string): void {
  const [fx, fy, fw, fh] = faceRects(r)[face];
  ctx.fillStyle = color;
  ctx.fillRect(fx, fy, fw, fh);
}

/** Draw horizontal stripes across the four side faces (right, front, left, back). */
function sideFaceStripes(ctx: Ctx2D, r: BoxRegion, stripeColor: string, count: number): void {
  const { x, y, w, h, d } = r;
  // Side faces run from y+d to y+d+h
  const totalH = h;
  const sw = Math.max(1, Math.round(totalH * 0.15));
  ctx.fillStyle = stripeColor;
  for (let i = 0; i < count; i++) {
    const sy = y + d + Math.round((totalH * (i + 0.5)) / count - sw / 2);
    ctx.fillRect(x, sy, 2 * d + 2 * w, sw);
  }
}

/**
 * Generates a canvas texture atlas for the given nodes and layout. The canvas can be used
 * directly as a THREE.CanvasTexture, giving the cat tabby markings, a belly patch, inner
 * ear, muzzle, and paw pads - none of which are possible with flat per-slot colours.
 *
 * colorFor(nodeId, slot) returns the base hex colour for a given node. It is called with
 * the node's primary slot first; the painter may call it with secondary slots (e.g. 'iris',
 * 'nose', 'pattern') for marking colours.
 */
export function paintAtlas(
  nodes: readonly NodeSpec[],
  layout: AtlasLayout,
  colorFor: (nodeId: string, slot: string) => string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = layout.size;
  canvas.height = layout.size;
  const ctx = canvas.getContext('2d')!;

  // Transparent-black background - texels that nothing writes to show as invisible.
  ctx.clearRect(0, 0, layout.size, layout.size);

  for (const node of nodes) {
    const region = layout.regions[node.id];
    if (!region) continue;

    const id = node.id;
    const fur = colorFor(id, 'fur');
    const pattern = colorFor(id, 'pattern');
    const base = colorFor(id, node.slot);

    // ── body (torso spine stack + hips) ──────────────────────────────────────
    if (/^(hipC|spine[0-4]|chest)$/.test(id)) {
      fillRegion(ctx, region, fur);
      // Tabby banding on all four side faces
      sideFaceStripes(ctx, region, pattern, 3);
      // Belly: -Y (bottom) face lighter
      fillFace(ctx, region, 'ny', lighten(fur, 0.55));
    }

    // ── neck ─────────────────────────────────────────────────────────────────
    else if (/^neck[12]$/.test(id)) {
      fillRegion(ctx, region, fur);
      sideFaceStripes(ctx, region, pattern, 2);
    }

    // ── tail ─────────────────────────────────────────────────────────────────
    else if (/^tail\d$/.test(id)) {
      const t = parseInt(id.slice(4)); // 0–6
      // Tip darkens toward end
      const tailColor = mix(fur, darken(fur, 0.55), t / 6);
      fillRegion(ctx, region, tailColor);
      if (t % 2 === 0) {
        sideFaceStripes(ctx, region, darken(tailColor, 0.65), 2);
      }
    }

    // ── head ─────────────────────────────────────────────────────────────────
    else if (id === 'head') {
      fillRegion(ctx, region, fur);
      // M-stripe on top (+Y face): three thin vertical bars
      const { x, y, w, d } = region;
      const stripe = darken(mix(fur, pattern, 0.7), 0.8);
      ctx.fillStyle = stripe;
      const sw = Math.max(1, Math.round(w * 0.1));
      ctx.fillRect(x + d + Math.round(w * 0.25), y, sw, d);
      ctx.fillRect(x + d + Math.round(w * 0.45), y, sw, d);
      ctx.fillRect(x + d + Math.round(w * 0.65), y, sw, d);
      // Cheek stripes on side faces
      sideFaceStripes(ctx, region, pattern, 2);
      // Muzzle: lower 35% of front face (+Z) in light cream
      const muzzleColor = lighten(fur, 0.75);
      const faceRs = faceRects(region);
      const [fx, fy, fw, fh] = faceRs.pz;
      const muzzleH = Math.max(1, Math.round(fh * 0.38));
      ctx.fillStyle = muzzleColor;
      ctx.fillRect(fx, fy + fh - muzzleH, fw, muzzleH);
    }

    // ── ears ─────────────────────────────────────────────────────────────────
    else if (/^ear[LR]$/.test(id)) {
      fillRegion(ctx, region, fur);
      // Inner ear (+Z front face): warm pink
      const innerEar = mix('#f2b8c6', '#e0988a', 0.35);
      fillFace(ctx, region, 'pz', innerEar);
      // Ear tip slightly darker
      fillFace(ctx, region, 'py', darken(fur, 0.75));
    }

    // ── eyes ─────────────────────────────────────────────────────────────────
    else if (/^eye[LR]$/.test(id)) {
      const iris = colorFor(id, 'iris');
      const pupil = colorFor(id, 'pupil');
      fillRegion(ctx, region, darken(iris, 0.5)); // sides/top/bottom darker
      // Front face: iris with vertical pupil slit
      const [fx, fy, fw, fh] = faceRects(region).pz;
      ctx.fillStyle = iris;
      ctx.fillRect(fx, fy, fw, fh);
      const slitW = Math.max(1, Math.round(fw * 0.3));
      ctx.fillStyle = pupil;
      ctx.fillRect(fx + Math.round((fw - slitW) / 2), fy, slitW, fh);
      // White highlight dot
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const hlSize = Math.max(1, Math.round(fw * 0.2));
      ctx.fillRect(fx + Math.round(fw * 0.15), fy + Math.round(fh * 0.12), hlSize, hlSize);
    }

    // ── nose ─────────────────────────────────────────────────────────────────
    else if (id === 'nose') {
      const noseCol = colorFor(id, 'nose');
      fillRegion(ctx, region, noseCol);
      // Heart-shaped nose: just lighten top half slightly
      const { x, y, w, d } = region;
      ctx.fillStyle = lighten(noseCol, 0.3);
      ctx.fillRect(x + d, y + d, w, Math.ceil(region.h * 0.45));
    }

    // ── mouth whisker pads ────────────────────────────────────────────────────
    else if (id === 'mouth') {
      const mouthCol = colorFor(id, 'mouth');
      fillRegion(ctx, region, mouthCol);
      fillFace(ctx, region, 'pz', lighten(mouthCol, 0.35));
    }

    // ── whiskers ─────────────────────────────────────────────────────────────
    else if (/^whisker/.test(id)) {
      fillRegion(ctx, region, colorFor(id, 'whisker'));
    }

    // ── tongue ───────────────────────────────────────────────────────────────
    else if (id === 'tongue') {
      const tongue = colorFor(id, 'tongue');
      fillRegion(ctx, region, tongue);
      fillFace(ctx, region, 'py', darken(tongue, 0.7)); // groove line on top
    }

    // ── fore legs (upper + lower) ─────────────────────────────────────────────
    else if (/^(scap|upper[FR][LR]|lower[FR][LR])$/.test(id)) {
      fillRegion(ctx, region, fur);
      if (/upper/.test(id)) sideFaceStripes(ctx, region, pattern, 2);
    }

    // ── hind legs ────────────────────────────────────────────────────────────
    else if (/^(thigh|shin)[LR]$/.test(id)) {
      fillRegion(ctx, region, fur);
      sideFaceStripes(ctx, region, pattern, 2);
    }

    // ── paws / feet ──────────────────────────────────────────────────────────
    else if (/^(foot[LR]|paw|toe)/.test(id)) {
      const pawCol = colorFor(id, 'paw');
      fillRegion(ctx, region, pawCol);
      // Paw pads: slightly pinker on bottom face
      fillFace(ctx, region, 'ny', mix(pawCol, '#e0a0a0', 0.25));
    }

    // ── everything else: plain slot colour ───────────────────────────────────
    else {
      fillRegion(ctx, region, base);
    }
  }

  return canvas;
}

/**
 * Rewrites a BoxGeometry's UVs to point at this box's atlas region.
 *
 * BoxGeometry emits its six faces in +X, -X, +Y, -Y, +Z, -Z order, four UV pairs each, in
 * (top-left, top-right, bottom-left, bottom-right) order - so each face is four consecutive
 * entries in the uv attribute and can be overwritten in place.
 */
export function applyAtlasUVs(geometry: { attributes: Record<string, { array: ArrayLike<number> & { [i: number]: number }; needsUpdate: boolean }> }, region: BoxRegion, atlasSize: number): void {
  if (!geometry.attributes['uv']) return;
  const rects = faceRects(region);
  const order: Array<[number, number, number, number]> = [
    rects.px, rects.nx, rects.py, rects.ny, rects.pz, rects.nz,
  ];
  const uv = geometry.attributes['uv'].array;

  order.forEach(([x, y, w, h], face) => {
    // Half-texel inset: without it, bilinear-free nearest sampling still bleeds neighbouring
    // regions along shared edges at some scales, which shows up as stray coloured seams.
    const u0 = (x + 0.01) / atlasSize;
    const u1 = (x + w - 0.01) / atlasSize;
    const v0 = 1 - (y + 0.01) / atlasSize;
    const v1 = 1 - (y + h - 0.01) / atlasSize;
    const o = face * 8;
    uv[o + 0] = u0; uv[o + 1] = v0;
    uv[o + 2] = u1; uv[o + 3] = v0;
    uv[o + 4] = u0; uv[o + 5] = v1;
    uv[o + 6] = u1; uv[o + 7] = v1;
  });
  geometry.attributes['uv'].needsUpdate = true;
}
