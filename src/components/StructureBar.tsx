import { useState } from "react";
import { Check, Plus, Scissors, Trash2, Undo2 } from "lucide-react";
import type { OutreachSnapshot } from "../domain/types";
import type { StructureChange } from "../domain/structure";

interface Props {
  snapshot: OutreachSnapshot;
  buildingId: string;
  picked: string[];
  onClear: () => void;
  onSelectAll: () => void;
  /** Returns the refusal in staff wording, if any. */
  onChange: (change: StructureChange) => string | undefined;
}

/** Experimental structure editor: add floors, then act on the units picked in the matrix. */
export function StructureBar({ snapshot, buildingId, picked, onClear, onSelectAll, onChange }: Props) {
  const floors = snapshot.floors.filter(f => f.buildingId === buildingId);
  const top = floors.reduce<string | undefined>((a, f) => (!a || f.level > (snapshot.floors.find(x => x.id === a)?.level ?? 0) ? f.id : a), undefined);
  const topUnits = top ? snapshot.units.filter(u => u.floorId === top && !u.parentUnitId).length : 0;
  const [count, setCount] = useState("1");
  const [perFloor, setPerFloor] = useState(String(topUnits || 4));
  const [rooms, setRooms] = useState("2");
  const [problem, setProblem] = useState<string>();
  const act = (change: StructureChange) => setProblem(onChange(change));
  const single = picked.length === 1 ? snapshot.units.find(u => u.id === picked[0]) : undefined;

  return (
    <div className="cf-structure" role="region" aria-label="編輯結構（實驗）">
      <form className="cf-structure__row" onSubmit={e => { e.preventDefault(); act({ kind: "addFloors", buildingId, count: Number(count), unitsPerFloor: Number(perFloor) }); }}>
        <span>在頂層之上新增</span>
        <input type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)} aria-label="新增層數" />
        <span>層，每層</span>
        <input type="number" min={0} max={24} value={perFloor} onChange={e => setPerFloor(e.target.value)} aria-label="每層單位數" />
        <span>個單位</span>
        <button type="submit"><Plus size={14} />新增樓層</button>
      </form>
      <p className="cf-structure__hint">點格子選取單位，點樓層名稱選取整層。每層右邊的 ＋／－ 加單位或刪除該層。有記錄的樓層及單位不能刪除。</p>
      <div className="cf-structure__row">
        <strong>已選 {picked.length} 個</strong>
        <button type="button" onClick={onSelectAll}>選取未確認的全部</button>
        <button type="button" onClick={onClear} disabled={!picked.length}>清除選取</button>
      </div>
      <div className="cf-structure__row">
        <button type="button" className="is-primary" disabled={!picked.length} onClick={() => act({ kind: "noSubdivision", unitIds: picked, confirm: true })}><Check size={14} />確認無劏房</button>
        <button type="button" disabled={!picked.length} onClick={() => act({ kind: "noSubdivision", unitIds: picked, confirm: false })}><Undo2 size={14} />取消確認</button>
        <span className="cf-structure__split">
          <button type="button" disabled={!single || !!single.parentUnitId} onClick={() => single && act({ kind: "split", unitId: single.id, rooms: Number(rooms) })} title={single ? undefined : "選一個單位"}><Scissors size={14} />分拆為劏房</button>
          <input type="number" min={2} max={20} value={rooms} onChange={e => setRooms(e.target.value)} aria-label="劏房間數" /><span>間</span>
        </span>
        <button type="button" className="is-danger" disabled={!picked.length} onClick={() => act({ kind: "removeUnits", unitIds: picked })}><Trash2 size={14} />刪除</button>
      </div>
      {problem && <p className="cf-structure__problem" role="alert">{problem}</p>}
    </div>
  );
}
