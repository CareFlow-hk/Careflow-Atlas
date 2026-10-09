/**
 * Building outline editing in a local metre frame. Rings here are open (no repeated
 * closing point) arrays of [x, y] metres east/north of an origin; convert at the edges.
 */
export type Pt = [number, number];
export interface Origin { lng: number; lat: number }

const metresX = (lat: number) => 111320 * Math.cos(lat * Math.PI / 180);
export function toLocal(ring: number[][], origin: Origin): Pt[] {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  return open.map(([lng, lat]) => [(lng - origin.lng) * metresX(origin.lat), (lat - origin.lat) * 111320]);
}
export function toLngLat(points: Pt[], origin: Origin): number[][] {
  const ring = points.map(([x, y]) => [origin.lng + x / metresX(origin.lat), origin.lat + y / 111320]);
  return [...ring, [...ring[0]]];
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const length = (a: Pt) => Math.hypot(a[0], a[1]);

export function area(points: Pt[]): number {
  return Math.abs(points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0)) / 2;
}
export const edgeLengths = (points: Pt[]) => points.map((p, i) => length(sub(points[(i + 1) % points.length], p)));

/** Area-weighted centroid; falls back to the vertex mean for degenerate shapes. */
export function centroid(points: Pt[]): Pt {
  let a = 0, x = 0, y = 0;
  points.forEach((p, i) => { const q = points[(i + 1) % points.length], c = cross(p, q); a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; });
  if (Math.abs(a) < 1e-9) return scale(points.reduce(add, [0, 0]), 1 / points.length);
  return [x / (3 * a), y / (3 * a)];
}

const signedArea = (points: Pt[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2;
/** Outward unit normal of edge i (from point i to i+1), whichever way the ring winds. */
export function edgeNormal(points: Pt[], i: number): Pt {
  const d = sub(points[(i + 1) % points.length], points[i]);
  const len = length(d) || 1, outward = signedArea(points) >= 0 ? 1 : -1;
  return [outward * d[1] / len, -outward * d[0] / len];
}

function intersect(p: Pt, r: Pt, q: Pt, s: Pt): Pt | undefined {
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-9) return undefined;
  return add(p, scale(r, cross(sub(q, p), s) / denom));
}

/**
 * Slide edge i along its normal by `distance` metres. Neighbouring edges keep their
 * direction and stretch or shrink to meet it; a neighbour parallel to the edge simply
 * moves with it.
 */
export function moveEdgeParallel(points: Pt[], i: number, distance: number): Pt[] {
  const n = points.length, j = (i + 1) % n;
  const offset = scale(edgeNormal(points, i), distance);
  const a = add(points[i], offset), b = add(points[j], offset), dir = sub(points[j], points[i]);
  const prev = points[(i - 1 + n) % n], next = points[(j + 1) % n];
  const result = points.map(p => [...p] as Pt);
  result[i] = intersect(a, dir, prev, sub(points[i], prev)) ?? a;
  result[j] = intersect(a, dir, next, sub(points[j], next)) ?? b;
  return result;
}
/** Move both ends of edge i by the same offset (the edge may change direction of its neighbours). */
export function moveEdgeFree(points: Pt[], i: number, offset: Pt): Pt[] {
  const j = (i + 1) % points.length;
  return points.map((p, k) => (k === i || k === j ? add(p, offset) : [...p] as Pt));
}
export const moveVertex = (points: Pt[], i: number, to: Pt): Pt[] => points.map((p, k) => (k === i ? [...to] as Pt : [...p] as Pt));
export const insertVertex = (points: Pt[], afterEdge: number, at: Pt): Pt[] => [...points.slice(0, afterEdge + 1), [...at] as Pt, ...points.slice(afterEdge + 1)];
export const removeVertex = (points: Pt[], i: number): Pt[] => (points.length <= 3 ? points : points.filter((_, k) => k !== i));
export const projectOnNormal = (points: Pt[], i: number, delta: Pt) => dot(delta, edgeNormal(points, i));
export const midpoint = (points: Pt[], i: number): Pt => scale(add(points[i], points[(i + 1) % points.length]), .5);

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign(cross(sub(q, p), sub(r, p)));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** Non-adjacent edges that cross make a figure-of-eight, which cannot be a building. */
export function selfIntersects(points: Pt[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
    if (i === 0 && k === n - 1) continue;
    if (segmentsCross(points[i], points[(i + 1) % n], points[k], points[(k + 1) % n])) return true;
  }
  return false;
}

/** Why an outline cannot be saved, in the words of the person editing it. */
export function outlineProblem(points: Pt[]): string | undefined {
  if (points.length < 3) return '至少要有 3 個頂點。';
  if (selfIntersects(points)) return '有邊互相交叉，請把頂點拉回去，避免「8 字形」。';
  if (area(points) < 10) return '形狀太小（少於 10 m²），請檢查是否拉錯了。';
  if (edgeLengths(points).some(l => l < .3)) return '有兩個頂點幾乎重疊，請刪除其中一個。';
  return undefined;
}

/** Centre of a longitude/latitude ring, as a coordinate. */
export function outlineCentre(ring: number[][]): Origin {
  const origin = { lng: ring[0][0], lat: ring[0][1] };
  const [x, y] = centroid(toLocal(ring, origin));
  return { lng: origin.lng + x / metresX(origin.lat), lat: origin.lat + y / 111320 };
}
