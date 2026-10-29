import { overlappingBuildings, type SpatialBuilding } from './buildingOverlaps';
import { OverlapNotice } from './OverlapNotice';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as LibreMap, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { CornerDownLeft, MapPin, Trash2, Undo2, X } from 'lucide-react';
import { footprintEditorColors } from '../domain/presentation';
import type { NewBuildingInput } from '../data/newBuilding';
import { area, type Origin } from './footprintGeometry';
import { findOsmFootprint, type FootprintMatch } from './osmFootprint';
import { addressFromTab, buildingInput, seedRing, shapeNote, type AddBuildingForm, type Picked } from './addBuildingDraft';
import { suggestNearbyAddress, type KnownBuilding } from './nearbyAddress';
import { useFootprintShape } from './useFootprintShape';

interface Props {
  map: LibreMap;
  /** Buildings already on the atlas; the nearest one words the address suggestion. */
  neighbours?: readonly KnownBuilding[];
  buildings: readonly SpatialBuilding[];
  onSelectBuilding: (id: string) => void;
  onAdd: (input: NewBuildingInput) => { error: string; field: string } | undefined;
  onCancel: () => void;
  find?: (p: { lng: number; lat: number }) => Promise<FootprintMatch>;
}
const SOURCE = 'add-preview', LAYERS = ['add-preview-point'];
const C = footprintEditorColors;
/** No spot picked yet, so the editor has nothing to measure from; it stays switched off. */
const NOWHERE: Origin = { lng: 0, lat: 0 };

