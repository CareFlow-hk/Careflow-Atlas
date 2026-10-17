import { useEffect, useState } from "react";
import { ClipboardPlus, CircleHelp, Trash2, X } from "lucide-react";
import { pickerKeyAction } from "./unitSelection";

/**
 * The footer while several units are selected at once: what is selected, the two things a
 * selection is for, and the help that says how the selection is made.
 *
 * The help stays in the document with `hidden` rather than being left out, so it is in the
 * accessibility tree in the right place and a reader can still find it when it is shut.
 */
export interface UnitPickerBarProps {
  /** How many units the selection holds. Never zero: without a selection there is no bar. */
  count: number;
  /** How many records a delete would take with it, across the whole selection. */
  recordCount: number;
  onClear: () => void;
  onRecord: () => void;
  /** Absent where structure editing is off: recording a set does not depend on it, deleting does. */
  onDelete?: () => void;
}

export function UnitPickerBar({ count, recordCount, onClear, onDelete, onRecord }: UnitPickerBarProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  /*
   * Esc clears the picked set while there is one. It is a key people also press to get out
   * of things, so it does not fire while a field has the cursor or a dialog is open — there,
   * Esc belongs to the dialog.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const clear = pickerKeyAction(event.key, {
        inField: Boolean((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']")),
        dialogOpen: Boolean(document.querySelector("dialog[open]")),
      });
      if (!clear) return;
      event.preventDefault();
      onClear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClear]);
  return (
    <div className="cf-pick" role="group" aria-label={`已選 ${count} 個單位`}>
      <p className="cf-pick__head">
        <strong>已選 {count} 個單位</strong>
        <button type="button" className="cf-pick__help" aria-label="多選操作說明" aria-expanded={helpOpen} aria-controls="cf-pick-help" onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={14} /></button>
        <button type="button" className="cf-pick__clear" onClick={onClear}><X size={13} />清除選取</button>
      </p>
      <p className="cf-pick__more" id="cf-pick-help" hidden={!helpOpen}>
        按住 Ctrl／Command 點色塊，可以逐個加入或移出選取；直接點色塊就還原成只選一個。按 Esc 清除選取。
        劏房房間要逐格點；已經分拆的單位不能確認無劏房，會被略過。
      </p>
      <div className="cf-pick__acts">
        <button type="button" className="cf-button cf-button--primary" onClick={onRecord}><ClipboardPlus size={17} />記錄 {count} 個單位</button>
        {onDelete && <button type="button" className="cf-button cf-button--ghost is-danger" onClick={onDelete}><Trash2 size={15} />刪除選取的 {count} 個單位{recordCount ? `（連 ${recordCount} 筆記錄）` : ""}</button>}
      </div>
    </div>
  );
}
