import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { OutreachSnapshot } from "../domain/types";
import type { StructureChange } from "../domain/structure";
import { RoomSplitPanel } from "./RoomSplitPanel";

interface Props {
  snapshot: OutreachSnapshot;
  buildingId: string;
  /** The unit whose 劏房 panel is open under the add-floors form. */
  splitUnitId?: string;
  onCloseSplit: () => void;
  /** Returns the refusal in staff wording, if any. */
  onChange: (change: StructureChange) => string | undefined;
  /** Deletes the unit open under the split form, with the same backup gate as any removal. */
  onDeleteUnit?: (unitId: string) => void;
}

/**
 * Experimental structure editor. Floors are added here; units are added, split and deleted
 * from the matrix above, where they already are — one place per thing, and no selection to
 * keep in step with what the grid shows.
 */
export function StructureBar({ snapshot, buildingId, splitUnitId, onCloseSplit, onChange, onDeleteUnit }: Props) {
  const floors = snapshot.floors.filter(f => f.buildingId === buildingId);
  const top = floors.reduce<string | undefined>((a, f) => (!a || f.level > (snapshot.floors.find(x => x.id === a)?.level ?? 0) ? f.id : a), undefined);
  const topUnits = top ? snapshot.units.filter(u => u.floorId === top && !u.parentUnitId).length : 0;
  const [count, setCount] = useState("1");
  const [perFloor, setPerFloor] = useState(String(topUnits || 4));
  const [problem, setProblem] = useState<string>();

  return (
    <div className="cf-structure" role="region" aria-label="編輯結構（實驗）">
      <form className="cf-structure__row" onSubmit={e => { e.preventDefault(); setProblem(onChange({ kind: "addFloors", buildingId, count: Number(count), unitsPerFloor: Number(perFloor) })); }}>
        <span>在頂層之上新增</span>
        <input type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)} aria-label="新增層數" />
        <span>層，每層</span>
        <input type="number" min={0} max={24} value={perFloor} onChange={e => setPerFloor(e.target.value)} aria-label="每層單位數" />
        <span>個單位</span>
        <button type="submit"><Plus size={14} />新增樓層</button>
      </form>
      {/* Keyed on the unit, so opening another one starts a clean form rather than carrying
          over what was typed or refused for the last. The panel speaks for its own refusals,
          so this row's message is cleared rather than said twice. */}
      {splitUnitId && <RoomSplitPanel key={splitUnitId} snapshot={snapshot} unitId={splitUnitId} onStructureChange={change => { setProblem(undefined); return onChange(change); }} onClose={onCloseSplit} />}
      {splitUnitId && onDeleteUnit && <div className="cf-structure__delete"><button type="button" onClick={() => onDeleteUnit(splitUnitId)}><Trash2 size={15} />刪除本單位</button></div>}
      <p className="cf-structure__hint">點樓層格子設定劏房間數或刪除本單位；每層右邊的 ＋／－ 加減一個單位，✕ 刪除整層。有記錄的會先問一次。</p>
      {problem && <p className="cf-structure__problem" role="alert">{problem}</p>}
    </div>
  );
}
