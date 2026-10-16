import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteGate, type BackupAttempt } from "../domain/structure";

export interface DeleteConfirmProps {
  /** What is about to go, in staff wording, with the number of records it takes with it. */
  question: string;
  /**
   * Hands the current workbook to the browser and answers whether it was actually taken.
   * The answer is the gate: a refusal, a thrown error or silence all leave the delete shut.
   */
  onBackup?: () => Promise<boolean>;
  onConfirm: () => void;
  onCancel: () => void;
}

/*
 * The last thing between staff and records that will not come back. It names what goes and
 * how much of it, offers the copy that makes the loss recoverable, and keeps 刪除 shut until
 * that copy has really been handed over — the rule and its wording live in `deleteGate`,
 * with the other statements about structure changes.
 */
export function DeleteConfirm({ question, onBackup, onConfirm, onCancel }: DeleteConfirmProps) {
  const [attempt, setAttempt] = useState<BackupAttempt>('IDLE');
  const gate = deleteGate(attempt);
  const takeBackup = async () => {
    if (!onBackup) return;
    setAttempt('WORKING');
    let taken = false;
    try { taken = await onBackup(); } catch { taken = false; }
    setAttempt(taken ? 'DONE' : 'FAILED');
  };
  return <div className="cf-structure__confirm" role="alertdialog" aria-label="確認刪除">
    <Trash2 size={15} />
    <p>{question}</p>
    <div className="cf-structure__acts">
      {onBackup && <button type="button" onClick={takeBackup} disabled={attempt === 'WORKING'}>下載當前 Excel 備份</button>}
      <button type="button" className="is-danger" disabled={!gate.allowed} onClick={onConfirm}>確認刪除</button>
      <button type="button" onClick={onCancel}>取消</button>
    </div>
    {/* Not decoration: it says why 刪除 is unavailable, and it is the only place that says so. */}
    <p className={`cf-structure__gate${gate.allowed ? " is-ready" : ""}`} role={attempt === 'FAILED' ? 'alert' : undefined}>{gate.note}</p>
  </div>;
}
