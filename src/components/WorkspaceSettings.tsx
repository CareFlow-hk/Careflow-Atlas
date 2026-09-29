import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CustomOptions } from "../domain/optionPrefs";
import { OptionManager } from "./OptionManager";

/**
 * Settings for this account's workspace. Everyday use needs none of it, so the one
 * setting there is — self-defined entry options — sits folded under 高級設定.
 */
export function WorkspaceSettings({ open, optionPrefs, onOptionPrefsChange, onClose }: {
  open: boolean;
  optionPrefs: CustomOptions;
  onOptionPrefsChange: (prefs: CustomOptions) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog aria-labelledby="settings-title" ref={dialogRef} className="cf-dialog" onCancel={event => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
      <div className="cf-editor">
        <header className="cf-dialog__header"><div><span className="cf-eyebrow">只影響你的帳號</span><h2 id="settings-title">工作台設定</h2></div><button type="button" className="cf-icon-button" onClick={onClose} aria-label="關閉"><X /></button></header>
        <details className="cf-settings-advanced">
          <summary>高級設定</summary>
          <h3>常用選項</h3>
          <p className="cf-custom-options__note">把經常用到的原話存成選項，之後會出現在「記錄今次結果」的選單。每個自訂選項都要歸入一個內置類別，顏色只按類別計算。</p>
          <OptionManager prefs={optionPrefs} onChange={onOptionPrefsChange} />
        </details>
      </div>
    </dialog>
  );
}
