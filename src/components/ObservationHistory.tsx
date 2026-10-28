import { useState } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, History, Info, PencilLine, Undo2, UserRound } from "lucide-react";
import { compareObservationTime, followUpClosures, followUpEventsFor, followUpResolutions, getOpenFollowUps, supersededObservationIds, type Observation, type OutreachSnapshot } from "../domain/types";
import { assessmentLabels, contactLabels, coverageLabels, coverageNotUpdatedLabel, followUpClosedLabels, sourceLabels, supportCategoryLabels } from "../domain/presentation";
import { impliedByCoverage } from "../domain/optionPrefs";
import { FollowUpActions, type FollowUpActionHandler } from "./FollowUpActions";
import { providerLabel } from "../ai/providers";

export interface ObservationHistoryProps {
  snapshot: OutreachSnapshot; subjectId: string; subjectType?: "UNIT" | "BUILDING"; emptyLabel?: string;
  /** Close or reopen a task in place. Without it the history is read-only. */
  onFollowUpAction?: FollowUpActionHandler;
  /**
   * Withdraw a record. Without it no button is offered. The predicate decides which rows
   * this account may withdraw, so the button never appears where the server would refuse.
   */
  onWithdraw?: (observationId: string) => void;
  canWithdraw?: (observation: Observation) => boolean;
}
function formatDate(value?: string) { if (!value) return "未定日期"; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function ObservationHistory({ snapshot, subjectId, subjectType = "UNIT", emptyLabel = "這個位置尚未有記錄", onFollowUpAction, onWithdraw, canWithdraw }: ObservationHistoryProps) {
  // Withdrawing is asked once per row, in place, so the click cannot be mistaken for a view.
  const [asking, setAsking] = useState<string>();
  // Ordered by the same rule coverage uses, so "current" here never contradicts the status chip.
  // A withdrawn row stays in the list: it is history, and the person who withdrew it is named.
  const observations = snapshot.observations.filter((item) => subjectType === "UNIT" ? item.unitId === subjectId : item.buildingId === subjectId && !item.unitId).sort((a, b) => compareObservationTime(b, a));
  if (!observations.length) return <div className="cf-empty"><History size={18} /><p>{emptyLabel}</p></div>;
  const superseded = supersededObservationIds(snapshot.observations);
  const resolutions = followUpResolutions(snapshot);
  const closures = followUpClosures(snapshot);
  const openIds = new Set(getOpenFollowUps(snapshot).map(task => task.observationId));
  const currentId = observations.find((item) => !item.deleted && !superseded.has(item.id))?.id;
  return <div className="cf-history" aria-label="位置記錄歷史">{observations.map((observation) => {
    const resolvedBy = resolutions.get(observation.id);
    const closure = closures.get(observation.id);
    /* Floors no longer keep records, but an older import may have written one. It is
       history only; name its floor so it is never read as a whole-building record. */
    const legacyFloor = !observation.unitId && observation.floorId ? snapshot.floors.find(floor => floor.id === observation.floorId)?.label ?? observation.floorId : undefined;
    const correctedBy = snapshot.observations.find((item) => item.correctsObservationId === observation.id);
    const isSuperseded = superseded.has(observation.id);
    // A withdrawn row is history only: it never counts as the current version.
    const isWithdrawn = Boolean(observation.deleted);
    const label = isWithdrawn ? "已撤回" : observation.id === currentId ? "當前有效" : isSuperseded ? "已被更正" : "較早記錄";
    /*
     * 接觸結果 is no longer asked, so a new record's outcome is the one its coverage implies
     * and a chip for it would only repeat the coverage chip beside it. It stays visible when
     * it says something the coverage does not — an older record where the two were chosen
     * apart, such as 未能完成探訪 with 已接觸 — because hiding that would lose a real fact.
     */
    const showsContact = Boolean(observation.contactOutcome)
      && observation.contactOutcome !== impliedByCoverage('contactOutcome', observation.coverage ?? '');
    /* A record may state no coverage: the chip then says so, rather than borrowing a
       colour from a blank. The place's earlier result still stands elsewhere. */
    const coverageText = observation.optionNotes?.coverage ?? (observation.coverage ? coverageLabels[observation.coverage] : coverageNotUpdatedLabel);
    return <article className={`cf-event ${observation.id === currentId ? "is-latest" : ""} ${isSuperseded ? "is-superseded" : ""} ${isWithdrawn ? "is-withdrawn" : ""}`} key={observation.id}>
      <div className="cf-event__rail" aria-hidden="true"><span /></div>
      <div className="cf-event__content"><div className="cf-event__meta"><span>{label}</span><time dateTime={observation.recordedAt}>{formatDate(observation.recordedAt)}</time></div>
        <h4>{observation.note || observation.evidence[0] || coverageText}</h4>
        {/* A self-defined wording, if one was typed, is shown instead of the enum's own. */}
        <div className="cf-chips">{legacyFloor && <span className="cf-chip cf-chip--floor">{legacyFloor} 樓層記錄</span>}<span className="cf-chip"><UserRound size={14} />{observation.workerName}</span><span className="cf-chip">{coverageText}</span>{showsContact && <span className="cf-chip">{observation.optionNotes?.contactOutcome ?? contactLabels[observation.contactOutcome!]}</span>}{/* A record that updated no housing judgement gets no chip: the coverage chip already says what the visit was. */}{observation.assessment && observation.assessment !== "NOT_UPDATED" && <span className={`cf-chip ${["SUSPECTED", "UNKNOWN"].includes(observation.assessment) ? "cf-chip--uncertain" : ""}`}><CircleAlert size={14} />{observation.optionNotes?.assessment ?? assessmentLabels[observation.assessment]}</span>}
          {/* No source recorded stays silent. "來源未明" is a different claim from "not recorded". */}
          {observation.sourceType && <span className="cf-chip cf-chip--source"><Info size={14} />{observation.optionNotes?.sourceType ?? sourceLabels[observation.sourceType]}</span>}</div>
        {observation.evidence.length > 0 && <p className="cf-event__note">依據：{observation.evidence.join("；")}</p>}
        <p className="cf-event__recorded">{`探訪：${formatDate(observation.occurredAt)} · `}記錄於 {formatDate(observation.recordedAt)}</p>
        {observation.photoSource && <p className="cf-event__recorded">{observation.photoSource.sample ? '示範照片回錄' : '照片回錄'} · {observation.photoSource.reviewedBy.name} 已核對 · {observation.photoSource.model}</p>}
        {observation.paperRef && <p className="cf-event__recorded">紙本 {observation.paperRef}{observation.paperLine ? observation.photoSource ? ` · 定位：${observation.paperLine}` : ` · 第 ${observation.paperLine} 行` : ''}{observation.importSource ? ` · Excel ${observation.importSource.sheet} 第 ${observation.importSource.row} 行` : ''}</p>}
        {observation.followUp && <div className={`cf-followup ${resolvedBy || closure || observation.followUp.status === "DONE" ? "is-resolved" : ""}`}><CalendarClock size={16} /><span><strong>{resolvedBy || observation.followUp.status === "DONE" ? "已由後續記錄結束" : closure ? followUpClosedLabels[closure.action as keyof typeof followUpClosedLabels] : isSuperseded ? "已被更正，詳見後續記錄" : "待跟進"}</strong> · {observation.followUp.action}<small>限期：{formatDate(observation.followUp.dueDate)}{resolvedBy ? ` · 結束於 ${formatDate(resolvedBy.occurredAt)}` : ""}</small></span></div>}
        {/* A category written out by hand is shown as written; no category at all adds no
            line, since the status above already says 待跟進. */}
        {observation.followUp && (() => {
          const category = observation.optionNotes?.followUpCategory ?? (observation.followUp.category ? supportCategoryLabels[observation.followUp.category] : undefined);
          const parts = [category, observation.followUp.assignee, observation.followUp.timingNote].filter(Boolean);
          return parts.length > 0 && <p className="cf-event__note">{parts.join(' · ')}</p>;
        })()}
        {/* Only the effective version carries the buttons, so a task is closed once. */}
        {observation.followUp && onFollowUpAction && !isSuperseded && !isWithdrawn && (openIds.has(observation.id) || closure || followUpEventsFor(snapshot, observation.id).length > 0) && <FollowUpActions observationId={observation.id} open={openIds.has(observation.id)} closure={closure} trail={followUpEventsFor(snapshot, observation.id)} onAct={onFollowUpAction} />}
        {observation.resolvesObservationId && <p className="cf-resolved-note"><CheckCircle2 size={14} />這次到訪完成了一項較早的跟進。</p>}
        {observation.correctsObservationId && <p className="cf-resolved-note"><PencilLine size={14} />更正記錄 {observation.correctsObservationId}{observation.correctionReason ? ` · ${observation.correctionReason}` : ''}。</p>}
        {isSuperseded && <p className="cf-superseded-note"><History size={14} />此記錄已被 {correctedBy?.id ?? "後續更正"} 取代，不再計入覆蓋，保留作追溯。</p>}
        {/* The operator who saved the row is not the paper worker; both are named, never merged. */}
        {observation.createdBy && <p className="cf-event__recorded">由 {observation.createdBy.name} 儲存{observation.deleted ? ` · ${formatDate(observation.deleted.at)} 由 ${observation.deleted.by.name} 撤回` : ''}</p>}
        {/* The tool is named beside, never instead of, the person who confirmed the row. */}
        {observation.aiAssist && <p className="cf-event__recorded">由 AI 協助（{providerLabel(observation.aiAssist.provider)} · {observation.aiAssist.model} · {formatDate(observation.aiAssist.at)}）</p>}
        {isWithdrawn && <p className="cf-superseded-note"><Undo2 size={14} />此記錄已撤回，不再計入覆蓋與跟進，保留作追溯。</p>}
        {onWithdraw && canWithdraw?.(observation) && (asking === observation.id
          ? <div className="cf-withdraw-ask" role="group" aria-label="確認撤回記錄"><span>撤回後這筆記錄不再計入覆蓋與跟進，但仍留在歷史。確定撤回？</span><button type="button" className="cf-button cf-withdraw__confirm" onClick={() => { setAsking(undefined); onWithdraw(observation.id); }}>確定撤回</button><button type="button" className="cf-button cf-button--ghost" onClick={() => setAsking(undefined)}>取消</button></div>
          : <button type="button" className="cf-button cf-button--ghost cf-withdraw" onClick={() => setAsking(observation.id)}><Undo2 size={14} />撤回這筆記錄</button>)}
      </div>
    </article>;
  })}</div>;
}
