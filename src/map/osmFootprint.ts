import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { area, toLocal } from './footprintGeometry';

/** The same OpenStreetMap building data as the basemap (OpenFreeMap). */
export const OSM_TILEJSON = 'https://tiles.openfreemap.org/planet';
const ZOOM = 14;
/** Further than this from every outline, a coordinate is not treated as any building. */
export const NEAREST_LIMIT_METRES = 15;
/** Larger outlines are usually a whole terrace merged into one block in OSM. */
export const LARGE_OUTLINE_M2 = 1500;

export interface OsmPolygon { osmId: string; ring: number[][] }
export type FootprintMatch =
  | { kind: 'contains' | 'nearest'; ring: number[][]; osmId: string; area: number; distance: number; large: boolean; source: string }
  | { kind: 'none'; reason: string; source?: string };

function inside(x: number, y: number, ring: number[][]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) yes = !yes;
  }
  return yes;
}
function distanceToRing(point: { lng: number; lat: number }, ring: number[][]) {
  const pts = toLocal(ring, point);
  let best = Infinity;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  });
  return best;
}

/**
 * Pick the building outline for a coordinate. A containing outline wins (the whole building
 * rather than one of its parts); otherwise the nearest within NEAREST_LIMIT_METRES, flagged so a
 * person checks it. Nothing further away is guessed.
 */
export function matchFootprint(point: { lng: number; lat: number }, polygons: OsmPolygon[], source = ''): FootprintMatch {
  const sized = polygons.map(p => ({ ...p, area: area(toLocal(p.ring, point)) })).filter(p => p.area >= 10);
  // OSM draws a building shell and, inside it, its parts (a tower on a podium). Take the whole
  // building; only when every candidate is oversized (a merged terrace) take the smallest.
  const around = sized.filter(p => inside(point.lng, point.lat, p.ring));
  const containing = around.filter(p => p.area <= LARGE_OUTLINE_M2).sort((a, b) => b.area - a.area)[0] ?? around.sort((a, b) => a.area - b.area)[0];
  if (containing) return { kind: 'contains', ring: containing.ring, osmId: containing.osmId, area: containing.area, distance: 0, large: containing.area > LARGE_OUTLINE_M2, source };
  const nearest = sized.map(p => ({ ...p, distance: distanceToRing(point, p.ring) })).sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance <= NEAREST_LIMIT_METRES) return { kind: 'nearest', ring: nearest.ring, osmId: nearest.osmId, area: nearest.area, distance: nearest.distance, large: nearest.area > LARGE_OUTLINE_M2, source };
  return { kind: 'none', reason: nearest ? `最近的建築在 ${Math.round(nearest.distance)} 米外` : '附近沒有建築資料', source };
}

export function tileOf(lng: number, lat: number, z = ZOOM) {
  const n = 2 ** z, rad = lat * Math.PI / 180;
  return { z, x: Math.floor((lng + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n) };
}

/** Outer rings of every building polygon in a vector tile, multipolygons split. */
export function polygonsFromTile(bytes: ArrayBuffer, tile: { z: number; x: number; y: number }): OsmPolygon[] {
  const layer = new VectorTile(new Protobuf(new Uint8Array(bytes))).layers.building;
  if (!layer) return [];
  const result: OsmPolygon[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const geometry = feature.toGeoJSON(tile.x, tile.y, tile.z).geometry;
    const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
    polygons.forEach((rings, part) => { if (rings[0]?.length >= 4) result.push({ osmId: `${feature.id ?? i}:${part}`, ring: rings[0] }); });
  }
  return result;
}

let template: Promise<string> | undefined;
const tileCache = new Map<string, Promise<OsmPolygon[]>>();
/** Fetches only the one tile under the coordinate; failures come back as `none` with a reason. */
export async function findOsmFootprint(point: { lng: number; lat: number }, fetcher: typeof fetch = fetch): Promise<FootprintMatch> {
  try {
    template ??= fetcher(OSM_TILEJSON).then(r => { if (!r.ok) throw new Error(`tilejson HTTP ${r.status}`); return r.json(); }).then(j => j.tiles[0] as string);
    const tile = tileOf(point.lng, point.lat);
    const url = (await template).replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
    if (!tileCache.has(url)) tileCache.set(url, fetcher(url).then(r => { if (!r.ok) throw new Error(`tile HTTP ${r.status}`); return r.arrayBuffer(); }).then(bytes => polygonsFromTile(bytes, tile)));
    return matchFootprint(point, await tileCache.get(url)!, url);
  } catch (error) {
    template = undefined; tileCache.clear();
    return { kind: 'none', reason: `未能取得地圖資料（${error instanceof Error ? error.message : String(error)}）` };
  }
}
