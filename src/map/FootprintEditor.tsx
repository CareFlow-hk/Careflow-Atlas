import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as LibreMap, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { RotateCcw, Trash2, Undo2, MapPin } from 'lucide-react';
import { footprintEditorColors } from '../domain/presentation';
import { area, edgeLengths, insertVertex, midpoint, moveEdgeFree, moveEdgeParallel, moveVertex, outlineProblem, projectOnNormal, removeVertex, toLngLat, toLocal, type Origin, type Pt } from './footprintGeometry';

interface Props {
  map: LibreMap;
  name: string;
  origin: Origin;
  /** Closed longitude/latitude ring to start from. */
  ring: number[][];
  onSave: (ring: number[][]) => void;
  onCancel: () => void;
  /** Fetch the OSM outline again; undefined when none is found. */
  onRestoreOsm: () => Promise<number[][] | undefined>;
}
type Drag = { kind: 'vertex' | 'edge'; index: number; start: Pt[]; from: Pt; moved: boolean };
const SOURCE = 'fp-edit', HANDLES = 'fp-edit-handles';
const LAYERS = ['fp-edit-fill', 'fp-edit-edge', 'fp-edit-edge-hit', 'fp-edit-length', 'fp-edit-mid', 'fp-edit-vertex'];
const C = footprintEditorColors;

