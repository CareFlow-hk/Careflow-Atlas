import { describe, expect, it } from 'vitest';
import { area, centroid, edgeLengths, insertVertex, moveEdgeFree, moveEdgeParallel, moveVertex, outlineProblem, removeVertex, selfIntersects, toLngLat, toLocal, type Pt } from './footprintGeometry';

const square: Pt[] = [[0, 0], [20, 0], [20, 10], [0, 10]];
const close = (a: Pt[], b: Pt[]) => a.forEach((p, i) => { expect(p[0]).toBeCloseTo(b[i][0], 6); expect(p[1]).toBeCloseTo(b[i][1], 6); });

describe('building outline editing', () => {
  it('slides an edge parallel and lets its neighbours stretch', () => {
    // Edge 1 is the east side (20,0)→(20,10); its outward normal points east.
    close(moveEdgeParallel(square, 1, -5), [[0, 0], [15, 0], [15, 10], [0, 10]]);
    close(moveEdgeParallel([...square].reverse() as Pt[], 1, -5), [[0, 10], [15, 10], [15, 0], [0, 0]]);
    expect(area(moveEdgeParallel(square, 1, -5))).toBeCloseTo(150);
  });
  it('keeps neighbour directions on a slanted shape', () => {
    const trapezoid: Pt[] = [[0, 0], [30, 0], [20, 10], [10, 10]];
    const moved = moveEdgeParallel(trapezoid, 2, 5); // top edge moves up (normal points north)
    expect(moved[2][1]).toBeCloseTo(15); expect(moved[3][1]).toBeCloseTo(15);
    // Still on the original slanted sides: x decreases by 5 on the right side, increases on the left.
    expect(moved[2][0]).toBeCloseTo(15); expect(moved[3][0]).toBeCloseTo(15);
  });
  it('moves, inserts and removes vertices, never below three', () => {
    expect(moveVertex(square, 2, [25, 12])[2]).toEqual([25, 12]);
    expect(insertVertex(square, 0, [10, -3])).toEqual([[0, 0], [10, -3], [20, 0], [20, 10], [0, 10]]);
    expect(removeVertex(square, 1)).toHaveLength(3);
    expect(removeVertex(removeVertex(square, 1), 0)).toHaveLength(3);
    expect(moveEdgeFree(square, 0, [0, -2]).slice(0, 2)).toEqual([[0, -2], [20, -2]]);
  });
  it('measures and rejects shapes that cannot be a building', () => {
    expect(area(square)).toBe(200);
    expect(edgeLengths(square)).toEqual([20, 10, 20, 10]);
    expect(centroid(square)).toEqual([10, 5]);
    const bowtie: Pt[] = [[0, 0], [20, 10], [20, 0], [0, 10]];
    expect(selfIntersects(bowtie)).toBe(true);
    expect(outlineProblem(bowtie)).toContain('交叉');
    expect(outlineProblem([[0, 0], [2, 0], [2, 2], [0, 2]])).toContain('太小');
    expect(outlineProblem(square)).toBeUndefined();
  });
  it('round trips through longitude/latitude with a closed ring', () => {
    const origin = { lng: 114.142, lat: 22.286 };
    const ring = toLngLat(square, origin);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    close(toLocal(ring, origin), square);
  });
});
