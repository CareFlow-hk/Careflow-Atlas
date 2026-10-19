import { useState, type CSSProperties } from "react";
import { ClipboardPlus, Scissors, X } from "lucide-react";
import type { OutreachSnapshot, Unit } from "../domain/types";
import { getOpenFollowUps, unitState } from "../domain/types";
import { stateColors, stateLabels } from "../domain/presentation";
import { MAX_ROOMS, roomCountAction, type StructureChange } from "../domain/structure";

/**
 * Experimental: the 劏房 rooms of one unit, listed in that unit's own ledger.
 *
 * Structure only — recording a room opens the ordinary observation editor, so nothing here
 * writes observations (see the note at the top of domain/structure.ts). The list is
 * read-only apart from 記錄: how many rooms there are is set in the structure editor, where
 * 1 merges them back.
 */
export interface RoomListProps {
  snapshot: OutreachSnapshot;
  rooms: Unit[];
  /** "2樓 C1室" → "C1": the floor the column repeats and the trailing 室 are dropped. */
  labelOf: (unit: Unit) => string;
  onRecord: (room: Unit) => void;
  onSelect?: (roomId: string) => void;
}

export function RoomList({ snapshot, rooms, labelOf, onRecord, onSelect }: RoomListProps) {
  const openFollowUps = getOpenFollowUps(snapshot);
  return (
    <ul className="cf-room-list" aria-label="劏房">
      {rooms.map(room => {
        const state = unitState(snapshot, room.buildingId, room.id);
        const tasks = openFollowUps.filter(item => item.unitId === room.id).length;
        const name = labelOf(room);
        const summary = `${stateLabels[state]}${tasks ? ` · ${tasks} 項待跟進` : ""}`;
        const dot = <i style={{ "--cf-state": stateColors[state] } as CSSProperties} aria-hidden="true" />;
        return (
          <li key={room.id}>
            <div className="cf-room-list__row">
              {onSelect
                ? <button type="button" className="cf-room-list__pick" onClick={() => onSelect(room.id)} aria-label={`選取 ${name}，${summary}`}>{dot}<strong>{name}</strong><small>{summary}</small></button>
                : <span className="cf-room-list__pick">{dot}<strong>{name}</strong><small>{summary}</small></span>}
              <button type="button" className="cf-room-list__act" onClick={() => onRecord(room)} aria-label={`記錄 ${name}`}><ClipboardPlus size={13} />記錄</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface RoomSplitPanelProps {
  snapshot: OutreachSnapshot;
  unitId: string;
  /** Returns the refusal in staff wording, if any. A removal awaiting confirmation says so. */
  onStructureChange: (change: StructureChange) => string | undefined;
  onClose: () => void;
  /**
   * Whether this account may reduce the room count. A member may only add rooms; the field
   * then starts at what the unit has, and the hint says why it cannot go lower.
   */
  canDelete?: boolean;
}

/**
 * How many 劏房 rooms one unit is divided into, set in place under 新增樓層 rather than in a
 * dialog of its own — the number is a property of the unit, and the unit is already on screen.
 * 1 merges the rooms back, which is the only way a room is removed.
 */
export function RoomSplitPanel({ snapshot, unitId, onStructureChange, onClose, canDelete = true }: RoomSplitPanelProps) {
  const unit = snapshot.units.find(item => item.id === unitId);
  const children = unit ? snapshot.units.filter(item => item.parentUnitId === unit.id) : [];
  /** Only set once someone types: until then the field follows the unit's own room count. */
  const [typed, setTyped] = useState<string>();
  const [problem, setProblem] = useState<string>();
  if (!unit) return null;
  const rooms = typed ?? String(children.length || 2);
  const count = Number(rooms);

  return (
    <div className="cf-room-split" role="group" aria-label={`新增劏房：${unit.label}`}>
      <header>
        <div><span className="cf-caps">Split · 新增劏房</span><h4>{unit.label}</h4></div>
        <button type="button" onClick={onClose} aria-label="收起新增劏房"><X size={15} /></button>
      </header>
      <form onSubmit={event => {
        event.preventDefault();
        const refused = onStructureChange({ kind: "split", unitId: unit.id, rooms: count });
        setProblem(refused);
        // A change that went through hands the field back to the unit: 「已合併」would
        // otherwise leave it saying 1, which reads as one room where there are now none.
        if (!refused) setTyped(undefined);
      }}>
        <span>分為</span>
        {/* A member cannot take rooms away, so the field starts where the unit is: below
            that there is nothing to type but a refusal. */}
        <input type="number" min={canDelete ? 1 : Math.max(children.length, 1)} max={MAX_ROOMS} value={rooms} onChange={event => setTyped(event.target.value)} aria-label="劏房間數" />
        <span>間</span>
        <button type="submit"><Scissors size={14} />{roomCountAction(count, children.length)}</button>
      </form>
      <p className="cf-room-split__hint">{children.length
        ? `現在有 ${children.length} 間。填 1 即合併回一個單位；房間的記錄會跟着一起刪除，要先確認。`
        : "分拆後原單位保留，分拆前的記錄仍在它名下。每間劏房可各自記錄。"}{!canDelete && "員工只能增加劏房，不能減少或合併。"}</p>
      {problem && <p className="cf-room-split__problem" role="alert">{problem}</p>}
    </div>
  );
}
