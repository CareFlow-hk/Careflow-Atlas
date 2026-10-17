import { toLocal } from './footprintGeometry';

/** A building already on the atlas, as the address suggestion needs it. */
export interface KnownBuilding { name: string; lng: number; lat: number }
export interface AddressSuggestion { text: string; name: string; distance: number }

/**
 * Past this, "近…" would no longer be true of the block, and a wrong-but-plausible
 * address is worse than an empty one. The field worker can always type their own.
 */
export const NEARBY_LIMIT_METRES = 120;

/**
 * A first guess at the address of a building being added, worded the way a field note
 * would be: the nearest building already on the atlas, as "近福滿大廈". The basemap's
 * building tiles carry no names, so this reads local data only and stays silent when
 * nothing registered is close enough. Nothing is filled in on its own.
 */
export function suggestNearbyAddress(point: { lng: number; lat: number }, buildings: readonly KnownBuilding[], limit = NEARBY_LIMIT_METRES): AddressSuggestion | undefined {
  const nearest = buildings
    .filter(b => b.name.trim() && Number.isFinite(b.lng) && Number.isFinite(b.lat))
    .map(b => {
      const [east, north] = toLocal([[b.lng, b.lat]], point)[0];
      return { name: b.name.trim(), distance: Math.hypot(east, north) };
    })
    .filter(b => b.distance <= limit)
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest ? { text: `近${nearest.name}`, name: nearest.name, distance: nearest.distance } : undefined;
}
