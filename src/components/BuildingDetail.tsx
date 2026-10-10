import { ArrowLeft, Building2, CalendarClock, ClipboardPlus, Flag, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { floorUnitGroups } from "../domain/structure";
import { StructureBar } from "./StructureBar";
import type { StructureChange } from "../domain/structure";
import { buildingState, clueOf, currentAssessment, effectiveObservations, followUpEventsFor, getCoverageSummary, getOpenFollowUps, isTagged, latestObservation, unitState, type NodeTag, type OutreachSnapshot, type Unit } from "../domain/types";
import { assessmentLabels, clueLabels, coverageLabels, nodeTagLabel, stateColors, stateLabels, supportCategoryLabels, uncategorisedFollowUpLabel } from "../domain/presentation";
import { ObservationHistory } from "./ObservationHistory";
import { features } from "../app/features";
import { FollowUpActions, type FollowUpActionHandler } from "./FollowUpActions";

export interface BuildingDetailProps { snapshot: OutreachSnapshot; selectedBuildingId?: string; selectedFloorId?: string; selectedUnitId?: string; onBack?: () => void; onSelectFloor: (floorId: string) => void; onSelectUnit: (unitId: string) => void; onToggleTag: (subject: { buildingId: string; floorId?: string }, tag?: NodeTag) => void; onFollowUpAction?: FollowUpActionHandler; onStartObservation: (subject: { buildingId: string; floorId?: string; unitId?: string; label: string }) => void;
  /** Experimental structure editing. Returns a refusal in staff wording, if any. Without it the editor is not offered. */
  onStructureChange?: (change: StructureChange) => string | undefined; }

/** "5F B室" / "1樓 A室" → "B室" / "A室": the column heading drops the floor it repeats. */
const unitColumnLabel = (label: string, floorLabel?: string) => floorLabel && label.startsWith(floorLabel) && label.length > floorLabel.length ? label.slice(floorLabel.length).trim() : label.replace(/^\S+\s+/, "");
const floorLabelOf = (snapshot: OutreachSnapshot, unit: Unit) => snapshot.floors.find(floor => floor.id === unit.floorId)?.label;
const formatDay = (value: string) => new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric" }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));

/*
 * The building as an atlas plate: a heading, three figures, then every floor and unit
 * at once as a matrix — the whole building's state in one view — and the selected
 * unit's ledger below it.
 */
export function BuildingDetail(props: BuildingDetailProps) {
  const { snapshot, selectedBuildingId, selectedFloorId, selectedUnitId, onBack, onSelectFloor, onSelectUnit, onToggleTag, onFollowUpAction, onStartObservation, onStructureChange } = props;
  // Structure editing: clicks pick units instead of opening them.
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  useEffect(() => { setEditing(false); setPicked(new Set()); }, [selectedBuildingId]);
  const toggle = (ids: string[]) => setPicked(current => { const next = new Set(current); const all = ids.every(id => next.has(id)); for (const id of ids) if (all) next.delete(id); else next.add(id); return next; });
  const building = snapshot.buildings.find((item) => item.id === selectedBuildingId);
  const floors = useMemo(() => snapshot.floors.filter((item) => item.buildingId === selectedBuildingId).sort((a, b) => b.level - a.level), [snapshot.floors, selectedBuildingId]);
  if (!building) return <aside className="cf-building-panel cf-empty"><Building2 size={28} /><p>從地圖選擇一幢大廈，查看樓層和單位記錄。</p></aside>;
  const openFollowUps = getOpenFollowUps(snapshot);
  const summary = getCoverageSummary(snapshot, building.id);
  const state = buildingState(snapshot, building.id);
  const buildingUnits = snapshot.units.filter(unit => unit.buildingId === building.id);
  // A unit split into 劏房 rooms keeps one column; its rooms share that cell.
  const groupsByFloor = new Map(floors.map(floor => [floor.id, floorUnitGroups(snapshot, floor.id)]));
  const width = Math.max(0, ...[...groupsByFloor.values()].map(list => list.length));
  const headings = ([...groupsByFloor.values()].find(list => list.length === width) ?? []).map(group => unitColumnLabel(group.unit.label, floorLabelOf(snapshot, group.unit)));
  const noSplit = buildingUnits.filter(unit => unit.noSubdivision).length;
  const unitCell = (unit: Unit, room: boolean) => {
    const unitStateValue = unitState(snapshot, building.id, unit.id);
    const clue = clueOf(snapshot, building.id, unit.id);
    const tasks = openFollowUps.filter(item => item.unitId === unit.id).length;
    const active = editing ? picked.has(unit.id) : selectedUnitId === unit.id;
    const label = `${unit.label} · ${stateLabels[unitStateValue]}${tasks ? ` · ${tasks} 項待跟進` : ""}${clue ? ` · ${clueLabels[clue]}` : ""}${unit.noSubdivision ? " · 已確認無劏房" : ""}`;
    return <button key={unit.id} role="gridcell" className={`cf-cell is-${unitStateValue.toLowerCase()}${active ? " is-selected" : ""}${room ? " is-room" : ""}`}
      style={{ "--cf-state": stateColors[unitStateValue] } as CSSProperties} aria-label={label} title={label} aria-pressed={active} onClick={() => (editing ? toggle([unit.id]) : onSelectUnit(unit.id))}>
      {room && <span className="cf-cell__room">{unitColumnLabel(unit.label, floorLabelOf(snapshot, unit)).replace(/室$/, "")}</span>}
      {tasks > 0 && <span className="cf-cell__task">↻{tasks > 1 ? tasks : ""}</span>}{clue && <span className={`cf-cell__clue${clue === "VERIFIED" ? " is-verified" : ""}`}>{clue === "VERIFIED" ? "◆" : "◇"}</span>}
      {unit.noSubdivision && <span className="cf-cell__clear" aria-hidden="true">✓</span>}
    </button>;
  };
  const failed = buildingUnits.filter(unit => unitState(snapshot, building.id, unit.id) === "RED").length;
  const selectedUnit = buildingUnits.find(unit => unit.id === selectedUnitId);
  const plate = snapshot.buildings.findIndex(item => item.id === building.id) + 1;
  const buildingTagged = isTagged(snapshot, { buildingId: building.id });
  /* Tasks on the building's own records belong to no floor, so no floor can show them.
     They stay pinned here, whatever floor or unit is selected. */
  const buildingTasks = openFollowUps.filter(task => task.buildingId === building.id && !task.floorId && !task.unitId);
  const unitLatest = selectedUnit ? latestObservation(effectiveObservations(snapshot).filter(item => item.unitId === selectedUnit.id)) : undefined;
  const unitAssessment = selectedUnit ? currentAssessment(snapshot, selectedUnit.id) : undefined;
  const rooms = selectedUnit ? buildingUnits.filter(unit => unit.parentUnitId === selectedUnit.id) : [];
  const unitTasks = selectedUnit ? openFollowUps.filter(task => task.unitId === selectedUnit.id).length : 0;
  return (
    <aside className="cf-building-panel cf-plate" aria-label={`${building.name} 詳情`}>
      <header className="cf-plate__head">
        {onBack && <button className="cf-icon-button" onClick={onBack} aria-label="返回地圖"><ArrowLeft /></button>}
        <div className="cf-plate__title">
          <span className="cf-caps">Plate {String(plate).padStart(2, "0")} · {building.address}</span>
          <h2>{building.name}</h2>
          <p>{floors.length ? `${floors.length} 層 · ${buildingUnits.length} 個單位` : "樓層未知"} · <span className="cf-plate__state" style={{ "--cf-state": stateColors[state] } as CSSProperties}><i />整幢{stateLabels[state]}</span></p>
        </div>
        {features.nodeTags && <button className="cf-tag-button" aria-pressed={buildingTagged} onClick={() => onToggleTag({ buildingId: building.id }, buildingTagged ? undefined : "FOLLOW_UP")} title={buildingTagged ? "取消大廈的跟進標記" : "為全幢加上跟進標記"}><Flag size={15} />{buildingTagged ? "已標記" : "標記跟進"}</button>}
      </header>
      <div className="cf-building-content" key={building.id}>
        <section className="cf-plate__figures" aria-label="覆蓋統計">
          <div><b>{summary.completed}</b><span>／{summary.total ?? "?"} 完成單位</span></div>
          <div className={summary.followUps ? "is-alert" : ""}><b>{summary.followUps}</b><span>待跟進</span></div>
          <div><b>{failed}</b><span>未能完成</span></div>
        </section>
        {buildingTasks.length > 0 && <section className="cf-plate__sec cf-building-tasks" aria-label="本幢層面待跟進">
          <h3><span className="cf-caps">Building · 本幢待跟進</span><span className="cf-plate__count">{buildingTasks.length} 項</span></h3>
          <ul>{buildingTasks.map(task => <li key={task.observationId} className="cf-followup">
            <CalendarClock size={16} /><span><strong>{task.category ? supportCategoryLabels[task.category] : uncategorisedFollowUpLabel}</strong> · {task.action}{task.dueDate && <small>限期：{task.dueDate}</small>}
              {onFollowUpAction && <FollowUpActions observationId={task.observationId} open trail={followUpEventsFor(snapshot, task.observationId)} onAct={onFollowUpAction} />}</span>
          </li>)}</ul>
        </section>}
        <section className="cf-plate__sec" aria-label="樓層與單位">
          <h3><span className="cf-caps">Elevation · 樓層立面</span><span className="cf-plate__key">↻ 待跟進 · ◇ 疑似 · ◆ 已確認{noSplit > 0 && " · ✓ 無劏房"}</span>
            {onStructureChange && <button type="button" className={`cf-structure-toggle${editing ? " is-active" : ""}`} aria-pressed={editing} onClick={() => { setEditing(!editing); setPicked(new Set()); }}>{editing ? "完成" : "編輯結構"}<small>實驗</small></button>}</h3>
          {floors.length && width ? <div className="cf-matrix" role="grid" aria-label="樓層與單位狀態" style={{ "--cf-cols": width } as CSSProperties}>
            <span role="presentation" />
            {headings.map(label => <span key={label} className="cf-matrix__col" role="columnheader">{label}</span>)}
            <span className="cf-matrix__col" role="columnheader">完成</span>
            {floors.map(floor => {
              const groups = groupsByFloor.get(floor.id) ?? [];
              const list = groups.flatMap(group => [group.unit, ...group.rooms]);
              const scoped = getCoverageSummary(snapshot, building.id, floor.id);
              const tagged = features.nodeTags && isTagged(snapshot, { buildingId: building.id, floorId: floor.id });
              return [
                <button key={`${floor.id}-label`} className={`cf-matrix__floor${selectedFloorId === floor.id ? " is-active" : ""}`} aria-pressed={selectedFloorId === floor.id} onClick={() => (editing ? toggle(list.map(unit => unit.id)) : onSelectFloor(floor.id))} title={editing ? `選取${floor.label}全部單位` : tagged ? nodeTagLabel : undefined}>{floor.label}{tagged && <Flag size={10} aria-label={nodeTagLabel} />}</button>,
                ...Array.from({ length: width }, (_, index) => {
                  const group = groups[index];
                  if (!group) return <span key={`${floor.id}-${index}`} className="cf-cell is-none" aria-hidden="true" />;
                  if (!group.rooms.length) return unitCell(group.unit, false);
                  return <span key={group.unit.id} className="cf-cell-split" role="group" aria-label={`${group.unit.label}，分拆為 ${group.rooms.length} 間`}>{unitCell(group.unit, true)}{group.rooms.map(room => unitCell(room, true))}</span>;
                }),
                editing && onStructureChange
                  ? <span key={`${floor.id}-edit`} className="cf-matrix__edit"><button type="button" aria-label={`在${floor.label}加一個單位`} title="加一個單位" onClick={() => onStructureChange({ kind: "addUnit", floorId: floor.id })}><Plus size={11} /></button><button type="button" aria-label={`刪除${floor.label}`} title="刪除這一層（只限沒有記錄）" onClick={() => onStructureChange({ kind: "removeFloor", floorId: floor.id })}><Minus size={11} /></button></span>
                  : <span key={`${floor.id}-sum`} className="cf-matrix__sum">{scoped.completed}/{list.length}</span>,
              ];
            })}
          </div> : <p className="cf-layout-note">尚未有已聲明的樓層或單位佈局，仍可記錄大廈層面的到訪。{onStructureChange && !editing && " 可按「編輯結構」直接加樓層。"}</p>}
          {editing && onStructureChange && <StructureBar snapshot={snapshot} buildingId={building.id} picked={[...picked]} onClear={() => setPicked(new Set())} onSelectAll={() => setPicked(new Set(buildingUnits.filter(unit => !unit.noSubdivision && !buildingUnits.some(room => room.parentUnitId === unit.id) && !unit.parentUnitId).map(unit => unit.id)))} onChange={change => { const refused = onStructureChange(change); if (!refused && change.kind !== "addUnit" && change.kind !== "addFloors") setPicked(new Set()); return refused; }} />}
        </section>
        {selectedUnit ? <section className="cf-plate__sec cf-selected-unit" key={selectedUnit.id}>
          <h3><span className="cf-plate__unit">{selectedUnit.label}</span><span className="cf-caps">Ledger</span></h3>
          <dl className="cf-plate__facts">
            <dt>最近</dt><dd>{unitLatest ? `${formatDay(unitLatest.occurredAt)}，${unitLatest.optionNotes?.coverage ?? coverageLabels[unitLatest.coverage]}` : "未有記錄"}</dd>
            <dt>住房</dt><dd>{unitAssessment ? assessmentLabels[unitAssessment] : "未有判斷"}</dd>
            {(selectedUnit.noSubdivision || selectedUnit.parentUnitId || rooms.length > 0) && <><dt>劏房</dt><dd>{selectedUnit.parentUnitId ? `劏房間格，屬 ${buildingUnits.find(unit => unit.id === selectedUnit.parentUnitId)?.label ?? "原單位"}` : rooms.length ? `已分拆為 ${rooms.length} 間：${rooms.map(room => unitColumnLabel(room.label, floorLabelOf(snapshot, room))).join("、")}` : `已確認無劏房（${selectedUnit.noSubdivision!.by ?? "未記名"} · ${formatDay(selectedUnit.noSubdivision!.at)}）`}</dd></>}
            {unitTasks > 0 && <><dt>待跟進</dt><dd>{unitTasks} 項</dd></>}
          </dl>
          <ObservationHistory snapshot={snapshot} subjectId={selectedUnit.id} onFollowUpAction={onFollowUpAction} />
        </section> : <section className="cf-plate__sec cf-selected-unit">
          <h3><span className="cf-plate__unit">大廈層面</span><span className="cf-caps">Ledger</span></h3>
          <ObservationHistory snapshot={snapshot} subjectId={building.id} subjectType="BUILDING" onFollowUpAction={onFollowUpAction} emptyLabel="大廈層面尚未有記錄；在上方選擇單位查看。" />
        </section>}
      </div>
      <footer className="cf-record-action"><span>{building.name} · {selectedUnit?.label ?? "大廈層面"}</span><button className="cf-button cf-button--primary cf-button--full" onClick={() => onStartObservation(selectedUnit ? { buildingId: building.id, floorId: selectedUnit.floorId, unitId: selectedUnit.id, label: `${building.name} · ${selectedUnit.label}` } : { buildingId: building.id, label: `${building.name} · 大廈到訪` })}><ClipboardPlus size={18} />{selectedUnit ? "記錄今次結果" : "記錄大廈到訪"}</button></footer>
    </aside>
  );
}
