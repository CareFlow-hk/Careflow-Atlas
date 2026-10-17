import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as LibreMap, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { footprintEditorColors } from '../domain/presentation';
import { edgeLengths, insertVertex, midpoint, moveEdgeFree, moveEdgeParallel, moveVertex, outlineProblem, projectOnNormal, removeVertex, toLngLat, toLocal, type Origin, type Pt } from './footprintGeometry';

type Drag = { kind: 'vertex' | 'edge'; index: number; start: Pt[]; before: number[][]; from: Pt; moved: boolean };
type Handle = { layer: string; index: number };
const SOURCE = 'fp-edit', HANDLES = 'fp-edit-handles';
const LAYERS = ['fp-edit-fill', 'fp-edit-edge', 'fp-edit-edge-hit', 'fp-edit-length', 'fp-edit-mid', 'fp-edit-vertex'];
// Vertex first: where two corners overlap, the one being pointed at should win.
const GRABBABLE = ['fp-edit-vertex', 'fp-edit-mid', 'fp-edit-edge-hit'];
const C = footprintEditorColors;

export interface FootprintShape {
  /** Open outline in metres east/north of the origin, for area, lengths and the checks. */
  points: Pt[];
  /** The vertex the pointer last landed on, which Delete removes. */
  selected?: number;
  /** Why the shape cannot be kept, if it cannot. */
  problem?: string;
  canUndo: boolean;
  undo: () => void;
  /** Drops the selected vertex; returns the reason when it will not go. */
  removeSelected: () => string | undefined;
  /** Replaces the whole outline, remembering the one before it. */
  replace: (ring: number[][]) => void;
  /** Drops the undo history, for when the outline is replaced from outside — a new spot, say. */
  forget: () => void;
  /** Whether a map point is on the shape being edited, so a caller can keep its own clicks off it. */
  onShape: (point: { x: number; y: number }) => boolean;
}

/**
 * The outline-editing engine: draws the handles on the map, reports every move as a new ring, and
 * takes Delete / ⌘Z while it is on. Controlled — `ring` is the shape and `onChange` writes it — so
 * the outline can be held wherever it belongs: a building's stored footprint, or a draft being added.
 *
 * With `enabled` false nothing is drawn and nothing is listened to, so a caller can offer the editor
 * without it taking over the map until someone opens it.
 */