/** Pick a spot on the flat map — left-click for a mapped building, right-click for a new one — then name it and shape it. */
export function AddBuildingPanel({ map, neighbours, buildings, onSelectBuilding, onAdd, onCancel, find = findOsmFootprint }: Props) {
  const [picked, setPicked] = useState<Picked>();
  const [form, setForm] = useState<AddBuildingForm>({ name: '', address: '' });
  const [problem, setProblem] = useState<{ text: string; field?: string }>();
  const [drawn, setDrawn] = useState<number[][]>();
  /** Why the outline would not take the last shape edit, in the editor's words. */
  const [shapeRefusal, setShapeRefusal] = useState<string>();
  const pickCount = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  // The outline is a draft like the name: picked from the basemap, then dragged into shape here
  // rather than in a second mode, and handed over with the rest of the form.
  const seed = useMemo(() => (picked ? seedRing(picked) : undefined), [picked]);
  const outline = drawn ?? seed;
  const collisions = outline ? overlappingBuildings(outline, buildings) : [];
  const origin = useMemo(() => (picked ? { lng: picked.point.lng, lat: picked.point.lat } : NOWHERE), [picked]);
  // A move answers whatever the last refusal was about, so nothing stale is left standing.
  const acceptOutline = (next: number[][]) => { setDrawn(next); setShapeRefusal(undefined); };
  const shape = useFootprintShape(map, origin, outline ?? [], acceptOutline, !!outline);
  const { forget, onShape } = shape;
  // A new spot is a new outline, so the undos of the last one go with it.
  useEffect(() => { forget(); }, [picked, forget]);
  // Still the very array the basemap handed over: putting it back with 用地圖形狀 hands back that
  // same array, so an outline someone only looked at is still recorded as OpenStreetMap's.
  const edited = !!outline && outline !== seed;

  useEffect(() => {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    map.addSource(SOURCE, { type: 'geojson', data: empty });
    map.addLayer({ id: 'add-preview-point', source: SOURCE, type: 'circle', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': C.outline, 'circle-stroke-color': C.handle, 'circle-stroke-width': 2 } });
    map.getCanvas().style.cursor = 'crosshair';
    return () => { for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(SOURCE)) map.removeSource(SOURCE); map.getCanvas().style.cursor = ''; };
  }, [map]);

  // The spot itself, which is all there is to show until there is an outline to drag.
  useEffect(() => {
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: !picked ? [] : [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [picked.point.lng, picked.point.lat] } },
    ] });
  }, [map, picked]);

  useEffect(() => {
    const place = (e: MapMouseEvent, manual: boolean) => {
      // A click on the outline is someone shaping the building, not choosing a new place for it.
      if (onShape(e.point)) return;
      const point = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      const ticket = ++pickCount.current;
      setPicked({ point, ...(manual ? { manual: true } : {}) }); setDrawn(undefined); setShapeRefusal(undefined); setProblem(undefined);
      // Keep the picked building clear of this panel, which sits at the bottom of the map.
      map.easeTo({ center: [point.lng, point.lat], offset: [0, -Math.min(170, map.getCanvas().clientHeight * .22)], duration: 450 });
      // A right-click asks for a building the basemap does not have, so nothing is matched
      // for it; snapping to an outline metres away would put the new building where it is not.
      if (manual) return;
      find(point).then(match => { if (ticket === pickCount.current) setPicked({ point, match }); },
        () => { if (ticket === pickCount.current) setPicked({ point, match: { kind: 'none', reason: '地圖資料未能連接' } }); });
    };
    const click = (e: MapMouseEvent) => place(e, false);
    const contextmenu = (e: MapMouseEvent) => place(e, true);
    map.on('click', click);
    map.on('contextmenu', contextmenu);
    return () => { map.off('click', click); map.off('contextmenu', contextmenu); };
  }, [map, find, onShape]);

  const first = !!picked && pickCount.current === 1;
  useEffect(() => { if (first) nameRef.current?.focus(); }, [first]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);

  // Where the new building is, said the way a field note would: after the nearest one on the atlas.
  const suggestion = useMemo(() => (picked ? suggestNearbyAddress(picked.point, neighbours ?? []) : undefined), [picked, neighbours]);
  const fillAddress = () => setForm(current => (suggestion ? { ...current, address: suggestion.text } : current));
  const keydown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const from = e.target === nameRef.current ? 'name' : e.target === addressRef.current ? 'address' : 'other';
    if (!addressFromTab(from, form.address, suggestion)) return;
    e.preventDefault(); fillAddress(); addressRef.current?.focus();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || (!picked.manual && !picked.match) || shape.problem || collisions.length) return;
    const refused = onAdd(buildingInput(form, picked, outline ? { ring: outline, edited } : undefined));
    setProblem(refused ? { text: refused.error, field: refused.field } : undefined);
  };
  const note = picked ? shapeNote(picked) : undefined;
  // Where 用地圖形狀 can put the outline back, when the basemap had one to offer.
  const matched = picked && !picked.manual && picked.match && picked.match.kind !== 'none' ? picked.match.ring : undefined;
  const field = (name: keyof typeof form) => ({ value: form[name], 'aria-invalid': problem?.field === name || undefined, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: e.target.value }) });

  return (
    <div className="fp-editor add-building" role="region" aria-label="新增大廈">
      <div className="fp-editor__head">
        <strong>新增大廈</strong>
        <button type="button" className="add-building__close" aria-label="取消新增大廈" onClick={onCancel}><X size={16} /></button>
      </div>
      {!picked ? <p className="fp-editor__hint">在地圖上<b>點一下大廈</b>的位置，系統會套用底圖上這幢建築的形狀；在空白位置<b>按右鍵</b>，就直接新增一個底圖上沒有的大廈單位。地址可以留空，大廈編號會自動編；樓層之後在「編輯結構」加。按 Esc 取消。</p> : <form onSubmit={submit} onKeyDown={keydown}>
        <p className={`fp-editor__note ${note?.check ? 'is-problem' : ''}`} role="status">{note?.text}<br /><small>點地圖其他位置可重新選擇。</small></p>
        {outline && <div className="add-building__shape" role="group" aria-label="大廈形狀">
          <div className="add-building__shape-head">
            <span>面積 {Math.round(area(shape.points))} m² · {shape.points.length} 個頂點</span>
            <button type="button" onClick={() => { setShapeRefusal(undefined); shape.undo(); }} disabled={!shape.canUndo} title="復原上一個改動"><Undo2 size={14} />復原</button>
            <button type="button" onClick={() => setShapeRefusal(shape.removeSelected())} disabled={shape.selected === undefined} title="刪除選中的頂點"><Trash2 size={14} />刪除頂點</button>
            {matched && <button type="button" onClick={() => { setShapeRefusal(undefined); shape.replace(matched); }} title="換回底圖上這幢建築的形狀"><MapPin size={14} />用地圖形狀</button>}
          </div>
          <p className="add-building__shape-hint">直接在地圖上拖動：拖<b>邊</b>＝平行移動（按住 Alt 可自由移動）· 拖<b>頂點</b> · 點邊中間的<b>小圓點</b>加頂點 · 選中頂點按 Delete 刪除 · ⌘Z 復原。</p>
        </div>}
        {(shape.problem ?? shapeRefusal) && <p className="fp-editor__note is-problem" role="status">{shape.problem ?? shapeRefusal}</p>}
        <OverlapNotice buildings={collisions} onSelect={onSelectBuilding} />
        <div className="add-building__grid">
          <label>大廈名稱<input ref={nameRef} {...field('name')} placeholder="例如：福滿大廈" required /></label>
          <label>地址（可留空）<input ref={addressRef} {...field('address')} placeholder={suggestion ? suggestion.text : '例如：第三街 88 號'} /></label>
        </div>
        {suggestion && !form.address.trim() && <button type="button" className="add-building__suggest" onClick={fillAddress}>
          <CornerDownLeft size={14} aria-hidden="true" />按 Tab 或點此填入「{suggestion.text}」
          <small>約 {Math.round(suggestion.distance)} 米外的{suggestion.name}</small>
        </button>}
        {problem && <p className="fp-editor__note is-problem" role="alert">{problem.text}</p>}
        <div className="fp-editor__actions">
          <span />
          <button type="button" onClick={onCancel}>取消</button>
          <button type="submit" className="is-primary" disabled={(!picked.manual && !picked.match) || !!shape.problem || collisions.length > 0}>新增大廈</button>
        </div>
      </form>}
      {!picked && problem && <p className="fp-editor__note is-problem" role="alert">{problem.text}</p>}
    </div>
  );
}
