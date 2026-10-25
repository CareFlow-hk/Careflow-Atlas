/**
 * How far ahead the reminder looks is a personal preference, not business data, so it
 * stays on this device and never enters the institution workspace (`docs/AI_ASSISTANT.md` 8).
 *
 * The key carries the institution and the account: colleagues sharing one phone keep
 * their own view, and signing in to another institution never inherits the last one's
 * preference (`CLAUDE.md` 3.5, the same rule the workspace key follows).
 * A read that fails falls back to the default instead of blocking the dialog.
 */
export interface ReminderPrefs {
  /** Days counted from today; `null` means every open task. */
  days: number | null;
}

export const DEFAULT_REMINDER_DAYS = 3;

/** The windows the dialog offers. A stored value outside this list is not a choice anyone made. */
export const REMINDER_WINDOWS = [1, 3, 7, 14] as const;

export function reminderPrefsKey(orgId?: string, accountId?: string): string {
  return orgId && accountId ? `careflow-atlas.org.${orgId}.${accountId}.reminders` : 'careflow-atlas.device.reminders';
}

/**
 * Only the windows the dialog offers, or "everything". A hand-edited 5 would compute five
 * days while leaving every window button unselected, so it is read as the default instead
 * (`docs/AI_ASSISTANT.md` 8).
 */
export function parseReminderPrefs(value: unknown): ReminderPrefs {
  const days = (value as { days?: unknown } | null)?.days;
  if (days === null) return { days: null };
  if (typeof days === 'number' && (REMINDER_WINDOWS as readonly number[]).includes(days)) return { days };
  return { days: DEFAULT_REMINDER_DAYS };
}

export function readReminderPrefs(key: string, storage: Pick<Storage, 'getItem'> = localStorage): ReminderPrefs {
  try {
    const raw = storage.getItem(key);
    return raw ? parseReminderPrefs(JSON.parse(raw)) : parseReminderPrefs(null);
  } catch { return parseReminderPrefs(null); }
}

export function writeReminderPrefs(key: string, prefs: ReminderPrefs, storage: Pick<Storage, 'setItem'> = localStorage): void {
  // A preference nobody can save is not worth an error banner.
  try { storage.setItem(key, JSON.stringify(parseReminderPrefs(prefs))); } catch { /* storage full or blocked */ }
}
