import { describe, expect, it } from 'vitest';
import type { Observation, OutreachSnapshot } from '../domain/types';
import {
  assigneesNamedIn, isReminderQuestion, looksLikeTaskFollowUp, readReminderIntent, readReminderQuestion,
  readReminderScope, reminderAnswer, reminderBook, shouldAnswerReminder,
} from './reminderQuery';

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

  it('recognises a request for an order of work', () => {
    expect(isReminderQuestion('給點行動建議')).toBe(true);
    expect(isReminderQuestion('這兩天有哪些待跟進任務？')).toBe(true);
    expect(isReminderQuestion('今天先做什麼？')).toBe(true);
    expect(isReminderQuestion('幫我寫一首關於大廈的詩')).toBe(false);
    expect(isReminderQuestion('明天去裕安樓探訪')).toBe(false);
  });
});

describe('how the answer is arranged', () => {
  it('reads a plan request as advice and a list question as a list', () => {
    expect(readReminderIntent('給點行動建議')).toBe('advice');
    expect(readReminderIntent('誰要做什麼？')).toBe('advice');
    expect(readReminderIntent('今天先做什麼？')).toBe('advice');
    expect(readReminderIntent('今天還有什麼未完成的跟進？')).toBe('list');
    expect(readReminderIntent('這兩天有哪些待跟進任務？')).toBe('list');
  });
});

