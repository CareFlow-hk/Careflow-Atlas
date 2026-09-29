import type { FeatureCollection, Polygon } from 'geojson';
import { nodeTagLabel, stateColors, stateLabels, stateSelectedColors } from '../domain/presentation';
import type { State, StateBreakdown } from '../domain/types';

/**
 * Only spatial geometry and display summaries cross into the map. No people or notes.
 * `state` is the whole colour decision: the map never derives a colour of its own, and
 * `recorded`/`total`/`hasFollowUp` are facts for the tooltip and the badge, not inputs
 * to the fill. A floor with an open task is YELLOW because the pipeline says so.
 */
export interface MapFloor {
  id: string; label: string; level: number; state: State; hasFollowUp: boolean; recorded: number; total: number;
  /** How many units sit in each state; shown beside the 3D floor label. */
  breakdown: StateBreakdown;
  /** A manual FOLLOW_UP mark on this floor. A separate marker, never a colour. */
  tagged: boolean;
}
export interface MapBuilding {
  id: string; name: string; longitude: number; latitude: number;
  footprint?: number[][]; floors: MapFloor[]; state: State;
  /** Open tasks anywhere in the building. Names the task on the marker; never picks the colour. */
  followUps: number;
  /** A manual FOLLOW_UP mark on this building. A separate marker, never a colour. */
  tagged: boolean;
}

export const DISTRICT_CAMERA = { center: [114.14175, 22.2865] as [number, number], zoom: 16.5, pitch: 48, bearing: -24 };
export const FLOOR_HEIGHT = 3.2;
export const FLOOR_GAP = 3.5;

/** Everything a marker says about one building, as data rather than as DOM. */
export interface MarkerLabel {
  className: string; ariaLabel: string; title: string; labelWidth: number;
  /** Present only when the building has open tasks; the text shown beside its name. */
  task?: string;
  /** The manual mark, drawn as a flag beside the name. */
  tagged: boolean;
}

/**
 * A building marker names its state and, when there is one, its outstanding task — the
 * same way a floor strip names its revisit. The colour and the task are separate facts:
 * the dot says how the visit went, the tag says whether anything is left to do, and a
 * green building with a task on it therefore shows both.
 */
export function markerLabel(building: MapBuilding, selected: boolean): MarkerLabel {
  const task = building.followUps > 0 ? '待跟進' : undefined;
  const state = stateLabels[building.state];
  const lead = selected ? `正在查看${building.name}` : `在地圖選擇${building.name}`;
  const tag = building.tagged ? ` · ${nodeTagLabel}` : '';
  return {
    className: `building-map-marker${selected ? ' is-selected' : ''}${task ? ' has-followup' : ''}${building.tagged ? ' is-tagged' : ''}`,
    ariaLabel: `${lead} · ${state}${task ? ` · ${building.followUps} 項待跟進` : ''}${tag}`,
    title: `${building.name} · ${state}${task ? ` · ${building.followUps} 項待跟進` : ''}${tag}`,
    // The declared width feeds label collision, so the tag and the mark are counted in it.
    labelWidth: Math.max(100, building.name.length * 14 + 38 + (task ? 60 : 0) + (building.tagged ? 18 : 0)),
    task,
    tagged: building.tagged,
  };
}

/** Bound the stagger for any declared floor count, and share it with label projection. */
export function floorSeparation(progress: number, index: number, count: number): number {
  const delay = count > 1 ? Math.min(.16, Math.max(0, index / (count - 1) * .16)) : 0;
  return Math.max(0, Math.min(1, (progress - delay) / (1 - delay)));
}

/** Each slab carries the gaps below it, so staggered floors never intersect. */
export function floorBase(progress: number, index: number, count: number): number {
  let base = index * FLOOR_HEIGHT + .3;
  for (let gapIndex = 1; gapIndex <= index; gapIndex++) base += floorSeparation(progress, gapIndex, count) * FLOOR_GAP;
  return base;
}

/** Declared synthetic geometry only; not an indoor survey or inferred subdivision. */
export function footprintOf(building: MapBuilding, paddingMetres = 0): number[][] {
  if (building.footprint && !paddingMetres) return building.footprint;
  const metresX = 111320 * Math.cos(building.latitude * Math.PI / 180);
  const ring = building.footprint;
  const west = ring ? Math.min(...ring.map(p => p[0])) : building.longitude - 13 / metresX;
  const east = ring ? Math.max(...ring.map(p => p[0])) : building.longitude + 13 / metresX;
  const south = ring ? Math.min(...ring.map(p => p[1])) : building.latitude - 10 / 111320;
  const north = ring ? Math.max(...ring.map(p => p[1])) : building.latitude + 10 / 111320;
  const dx = paddingMetres / metresX, dy = paddingMetres / 111320;
  return [
    [west - dx, south - dy], [east + dx, south - dy],
    [east + dx, north + dy], [west - dx, north + dy], [west - dx, south - dy],
  ];
}

export function floorFeatures(building: MapBuilding | undefined, separation: number, selectedFloorId?: string): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: building?.floors.map((floor, index) => {
      // Later floors begin a little later, while keeping the total motion under a second.
      const base = floorBase(separation, index, building.floors.length);
      return {
        type: 'Feature', id: floor.id,
        geometry: { type: 'Polygon', coordinates: [footprintOf(building)] },
        properties: {
          id: floor.id, label: floor.label, base, height: base + FLOOR_HEIGHT - 0.35,
          color: (selectedFloorId === floor.id ? stateSelectedColors : stateColors)[floor.state],
          selected: selectedFloorId === floor.id,
        },
      };
    }) ?? [],
  };
}

export function buildingFeatures(buildings: MapBuilding[], selectedId?: string): FeatureCollection<Polygon> {
  return { type: 'FeatureCollection', features: buildings.filter(b => b.id !== selectedId).map(b => ({
    type: 'Feature', id: b.id, properties: { id: b.id, color: stateColors[b.state], height: Math.max(8, b.floors.length * FLOOR_HEIGHT) },
    geometry: { type: 'Polygon', coordinates: [footprintOf(b)] },
  })) };
}

/** Frame the actual footprint extent, including wide buildings and new imports. */
export function districtBounds(buildings: MapBuilding[]): [[number, number], [number, number]] | undefined {
  const points = buildings.flatMap(building => footprintOf(building));
  if (!points.length) return undefined;
  return [
    [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))],
    [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))],
  ];
}

export interface ProjectedLabel { id: string; x: number; y: number; width: number; }
/** Suppress overlapping names only. Every building keeps its clickable location dot. */
export function visibleDistrictLabels(labels: ProjectedLabel[], width: number, height: number): Set<string> {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const visible = new Set<string>();
  for (const label of labels) {
    const rect = { left: label.x - label.width / 2, right: label.x + label.width / 2, top: label.y - 44, bottom: label.y - 4 };
    if (rect.left < 12 || rect.right > width - 12 || rect.top < 112 || rect.bottom > height - 104) continue;
    if ((rect.left < 235 && rect.top < 176) || (rect.right > width - 82 && rect.top < 380)) continue;
    // Keep a little separation, so adjacent labels remain distinct at district scale.
    if (placed.some(other => rect.left < other.right + 8 && rect.right + 8 > other.left && rect.top < other.bottom + 7 && rect.bottom + 7 > other.top)) continue;
    placed.push(rect);
    visible.add(label.id);
  }
  return visible;
}
