import { describe, expect, it } from 'vitest';
import { buildReminders, hkDay } from './reminders';
import type { Observation, OutreachSnapshot } from './types';

/*
 * The reminder answers two questions without sending anything anywhere: what is still
 * open and when it is due, and — for an employee — only their own tasks. A task with no
 * due date is 未排期; 「下星期」 in the original words is quoted, never turned into a date.
 */
const flags = { isSynthetic: true as const, provisional: true as const };
const NOW = new Date('2026-10-24T04:00:00Z'); // 12:00 in Hong Kong, still 24 October

function scene(observations: Observation[]): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '合成大廈', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1樓' }],
    units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: '1樓 A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [],
    visits: [{ ...flags, id: 'v1', occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z', workerName: '合成工作員' }],
    observations,
  };
}

const open = (id: string, followUp: NonNullable<Observation['followUp']>, extra: Partial<Observation> = {}): Observation => ({
  ...flags, id, visitId: 'v1', buildingId: 'b1', floorId: 'f1', unitId: 'u1',
  occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z',
  workerName: '合成工作員', coverage: 'VISITED_WITH_FINDING', evidence: [], followUp, ...extra,
});

const all = () => scene([
  open('o-overdue', { action: '再訪', status: 'OPEN', dueDate: '2026-10-22', assignee: '陳大文' }),
  open('o-today', { action: '打電話', status: 'OPEN', dueDate: '2026-10-24', assignee: '陳大文' }),
  open('o-soon', { action: '約見', status: 'OPEN', dueDate: '2026-10-26', assignee: '李小明' }),
  open('o-later', { action: '搬遷後再訪', status: 'OPEN', dueDate: '2026-11-10', assignee: '陳大文' }),
  open('o-undated', { action: '等住戶回覆', status: 'OPEN', timingNote: '下星期再問', assignee: '陳大文' }),
]);

describe('what is still open and when', () => {
  it('reads today in Hong Kong time, not the device time zone', () => {
    expect(hkDay(NOW)).toBe('2026-10-24');
    expect(hkDay('2026-10-24T17:00:00Z')).toBe('2026-10-25');
  });

  it('sorts every task into overdue, today, soon, later or unscheduled', () => {
    const book = buildReminders(all(), { now: NOW, from: 0, to: null });
    expect(book.tasks.map(task => [task.observationId, task.bucket])).toEqual([
      ['o-overdue', 'OVERDUE'], ['o-today', 'TODAY'], ['o-soon', 'UPCOMING'],
      ['o-later', 'LATER'], ['o-undated', 'UNSCHEDULED'],
    ]);
    expect(book.counts).toEqual({ OVERDUE: 1, TODAY: 1, UPCOMING: 1, LATER: 1, UNSCHEDULED: 1 });
  });

  it('shows the place and the original words, never a date invented from them', () => {
    const undated = buildReminders(all(), { now: NOW }).tasks.find(task => task.observationId === 'o-undated')!;
    expect(undated.dueDate).toBeUndefined();
    expect(undated.timingNote).toBe('下星期再問');
    expect(undated.place).toBe('1樓 A室');
    expect(undated.bucket).toBe('UNSCHEDULED');
  });

  it('answers 「今天」 with today, the overdue work and the undated work, but not later dates', () => {
    const book = buildReminders(all(), { now: NOW, from: 0, to: 0 });
    expect(book.tasks.map(task => task.observationId)).toEqual(['o-overdue', 'o-today', 'o-undated']);
  });

  it('answers 「明天」 without pulling in today, overdue or undated work', () => {
    const book = buildReminders(all(), { now: NOW, from: 1, to: 1 });
    expect(book.tasks).toHaveLength(0);
    const withTomorrow = scene([...all().observations, open('o-tomorrow', { action: '上門', status: 'OPEN', dueDate: '2026-10-25' })]);
    expect(buildReminders(withTomorrow, { now: NOW, from: 1, to: 1 }).tasks.map(task => task.observationId)).toEqual(['o-tomorrow']);
  });

  it('leaves out a task that was withdrawn, and one a later record resolved', () => {
    const withdrawn = scene([
      open('o-gone', { action: '再訪', status: 'OPEN', dueDate: '2026-10-24' }, { deleted: { at: '2026-10-23T02:00:00.000Z', by: { accountId: 'acct-1', name: '合成操作員' } } }),
      open('o-done', { action: '再訪', status: 'OPEN', dueDate: '2026-10-24' }),
      open('o-resolved', { action: '再訪', status: 'DONE' }, { resolvesObservationId: 'o-done' }),
      open('o-open', { action: '再訪', status: 'OPEN', dueDate: '2026-10-24' }),
    ]);
    const book = buildReminders(withdrawn, { now: NOW, from: 0, to: 0 });
    // Withdrawn, and the task the later record resolved: neither is still to do.
    expect(book.tasks.map(task => task.observationId)).toEqual(['o-open']);
  });
});

describe('an employee sees only their own tasks', () => {
  const member = { name: '陳大文', role: 'MEMBER' as const };

  it('lists the tasks assigned to them by exact name', () => {
    const book = buildReminders(all(), { now: NOW, viewer: member, from: 0, to: null });
    expect(book.ownOnly).toBe(true);
    expect(book.tasks.map(task => task.observationId)).toEqual(['o-overdue', 'o-today', 'o-later', 'o-undated']);
    expect(book.mine).toBe(4);
  });

  it('says how many belong to someone else or to nobody instead of hiding them silently', () => {
    const book = buildReminders(all(), { now: NOW, viewer: member, from: 0, to: null });
    expect(book.hidden).toEqual({ others: 1, unassigned: 0 });
    const unassigned = scene([...all().observations, open('o-nobody', { action: '待分派', status: 'OPEN', dueDate: '2026-10-24' })]);
    expect(buildReminders(unassigned, { now: NOW, viewer: member, from: 0, to: null }).hidden).toEqual({ others: 1, unassigned: 1 });
  });

  it('does not treat a similar name or a title as the same person', () => {
    const lookalike = scene([open('o-other', { action: '再訪', status: 'OPEN', dueDate: '2026-10-24', assignee: '陳大文（兼職）' })]);
    expect(buildReminders(lookalike, { now: NOW, viewer: member, from: 0, to: null }).tasks).toHaveLength(0);
  });

  it('gives an administrator every open task', () => {
    const book = buildReminders(all(), { now: NOW, viewer: { name: '管理員', role: 'ADMIN' }, from: 0, to: null });
    expect(book.ownOnly).toBe(false);
    expect(book.tasks).toHaveLength(5);
    expect(book.hidden).toEqual({ others: 0, unassigned: 0 });
  });
});