export function useFootprintShape(map: LibreMap, origin: Origin, ring: number[][], onChange: (ring: number[][]) => void, enabled = true): FootprintShape {
  const points = useMemo(() => toLocal(ring, origin), [ring, origin]);
  const [selected, setSelected] = useState<number>();
  const [depth, setDepth] = useState(0);
  const past = useRef<number[][][]>([]);
  const drag = useRef<Drag | undefined>(undefined);
  // The map handlers are bound once per session and read the shape through here, so a drag does not
  // tear them down and rebuild them on every move.
  const now = useRef({ points, ring, onChange, origin });
  now.current = { points, ring, onChange, origin };

  const remember = useCallback((before: number[][]) => { past.current = [...past.current.slice(-49), before]; setDepth(past.current.length); }, []);
  const write = useCallback((next: Pt[]) => now.current.onChange(toLngLat(next, now.current.origin)), []);
  const replace = useCallback((next: number[][]) => { const { ring: before, onChange: change } = now.current; remember(before); setSelected(undefined); change(next); }, [remember]);
  const forget = useCallback(() => { past.current = []; setDepth(0); setSelected(undefined); }, []);
  const undo = useCallback(() => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    setDepth(past.current.length); setSelected(undefined);
    now.current.onChange(previous);
  }, []);
  const removeSelected = useCallback(() => {
    if (selected === undefined) return undefined;
    const current = now.current.points;
    if (current.length <= 3) return '至少要保留 3 個頂點。';
    remember(now.current.ring); setSelected(undefined);
    write(removeVertex(current, selected));
    return undefined;
  }, [selected, remember, write]);

  const hitAt = useCallback((point: { x: number; y: number }): Handle | undefined => {
    if (!map.getLayer('fp-edit-vertex')) return undefined;
    const box: [[number, number], [number, number]] = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
    for (const layer of GRABBABLE) {
      const feature = map.queryRenderedFeatures(box, { layers: [layer] })[0];
      if (feature) return { layer, index: Number(feature.properties.index) };
    }
    return undefined;
  }, [map]);
  const onShape = useCallback((point: { x: number; y: number }) => !!hitAt(point) || !!map.getLayer('fp-edit-fill') && map.queryRenderedFeatures([point.x, point.y], { layers: ['fp-edit-fill'] }).length > 0, [map, hitAt]);

  // Layers live only while editing and sit above everything else on the map.
  useEffect(() => {
    if (!enabled) return;
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    map.addSource(SOURCE, { type: 'geojson', data: empty });
    map.addSource(HANDLES, { type: 'geojson', data: empty });
    map.addLayer({ id: 'fp-edit-fill', source: SOURCE, type: 'fill', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': C.outline, 'fill-opacity': .14 } });
    map.addLayer({ id: 'fp-edit-edge', source: SOURCE, type: 'line', filter: ['==', '$type', 'LineString'], paint: { 'line-color': C.outline, 'line-width': 2.5 } });
    map.addLayer({ id: 'fp-edit-edge-hit', source: SOURCE, type: 'line', filter: ['==', '$type', 'LineString'], paint: { 'line-color': C.hitArea, 'line-opacity': 0, 'line-width': 16 } });
    map.addLayer({ id: 'fp-edit-length', source: HANDLES, type: 'symbol', filter: ['==', 'role', 'mid'], layout: { 'text-field': ['get', 'length'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, -1.3], 'text-allow-overlap': true }, paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.6 } });
    map.addLayer({ id: 'fp-edit-mid', source: HANDLES, type: 'circle', filter: ['==', 'role', 'mid'], paint: { 'circle-radius': 5, 'circle-color': C.handle, 'circle-stroke-color': C.outline, 'circle-stroke-width': 1.5, 'circle-opacity': .9 } });
    map.addLayer({ id: 'fp-edit-vertex', source: HANDLES, type: 'circle', filter: ['==', 'role', 'vertex'], paint: { 'circle-radius': 7, 'circle-color': ['case', ['get', 'selected'], C.outline, C.handle], 'circle-stroke-color': C.outline, 'circle-stroke-width': 2.5 } });
    return () => { for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id); for (const id of [HANDLES, SOURCE]) if (map.getSource(id)) map.removeSource(id); map.getCanvas().style.cursor = ''; };
  }, [map, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const outline = toLngLat(points, origin);
    const lengths = edgeLengths(points);
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outline] } },
      ...points.map((_, i) => ({ type: 'Feature' as const, properties: { index: i }, geometry: { type: 'LineString' as const, coordinates: [outline[i], outline[i + 1]] } })),
    ] });
    (map.getSource(HANDLES) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [
      ...points.map((_, i) => ({ type: 'Feature' as const, properties: { role: 'mid', index: i, length: `${lengths[i].toFixed(1)} m` }, geometry: { type: 'Point' as const, coordinates: toLngLat([midpoint(points, i)], origin)[0] } })),
      ...points.map((_, i) => ({ type: 'Feature' as const, properties: { role: 'vertex', index: i, selected: i === selected }, geometry: { type: 'Point' as const, coordinates: outline[i] } })),
    ] });
  }, [map, points, origin, selected, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const local = (e: MapMouseEvent): Pt => toLocal([[e.lngLat.lng, e.lngLat.lat]], now.current.origin)[0];
    const down = (e: MapMouseEvent) => {
      const target = hitAt(e.point);
      if (!target || e.originalEvent.button !== 0) return;
      e.preventDefault(); // keeps the map from panning while a handle is dragged
      const start = now.current.points, before = now.current.ring, from = local(e);
      if (target.layer === 'fp-edit-mid') {
        drag.current = { kind: 'vertex', index: target.index + 1, start, before, from, moved: true };
        write(insertVertex(start, target.index, midpoint(start, target.index)));
        setSelected(target.index + 1);
      } else if (target.layer === 'fp-edit-vertex') {
        drag.current = { kind: 'vertex', index: target.index, start, before, from, moved: false };
        setSelected(target.index);
      } else {
        drag.current = { kind: 'edge', index: target.index, start, before, from, moved: false };
        setSelected(undefined);
      }
    };
    const move = (e: MapMouseEvent) => {
      const held = drag.current;
      if (!held) { const over = hitAt(e.point); map.getCanvas().style.cursor = over ? (over.layer === 'fp-edit-edge-hit' ? 'move' : 'grab') : ''; return; }
      const at = local(e), delta: Pt = [at[0] - held.from[0], at[1] - held.from[1]];
      held.moved = true;
      // A vertex added on mousedown is not in `start`; from then on moves build on the shape as it
      // now is, or the new vertex would snap back on every move.
      const base = held.start.length === now.current.points.length ? held.start : now.current.points;
      write(held.kind === 'vertex' ? moveVertex(base, held.index, at)
        : e.originalEvent.altKey ? moveEdgeFree(held.start, held.index, delta) : moveEdgeParallel(held.start, held.index, projectOnNormal(held.start, held.index, delta)));
    };
    const up = () => {
      const held = drag.current;
      drag.current = undefined;
      if (held?.moved) remember(held.before);
    };
    map.on('mousedown', down); map.on('mousemove', move); map.on('mouseup', up);
    return () => { map.off('mousedown', down); map.off('mousemove', move); map.off('mouseup', up); };
  }, [map, enabled, hitAt, write, remember]);

  useEffect(() => {
    if (!enabled) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== undefined) { e.preventDefault(); removeSelected(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Escape') setSelected(undefined);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [enabled, selected, removeSelected, undo]);

  return { points, selected, problem: enabled ? outlineProblem(points) : undefined, canUndo: depth > 0, undo, removeSelected, replace, forget, onShape };
}
