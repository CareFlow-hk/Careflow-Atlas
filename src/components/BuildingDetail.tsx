import { ArrowLeft, Building2, CalendarClock, ClipboardPlus, Flag, Minus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { floorColumnCount, floorHeadings, floorUnitColumns, lastDrawnUnit, structureImpact, unitColumnLabel } from "../domain/structure";
import { DeleteConfirm } from "./DeleteConfirm";
import { StructureBar } from "./StructureBar";
import { RoomList } from "./RoomSplitPanel";
import type { StructureChange } from "../domain/structure";
import { buildingState, clueOf, currentAssessment, followUpEventsFor, getCoverageSummary, getOpenFollowUps, isTagged, latestForUnit, subjectUnitIds, unitState, type ClueLevel, type NodeTag, type Observation, type OutreachSnapshot, type Unit } from "../domain/types";
import { assessmentLabels, clueLabels, clueMarks, coverageLabels, coverageNotUpdatedLabel, nodeTagLabel, stateColors, stateLabels, supportCategoryLabels, uncategorisedFollowUpLabel } from "../domain/presentation";
import { ObservationHistory } from "./ObservationHistory";
import { UnitPickerBar } from "./UnitPickerBar";
import { nextSelection, pruneSelection } from "./unitSelection";
import { features } from "../app/features";
import { FollowUpActions, type FollowUpActionHandler } from "./FollowUpActions";

export interface BuildingDetailProps { snapshot: OutreachSnapshot; selectedBuildingId?: string; selectedFloorId?: string; selectedUnitId?: string; onBack?: () => void; onSelectFloor: (floorId: string) => void; /** Undefined goes back to the building itself. */ onSelectUnit: (unitId?: string) => void; onToggleTag: (subject: { buildingId: string; floorId?: string }, tag?: NodeTag) => void; onFollowUpAction?: FollowUpActionHandler; onStartObservation: (subject: { buildingId: string; floorId?: string; unitId?: string; label: string; /** Several units at once, for a batch. */ unitIds?: string[] }) => void;
  /** Experimental structure editing. Returns a refusal in staff wording, if any. Without it the editor is not offered. */
  onStructureChange?: (change: StructureChange) => string | undefined;
  /** The current workbook, offered to the browser when staff delete records. Answers whether it was taken. */
  onBackup?: () => Promise<boolean>;
  /** Withdraw one record. A member may only withdraw their own; the predicate decides. */
  onWithdrawObservation?: (observationId: string) => void;
  canWithdraw?: (observation: Observation) => boolean;
  /**
   * Whether this account may delete floors, units and 劏房 rooms. Only an administrator may;
   * a member gets no delete control here, and the structure editor says why instead of
   * offering a button the server would refuse (2026-10-19).
   */
  canDeleteStructure?: boolean;
  overlapPeers?: readonly { id: string; name: string }[];
  onSelectBuilding?: (id: string) => void; }

const floorLabelOf = (snapshot: OutreachSnapshot, unit: Unit) => snapshot.floors.find(floor => floor.id === unit.floorId)?.label;
const formatDay = (value: string) => new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric" }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));

/*
 * The building as an atlas plate: a heading, three figures, then every floor and unit
 * at once as a matrix — the whole building's state in one view — and the selected
 * unit's ledger below it.
 */
export function BuildingDetail(props: BuildingDetailProps) {
  const { snapshot, selectedBuildingId, selectedFloorId, selectedUnitId, onBack, onSelectFloor, onSelectUnit, onToggleTag, onFollowUpAction, onStartObservation, onStructureChange, onBackup, onWithdrawObservation, canWithdraw, canDeleteStructure = true } = props;
  // Structure editing: a click on a cell sets that unit's 劏房 count instead of opening it.
  const [editing, setEditing] = useState(false);
  /** The unit whose 劏房 panel is open. A room opens its parent, since rooms belong to it. */
  const [splitTarget, setSplitTarget] = useState<string>();
  /**
   * A change that would delete records, held back until staff say yes. The serial number
   * gives the confirmation a key, so a second question starts with the delete shut again
   * rather than inheriting an answer given about a different change.
   */
  const [pending, setPending] = useState<{ id: number; change: StructureChange; question: string }>();
  const pendingSeq = useRef(0);
  /**
   * The units currently picked out of the elevation, for acting on several at once. It is
   * the ordinary selection plus whatever Ctrl/Command-clicking has added to it: one entry
   * is just a selected unit, so nothing extra is offered until a second one joins.
   */
  const [chosen, setChosen] = useState<string[]>([]);
  /* What a delete of the picked set would take with it, read once per selection rather than
     once per render: the bar shows the count before the click, not only in the question after. */
  const pickedImpact = useMemo(() => (chosen.length > 1 ? structureImpact(snapshot, { kind: "removeUnits", unitIds: chosen }) : undefined), [snapshot, chosen]);
  useEffect(() => { setEditing(false); setSplitTarget(undefined); setPending(undefined); setChosen([]); }, [selectedBuildingId]);
  /*
   * The structure can change under a selection: ＋／－, ✕ on a floor, or a split all rewrite the
   * units while the pick is still held. An id that no longer names anything would go on counting
   * towards 已選 N 個單位 and towards the records the bar warns about, while naming nothing that
   * can be acted on — so the pick is read against the units there are, after every change.
   */
  useEffect(() => { setChosen(previous => pruneSelection(previous, snapshot.units.map(unit => unit.id))); }, [snapshot.units]);
  const building = snapshot.buildings.find((item) => item.id === selectedBuildingId);
  const floors = useMemo(() => snapshot.floors.filter((item) => item.buildingId === selectedBuildingId).sort((a, b) => b.level - a.level), [snapshot.floors, selectedBuildingId]);
  if (!building) return <aside className="cf-building-panel cf-empty"><Building2 size={28} /><p>從地圖選擇一幢大廈，查看樓層和單位記錄。</p></aside>;
  /*
   * Deleting a floor or a unit that carries records would leave those records pointing at a
   * place that no longer exists, and the snapshot schema refuses to save that. So such a
   * delete is parked here and only carried out with `confirmed`, after staff have seen the
   * count. Everything else goes straight through.
   */
  const runChange = (change: StructureChange): string | undefined => {
    if (!onStructureChange) return undefined;
    const impact = structureImpact(snapshot, change);
    if (impact) { pendingSeq.current += 1; setPending({ id: pendingSeq.current, change, question: impact.confirmation }); return undefined; }
    return onStructureChange(change);
  };
  /*
   * Clicking the elevation where there is no unit goes back to the building itself: the
   * ledger below and the footer button read 大廈層面 again. The matrix is mostly gap, and
   * the way back to the building was the map or ⌫, neither of which is at hand here.
   *
   * Anything you can act on keeps its own click — a cell, a floor, a button, or the
   * structure editor, including its empty space and its confirmation, which stay as they
   * were. What is open stays open: this steps out of the unit, nothing more.
   */
  const blankAreaClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, input, .cf-structure, .cf-structure__confirm")) return;
    setChosen([]);
    onSelectUnit(undefined);
  };
  /*
   * Deleting units goes the same way as any other structure change: straight through when
   * nothing is recorded there, and held back by the count when something is. The picked set
   * or the unit the structure editor has open is dropped once it is gone — the ids it holds
   * no longer name anything.
   */
  const removeUnits = (unitIds: string[]) => {
    if (!onStructureChange) return;
    const change: StructureChange = { kind: "removeUnits", unitIds };
    const impact = structureImpact(snapshot, change);
    if (impact) { pendingSeq.current += 1; setPending({ id: pendingSeq.current, change, question: impact.confirmation }); return; }
    onStructureChange(change);
    setChosen([]);
    setSplitTarget(undefined);
    onSelectUnit(undefined);
  };
  const deletePicked = () => removeUnits(chosen);
  /* The one unit the structure editor has open, deleted from its own button under the split form. */
  const deleteUnit = (unitId: string) => removeUnits([unitId]);
  const openFollowUps = getOpenFollowUps(snapshot);
  const summary = getCoverageSummary(snapshot, building.id);
  const state = buildingState(snapshot, building.id);
  const buildingUnits = snapshot.units.filter(unit => unit.buildingId === building.id);
  /*
   * A unit split into 劏房 rooms keeps one column and one cell width: its rooms divide
   * that cell between them, marked off by white lines. Widening the column instead made
   * every column a different width and pushed each floor's cells out of line, so a split
   * unit no longer changes the grid at all — it only changes what is inside its cell.
   * The room names are not printed on the slices; the ledger below names them, and each
   * slice still carries its own name in `aria-label`/`title`.
   */
  /*
   * The floors laid out as fixed letter columns — A is column 0, B column 1, and so on — so a
   * deleted unit leaves its column empty and the units around it keep their positions. The
   * columns are the building's letters; a unit whose label is not a plain letter follows the
   * letters, in label order, only on its own floor. The headings are read off what each column
   * actually holds, so a building with numbered units says 1室 rather than A.
   */
  const columnCount = Math.max(0, ...floors.map(floor => floorColumnCount(snapshot, floor.id)));
  const cellsByFloor = new Map(floors.map(floor => [floor.id, floorUnitColumns(snapshot, floor.id, columnCount)]));
  const headings = floorHeadings(snapshot, floors, columnCount);
  /** Whether there are blocks at all: with none, nothing can be picked and no key is owed. */
  const hasMatrix = floors.length > 0 && columnCount > 0;
  /** "2樓 C1室" → "C1" for a room row: the floor the column repeats and 室 are understood. */
  const roomLabel = (unit: Unit) => unitColumnLabel(unit.label, floorLabelOf(snapshot, unit)).replace(/室$/, "");
  /*
   * The mark in the corner of a colour block. It says what was found; the block's colour
   * keeps saying what the visit was. A 劏房 room carries none — the room exists because
   * its unit was split, so the slice already is the finding, and a mark on it would only
   * repeat what the shape of the block says. What the split cannot say on its own is the
   * judgement, so the unit the rooms were split from says it once, on the group, having
   * no block of its own to say it in.
   */
  const clueMark = (clue: ClueLevel | undefined) => clue && clueMarks[clue]
    ? <span className={`cf-cell__clue${clue === "VERIFIED" ? " is-verified" : ""}`} aria-hidden="true">{clueMarks[clue]}</span>
    : null;
  /*
   * A plain click steps into one unit, as it always has. Ctrl/Command adds a unit to the
   * set instead, so a run of identical results can be written in one go; the ledger keeps
   * following the last cell touched, so what is picked and what is open stay legible
   * together. Rooms are picked one slice at a time: they are separate places, and each
   * keeps its own record.
   */
  const pick = (unit: Unit, event: MouseEvent<HTMLButtonElement>) => {
    if (editing) { setSplitTarget(unit.parentUnitId ?? unit.id); return; }
    if (!event.ctrlKey && !event.metaKey) { setChosen([unit.id]); onSelectUnit(unit.id); return; }
    const next = nextSelection(chosen, unit.id, true);
    setChosen(next);
    onSelectUnit(next.includes(unit.id) ? unit.id : next.at(-1));
  };
  const unitCell = (unit: Unit, room: boolean) => {
    const unitStateValue = unitState(snapshot, building.id, unit.id);
    const clue = clueOf(snapshot, building.id, unit.id);
    // The tasks that belong to this block: its own, and — for a 劏房 room — the ones on the
    // unit it was split from, which is where its colour comes from too.
    const subjects = subjectUnitIds(snapshot, unit.id);
    const tasks = openFollowUps.filter(item => item.unitId !== undefined && subjects.includes(item.unitId)).length;
    // Editing, a cell opens the 劏房 form for its unit (a room opens its parent's), so what
    // is "pressed" is that form being open — not the selection the cell shows normally.
    const owner = unit.parentUnitId ?? unit.id;
    const active = editing ? splitTarget === owner : selectedUnitId === unit.id;
    // A single picked unit is just the selection, which already has its own mark.
    const picked = chosen.length > 1 && chosen.includes(unit.id);
    const label = `${unit.label} · ${stateLabels[unitStateValue]}${tasks ? ` · ${tasks} 項待跟進` : ""}${clue ? ` · ${clueLabels[clue]}` : ""}${editing ? " · 設定劏房間數" : ""}${picked ? " · 已選" : ""}`;
    return <button key={unit.id} role="gridcell" className={`cf-cell is-${unitStateValue.toLowerCase()}${active ? " is-selected" : ""}${room ? " is-room" : ""}${picked ? " is-picked" : ""}`}
      style={{ "--cf-state": stateColors[unitStateValue] } as CSSProperties} aria-label={label} title={label} aria-pressed={active} onClick={event => pick(unit, event)}>
      {tasks > 0 && <span className="cf-cell__task">↻{tasks > 1 ? tasks : ""}</span>}{!room && clueMark(clue)}
    </button>;
  };
  /*
   * The figures under the heading count what the elevation draws. A unit that has been split
   * is a container: its rooms are the blocks on screen, so a count that kept the container as
   * well would report one place too many for every split, and would report the same failure
   * once for the unit and once for each of its rooms.
   */
  const splitIds = new Set(buildingUnits.map(unit => unit.parentUnitId).filter((id): id is string => id !== undefined));
  const drawnUnits = buildingUnits.filter(unit => !splitIds.has(unit.id));
  const failed = drawnUnits.filter(unit => unitState(snapshot, building.id, unit.id) === "RED").length;
  const selectedUnit = buildingUnits.find(unit => unit.id === selectedUnitId);
  const plate = snapshot.buildings.findIndex(item => item.id === building.id) + 1;
  const buildingTagged = isTagged(snapshot, { buildingId: building.id });
  /* Tasks on the building's own records belong to no floor, so no floor can show them.
     They stay pinned here, whatever floor or unit is selected. */
  const buildingTasks = openFollowUps.filter(task => task.buildingId === building.id && !task.floorId && !task.unitId);
  /* Everything below reads through `latestForUnit`: for a 劏房 room that is its own last record
     or, while it has none, the record made at the unit it was split from. */
  const unitLatest = selectedUnit ? latestForUnit(snapshot, selectedUnit.id) : undefined;
  const unitAssessment = selectedUnit ? currentAssessment(snapshot, selectedUnit.id) : undefined;
  const rooms = selectedUnit ? buildingUnits.filter(unit => unit.parentUnitId === selectedUnit.id).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant", { numeric: true })) : [];
  const unitTasks = selectedUnit ? openFollowUps.filter(task => task.unitId !== undefined && subjectUnitIds(snapshot, selectedUnit.id).includes(task.unitId)).length : 0;
  return (
    <aside className="cf-building-panel cf-plate" aria-label={`${building.name} 詳情`}>
      <header className="cf-plate__head">
        {onBack && <button className="cf-icon-button" onClick={onBack} aria-label="返回地圖"><ArrowLeft /></button>}
        <div className="cf-plate__title">
          <span className="cf-caps">Plate {String(plate).padStart(2, "0")} · {building.address || "地址待補"}</span>
          <h2>{building.name}{!!props.overlapPeers?.length && <> <small className="building-overlap-badge">可能重複</small></>}</h2>
          <p>{floors.length ? `${floors.length} 層 · ${drawnUnits.length} 個單位` : "樓層未知"} · <span className="cf-plate__state" style={{ "--cf-state": stateColors[state] } as CSSProperties}><i />整幢{stateLabels[state]}</span></p>
        </div>
        {features.nodeTags && <button className="cf-tag-button" aria-pressed={buildingTagged} onClick={() => onToggleTag({ buildingId: building.id }, buildingTagged ? undefined : "FOLLOW_UP")} title={buildingTagged ? "取消大廈的跟進標記" : "為全幢加上跟進標記"}><Flag size={15} />{buildingTagged ? "已標記" : "標記跟進"}</button>}
      </header>
      <div className="cf-building-content" key={building.id}>
        {!!props.overlapPeers?.length && <section className="cf-plate__sec" aria-label="可能重複的大廈">
          {props.overlapPeers.map(peer => <div key={peer.id}>
            <p>這幢和『{peer.name}』的位置重疊，可能是同一幢。請管理員確認後保留一幢；有記錄的那幢先不要刪。</p>
            <button type="button" className="cf-button" onClick={() => props.onSelectBuilding?.(peer.id)}>去『{peer.name}』</button>
          </div>)}
        </section>}

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
        <section className="cf-plate__sec" aria-label="樓層與單位" onClick={blankAreaClick}>
          {/* The key sits on its own line: in the heading row it wrapped in the middle of
              a mark and its word on a narrow panel, which read as two separate keys. It quotes the
              words the entry form offers and the marks the blocks show, from the one table
              that holds both, so the form and the elevation cannot drift apart.
              The marked lines come first and the unmarked ones on a line of their own: a run of
              lines that each begin with a mark reads as a table, and the qualifier that has no
              mark at all would break that run. */}
          <h3><span className="cf-caps">Elevation · 樓層立面</span>
            {onStructureChange && <button type="button" className={`cf-structure-toggle${editing ? " is-active" : ""}`} aria-pressed={editing} onClick={() => { setEditing(!editing); setSplitTarget(undefined); setPending(undefined); }}>{editing ? "完成" : "編輯結構"}<small>實驗</small></button>}</h3>
          <p className="cf-plate__key">{`↻ 待跟進 · ${clueMarks.SUSPECTED} ${assessmentLabels.SUSPECTED} · ${clueMarks.VERIFIED} ${assessmentLabels.STAFF_VERIFIED}`}</p>
          <p className="cf-plate__key">{`無符號＝${assessmentLabels.NO_INDICATION}／${assessmentLabels.NOT_UPDATED}`}</p>
          {hasMatrix ? <div className="cf-matrix" role="grid" aria-label="樓層與單位狀態" style={{ "--cf-cols": columnCount } as CSSProperties}>
            <span role="presentation" />
            {headings.map((label, i) => <span key={`${label}-${i}`} className="cf-matrix__col" role="columnheader">{label}</span>)}
            <span className="cf-matrix__col" role="columnheader">完成</span>
            {floors.map(floor => {
              const cells = cellsByFloor.get(floor.id) ?? [];
              const present = cells.filter((cell): cell is { unit: Unit; rooms: Unit[] } => cell !== undefined);
              const list = present.flatMap(group => (group.rooms.length ? group.rooms : [group.unit]));
              const scoped = getCoverageSummary(snapshot, building.id, floor.id);
              const lastUnit = lastDrawnUnit(cells);
              const tagged = features.nodeTags && isTagged(snapshot, { buildingId: building.id, floorId: floor.id });
              return [
                <button key={`${floor.id}-label`} className={`cf-matrix__floor${selectedFloorId === floor.id ? " is-active" : ""}`} aria-pressed={selectedFloorId === floor.id} onClick={() => onSelectFloor(floor.id)} title={tagged ? nodeTagLabel : undefined}>{floor.label}{tagged && <Flag size={10} aria-label={nodeTagLabel} />}</button>,
                ...Array.from({ length: columnCount }, (_, index) => {
                  const group = cells[index];
                  if (!group) return <span key={`${floor.id}-${index}`} className="cf-cell is-none" aria-hidden="true" />;
                  if (!group.rooms.length) return unitCell(group.unit, false);
                  const parentClue = clueOf(snapshot, building.id, group.unit.id);
                  return <span key={group.unit.id} className={`cf-cell-split${!editing && selectedUnitId === group.unit.id ? " is-selected" : ""}`} role="group" aria-label={`${group.unit.label}，分拆為 ${group.rooms.length} 間${parentClue ? `，${clueLabels[parentClue]}` : ""}`}>{clueMark(parentClue)}{group.rooms.map(room => unitCell(room, true))}</span>;
                }),
                editing && onStructureChange
                  /*
                   * ＋／－ add and drop one unit — the two ends of the same row, so － takes the
                   * last cell on screen, which is the one ＋ has just been putting there. On a
                   * floor whose last group has been split into 劏房 that is the last room, not the
                   * unit behind it: the unit is not drawn, and taking it would take every room
                   * with it. Deleting the floor itself is a different act with a different reach,
                   * so it gets its own mark at the end rather than sharing the minus.
                   */
                  ? <span key={`${floor.id}-edit`} className="cf-matrix__edit"><button type="button" aria-label={`在${floor.label}加一個單位`} title="加一個單位" onClick={() => runChange({ kind: "addUnit", floorId: floor.id })}><Plus size={11} /></button>{canDeleteStructure && <><button type="button" disabled={!lastUnit} aria-label={lastUnit ? `移除${lastUnit.label}` : `${floor.label}沒有單位可移除`} title={lastUnit ? `移除最後一個單位（${lastUnit.label}）` : "這一層沒有單位"} onClick={() => lastUnit && runChange({ kind: "removeUnits", unitIds: [lastUnit.id] })}><Minus size={11} /></button><button type="button" className="is-danger" aria-label={`刪除${floor.label}`} title="刪除整層（有記錄會先問）" onClick={() => runChange({ kind: "removeFloor", floorId: floor.id })}><X size={11} /></button></>}</span>
                  : <span key={`${floor.id}-sum`} className="cf-matrix__sum">{scoped.completed}/{list.length}</span>,
              ];
            })}
          </div> : <p className="cf-layout-note">尚未有已聲明的樓層或單位佈局，仍可記錄大廈層面的到訪。{onStructureChange && !editing && " 可按「編輯結構」直接加樓層。"}</p>}
          {/* How a set is picked, said where the picking happens. Ctrl/Command-clicking is not
              discoverable on its own, and the batch bar that would otherwise explain it only
              appears once the thing it explains has already been done. Hidden while the
              structure editor is open: there a click sets a 劏房 count instead of picking. */}
          {hasMatrix && !editing && <p className="cf-plate__hint">按住 Ctrl／Command 點色塊，可以一次記錄多個單位。</p>}
          {editing && onStructureChange && <StructureBar snapshot={snapshot} buildingId={building.id} splitUnitId={splitTarget} onCloseSplit={() => setSplitTarget(undefined)} onChange={runChange} onDeleteUnit={canDeleteStructure ? deleteUnit : undefined} canDelete={canDeleteStructure} />}
          {/* Only ever shown for a delete that would take records with it, so the count is on
              screen at the moment staff decide — not after the fact. It sits outside the
              structure editor because a picked set can be deleted without opening it. */}
          {pending && <DeleteConfirm key={pending.id} question={pending.question} onBackup={onBackup}
            onConfirm={() => { const confirmed = { ...pending.change, confirmed: true }; setPending(undefined); setSplitTarget(undefined); setChosen([]); onStructureChange?.(confirmed); }}
            onCancel={() => setPending(undefined)} />}
        </section>
        {selectedUnit ? <section className="cf-plate__sec cf-selected-unit" key={selectedUnit.id}>
          <h3><span className="cf-plate__unit">{selectedUnit.label}</span><span className="cf-caps">Ledger</span></h3>
          <dl className="cf-plate__facts">
            <dt>最近</dt><dd>{unitLatest ? `${formatDay(unitLatest.occurredAt)}，${unitLatest.optionNotes?.coverage ?? (unitLatest.coverage ? coverageLabels[unitLatest.coverage] : coverageNotUpdatedLabel)}` : "未有記錄"}{/* A room with nothing of its own reads its unit's record, and says so: the date is real, but it is not a visit to this room. */}{unitLatest && unitLatest.unitId !== selectedUnit.id && <span className="cf-plate__inherited">承自分拆前的原單位</span>}</dd>
            <dt>住房</dt><dd>{unitAssessment ? assessmentLabels[unitAssessment] : "未有判斷"}</dd>
            {(selectedUnit.parentUnitId || rooms.length > 0) && <><dt>劏房</dt><dd>{selectedUnit.parentUnitId ? <>劏房間格，屬 <button type="button" className="cf-link" onClick={() => onSelectUnit(selectedUnit.parentUnitId!)}>{buildingUnits.find(unit => unit.id === selectedUnit.parentUnitId)?.label ?? "原單位"}</button>（分拆前的記錄在那裡）</> : <><p className="cf-room-ledger__count">已分拆為 {rooms.length} 間，點一間看它自己的記錄：</p><RoomList snapshot={snapshot} rooms={rooms} labelOf={roomLabel} onSelect={onSelectUnit} onRecord={room => onStartObservation({ buildingId: building.id, floorId: room.floorId, unitId: room.id, label: `${building.name} · ${room.label}` })} /></>}</dd></>}
            {unitTasks > 0 && <><dt>待跟進</dt><dd>{unitTasks} 項</dd></>}
          </dl>
          <ObservationHistory snapshot={snapshot} subjectId={selectedUnit.id} onFollowUpAction={onFollowUpAction} onWithdraw={onWithdrawObservation} canWithdraw={canWithdraw} emptyLabel={selectedUnit.parentUnitId ? "這間房還未有自己的記錄；上面的「最近」是分拆前原單位的記錄。" : undefined} />
        </section> : <section className="cf-plate__sec cf-selected-unit">
          <h3><span className="cf-plate__unit">大廈層面</span><span className="cf-caps">Ledger</span></h3>
          <ObservationHistory snapshot={snapshot} subjectId={building.id} subjectType="BUILDING" onFollowUpAction={onFollowUpAction} onWithdraw={onWithdrawObservation} canWithdraw={canWithdraw} emptyLabel="大廈層面尚未有記錄；在上方選擇單位查看。" />
        </section>}
      </div>
      {chosen.length > 1 ? (
        <UnitPickerBar count={chosen.length} recordCount={pickedImpact?.records ?? 0}
          onClear={() => { setChosen([]); onSelectUnit(undefined); }}
          onDelete={onStructureChange && canDeleteStructure ? deletePicked : undefined}
          onRecord={() => onStartObservation({ buildingId: building.id, label: `${building.name} · 已選 ${chosen.length} 個單位`, unitIds: [...chosen] })} />
      ) : (
        <footer className="cf-record-action"><span>{building.name} · {selectedUnit?.label ?? "大廈層面"}</span><button className="cf-button cf-button--primary cf-button--full" onClick={() => onStartObservation(selectedUnit ? { buildingId: building.id, floorId: selectedUnit.floorId, unitId: selectedUnit.id, label: `${building.name} · ${selectedUnit.label}` } : { buildingId: building.id, label: `${building.name} · 大廈到訪` })}><ClipboardPlus size={18} />{selectedUnit ? "記錄今次結果" : "記錄大廈到訪"}</button></footer>
      )}
    </aside>
  );
}
