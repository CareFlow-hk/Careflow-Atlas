import { api } from '../auth/api';
import { toLocal } from './footprintGeometry';

/**
 * Searching for a building by name, then adding it at the place that came back
 * (`docs/GEOCODING.md`).
 *
 * Two rules from the panel it serves. A result is a *place to look at*, not a record: the
 * name and address it fills in are the person's to change, and the outline still comes from
 * the basemap. And a result that lands on a building already on the atlas is a duplicate
 * warning, not a second building — the same 15 metres the footprint matcher already uses for
 * "this coordinate is that building".
 */

/** What the server returns per place: exactly the fields the panel fills in. */
export interface PlaceResult { id: string; name: string; address: string; lng: number; lat: number }
/** A building already on the atlas, for the "this looks like it is already here" check. */
export interface ExistingBuilding { id: string; name: string; lng: number; lat: number }

/** The same reach the footprint matcher uses before it stops calling a coordinate a building. */
export const PLACE_NEARBY_METRES = 15;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const coordinate = (value: unknown) => {
  // A blank is missing, not zero: `Number('')` is 0, and 0 would read as a real coordinate.
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : undefined;
};

/**
 * Rows from the server, kept only when they can be shown. The server already drops what it
 * cannot place; this repeats the check at the boundary it is actually trusted from, because
 * a marker in the sea is worse than one fewer search result.
 */
export function readPlaces(value: unknown): PlaceResult[] {
  const rows = Array.isArray((value as { places?: unknown })?.places) ? (value as { places: unknown[] }).places : [];
  return rows.flatMap((row, index) => {
    const item = (row ?? {}) as Record<string, unknown>;
    const lng = coordinate(item.lng), lat = coordinate(item.lat);
    if (lng === undefined || lat === undefined) return [];
    if (lng < 113.8 || lng > 114.5 || lat < 22.1 || lat > 22.6) return [];
    const address = text(item.address);
    const name = text(item.name) || address;
    if (!name) return [];
    return [{ id: text(item.id) || `place-${index}`, name, address, lng, lat }];
  });
}

/**
 * The building already standing where a result points, if any. Only the position decides:
 * a similar name is not enough to call two buildings one (CLAUDE.md §4), and a name is not
 * needed to see that this coordinate is already on the atlas.
 */
export function nearbyBuilding(result: { lng: number; lat: number }, buildings: readonly ExistingBuilding[], limit = PLACE_NEARBY_METRES): ExistingBuilding | undefined {
  const point = { lng: result.lng, lat: result.lat };
  return buildings
    .filter(building => Number.isFinite(building.lng) && Number.isFinite(building.lat))
    .map(building => {
      const [east, north] = toLocal([[building.lng, building.lat]], point)[0];
      return { building, distance: Math.hypot(east, north) };
    })
    .filter(item => item.distance <= limit)
    .sort((a, b) => a.distance - b.distance)[0]?.building;
}

/**
 * Ask the server. `fetcher` is a seam for tests; the page always goes through `/api`, which
 * means the switch, the session and the rate limit are the server's to decide.
 */
export async function searchPlaces(query: string, options: { fetcher?: (path: string) => Promise<unknown>; signal?: AbortSignal } = {}): Promise<PlaceResult[]> {
  const words = query.trim();
  if (words.length < 2) return [];
  const ask = options.fetcher ?? ((path: string) => api<unknown>(path, 'GET', undefined, { signal: options.signal, timeoutMs: 10_000 }));
  return readPlaces(await ask(`/place-search?q=${encodeURIComponent(words)}`));
}
