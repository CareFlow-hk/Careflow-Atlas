import { overlappingBuildings, type SpatialBuilding } from './buildingOverlaps';
import { OverlapNotice } from './OverlapNotice';
import { useState } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import { RotateCcw, Trash2, Undo2, MapPin } from 'lucide-react';
import { area, toLngLat, type Origin } from './footprintGeometry';
import { useFootprintShape } from './useFootprintShape';

interface Props {
  map: LibreMap;
  name: string;
  buildingId: string;
  buildings: readonly SpatialBuilding[];
  onSelectBuilding: (id: string) => void;
  origin: Origin;
  /** Closed longitude/latitude ring to start from. */
  ring: number[][];
  onSave: (ring: number[][]) => void;
  onCancel: () => void;
  /** Fetch the OSM outline again; undefined when none is found. */
  onRestoreOsm: () => Promise<number[][] | undefined>;
}

/** 2D outline editor: drag an edge (parallel), drag a vertex, ＋ to add, Delete to remove. */
export function FootprintEditor({ map, name, buildingId, buildings, onSelectBuilding, origin, ring, onSave, onCancel, onRestoreOsm }: Props) {
  // The draft lives here, not above: what the map shows is the edit in progress, and only
  // 儲存形狀 hands it on.
  const [draft, setDraft] = useState(ring);
  const [message, setMessage] = useState('');
  // A move answers whatever the last refusal was about, so nothing stale is left standing.
  const shape = useFootprintShape(map, origin, draft, next => { setMessage(''); setDraft(next); });

  const collisions = overlappingBuildings(draft, buildings, buildingId);
  const restore = async () => {
    setMessage('正在取得地圖上的建築形狀…');
    const osm = await onRestoreOsm();
    if (!osm) { setMessage('找不到地圖上的建築形狀，形狀沒有改變。'); return; }
    shape.replace(osm);
    setMessage('已換成地圖上的建築形狀。');
  };

  return (
    <div className="fp-editor" role="region" aria-label={`調整 ${name} 的形狀`}>
      <div className="fp-editor__head">
        <strong>調整形狀 · {name}</strong>
        <span>面積 {Math.round(area(shape.points))} m² · {shape.points.length} 個頂點</span>
      </div>
      <p className="fp-editor__hint">拖動<b>邊</b>＝平行移動（按住 Alt 可自由移動）· 拖動<b>頂點</b> · 點邊中間的<b>小圓點</b>加頂點 · 選中頂點按 Delete 刪除 · ⌘Z 復原。只改地圖上的形狀，記錄不受影響。</p>
      {(shape.problem || message) && <p className={`fp-editor__note ${shape.problem ? 'is-problem' : ''}`} role="status">{shape.problem ?? message}</p>}
      <OverlapNotice buildings={collisions} onSelect={onSelectBuilding} />
      <div className="fp-editor__actions">
        <button type="button" onClick={shape.undo} disabled={!shape.canUndo}><Undo2 size={15} />復原</button>
        <button type="button" onClick={() => setMessage(shape.removeSelected() ?? '')} disabled={shape.selected === undefined}><Trash2 size={15} />刪除頂點</button>
        <button type="button" onClick={() => void restore()}><MapPin size={15} />用地圖形狀</button>
        <span />
        <button type="button" onClick={onCancel}><RotateCcw size={15} />取消</button>
        <button type="button" className="is-primary" disabled={!!shape.problem || collisions.length > 0} onClick={() => { if (!shape.problem && !collisions.length) onSave(toLngLat(shape.points, origin)); }}>儲存形狀</button>
      </div>
    </div>
  );
}
