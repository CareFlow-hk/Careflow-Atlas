import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as LibreMap, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { X } from 'lucide-react';
import { footprintEditorColors } from '../domain/presentation';
import type { NewBuildingInput } from '../data/newBuilding';
import { findOsmFootprint, type FootprintMatch } from './osmFootprint';
import { outlineCentre } from './footprintGeometry';

interface Props {
  map: LibreMap;
  /** Prefilled id; the person may change it. */
  suggestedId: string;
  /** Name of a building already on the atlas under a point, so it is not added twice. */
  existingAt: (e: MapMouseEvent) => string | undefined;
  onAdd: (input: NewBuildingInput) => { error: string; field: string } | undefined;
  onCancel: () => void;
  find?: (p: { lng: number; lat: number }) => Promise<FootprintMatch>;
}
type Picked = { point: { lng: number; lat: number }; match?: FootprintMatch };
const SOURCE = 'add-preview', LAYERS = ['add-preview-fill', 'add-preview-edge', 'add-preview-point'];
const C = footprintEditorColors;

function shapeNote(match: FootprintMatch | undefined) {
  if (!match) return { text: '正在找地圖上的建築形狀…', check: false };
  if (match.kind === 'none') return { text: `找不到地圖上的建築（${match.reason}），會先用預設方塊。新增後可用「調整大廈形狀」畫出輪廓。`, check: true };
  const size = `約 ${Math.round(match.area)} m²`;
  if (match.large) return { text: `地圖上的建築${size}，可能連着相鄰大廈。新增後可用「調整大廈形狀」收窄。`, check: true };
  if (match.kind === 'nearest' && match.distance >= 1) return { text: `你點的位置不在建築內，用了 ${Math.round(match.distance)} 米外最近的建築（${size}）。不對的話請點準一點。`, check: true };
  return { text: `已套用地圖上的建築形狀（${size}，來源 OpenStreetMap）。`, check: false };
}

/** Click a spot on the flat map, see the matched OSM outline, then name the building. */
export function AddBuildingPanel({ map, suggestedId, existingAt, onAdd, onCancel, find = findOsmFootprint }: Props) {
  const [picked, setPicked] = useState<Picked>();
  const [form, setForm] = useState({ id: suggestedId, name: '', address: '', layout: '' });
  const [problem, setProblem] = useState<{ text: string; field?: string }>();
  const pickCount = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    map.addSource(SOURCE, { type: 'geojson', data: empty });
    map.addLayer({ id: 'add-preview-fill', source: SOURCE, type: 'fill', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': C.outline, 'fill-opacity': .18 } });
    map.addLayer({ id: 'add-preview-edge', source: SOURCE, type: 'line', filter: ['==', '$type', 'Polygon'], paint: { 'line-color': C.outline, 'line-width': 2.5 } });
    map.addLayer({ id: 'add-preview-point', source: SOURCE, type: 'circle', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': C.outline, 'circle-stroke-color': C.handle, 'circle-stroke-width': 2 } });
    map.getCanvas().style.cursor = 'crosshair';
    return () => { for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(SOURCE)) map.removeSource(SOURCE); map.getCanvas().style.cursor = ''; };
  }, [map]);

  useEffect(() => {
    const ring = picked?.match && picked.match.kind !== 'none' ? picked.match.ring : undefined;
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: !picked ? [] : [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [picked.point.lng, picked.point.lat] } },
      ...(ring ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } }] : []),
    ] });
  }, [map, picked]);

  useEffect(() => {
    const click = (e: MapMouseEvent) => {
      const existing = existingAt(e);
      if (existing) { setProblem({ text: `這裡已經有「${existing}」。請點另一幢大廈。` }); return; }
      const point = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      const ticket = ++pickCount.current;
      setPicked({ point }); setProblem(undefined);
      // Keep the picked building clear of this panel, which sits at the bottom of the map.
      map.easeTo({ center: [point.lng, point.lat], offset: [0, -Math.min(170, map.getCanvas().clientHeight * .22)], duration: 450 });
      find(point).then(match => { if (ticket === pickCount.current) setPicked({ point, match }); },
        () => { if (ticket === pickCount.current) setPicked({ point, match: { kind: 'none', reason: '地圖資料未能連接' } }); });
    };
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [map, existingAt, find]);

  const first = !!picked && pickCount.current === 1;
  useEffect(() => { if (first) nameRef.current?.focus(); }, [first]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked?.match) return;
    const match = picked.match;
    const outline = match.kind === 'none' ? undefined : match;
    const refused = onAdd({
      id: form.id, name: form.name, address: form.address, layout: form.layout,
      // The marker sits in the middle of the outline, not wherever the click landed.
      coordinates: outline ? outlineCentre(outline.ring) : picked.point,
      ...(outline ? { footprint: outline.ring, footprintSource: { kind: 'osm' as const, at: new Date().toISOString(), osmId: outline.osmId, match: outline.kind } } : {}),
    });
    setProblem(refused ? { text: refused.error, field: refused.field } : undefined);
  };
  const note = shapeNote(picked?.match);
  const field = (name: keyof typeof form) => ({ value: form[name], 'aria-invalid': problem?.field === name || undefined, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [name]: e.target.value }) });

  return (
    <div className="fp-editor add-building" role="region" aria-label="新增大廈">
      <div className="fp-editor__head">
        <strong>新增大廈</strong>
        <button type="button" className="add-building__close" aria-label="取消新增大廈" onClick={onCancel}><X size={16} /></button>
      </div>
      {!picked ? <p className="fp-editor__hint">在地圖上<b>點一下大廈</b>的位置。系統會套用地圖上這幢建築的形狀。按 Esc 取消。</p> : <form onSubmit={submit}>
        <p className={`fp-editor__note ${note.check ? 'is-problem' : ''}`} role="status">{note.text}<br /><small>點地圖其他位置可重新選擇。</small></p>
        <div className="add-building__grid">
          <label>大廈名稱<input ref={nameRef} {...field('name')} placeholder="例如：福滿大廈" required /></label>
          <label>地址<input {...field('address')} placeholder="例如：第三街 88 號" required /></label>
          <label>大廈編號<input {...field('id')} spellCheck={false} /></label>
          <label className="add-building__layout">樓層及單位（可留空，之後在 Excel 補）<textarea {...field('layout')} rows={3} placeholder={'由最低一層開始，一行一層：\n1 樓：1樓 A室、1樓 B室\n2 樓：2樓 A室、2樓 B室'} /></label>
        </div>
        {problem && <p className="fp-editor__note is-problem" role="alert">{problem.text}</p>}
        <div className="fp-editor__actions">
          <span />
          <button type="button" onClick={onCancel}>取消</button>
          <button type="submit" className="is-primary" disabled={!picked.match}>新增大廈</button>
        </div>
      </form>}
      {!picked && problem && <p className="fp-editor__note is-problem" role="alert">{problem.text}</p>}
    </div>
  );
}
