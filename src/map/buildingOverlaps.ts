import { footprintOf, type MapBuilding } from './mapModel';
import { footprintsOverlap } from './footprintsOverlap';

export type SpatialBuilding = Pick<MapBuilding, 'id' | 'name' | 'longitude' | 'latitude' | 'footprint'>;
/** Check the final outline, including default blocks, rather than the clicked point. */
export function overlappingBuildings(ring: number[][], buildings: readonly SpatialBuilding[], excludeId?: string): SpatialBuilding[] {
  return buildings.filter(building => building.id !== excludeId && footprintsOverlap(ring, footprintOf(building)));
}

/** Derived from the current workspace, never persisted and never used to merge IDs.
 * Connected components include A—B—C even when A and C do not directly overlap.
 * Detail warnings use direct peers so they never claim an absent A—C intersection.
 */
export function buildingOverlapGroups(buildings: readonly SpatialBuilding[]) {
  const peers = new Map<string, SpatialBuilding[]>();
  const rings = buildings.map(building => footprintOf(building));
  for (let i = 0; i < buildings.length; i++) for (let j = i + 1; j < buildings.length; j++) {
    if (!footprintsOverlap(rings[i], rings[j])) continue;
    const a = buildings[i], b = buildings[j];
    peers.set(a.id, [...(peers.get(a.id) ?? []), b]);
    peers.set(b.id, [...(peers.get(b.id) ?? []), a]);
  }
  const seen = new Set<string>(), groups: string[][] = [];
  for (const id of peers.keys()) {
    if (seen.has(id)) continue;
    const group: string[] = [], pending = [id];
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next)) continue;
      seen.add(next); group.push(next);
      pending.push(...(peers.get(next) ?? []).map(building => building.id));
    }
    groups.push(group);
  }
  return { groups, peers };
}

/** Each overlapping building's group, keyed by building id; buildings that overlap nothing are absent. */
export function overlapGroupOf(buildings: readonly SpatialBuilding[]): Map<string, string> {
  return new Map(buildingOverlapGroups(buildings).groups.flatMap(group => group.map(id => [id, group[0]] as const)));
}