/** 2D outline editor: drag an edge (parallel), drag a vertex, ＋ to add, Delete to remove. */
export function FootprintEditor({ map, name, origin, ring, onSave, onCancel, onRestoreOsm }: Props) {
  const [points, setPoints] = useState<Pt[]>(() => toLocal(ring, origin));
  const [history, setHistory] = useState<Pt[][]>([]);
  const [selected, setSelected] = useState<number>();
  const [message, setMessage] = useState('');
  const drag = useRef<Drag | undefined>(undefined);
  const latest = useRef(points);
  latest.current = points;
  const commit = useCallback((next: Pt[], previous: Pt[]) => { setHistory(h => [...h.slice(-49), previous]); setPoints(next); }, []);
  const local = useCallback((e: MapMouseEvent): Pt => toLocal([[e.lngLat.lng, e.lngLat.lat]], origin)[0], [origin]);

  // Layers live only while editing and sit above everything else on the map.
  useEffect(() => {
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
  }, [map]);

  useEffect(() => {
    const ringLngLat = toLngLat(points, origin);
    const lengths = edgeLengths(points);
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ringLngLat] } },
      ...points.map((_, i) => ({ type: 'Feature' as const, properties: { index: i }, geometry: { type: 'LineString' as const, coordinates: [ringLngLat[i], ringLngLat[i + 1]] } })),
    ] });
    (map.getSource(HANDLES) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [
      ...points.map((_, i) => ({ type: 'Feature' as const, properties: { role: 'mid', index: i, length: `${lengths[i].toFixed(1)} m` }, geometry: { type: 'Point' as const, coordinates: toLngLat([midpoint(points, i)], origin)[0] } })),
      ...points.map((_, i) => ({ type: 'Feature' as const, properties: { role: 'vertex', index: i, selected: i === selected }, geometry: { type: 'Point' as const, coordinates: ringLngLat[i] } })),
    ] });
  }, [map, points, origin, selected]);

  // One handler decides what was grabbed, in priority order, with a little slack around the pointer.
  useEffect(() => {
    const hit = (e: MapMouseEvent) => {
      const box: [[number, number], [number, number]] = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
      for (const layer of ['fp-edit-vertex', 'fp-edit-mid', 'fp-edit-edge-hit']) {
        const feature = map.queryRenderedFeatures(box, { layers: [layer] })[0];
        if (feature) return { layer, index: Number(feature.properties.index) };
      }
      return undefined;
    };
    const down = (e: MapMouseEvent) => {
      const target = hit(e);
      if (!target || e.originalEvent.button !== 0) return;
      e.preventDefault(); // keeps the map from panning while a handle is dragged
      const start = latest.current, from = local(e);
      if (target.layer === 'fp-edit-mid') {
        const inserted = insertVertex(start, target.index, midpoint(start, target.index));
        drag.current = { kind: 'vertex', index: target.index + 1, start, from, moved: true };
        setPoints(inserted); setSelected(target.index + 1);
      } else if (target.layer === 'fp-edit-vertex') {
        drag.current = { kind: 'vertex', index: target.index, start, from, moved: false };
        setSelected(target.index);
      } else {
        drag.current = { kind: 'edge', index: target.index, start, from, moved: false };
        setSelected(undefined);
      }
      setMessage('');
    };
    const move = (e: MapMouseEvent) => {
      const d = drag.current;
      if (!d) { map.getCanvas().style.cursor = hit(e) ? (hit(e)!.layer === 'fp-edit-edge-hit' ? 'move' : 'grab') : ''; return; }
      const at = local(e), delta: Pt = [at[0] - d.from[0], at[1] - d.from[1]];
      d.moved = true;
      if (d.kind === 'vertex') {
        const base = d.start.length === latest.current.length ? d.start : latest.current;
        setPoints(moveVertex(base, d.index, at));
      } else {
        setPoints(e.originalEvent.altKey ? moveEdgeFree(d.start, d.index, delta) : moveEdgeParallel(d.start, d.index, projectOnNormal(d.start, d.index, delta)));
      }
    };
    const up = () => {
      const d = drag.current;
      drag.current = undefined;
      if (d?.moved) setHistory(h => [...h.slice(-49), d.start]);
    };
    map.on('mousedown', down); map.on('mousemove', move); map.on('mouseup', up);
    return () => { map.off('mousedown', down); map.off('mousemove', move); map.off('mouseup', up); };
  }, [map, local]);

  const undo = useCallback(() => setHistory(h => { if (!h.length) return h; setPoints(h.at(-1)!); setSelected(undefined); return h.slice(0, -1); }), []);
  const removeSelected = useCallback(() => {
    if (selected === undefined) return;
    if (points.length <= 3) { setMessage('至少要保留 3 個頂點。'); return; }
    commit(removeVertex(points, selected), points); setSelected(undefined);
  }, [selected, points, commit]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== undefined) { e.preventDefault(); removeSelected(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Escape') setSelected(undefined);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected, removeSelected, undo]);

  const problem = useMemo(() => outlineProblem(points), [points]);
  const restore = async () => {
    setMessage('正在取得地圖上的建築形狀…');
    const osm = await onRestoreOsm();
    if (!osm) { setMessage('找不到地圖上的建築形狀，形狀沒有改變。'); return; }
    commit(toLocal(osm, origin), points); setSelected(undefined); setMessage('已換成地圖上的建築形狀。');
  };

  return (
    <div className="fp-editor" role="region" aria-label={`調整 ${name} 的形狀`}>
      <div className="fp-editor__head">
        <strong>調整形狀 · {name}</strong>
        <span>面積 {Math.round(area(points))} m² · {points.length} 個頂點</span>
      </div>
      <p className="fp-editor__hint">拖動<b>邊</b>＝平行移動（按住 Alt 可自由移動）· 拖動<b>頂點</b> · 點邊中間的<b>小圓點</b>加頂點 · 選中頂點按 Delete 刪除 · ⌘Z 復原。只改地圖上的形狀，記錄不受影響。</p>
      {(problem || message) && <p className={`fp-editor__note ${problem ? 'is-problem' : ''}`} role="status">{problem ?? message}</p>}
      <div className="fp-editor__actions">
        <button type="button" onClick={undo} disabled={!history.length}><Undo2 size={15} />復原</button>
        <button type="button" onClick={removeSelected} disabled={selected === undefined}><Trash2 size={15} />刪除頂點</button>
        <button type="button" onClick={() => void restore()}><MapPin size={15} />用地圖形狀</button>
        <span />
        <button type="button" onClick={onCancel}><RotateCcw size={15} />取消</button>
        <button type="button" className="is-primary" disabled={!!problem} onClick={() => onSave(toLngLat(points, origin))}>儲存形狀</button>
      </div>
    </div>
  );
}
