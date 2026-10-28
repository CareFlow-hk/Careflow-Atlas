import { area, selfIntersects, toLocal, type Pt } from './footprintGeometry';

/** Ignore drawing slivers smaller than 5% of the smaller footprint. Shared walls and
 * corners have zero area. This is a review hint, never a business identity or merge key.
 * Rings are simple building exteriors (the existing footprint model has no holes).
 */
export const OVERLAP_RATIO = .05;
const EPSILON = 1e-8; // square metres, only for arithmetic/degenerate triangles
const turn = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const signedArea = (points: Pt[]) => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const inTriangle = (p: Pt, [a, b, c]: Pt[]) => turn(a, b, p) >= -EPSILON && turn(b, c, p) >= -EPSILON && turn(c, a, p) >= -EPSILON;

/** Ear clipping retains concavities; replacing the polygon by its bbox/convex hull would
 * incorrectly reject neighbouring L-shaped buildings. Triangles have disjoint interiors.
 */
function triangles(input: Pt[]): Pt[][] {
  const points = input.filter((p, i) => Math.hypot(p[0] - input[(i + 1) % input.length][0], p[1] - input[(i + 1) % input.length][1]) > EPSILON);
  for (let i = points.length - 1; i >= 0 && points.length > 3; i--) {
    if (Math.abs(turn(points[(i + points.length - 1) % points.length], points[i], points[(i + 1) % points.length])) < EPSILON) points.splice(i, 1);
  }
  if (points.length < 3 || selfIntersects(points)) return [];
  if (signedArea(points) < 0) points.reverse();
  const result: Pt[][] = [];
  while (points.length > 3) {
    const ear = points.findIndex((b, i) => {
      const before = (i + points.length - 1) % points.length, after = (i + 1) % points.length;
      const a = points[before], c = points[after];
      return turn(a, b, c) > EPSILON && !points.some((p, j) => j !== before && j !== i && j !== after && inTriangle(p, [a, b, c]));
    });
    if (ear < 0) return []; // invalid geometry, not evidence of an overlap
    result.push([points[(ear + points.length - 1) % points.length], points[ear], points[(ear + 1) % points.length]]);
    points.splice(ear, 1);
  }
  return [...result, points];
}

/** Clip one counter-clockwise triangle to another, retaining the real intersection. */
function intersectionArea(subject: Pt[], clip: Pt[]): number {
  let polygon = subject;
  for (let i = 0; i < 3 && polygon.length; i++) {
    const a = clip[i], b = clip[(i + 1) % 3], output: Pt[] = [];
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j], q = polygon[(j + 1) % polygon.length];
      const dp = turn(a, b, p), dq = turn(a, b, q);
      const insideP = dp >= 0, insideQ = dq >= 0;
      if (insideP) output.push(p);
      if (insideP !== insideQ) {
        const t = dp / (dp - dq);
        output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    polygon = output;
  }
  return polygon.length < 3 ? 0 : area(polygon);
}

export function footprintsOverlap(a: number[][], b: number[][]): boolean {
  if ([a, b].some(ring => ring.length < 3 || ring.some(p => p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])))) return false;
  // A bbox is only a cheap rejection, never proof that two shapes overlap.
  for (const axis of [0, 1]) if (Math.max(...a.map(p => p[axis])) <= Math.min(...b.map(p => p[axis])) || Math.max(...b.map(p => p[axis])) <= Math.min(...a.map(p => p[axis]))) return false;
  const origin = { lng: a[0][0], lat: a[0][1] };
  const localA = toLocal(a, origin), localB = toLocal(b, origin);
  const smallerArea = Math.min(area(localA), area(localB));
  if (smallerArea <= EPSILON) return false;
  const left = triangles(localA), right = triangles(localB);
  const overlap = left.reduce((sum, triangle) => sum + right.reduce((part, other) => part + intersectionArea(triangle, other), 0), 0);
  return overlap > EPSILON && overlap / smallerArea >= OVERLAP_RATIO - 1e-9;
}
