import { CalendarClock, CheckCircle2, CircleAlert, History, PencilLine, UserRound } from "lucide-react";
import { compareObservationTime, followUpResolutions, supersededObservationIds, supportCategoryLabels, type Observation, type OutreachSnapshot } from "../domain/types";

export interface ObservationHistoryProps { snapshot: OutreachSnapshot; subjectId: string; subjectType?: "UNIT" | "BUILDING"; emptyLabel?: string; }
const assessmentLabels: Record<NonNullable<Observation["assessment"]>, string> = { NOT_UPDATED: "今次未更新住房判斷", UNKNOWN: "住房情況未能確定", SUSPECTED: "疑似劏房，尚待核實", NO_INDICATION: "今次未見相關跡象", STAFF_VERIFIED: "由工作人員確認" };
const contactLabels: Record<NonNullable<Observation["contactOutcome"]>, string> = { NOT_ATTEMPTED: "未嘗試接觸", NO_ANSWER: "無人應門", DECLINED: "住戶婉拒", CONTACTED: "已接觸", UNKNOWN: "接觸結果未明" };
const coverageLabels: Record<Observation["coverage"], string> = { UNKNOWN: "覆蓋未明", UNVISITED: "未到訪", ATTEMPTED: "曾嘗試", PARTIAL: "部分完成", VISITED_NO_FINDING: "已訪，無記錄發現", VISITED_WITH_FINDING: "已訪，有記錄", INACCESSIBLE: "未能進入" };
function formatDate(value?: string) { if (!value) return "未定日期"; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function ObservationHistory({ snapshot, subjectId, subjectType = "UNIT", emptyLabel = "這個位置尚未有記錄" }: ObservationHistoryProps) {
  // Ordered by the same rule coverage uses, so "current" here never contradicts the status chip.
  const observations = snapshot.observations.filter((item) => subjectType === "UNIT" ? item.unitId === subjectId : item.buildingId === subjectId && !item.unitId).sort((a, b) => compareObservationTime(b, a));
  if (!observations.length) return <div className="cf-empty"><History size={18} /><p>{emptyLabel}</p></div>;
  const superseded = supersededObservationIds(snapshot.observations);
  const resolutions = followUpResolutions(snapshot);
  const currentId = observations.find((item) => !superseded.has(item.id))?.id;
  return <div className="cf-history" aria-label="位置記錄歷史">{observations.map((observation) => {
    const resolvedBy = resolutions.get(observation.id);
    const correctedBy = snapshot.observations.find((item) => item.correctsObservationId === observation.id);
    const isSuperseded = superseded.has(observation.id);
    const label = observation.id === currentId ? "當前有效" : isSuperseded ? "已被更正" : "較早記錄";
    return <article className={`cf-event ${observation.id === currentId ? "is-latest" : ""} ${isSuperseded ? "is-superseded" : ""}`} key={observation.id}>
      <div className="cf-event__rail" aria-hidden="true"><span /></div>
      <div className="cf-event__content"><div className="cf-event__meta"><span>{label}</span><time dateTime={observation.recordedAt}>{formatDate(observation.recordedAt)}</time></div>
        <h4>{observation.note || observation.evidence[0] || coverageLabels[observation.coverage]}</h4>
        <div className="cf-chips"><span className="cf-chip"><UserRound size={14} />{observation.workerName}</span><span className="cf-chip">{coverageLabels[observation.coverage]}</span>{observation.contactOutcome && <span className="cf-chip">{contactLabels[observation.contactOutcome]}</span>}{observation.assessment && <span className={`cf-chip ${["SUSPECTED", "UNKNOWN"].includes(observation.assessment) ? "cf-chip--uncertain" : ""}`}><CircleAlert size={14} />{assessmentLabels[observation.assessment]}</span>}</div>
        {observation.evidence.length > 0 && <p className="cf-event__note">依據：{observation.evidence.join("；")}</p>}
        <p className="cf-event__recorded">{`探訪：${formatDate(observation.occurredAt)} · `}記錄於 {formatDate(observation.recordedAt)}</p>
        {observation.paperRef && <p className="cf-event__recorded">紙本 {observation.paperRef}{observation.paperLine ? ` · 第 ${observation.paperLine} 行` : ''}{observation.importSource ? ` · Excel ${observation.importSource.sheet} 第 ${observation.importSource.row} 行` : ''}</p>}
        {observation.followUp && <div className={`cf-followup ${resolvedBy || observation.followUp.status === "DONE" ? "is-resolved" : ""}`}><CalendarClock size={16} /><span><strong>{resolvedBy || observation.followUp.status === "DONE" ? "已由後續記錄結束" : isSuperseded ? "已被更正，詳見後續記錄" : "待跟進"}</strong> · {observation.followUp.action}<small>限期：{formatDate(observation.followUp.dueDate)}{resolvedBy ? ` · 結束於 ${formatDate(resolvedBy.occurredAt)}` : ""}</small></span></div>}
        {observation.followUp && <p className="cf-event__note">{observation.followUp.category ? supportCategoryLabels[observation.followUp.category] : '一般跟進'}{observation.followUp.assignee ? ` · ${observation.followUp.assignee}` : ''}{observation.followUp.timingNote ? ` · ${observation.followUp.timingNote}` : ''}</p>}
        {observation.resolvesObservationId && <p className="cf-resolved-note"><CheckCircle2 size={14} />這次結果已結束一項較早的復訪。</p>}
        {observation.correctsObservationId && <p className="cf-resolved-note"><PencilLine size={14} />更正記錄 {observation.correctsObservationId}{observation.correctionReason ? ` · ${observation.correctionReason}` : ''}。</p>}
        {isSuperseded && <p className="cf-superseded-note"><History size={14} />此記錄已被 {correctedBy?.id ?? "後續更正"} 取代，不再計入覆蓋，保留作追溯。</p>}
      </div>
    </article>;
  })}</div>;
}
