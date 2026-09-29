import { Check, Undo2, X } from "lucide-react";
import { useState } from "react";
import type { FollowUpEvent, FollowUpEventAction } from "../domain/types";
import { followUpEventLabels } from "../domain/presentation";

export type FollowUpActionHandler = (observationId: string, action: FollowUpEventAction, reason?: string) => void;

function formatInstant(value: string) {
  return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/**
 * Close a task without inventing a visit. Done is one press; cancelling asks why. The
 * closing event can be undone, which appends a REOPENED event rather than erasing one,
 * so the small trail underneath always shows who did what and when.
 */
export function FollowUpActions({ observationId, open, closure, trail, onAct }: {
  observationId: string;
  /** The task is still outstanding and may be closed here. */
  open: boolean;
  /** The app event currently closing this task, if any. */
  closure?: FollowUpEvent;
  trail: FollowUpEvent[];
  onAct: FollowUpActionHandler;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const act = (action: FollowUpEventAction, why?: string) => {
    setError("");
    try { onAct(observationId, action, why); setCancelling(false); setReason(""); }
    catch (reasonError) { setError(reasonError instanceof Error ? reasonError.message : "未能儲存，請再試一次。"); }
  };
  return (
    <div className="cf-followup-actions">
      {open && !cancelling && <div className="cf-followup-actions__row">
        <button type="button" className="cf-button cf-button--secondary cf-button--small" onClick={() => act("DONE")}><Check size={15} />標記完成</button>
        <button type="button" className="cf-button cf-button--ghost cf-button--small" onClick={() => setCancelling(true)}><X size={15} />取消跟進</button>
      </div>}
      {open && cancelling && <form className="cf-followup-actions__cancel" onSubmit={event => { event.preventDefault(); act("CANCELLED", reason); }}>
        <label><span>取消原因（必填）</span><input value={reason} autoFocus required placeholder="例如：已電話聯絡，毋須再訪" onChange={event => setReason(event.target.value)} /></label>
        <div className="cf-followup-actions__row">
          <button className="cf-button cf-button--secondary cf-button--small" disabled={!reason.trim()}>確認取消</button>
          <button type="button" className="cf-button cf-button--ghost cf-button--small" onClick={() => { setCancelling(false); setReason(""); setError(""); }}>返回</button>
        </div>
      </form>}
      {closure && <div className="cf-followup-actions__row">
        <button type="button" className="cf-button cf-button--ghost cf-button--small" onClick={() => act("REOPENED")}><Undo2 size={15} />撤銷{followUpEventLabels[closure.action]}</button>
      </div>}
      {error && <p role="alert" className="cf-error">{error}</p>}
      {trail.length > 0 && <ol className="cf-followup-trail" aria-label="跟進處理記錄">
        {trail.map(event => <li key={event.id}>
          <time dateTime={event.at}>{formatInstant(event.at)}</time> · {event.operator.name} {followUpEventLabels[event.action]}{event.reason ? `：${event.reason}` : ""}
        </li>)}
      </ol>}
    </div>
  );
}
