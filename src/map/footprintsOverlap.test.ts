import { describe, expect, it } from 'vitest';
import { footprintsOverlap } from './footprintsOverlap';
import { toLngLat, type Pt } from './footprintGeometry';
const ring = (points: Pt[]) => toLngLat(points, { lng: 114.14, lat: 22.28 });
const square = (x = 0, y = 0, size = 10) => ring([[x,y],[x+size,y],[x+size,y+size],[x,y+size]]);
describe('actual footprint area overlap', () => {
  it('recognizes identical, partial and contained polygons in either order', () => {
    for (const other of [square(), square(5, 5), square(2, 2, 2)]) {
      expect(footprintsOverlap(square(), other)).toBe(true);
      expect(footprintsOverlap(other, square())).toBe(true);
    }
  });
  it('does not count shared walls or corner contact', () => {
    expect(footprintsOverlap(square(), square(10, 0))).toBe(false);
    expect(footprintsOverlap(square(), square(10, 10))).toBe(false);
  });
  it('ignores bbox intersections for an L-shaped building and its separate neighbour', () => {
    const l = ring([[0,0],[10,0],[10,2],[2,2],[2,10],[0,10]]);
    expect(footprintsOverlap(l, square(3, 3, 6))).toBe(false);
    expect(footprintsOverlap(l, square(1, 3, 6))).toBe(true);
  });
  it('does not count disjoint diagonal shapes with intersecting bounding boxes', () => {
    expect(footprintsOverlap(ring([[0,0],[10,0],[0,10]]), ring([[10,10],[10,2],[2,10]]))).toBe(false);
  });
  it('applies the documented five-percent threshold to the smaller building', () => {
    expect(footprintsOverlap(square(), square(9.51, 0))).toBe(false);
    expect(footprintsOverlap(square(), square(9.5, 0))).toBe(true);
    expect(footprintsOverlap(square(), square(9.49, 0))).toBe(true);
  });
  it('accepts reversed, open and collinear rings without changing the result', () => {
    expect(footprintsOverlap(square().slice().reverse(), square(5, 5).slice(0,-1))).toBe(true);
    expect(footprintsOverlap(ring([[0,0],[5,0],[10,0],[10,10],[0,10]]), square())).toBe(true);
  });
  it('does not turn invalid or empty geometry into an overlap warning', () => {
    expect(footprintsOverlap([], square())).toBe(false);
    expect(footprintsOverlap([[NaN,0],[0,1],[1,1]], square())).toBe(false);
    expect(footprintsOverlap(ring([[0,0],[10,10],[0,10],[10,0]]), square())).toBe(false);
  });
});
