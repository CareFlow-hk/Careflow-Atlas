import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { SyncChoice, SyncConflict } from '../data/syncMerge';

/**
 * The account端 and this browser changed the same record. Neither copy is thrown away and
 * neither is written until a person picks one per record; the dialog is the only place a
 * merge can be decided, so it is deliberately not dismissible-with-a-default.
 */
export function SyncConflictDialog({ conflicts, onResolve, onDefer }: {
  conflicts: SyncConflict[];
  onResolve: (choices: Readonly<Record<string, SyncChoice>>) => void;
  onDefer: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [choices, setChoices] = useState<Record<string, SyncChoice>>({});
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // A conflict that appeared since the last render starts on the account端 copy: that is
    // the version other devices already see, and the one that never overwrites anyone.
    setChoices(previous => Object.fromEntries(conflicts.map(item => [item.key, previous[item.key] ?? 'remote'])));
  }, [conflicts]);
  const all = (choice: SyncChoice) => setChoices(Object.fromEntries(conflicts.map(item => [item.key, choice])));
  return <dialog ref={dialogRef} className="cf-dialog" aria-labelledby="sync-conflict-title" onCancel={event => { event.preventDefault(); onDefer(); }}>
    <div className="cf-import">
      <header className="cf-dialog__header">
        <div><span className="cf-eyebrow">帳號同步</span><h2 id="sync-conflict-title">同一筆記錄，兩邊都改過</h2></div>
        <button className="cf-icon-button" type="button" onClick={onDefer} aria-label="稍後處理"><X /></button>
      </header>
      <p className="cf-callout">本機與帳號端都改過以下記錄，未有自動決定。揀好之前不會寫上帳號端；本機的版本仍然留在這部電腦。</p>
      <div className="sync-conflict">
        {conflicts.map(item => <div key={item.key} className="sync-conflict__row">
          <strong>{item.label}</strong>
          <p>{item.localDeleted ? '本機已刪除這筆' : '本機版本'} · {item.remoteDeleted ? '帳號端已刪除' : '帳號端版本'}</p>
          <div className="sync-conflict__choice" role="group" aria-label={item.label}>
            <button type="button" aria-pressed={choices[item.key] === 'local'} onClick={() => setChoices(current => ({ ...current, [item.key]: 'local' }))}>{item.localDeleted ? '本機（刪除）' : '保留本機'}</button>
            <button type="button" aria-pressed={choices[item.key] === 'remote'} onClick={() => setChoices(current => ({ ...current, [item.key]: 'remote' }))}>{item.remoteDeleted ? '帳號端（刪除）' : '保留帳號端'}</button>
          </div>
        </div>)}
      </div>
      <footer className="cf-dialog__footer">
        <span>預設保留帳號端版本；之後仍可匯出 Excel 核對。</span>
        <div>
          <button className="cf-button cf-button--ghost" type="button" onClick={() => all('local')}>全部保留本機</button>
          <button className="cf-button cf-button--ghost" type="button" onClick={() => all('remote')}>全部保留帳號端</button>
          <button className="cf-button cf-button--secondary" type="button" onClick={onDefer}>稍後處理</button>
          <button className="cf-button cf-button--primary" type="button" onClick={() => onResolve(choices)}>套用選擇</button>
        </div>
      </footer>
    </div>
  </dialog>;
}
