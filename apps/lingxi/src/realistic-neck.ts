// The head and torso are closed, overlapping skins rather than two meshes with matching neck rings. Only trim the
// lower rear cheek where it meets the shoulder. The shoulder-distance gate leaves the free muzzle and cheek intact.
// Model units are metres: the side shoulder crossing is near y=.42-.45, z=.20, while the muzzle starts past z=.31.
// The head's 59-73 mm guards and up to 26 mm of solid shell stand above the body's ~43 mm guards / 15 mm shell there.
// At full weight these trims bring the guards close to shoulder length without exposing bare head skin.
const NECK = {
  side: [0.055, 0.105],
  lower: [0.39, 0.52],
  rear: [0.18, 0.31],
  shoulder: [0.015, 0.085],
  shellTrim: 0.55,
  guardTrim: 0.45,
  underTrim: 0.25,
} as const;

function smoothstep(x: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** A rest-pose shoulder surface lookup, built once when the coat loads. No per-frame nearest-point work. */
export function createNeckBlend(bodyPositions: ArrayLike<number>): (x: number, y: number, z: number) => number {
  type Point = [number, number, number];
  interface Node { point: Point; axis: number; left: Node | null; right: Node | null }
  const shoulder: Point[] = [];
  for (let i = 0; i < bodyPositions.length; i += 3) {
    const x = bodyPositions[i], y = bodyPositions[i + 1], z = bodyPositions[i + 2];
    if (Math.abs(x) < 0.03 || y < 0.29 || y > 0.49 || z < 0.08 || z > 0.34) continue;
    shoulder.push([x, y, z]);
  }
  const build = (points: Point[], depth: number): Node | null => {
    if (!points.length) return null;
    const axis = depth % 3;
    points.sort((a, b) => a[axis] - b[axis]);
    const middle = points.length >> 1;
    return { point: points[middle], axis, left: build(points.slice(0, middle), depth + 1), right: build(points.slice(middle + 1), depth + 1) };
  };
  const tree = build(shoulder, 0);
  const nearest2 = (node: Node | null, point: Point, best: number): number => {
    if (!node) return best;
    const dx = point[0] - node.point[0], dy = point[1] - node.point[1], dz = point[2] - node.point[2];
    best = Math.min(best, dx * dx + dy * dy + dz * dz);
    const split = point[node.axis] - node.point[node.axis];
    const near = split < 0 ? node.left : node.right;
    const far = split < 0 ? node.right : node.left;
    best = nearest2(near, point, best);
    return split * split < best ? nearest2(far, point, best) : best;
  };
  return (x, y, z) => {
    const region = smoothstep(Math.abs(x), ...NECK.side)
      * (1 - smoothstep(y, ...NECK.lower)) * (1 - smoothstep(z, ...NECK.rear));
    if (region < 0.001) return 0;
    const distance = Math.sqrt(nearest2(tree, [x, y, z], NECK.shoulder[1] ** 2));
    return region * (1 - smoothstep(distance, ...NECK.shoulder));
  };
}

export function neckShellScale(weight: number): number { return 1 - NECK.shellTrim * weight; }
export function neckStrandScale(weight: number, guard: boolean): number {
  return 1 - (guard ? NECK.guardTrim : NECK.underTrim) * weight;
}