describe('which days the question is about', () => {
  const today = '2026-10-24'; // a Saturday
  // Stating the days and accepting the default are different things: 「陳大文要做什麼？」
  // never said 今天, so the answer may widen (see the narrowing tests below).
  const stated = (from: number, to: number | null, label: string) => ({ from, to, label, stated: true, everything: false });
  const defaulted = { from: 0, to: 0, label: '今天', stated: false, everything: false };

  it('defaults to today without claiming the question said so', () => {
    expect(readReminderQuestion('今天還有什麼未完成的跟進嗎？', today)).toEqual(stated(0, 0, '今天'));
    expect(readReminderQuestion('有沒有未完成的跟進？', today)).toEqual(defaulted);
  });

  it('reads tomorrow and the day after as single days', () => {
    expect(readReminderQuestion('明天要跟進什麼？', today)).toEqual(stated(1, 1, '明天'));
    expect(readReminderQuestion('後天有什麼任務？', today)).toEqual(stated(2, 2, '後天'));
  });

  it('reads 這兩天 as today and tomorrow', () => {
    expect(readReminderQuestion('這兩天有哪些待跟進任務？', today)).toEqual(stated(0, 1, '這兩天'));
  });

  it('reads a number of days as today onwards', () => {
    expect(readReminderQuestion('未來 7 天有什麼跟進？', today)).toEqual(stated(0, 6, '未來 7 天'));
    expect(readReminderQuestion('未來 2 星期的跟進', today)).toEqual(stated(0, 13, '未來 14 天'));
  });

  it('reads 本週 as up to Sunday, without counting the next week', () => {
    expect(readReminderQuestion('本週有哪些跟進？', today)).toEqual(stated(0, 1, '這個星期（還有 2 天）'));
    expect(readReminderQuestion('本週有哪些跟進？', '2026-10-20')).toEqual(stated(0, 5, '這個星期（還有 6 天）'));
    // Sunday is the last day of the week, so nothing is left after it.
    expect(readReminderQuestion('本週有哪些跟進？', '2026-10-25')).toEqual(stated(0, 0, '今天（這個星期最後一天）'));
  });

  it('reads 「全部」 as no upper bound, and as a question about everything', () => {
    expect(readReminderQuestion('所有未完成的跟進', today)).toEqual({ from: 0, to: null, label: '所有未完成的跟進', stated: true, everything: true });
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

  it('answers a named person with all of their open work, not only today', () => {
    // 「陳大文要做什麼？」 names the person, not a day. Reading it as today hid the
    // 10-30 task without the question ever saying 今天 (2026-10-25).
    const { book } = reminderAnswer(snapshot, '陳大文要做什麼？', { now: NOW });
    expect(book.tasks.map(task => task.observationId).sort()).toEqual(['o-later', 'o-today']);
  });

  it('answers a named building with all of its open work, not only today', () => {
    const { book } = reminderAnswer(snapshot, '合成大廈有什麼跟進？', { now: NOW });
    expect(book.buildingName).toBe('合成大廈');
    expect(book.tasks.map(task => task.observationId).sort()).toEqual(['o-later', 'o-nobody', 'o-today']);
  });

  it('still keeps the day the question does name', () => {
    const { book } = reminderAnswer(snapshot, '陳大文今天要做什麼？', { now: NOW });
    expect(book.tasks.map(task => task.observationId)).toEqual(['o-today']);
  });

  it('gives an order of work from the whole backlog, so the later steps can exist', () => {
    const { advice } = reminderAnswer(snapshot, '給我行動建議', { now: NOW });
    expect(advice?.owners.map(owner => ({
      who: owner.assignee,
      steps: owner.steps.map(step => [step.label, step.tasks.map(task => task.observationId)]),
    }))).toEqual([{
      who: '陳大文',
      steps: [
        ['今天先做（已逾期或今天到期）', ['o-today']],
        ['之後（按到期日排）', ['o-later']],
      ],
    }]);
    // Nobody is handed work the record never assigned, however the list is read.
    expect(advice?.unassigned.map(task => task.observationId)).toEqual(['o-nobody']);
  });

  it('lets 「所有」 drop the narrowing kept from the question before', () => {
    const next = reminderAnswer(snapshot, '所有未完成的跟進', { now: NOW, keep: { assignee: '陳大文' } });
    expect(next.book.assignee).toBeUndefined();
    expect(next.book.tasks.map(task => task.observationId).sort()).toEqual(['o-later', 'o-nobody', 'o-today']);
  });

  it('narrows the same question to an employee’s own tasks', () => {
    const book = reminderBook(snapshot, '所有未完成的跟進', { name: '陳大文', role: 'MEMBER' }, NOW);
    expect(book.ownOnly).toBe(true);
    expect(book.tasks.map(task => task.observationId).sort()).toEqual(['o-later', 'o-today']);
    expect(book.hidden).toEqual({ others: 0, unassigned: 1 });
  });
});

describe('a question that names a person or a building', () => {
  const flags = { isSynthetic: true as const, provisional: true as const };
  const NOW = new Date('2026-10-24T04:00:00Z');
  const open = (id: string, assignee: string | undefined, extra: NonNullable<Observation['followUp']>, buildingId = 'b1'): Observation => ({
    ...flags, id, visitId: 'v1', buildingId, floorId: 'f1', unitId: 'u1',
    occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z',
    workerName: '合成工作員', coverage: 'VISITED_WITH_FINDING', evidence: [], followUp: { ...extra, ...(assignee ? { assignee } : {}) },
  });
  const snapshot: OutreachSnapshot = {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [
      { ...flags, id: 'b1', name: '裕安樓', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true },
      { ...flags, id: 'b2', name: '裕安樓二期', address: '合成地址二', coordinates: { lng: 114.15, lat: 22.29 }, layoutDeclared: true },
    ],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1樓' }],
    units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: '1樓 A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [],
    visits: [{ ...flags, id: 'v1', occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z', workerName: '合成工作員' }],
    observations: [
      open('o-chen', '陳大文', { action: '再訪', status: 'OPEN', dueDate: '2026-10-24' }),
      open('o-chen-part', '陳大文（兼職）', { action: '約見', status: 'OPEN', dueDate: '2026-10-24' }),
      open('o-lee', '李小明', { action: '打電話', status: 'OPEN', dueDate: '2026-10-24' }, 'b2'),
    ],
  };

  it('reads only an exact name, never the lookalike it sits inside', () => {
    expect(assigneesNamedIn(snapshot, '陳大文要做什麼？')).toEqual(['陳大文']);
    expect(assigneesNamedIn(snapshot, '陳大文（兼職）要做什麼？')).toEqual(['陳大文（兼職）']);
    expect(assigneesNamedIn(snapshot, '陳大同要做什麼？')).toEqual([]);
  });

  it('narrows the list to the person the question named', () => {
    const { book } = reminderAnswer(snapshot, '陳大文要做什麼？', { now: NOW });
    expect(book.assignee).toBe('陳大文');
    expect(book.tasks.map(task => task.observationId)).toEqual(['o-chen']);
  });

  it('narrows the list to the building the question named, not its neighbour whose name contains it', () => {
    const { book } = reminderAnswer(snapshot, '裕安樓有什麼跟進？', { now: NOW });
    expect(book.buildingName).toBe('裕安樓');
    expect(book.tasks.map(task => task.observationId)).toEqual(['o-chen', 'o-chen-part']);
  });

  it('refuses to pick when the sentence names two things', () => {
    const scope = readReminderScope(snapshot, '陳大文和李小明要做什麼？', '2026-10-24');
    expect(scope.assignee).toBeUndefined();
    expect(scope.ambiguous).toEqual(['陳大文', '李小明']);
  });

  it('keeps the narrowing when the next question names nobody new', () => {
    const first = reminderAnswer(snapshot, '陳大文要做什麼？', { now: NOW });
    const next = reminderAnswer(snapshot, '明天呢？', { now: NOW, keep: { assignee: first.book.assignee } });
    expect(next.book.assignee).toBe('陳大文');
  });

  it('lets a question that names someone else replace the narrowing', () => {
    const next = reminderAnswer(snapshot, '李小明要做什麼？', { now: NOW, keep: { assignee: '陳大文' } });
    expect(next.book.assignee).toBe('李小明');
    expect(next.book.tasks.map(task => task.observationId)).toEqual(['o-lee']);
  });

  it('reads a follow-up on the task screen as a task question', () => {
    expect(looksLikeTaskFollowUp(snapshot, '明天呢？')).toBe(true);
    expect(looksLikeTaskFollowUp(snapshot, '陳大文')).toBe(true);
    expect(looksLikeTaskFollowUp(snapshot, '裕安樓有什麼？')).toBe(true);
    expect(looksLikeTaskFollowUp(snapshot, '10月9日拍門無人應門')).toBe(false);
  });
});
