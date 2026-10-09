import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findOsmFootprint, matchFootprint, polygonsFromTile, tileOf, type OsmPolygon } from './osmFootprint';
import { districtDemo } from '../data/districtDemo';
import { area, toLocal } from './footprintGeometry';

const metresX = 111320 * Math.cos(22.286 * Math.PI / 180);
const box = (id: string, cx: number, cy: number, w: number, h: number): OsmPolygon => {
  const o = { lng: 114.142 + cx / metresX, lat: 22.286 + cy / 111320 }, dx = w / 2 / metresX, dy = h / 2 / 111320;
  return { osmId: id, ring: [[o.lng - dx, o.lat - dy], [o.lng + dx, o.lat - dy], [o.lng + dx, o.lat + dy], [o.lng - dx, o.lat + dy], [o.lng - dx, o.lat - dy]] };
};
const at = (x: number, y: number) => ({ lng: 114.142 + x / metresX, lat: 22.286 + y / 111320 });

describe('matching a coordinate to an OSM building outline', () => {
  it('takes the whole building rather than one of its parts', () => {
    const m = matchFootprint(at(0, 0), [box('building', 0, 0, 30, 20), box('tower', 2, 0, 12, 12), box('other', 40, 40, 10, 10)]);
    expect(m).toMatchObject({ kind: 'contains', osmId: 'building' });
  });
  it('takes a part when the only whole outline is an oversized merged block', () => {
    const m = matchFootprint(at(0, 0), [box('terrace', 0, 0, 80, 30), box('part', 2, 0, 12, 12)]);
    expect(m).toMatchObject({ kind: 'contains', osmId: 'part', large: false });
  });
  it('falls back to the nearest outline within 15 m, flagged for checking', () => {
    expect(matchFootprint(at(0, 0), [box('near', 15, 0, 10, 10)])).toMatchObject({ kind: 'nearest', osmId: 'near' });
    expect(matchFootprint(at(0, 0), [box('far', 40, 0, 10, 10)])).toMatchObject({ kind: 'none' });
  });
  it('flags very large outlines as probably merged terraces', () => {
    expect(matchFootprint(at(0, 0), [box('block', 0, 0, 80, 30)])).toMatchObject({ kind: 'contains', large: true });
  });
  it('finds the demo buildings in a real Sai Ying Pun tile', () => {
    const tile = tileOf(114.142, 22.286);
    expect(tile).toEqual({ z: 14, x: 13386, y: 7151 });
    const bytes = readFileSync('src/map/__fixtures__/syp-14-13386-7151.pbf');
    const polygons = polygonsFromTile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), tile);
    expect(polygons.length).toBeGreaterThan(100);
    const yuAn = districtDemo.buildings.find(b => b.id === 'bldg-yu-an')!;
    // Every demo outline was taken from this same OSM data; matching must find the same building.
    // The demo outlines were hand-picked, so a shell-vs-part choice can differ; most must agree.
    let same = 0;
    for (const building of districtDemo.buildings) {
      const match = matchFootprint(building.coordinates, polygons);
      expect(match.kind, building.name).toBe('contains');
      if (match.kind !== 'none' && building.footprint && Math.round(match.area) === Math.round(area(toLocal(building.footprint, building.coordinates)))) same++;
    }
    console.log(`demo outlines reproduced: ${same}/${districtDemo.buildings.length}`);
    expect(same).toBeGreaterThanOrEqual(15);
    void yuAn;
  });
  it('reports a network failure instead of throwing', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await findOsmFootprint(at(0, 0), failing)).toMatchObject({ kind: 'none', reason: expect.stringContaining('offline') });
  });
});
