import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { buildReminders, type ReminderTask, type ReminderViewer } from '../domain/reminders';
import type { OutreachSnapshot } from '../domain/types';
import { readReminderPrefs, reminderPrefsKey, writeReminderPrefs, type ReminderPrefs } from '../data/reminderPrefs';
import { ReminderAnswer } from './ReminderAnswer';

/**
 * The task list, asked for directly. Same answer as the assistant gives to
 * 「今天還有什麼未完成的跟進？», minus the conversation.
 *
 * An employee sees only the tasks assigned to them; the dialog says how many were left
 * out and why rather than showing an empty list (`CLAUDE.md` 3.5, `docs/AI_ASSISTANT.md` 8).
 * The look-ahead is remembered per institution and account on this device only.
 */

const WINDOWS: { days: number | null; label: string }[] = [
  { days: 1, label: '今天' },
  { days: 3, label: '3 天' },
  { days: 7, label: '7 天' },
  { days: 14, label: '14 天' },
  { days: null, label: '全部' },
];

export interface ReminderDialogProps {
  open: boolean;
  onClose: () => void;
  snapshot?: OutreachSnapshot;
  viewer?: ReminderViewer;
  orgId?: string;
  accountId?: string;
  onOpenTask: (task: ReminderTask) => void;
}

export function ReminderDialog({ open, onClose, snapshot, viewer, orgId, accountId, onOpenTask }: ReminderDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const key = reminderPrefsKey(orgId, accountId);
  const [prefs, setPrefs] = useState<ReminderPrefs>(() => readReminderPrefs(key));

  useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }, [open]);
  useEffect(() => { if (open) setPrefs(readReminderPrefs(key)); }, [open, key]);

  const name = viewer?.name;
  const role = viewer?.role;
  const book = useMemo(() => snapshot
    ? buildReminders(snapshot, { viewer: name ? { name, role } : undefined, from: 0, to: prefs.days === null ? null : prefs.days - 1 })
    : undefined, [snapshot, name, role, prefs.days]);

  const choose = (days: number | null) => {
    setPrefs({ days });
    writeReminderPrefs(key, { days });
  };

  if (!open) return null;

  return <dialog aria-labelledby="reminder-title" ref={dialogRef} className="cf-dialog cf-dialog--reminder" onCancel={event => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
    <div className="cf-reminder-dialog">
      <header className="cf-dialog__header"><div><span className="cf-eyebrow">任務提醒</span><h2 id="reminder-title">未完成的跟進</h2></div><button className="cf-icon-button" onClick={onClose} aria-label="關閉"><X /></button></header>
      <div className="cf-reminder-dialog__windows" role="group" aria-label="顯示範圍">
        {WINDOWS.map(window => <button key={String(window.days)} type="button" aria-pressed={prefs.days === window.days} className={prefs.days === window.days ? 'is-active' : ''} onClick={() => choose(window.days)}>{window.label}</button>)}
      </div>
      {book ? <ReminderAnswer book={book} onOpenTask={task => { onOpenTask(task); onClose(); }} /> : <p className="cf-ai__note">尚未載入工作區資料。</p>}
      <footer className="cf-dialog__footer">
        <span>在這部裝置計算；提醒不會把跟進內容或日期送到伺服器或 AI。</span>
        <div><button className="cf-button cf-button--primary" onClick={onClose}>關閉</button></div>
      </footer>
    </div>
  </dialog>;
}
