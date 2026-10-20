// Geometry only: the host supplies input areas already expanded by the cat's drawn extent.
export function normalizeRegions(regions) {
  return (Array.isArray(regions) ? regions : []).filter(r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0)
    .slice(0, 8).map(({ x, y, width, height }) => ({ x, y, width, height }));
}
export const insideRegion = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
export const isProtected = (p, regions) => regions.some(r => insideRegion(p, r));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clampPoint = (p, b) => ({ x: clamp(p.x, b.left, b.right), y: clamp(p.y, b.top, b.bottom) });

export function crossesRegion(a, b, r) {
  let enter = 0, exit = 1;
  for (const [key, size] of [['x', 'width'], ['y', 'height']]) {
    const delta = b[key] - a[key];
    if (Math.abs(delta) < 1e-9) {
      if (a[key] < r[key] || a[key] > r[key] + r[size]) return false;
    } else {
      let lo = (r[key] - a[key]) / delta, hi = (r[key] + r[size] - a[key]) / delta;
      if (lo > hi) [lo, hi] = [hi, lo];
      enter = Math.max(enter, lo); exit = Math.min(exit, hi);
      if (enter > exit) return false;
    }
  }
  return true;
}
export const pathProtected = (a, b, regions) => regions.some(r => crossesRegion(a, b, r));
const corners = r => [
  { x: r.x - 1, y: r.y - 1 }, { x: r.x + r.width + 1, y: r.y - 1 },
  { x: r.x - 1, y: r.y + r.height + 1 }, { x: r.x + r.width + 1, y: r.y + r.height + 1 },
];
export function safePoint(point, regions, bounds) {
  const p = clampPoint(point, bounds);
  if (!isProtected(p, regions)) return p;
  const candidates = regions.flatMap(r => [
    { x: r.x - 1, y: p.y }, { x: r.x + r.width + 1, y: p.y },
    { x: p.x, y: r.y - 1 }, { x: p.x, y: r.y + r.height + 1 }, ...corners(r),
  ]);
  candidates.push({ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top },
    { x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom });
  return candidates.map(p => clampPoint(p, bounds)).filter(p => !isProtected(p, regions))
    .sort((a, b) => distance(a, point) - distance(b, point))[0] ?? null;
}

/** First waypoint on a shortest visible route. Null means the input covers every route. */
export function inputWaypoint(from, to, regions, bounds) {
  if (isProtected(from, regions)) return safePoint(from, regions, bounds);
  if (!pathProtected(from, to, regions)) return to;
  const nodes = [from, to, ...regions.flatMap(corners).map(p => clampPoint(p, bounds)).filter(p => !isProtected(p, regions))];
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
  costs[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let at = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (at < 0 || costs[i] < costs[at])) at = i;
    if (at < 0 || !Number.isFinite(costs[at])) return null;
    if (at === 1) {
      while (previous[at] > 0) at = previous[at];
      return nodes[at];
    }
    visited.add(at);
    for (let next = 1; next < nodes.length; next++) {
      if (visited.has(next) || pathProtected(nodes[at], nodes[next], regions)) continue;
      const cost = costs[at] + distance(nodes[at], nodes[next]);
      if (cost < costs[next]) { costs[next] = cost; previous[next] = at; }
    }
  }
  return null;
}
