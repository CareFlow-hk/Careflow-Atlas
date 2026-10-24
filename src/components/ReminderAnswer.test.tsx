import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildReminders } from '../domain/reminders';
import type { Observation, OutreachSnapshot } from '../domain/types';
import { ReminderAnswer } from './ReminderAnswer';

/*
 * What the person reads: the date each task carries, the original words when there is no
 * date, and — for an employee — a count of the tasks that were left out rather than a
 * list that pretends nobody else has any.
 */
const flags = { isSynthetic: true as const, provisional: true as const };
const NOW = new Date('2026-10-24T04:00:00Z');
const open = (id: string, followUp: NonNullable<Observation['followUp']>, assignee?: string): Observation => ({
  ...flags, id, visitId: 'v1', buildingId: 'b1', floorId: 'f1', unitId: 'u1',
  occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z',
  workerName: '合成工作員', coverage: 'VISITED_WITH_FINDING', evidence: [], followUp: { ...followUp, ...(assignee ? { assignee } : {}) },
});
const snapshot: OutreachSnapshot = {
  schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
  buildings: [{ ...flags, id: 'b1', name: '合成大廈', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true }],
  floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1樓' }],
  units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: '1樓 A室' }],
  households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [],
  visits: [{ ...flags, id: 'v1', occurredAt: '2026-10-20T02:00:00.000Z', recordedAt: '2026-10-20T02:00:00.000Z', workerName: '合成工作員' }],
  observations: [
    open('o-late', { action: '再訪', status: 'OPEN', dueDate: '2026-10-22' }, '陳大文'),
    open('o-undated', { action: '等住戶回覆', status: 'OPEN', timingNote: '下星期再問' }, '陳大文'),
    open('o-other', { action: '約見', status: 'OPEN', dueDate: '2026-10-24' }, '李小明'),
    open('o-nobody', { action: '待分派', status: 'OPEN', dueDate: '2026-10-24' }),
  ],
};

describe('the reminder answer', () => {
  const member = buildReminders(snapshot, { now: NOW, viewer: { name: '陳大文', role: 'MEMBER' }, from: 0, to: null });

  it('names the building and place, and how late the work is', () => {
    const html = renderToStaticMarkup(<ReminderAnswer book={member} />);
    expect(html).toContain('合成大廈 · 1樓 A室');
    expect(html).toContain('到期 10月22日（已逾期 2 天）');
  });

  it('quotes the original words instead of passing them off as a date', () => {
    const html = renderToStaticMarkup(<ReminderAnswer book={member} />);
    expect(html).toContain('未填確定日期');
    expect(html).toContain('時間原話：「下星期再問」沒有換算成日期');
  });

  it('tells an employee their list is their own, and counts what it left out', () => {
    const html = renderToStaticMarkup(<ReminderAnswer book={member} />);
    expect(html).toContain('只列出指派給你的任務');
    expect(html).toContain('另有 1 項指派給其他同事、1 項未填負責人');
    expect(html).not.toContain('約見');
    expect(html).not.toContain('待分派');
  });

  it('shows an administrator every task with its owner', () => {
    const html = renderToStaticMarkup(<ReminderAnswer book={buildReminders(snapshot, { now: NOW, viewer: { name: '管理員', role: 'ADMIN' }, from: 0, to: null })} />);
    expect(html).toContain('指派給 李小明');
    expect(html).toContain('未填負責人');
    expect(html).not.toContain('只列出指派給你的任務');
  });

  it('says plainly when there is nothing to do', () => {
    const empty = buildReminders(snapshot, { now: NOW, viewer: { name: '管理員', role: 'ADMIN' }, from: 0, to: 0 });
    // Today has o-other and o-nobody plus the overdue task, so ask about a day with none.
    expect(empty.tasks.length).toBeGreaterThan(0);
    const tomorrow = buildReminders(snapshot, { now: NOW, from: 1, to: 1 });
    expect(renderToStaticMarkup(<ReminderAnswer book={tomorrow} />)).toContain('沒有未完成跟進');
  });
});
