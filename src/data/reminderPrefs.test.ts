import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_DAYS, parseReminderPrefs, readReminderPrefs, reminderPrefsKey, REMINDER_WINDOWS, writeReminderPrefs } from './reminderPrefs';

/*
 * The reminder window is a personal view preference and nothing else: it lives on this
 * device under a key that carries the institution and the account, it holds only the
 * window size, and a value nobody can have chosen falls back to the default instead of
 * computing a range the dialog has no button for (`docs/AI_ASSISTANT.md` 8).
 *
 * Everything here is a made-up id; no credential, key or account detail is involved.
 */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe('which preference belongs to whom', () => {
  it('keeps one key per institution and account', () => {
    expect(reminderPrefsKey('org-a', 'acct-1')).toBe('careflow-atlas.org.org-a.acct-1.reminders');
    expect(reminderPrefsKey('org-a', 'acct-1')).not.toBe(reminderPrefsKey('org-b', 'acct-1'));
    expect(reminderPrefsKey('org-a', 'acct-1')).not.toBe(reminderPrefsKey('org-a', 'acct-2'));
  });

  it('uses a device key only when there is no signed-in account', () => {
    expect(reminderPrefsKey()).toBe('careflow-atlas.device.reminders');
    expect(reminderPrefsKey('org-a')).toBe('careflow-atlas.device.reminders');
    expect(reminderPrefsKey(undefined, 'acct-1')).toBe('careflow-atlas.device.reminders');
  });
});

describe('which windows are a real choice', () => {
  it('accepts exactly the windows the dialog offers, plus everything', () => {
    for (const days of REMINDER_WINDOWS) expect(parseReminderPrefs({ days })).toEqual({ days });
    expect(parseReminderPrefs({ days: null })).toEqual({ days: null });
  });

  it('falls back to the default for a value nobody could have picked', () => {
    // 5 would compute five days while leaving every window button unselected.
    for (const days of [0, 2, 5, 30, 365, -1, 3.5, Number.NaN, '3', true]) {
      expect(parseReminderPrefs({ days })).toEqual({ days: DEFAULT_REMINDER_DAYS });
    }
    expect(parseReminderPrefs(null)).toEqual({ days: DEFAULT_REMINDER_DAYS });
    expect(parseReminderPrefs('not a preference')).toEqual({ days: DEFAULT_REMINDER_DAYS });
  });
});

describe('reading and writing the preference', () => {
  it('round-trips a chosen window', () => {
    const storage = memoryStorage();
    writeReminderPrefs('k', { days: 7 }, storage);
    expect(readReminderPrefs('k', storage)).toEqual({ days: 7 });
    expect(storage.map.get('k')).toBe('{"days":7}');
  });

  it('stores only the window, never who chose it', () => {
    const storage = memoryStorage();
    writeReminderPrefs('k', { days: null }, storage);
    expect(Object.keys(JSON.parse(storage.map.get('k')!))).toEqual(['days']);
  });

  it('normalises an impossible value before it is written', () => {
    const storage = memoryStorage();
    writeReminderPrefs('k', { days: 5 }, storage);
    expect(storage.map.get('k')).toBe(`{"days":${DEFAULT_REMINDER_DAYS}}`);
  });

  it('answers with the default when the stored text is missing or broken', () => {
    expect(readReminderPrefs('missing', memoryStorage())).toEqual({ days: DEFAULT_REMINDER_DAYS });
    expect(readReminderPrefs('broken', memoryStorage({ broken: '{not json' }))).toEqual({ days: DEFAULT_REMINDER_DAYS });
  });

  it('does not block the dialog when storage refuses', () => {
    const refused = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readReminderPrefs('k', refused)).toEqual({ days: DEFAULT_REMINDER_DAYS });
    expect(() => writeReminderPrefs('k', { days: 3 }, refused)).not.toThrow();
  });
});
