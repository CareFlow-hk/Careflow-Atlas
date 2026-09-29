import { ArrowLeft, Building2, CalendarClock, Check, ClipboardPlus, DoorOpen, Flag, Grid2X2, List, MapPin, RotateCcw } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { buildingState, clueOf, floorState, followUpBadges, followUpEventsFor, getCoverageStatus, getCoverageSummary, getOpenFollowUps, isTagged, unitState, type NodeTag, type OutreachSnapshot, type State } from "../domain/types";
import { clueLabels, coverageLabels, nodeTagLabel, stateColors, stateLabels, stateLegendNotes, supportCategoryLabels, uncategorisedFollowUpLabel } from "../domain/presentation";
import { ObservationHistory } from "./ObservationHistory";
import { FollowUpActions, type FollowUpActionHandler } from "./FollowUpActions";

export interface BuildingDetailProps { snapshot: OutreachSnapshot; selectedBuildingId?: string; selectedFloorId?: string; selectedUnitId?: string; onBack?: () => void; onSelectFloor: (floorId: string) => void; onSelectUnit: (unitId: string) => void; onToggleTag: (subject: { buildingId: string; floorId?: string }, tag?: NodeTag) => void; onFollowUpAction?: FollowUpActionHandler; onStartObservation: (subject: { buildingId: string; floorId?: string; unitId?: string; label: string }) => void; }

/** The four-state pill. Colour comes from the single source; the class carries no hue. */
function StateMark({ state, label }: { state: State; label: string }) {
  return <span className={`cf-state-mark cf-status-${state.toLowerCase()}`} style={{ "--cf-state": stateColors[state] } as CSSProperties} title={stateLegendNotes[state]}><i />{label}</span>;
}

