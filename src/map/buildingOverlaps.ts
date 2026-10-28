import { footprintOf, type MapBuilding } from './mapModel';
import { footprintsOverlap } from './footprintsOverlap';

export type SpatialBuilding = Pick<MapBuilding, 'id' | 'name' | 'longitude' | 'latitude' | 'footprint'>;
/** Check the final outline, including default blocks, rather than the clicked point. */
export function overlappingBuildings(ring: number[][], buildings: readonly SpatialBuilding[], excludeId?: string): SpatialBuilding[] {
  return buildings.filter(building => building.id !== excludeId && footprintsOverlap(ring, footprintOf(building)));
}
