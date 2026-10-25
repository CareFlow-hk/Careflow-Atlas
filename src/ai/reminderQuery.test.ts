import { describe, expect, it } from 'vitest';
import type { Observation, OutreachSnapshot } from '../domain/types';
import { isReminderQuestion, readReminderQuestion, reminderBook, shouldAnswerReminder } from './reminderQuery';

/*
 * Only an actual question is answered from the workspace. A visit note that mentions
 * 跟進 must still be read as a note, or the person's words would be swallowed by a list
 * they did not ask for.
 */
describe('which messages are task questions', () => {
  it('recognises the question people actually type', () => {
    expect(isReminderQuestion('今天還有什麼未完成的跟進任務嗎？')).toBe(true);
    expect(isReminderQuestion('有什么跟进要做')).toBe(true);
    expect(isReminderQuestion('有哪些任務未完成？')).toBe(true);
    expect(isReminderQuestion('待跟進的清單')).toBe(true);
  });

  it('leaves a visit note alone', () => {
    expect(isReminderQuestion('10月9日，3樓 A 室拍門無人應門，下星期再跟進。')).toBe(false);
    expect(isReminderQuestion('下週再跟進，什麼都未談好？')).toBe(false);
    expect(isReminderQuestion('今天拍門無人應門')).toBe(false);
  });
});

describe('which days the question is about', () => {
  const today = '2026-10-24'; // a Saturday

  it('defaults to today', () => {
    expect(readReminderQuestion('今天還有什麼未完成的跟進嗎？', today)).toEqual({ from: 0, to: 0, label: '今天' });
    expect(readReminderQuestion('有沒有未完成的跟進？', today)).toEqual({ from: 0, to: 0, label: '今天' });
  });

  it('reads tomorrow and the day after as single days', () => {
    expect(readReminderQuestion('明天要跟進什麼？', today)).toEqual({ from: 1, to: 1, label: '明天' });
    expect(readReminderQuestion('後天有什麼任務？', today)).toEqual({ from: 2, to: 2, label: '後天' });
  });

  it('reads a number of days as today onwards', () => {
    expect(readReminderQuestion('未來 7 天有什麼跟進？', today)).toEqual({ from: 0, to: 6, label: '未來 7 天' });
    expect(readReminderQuestion('未來 2 星期的跟進', today)).toEqual({ from: 0, to: 13, label: '未來 14 天' });
  });

  it('reads 本週 as up to Sunday, without counting the next week', () => {
    expect(readReminderQuestion('本週有哪些跟進？', today)).toEqual({ from: 0, to: 1, label: '這個星期（還有 2 天）' });
    expect(readReminderQuestion('本週有哪些跟進？', '2026-10-20')).toEqual({ from: 0, to: 5, label: '這個星期（還有 6 天）' });
    // Sunday is the last day of the week, so nothing is left after it.
    expect(readReminderQuestion('本週有哪些跟進？', '2026-10-25')).toEqual({ from: 0, to: 0, label: '今天（這個星期最後一天）' });
  });

  it('reads 「全部」 as no upper bound', () => {
    expect(readReminderQuestion('所有未完成的跟進', today)).toEqual({ from: 0, to: null, label: '所有未完成的跟進' });
  });
});

describe('which messages the dialog answers from the workspace', () => {
  it('answers a task question when no file came with it', () => {
    expect(shouldAnswerReminder('今天還有什麼未完成的跟進？')).toBe(true);
    expect(shouldAnswerReminder('今天還有什麼未完成的跟進？', { hasFile: false, asReminder: true })).toBe(true);
  });

  it('keeps a sheet on the sheet route, even when the note beside it reads like a question', () => {
    // 「在裕安樓增加以下記錄，還有什麼未完成？」 is that sheet's heading: answering it as a
    // task list would drop the rows the person actually brought.
    expect(shouldAnswerReminder('今天的跟進有什麼？', { hasFile: true })).toBe(false);
  });

  it('lets the person overrule the reading with 「這不是提醒」', () => {
    expect(shouldAnswerReminder('今天還有什麼未完成的跟進？', { asReminder: false })).toBe(false);
  });

  it('leaves a visit note on the ordinary draft route', () => {
    expect(shouldAnswerReminder('10月9日，3樓 A 室拍門無人應門，下星期再跟進。')).toBe(false);
  });
});

describe('the list a question gets', () => {
  const flags = { isSynthetic: true as const, provisional: true as const };
  const NOW = new Date('2026-10-24T04:00:00Z'); // 12:00 in Hong Kong, still 24 October
  const open = (id: string, followUp: NonNullable<Observation['followUp']>): Observation => ({
    ...flags, id, visitId: 'v1', buildingId: 'b1', floorId: 'f1', unitId: 'u1',
    occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z',
    workerName: '合成工作員', coverage: 'VISITED_WITH_FINDING', evidence: [], followUp,
  });
  const snapshot: OutreachSnapshot = {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '合成大廈', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1樓' }],
    units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: '1樓 A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [],
    visits: [{ ...flags, id: 'v1', occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z', workerName: '合成工作員' }],
    observations: [
      open('o-today', { action: '再訪', status: 'OPEN', dueDate: '2026-10-24', assignee: '陳大文' }),
      open('o-later', { action: '約見', status: 'OPEN', dueDate: '2026-10-30', assignee: '陳大文' }),
      open('o-nobody', { action: '待分派', status: 'OPEN', dueDate: '2026-10-24' }),
    ],
  };

  it('reads 「今天」 exactly as the reminder dialog does', () => {
    const book = reminderBook(snapshot, '今天還有什麼未完成的跟進？', undefined, NOW);
    expect(book.tasks.map(task => task.observationId).sort()).toEqual(['o-nobody', 'o-today']);
  });

  it('reads 「所有」 as every open task', () => {
    const book = reminderBook(snapshot, '所有未完成的跟進', undefined, NOW);
    expect(book.tasks.map(task => task.observationId).sort()).toEqual(['o-later', 'o-nobody', 'o-today']);
  });

  it('narrows the same question to an employee’s own tasks', () => {
    const book = reminderBook(snapshot, '所有未完成的跟進', { name: '陳大文', role: 'MEMBER' }, NOW);
    expect(book.ownOnly).toBe(true);
    expect(book.tasks.map(task => task.observationId).sort()).toEqual(['o-later', 'o-today']);
    expect(book.hidden).toEqual({ others: 0, unassigned: 1 });
  });
});