export function BuildingDetail(props: BuildingDetailProps) {
  const { snapshot, selectedBuildingId, selectedFloorId, selectedUnitId, onBack, onSelectFloor, onSelectUnit, onToggleTag, onFollowUpAction, onStartObservation } = props;
  const [view, setView] = useState<"grid" | "list">("grid");
  const building = snapshot.buildings.find((item) => item.id === selectedBuildingId);
  const floors = useMemo(() => snapshot.floors.filter((item) => item.buildingId === selectedBuildingId).sort((a, b) => b.level - a.level), [snapshot.floors, selectedBuildingId]);
  const activeFloorId = selectedFloorId;
  const units = snapshot.units.filter((item) => item.floorId === activeFloorId);
  const selectedUnit = units.find((item) => item.id === selectedUnitId);
  const openFollowUps = getOpenFollowUps(snapshot);
  if (!building) return <aside className="cf-building-panel cf-empty"><Building2 size={28} /><p>從地圖選擇一幢大廈，查看樓層和單位記錄。</p></aside>;
  const summary = getCoverageSummary(snapshot, building.id);
  const buildingTagged = isTagged(snapshot, { buildingId: building.id });
  const activeFloor = floors.find((item) => item.id === activeFloorId);
  const floorTagged = activeFloor ? isTagged(snapshot, { buildingId: building.id, floorId: activeFloor.id }) : false;
  /* Tasks on the building's own records belong to no floor, so no floor can show them.
     They stay pinned here, whatever floor or unit is selected. */
  const buildingTasks = openFollowUps.filter(task => task.buildingId === building.id && !task.floorId && !task.unitId);
  return (
    <aside className="cf-building-panel" aria-label={`${building.name} 詳情`}>
      <header className="cf-building-header">{onBack && <button className="cf-icon-button" onClick={onBack} aria-label="返回地圖"><ArrowLeft /></button>}<div><span className="cf-eyebrow">大廈檔案 · 合成示例</span><h2>{building.name}</h2><p><MapPin size={14} />{building.address}</p></div>
        <button className="cf-tag-button" aria-pressed={buildingTagged} onClick={() => onToggleTag({ buildingId: building.id }, buildingTagged ? undefined : "FOLLOW_UP")} title={buildingTagged ? "取消大廈的跟進標記" : "為全幢加上跟進標記"}><Flag size={15} />{buildingTagged ? "已標記" : "標記跟進"}</button>
      </header>
      <div className="cf-building-content" key={building.id}>
        <section className="cf-stats" aria-label="覆蓋統計"><div><strong>{summary.completed}<small> / {summary.total ?? "?"}</small></strong><span>完成單位</span></div><div><strong>{summary.recorded}</strong><span>有記錄位置</span></div><div className={summary.followUps ? "cf-stat--alert" : ""}><strong>{summary.followUps}</strong><span>待跟進</span></div></section>
        {buildingTasks.length > 0 && <section className="cf-building-tasks" aria-label="本幢層面待跟進">
          <div className="cf-section-heading"><div><span className="cf-eyebrow">大廈層面</span><h3>本幢待跟進<span className="cf-section-count">{buildingTasks.length} 項</span></h3></div></div>
          <ul>{buildingTasks.map(task => <li key={task.observationId} className="cf-followup">
            <CalendarClock size={16} /><span><strong>{task.category ? supportCategoryLabels[task.category] : uncategorisedFollowUpLabel}</strong> · {task.action}{task.dueDate && <small>限期：{task.dueDate}</small>}
              {onFollowUpAction && <FollowUpActions observationId={task.observationId} open trail={followUpEventsFor(snapshot, task.observationId)} onAct={onFollowUpAction} />}</span>
          </li>)}</ul>
        </section>}
        <section className="cf-floor-section">
          <div className="cf-section-heading"><div><span className="cf-eyebrow">樓層導航</span><h3>選擇樓層</h3></div><StateMark state={buildingState(snapshot, building.id)} label={stateLabels[buildingState(snapshot, building.id)]} /></div>
          {floors.length ? <div className="cf-floor-strip" role="group" aria-label="樓層選擇">{floors.map((floor) => {
            const revisit = openFollowUps.filter(item => item.floorId === floor.id).length > 0;
            const state = floorState(snapshot, building.id, floor.id);
            // The manual mark is its own marker: it sits beside the label and never repaints the floor.
            const tagged = isTagged(snapshot, { buildingId: building.id, floorId: floor.id });
            return <button key={floor.id} aria-pressed={activeFloorId === floor.id} className={`${activeFloorId === floor.id ? "is-active" : ""} ${revisit ? "has-followup" : ""} cf-status-${state.toLowerCase()}`} style={{ "--cf-state": stateColors[state] } as CSSProperties} title={`${stateLabels[state]}${tagged ? ` · ${nodeTagLabel}` : ""}`} onClick={() => onSelectFloor(floor.id)}>{floor.label}{tagged && <Flag className="cf-node-tag" size={12} aria-label={nodeTagLabel} />}<span className="cf-floor-state" style={{ background: stateColors[state] }} />{revisit && <span title="有待跟進"><RotateCcw size={12} />復訪</span>}</button>;
          })}</div> : <p className="cf-layout-note">尚未有已聲明的樓層或單位佈局，仍可記錄大廈層面的到訪。</p>}
        </section>
        {activeFloorId ? <section className="cf-unit-section" key={activeFloorId}>
          <div className="cf-section-heading"><div><span className="cf-eyebrow">單位狀態</span><h3>{activeFloor?.label}<span className="cf-section-count">{units.length} 個單位</span></h3></div>
            <div className="cf-section-tools"><button className="cf-tag-button" aria-pressed={floorTagged} onClick={() => onToggleTag({ buildingId: building.id, floorId: activeFloorId }, floorTagged ? undefined : "FOLLOW_UP")} title={floorTagged ? "取消本層的跟進標記" : "為本層加上跟進標記"}><Flag size={15} />{floorTagged ? "已標記" : "標記本層"}</button>
              <div className="cf-view-toggle" data-view={view} aria-label="切換單位顯示"><button aria-pressed={view === "grid"} className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")} aria-label="方格顯示"><Grid2X2 /></button><button aria-pressed={view === "list"} className={view === "list" ? "is-active" : ""} onClick={() => setView("list")} aria-label="列表顯示"><List /></button></div></div></div>
          <div className={`cf-units cf-units--${view}`}>{units.map((unit) => {
            const coverage = getCoverageStatus(snapshot, building.id, unit.id);
            const state = unitState(snapshot, building.id, unit.id);
            const clue = clueOf(snapshot, building.id, unit.id);
            // The badge names its own task; it never repaints the unit's colour.
            const badge = followUpBadges(snapshot, { buildingId: building.id, unitId: unit.id })[0];
            const tasks = openFollowUps.filter(item => item.unitId === unit.id).length;
            return <button key={unit.id} aria-pressed={selectedUnitId === unit.id} className={`${selectedUnitId === unit.id ? "is-active" : ""} cf-status-${state.toLowerCase()}`} style={{ "--cf-state": stateColors[state] } as CSSProperties} title={coverageLabels[coverage]} onClick={() => onSelectUnit(unit.id)}><span><DoorOpen size={17} />{unit.label}{selectedUnitId === unit.id && <Check className="cf-unit-check" size={15} />}</span><small>{stateLabels[state]}</small>{tasks > 0 && <em className="cf-unit-followup"><RotateCcw size={12} />{badge?.category ? supportCategoryLabels[badge.category] : badge ? uncategorisedFollowUpLabel : "待跟進"}{tasks > 1 ? ` ×${tasks}` : ""}</em>}{clue && <em className={`cf-clue${clue === "VERIFIED" ? " cf-clue--verified" : ""}`}>{clueLabels[clue]}</em>}</button>;
          })}</div>
        </section> : floors.length > 0 && <p className="cf-selection-prompt">請先選擇樓層，再查看各單位狀態。</p>}
        {selectedUnit && <section className="cf-selected-unit" key={selectedUnit.id}><div className="cf-section-heading"><div><span className="cf-eyebrow">位置記錄</span><h3>{selectedUnit.label} · 到訪歷史</h3></div></div><ObservationHistory snapshot={snapshot} subjectId={selectedUnit.id} onFollowUpAction={onFollowUpAction} /></section>}
        {!selectedUnit && <section className="cf-selected-unit"><div className="cf-section-heading"><div><span className="cf-eyebrow">大廈層面</span><h3>到訪歷史</h3></div></div><ObservationHistory snapshot={snapshot} subjectId={building.id} subjectType="BUILDING" onFollowUpAction={onFollowUpAction} /></section>}
      </div>
      <footer className="cf-record-action"><span>{building.name} · {selectedUnit?.label ?? "大廈層面"}</span><button className="cf-button cf-button--primary cf-button--full" onClick={() => onStartObservation(selectedUnit ? { buildingId: building.id, floorId: activeFloorId, unitId: selectedUnit.id, label: `${building.name} · ${selectedUnit.label}` } : { buildingId: building.id, label: `${building.name} · 大廈到訪` })}><ClipboardPlus size={18} />{selectedUnit ? "記錄今次結果" : "記錄大廈到訪"}</button></footer>
    </aside>
  );
}
