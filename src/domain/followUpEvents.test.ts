import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { followUpClosures, followUpEventsFor, getOpenFollowUps, recordFollowUpEvent, unitState, type Observation, type OutreachSnapshot } from './types';
import { snapshotSchema } from './schema';
import { workflowDemo } from '../data/workflowDemo';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from '../data/workflowWorkbook';
import { mergeWorkflow } from '../data/workflowMerge';
import { excelDate, paperHeaders } from '../data/workflowFormat';

/*
 * Decision 2026-09-29: a task can be marked done or cancelled (with a reason) without
 * inventing a visit, the operator is recorded, the action can be undone, and the
 * trail travels with the Excel export.
 */
const flags = { isSynthetic: true as const, provisional: true as const };
const operator = { accountId: 'acct-1', name: '合成操作員' };
const at = (minute: number) => new Date(Date.UTC(2026, 0, 6, 2, minute)).toISOString();

function scene(observations: Observation[]): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '合成大廈', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1F' }],
    units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: 'A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [],
    visits: [{ ...flags, id: 'v1', occurredAt: '2026-01-05T02:00:00.000Z', recordedAt: '2026-01-05T02:00:00.000Z', workerName: '合成工作員' }],
    observations,
  };
}
const visited = (extra: Partial<Observation> = {}): Observation => ({
  ...flags, id: 'o1', visitId: 'v1', buildingId: 'b1', floorId: 'f1', unitId: 'u1', occurredAt: '2026-01-05T02:00:00.000Z',
  recordedAt: '2026-01-05T02:00:00.000Z', workerName: '合成工作員', coverage: 'VISITED_NO_FINDING', evidence: [],
  followUp: { action: '再訪', status: 'OPEN' }, ...extra,
});
const act = (snapshot: OutreachSnapshot, action: 'DONE' | 'CANCELLED' | 'REOPENED', minute: number, reason?: string, observationId = 'o1') =>
  recordFollowUpEvent(snapshot, { id: `e${minute}`, observationId, action, reason, at: at(minute), operator });

describe('closing a task without a visit', () => {
  it('marks it done: the task leaves the open list and the colour follows', () => {
    const before = scene([visited()]);
    expect(unitState(before, 'b1', 'u1')).toBe('YELLOW');
    const after = act(before, 'DONE', 1);
    expect(getOpenFollowUps(after)).toHaveLength(0);
    expect(unitState(after, 'b1', 'u1')).toBe('GREEN');
  });

  it('adds no observation: nothing pretends a visit happened', () => {
    const before = scene([visited()]);
    expect(act(before, 'DONE', 1).observations).toEqual(before.observations);
  });

  it('records the operator and the time of the press', () => {
    const [event] = act(scene([visited()]), 'DONE', 1).followUpEvents!;
    expect(event).toMatchObject({ observationId: 'o1', action: 'DONE', at: at(1), operator });
  });

  it('refuses to cancel without a reason', () => {
    expect(() => act(scene([visited()]), 'CANCELLED', 1, '  ')).toThrow('取消跟進須寫明原因');
    const cancelled = act(scene([visited()]), 'CANCELLED', 1, '已電話聯絡');
    expect(followUpClosures(cancelled).get('o1')).toMatchObject({ action: 'CANCELLED', reason: '已電話聯絡' });
  });

  it('can be undone, and the undo is a new event rather than an erasure', () => {
    const reopened = act(act(scene([visited()]), 'DONE', 1), 'REOPENED', 2);
    expect(getOpenFollowUps(reopened)).toHaveLength(1);
    expect(followUpEventsFor(reopened, 'o1').map(event => event.action)).toEqual(['DONE', 'REOPENED']);
    expect(unitState(reopened, 'b1', 'u1')).toBe('YELLOW');
  });

  it('ignores a second close and an undo of an open task', () => {
    const done = act(scene([visited()]), 'DONE', 1);
    expect(act(done, 'CANCELLED', 2, '重複')).toBe(done);
    const open = scene([visited()]);
    expect(act(open, 'REOPENED', 1)).toBe(open);
  });

  it('does not reopen a task a later visit already closed', () => {
    const closer = visited({ id: 'o2', occurredAt: '2026-01-07T02:00:00.000Z', recordedAt: '2026-01-07T02:00:00.000Z', followUp: undefined, resolvesObservationId: 'o1' });
    const snapshot = scene([visited(), closer]);
    expect(act(snapshot, 'REOPENED', 1)).toBe(snapshot);
  });

  it('follows a corrected task: closing either version closes the task once', () => {
    const correction = visited({ id: 'o1b', recordedAt: '2026-01-05T03:00:00.000Z', correctsObservationId: 'o1', correctionReason: '改寫行動', followUp: { action: '改為電話聯絡', status: 'OPEN' } });
    const done = act(scene([visited(), correction]), 'DONE', 1, undefined, 'o1b');
    expect(getOpenFollowUps(done)).toHaveLength(0);
    expect(followUpClosures(done).has('o1')).toBe(true);
  });
});

describe('the stored trail is validated', () => {
  const valid = act(act(scene([visited()]), 'DONE', 1), 'REOPENED', 2);
  it('accepts a normal close and undo', () => expect(snapshotSchema.safeParse(valid).success).toBe(true));
  it('rejects a cancellation with no reason', () => {
    const bad = { ...valid, followUpEvents: [{ ...valid.followUpEvents![0], action: 'CANCELLED' as const, reason: undefined }] };
    expect(snapshotSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects an undo of something never closed', () => {
    const bad = { ...valid, followUpEvents: [valid.followUpEvents![1]] };
    expect(snapshotSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects an event on a record that carries no task', () => {
    const bad = { ...valid, observations: [visited({ followUp: undefined })] };
    expect(snapshotSchema.safeParse(bad).success).toBe(false);
  });
});

describe('the trail travels with Excel', () => {
  const task = getOpenFollowUps(workflowDemo)[0];
  const closed = recordFollowUpEvent(workflowDemo, { id: 'e1', observationId: task.observationId, action: 'CANCELLED', reason: '已電話聯絡', at: at(1), operator });
  const bytes = exportWorkflowWorkbook(closed);

  it('adds a readable 跟進處理 sheet naming the operator and the reason', () => {
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toContain('跟進處理');
    const text = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets['跟進處理'], { header: 1 }));
    expect(text).toContain('合成操作員');
    expect(text).toContain('已電話聯絡');
  });

  it('round-trips the events through the archive and keeps the task closed', () => {
    const result = parseWorkflowWorkbook(bytes, 'closed.xlsx', '2026-09-11T04:00:00Z')!;
    expect(result.issues).toEqual([]);
    expect(result.snapshot?.followUpEvents).toEqual(closed.followUpEvents);
    expect(getOpenFollowUps(result.snapshot!).some(open => open.observationId === task.observationId)).toBe(false);
  });

  it('keeps local events when an older file without them is merged', () => {
    const older = parseWorkflowWorkbook(exportWorkflowWorkbook(workflowDemo), 'older.xlsx', '2026-09-11T04:00:00Z')!;
    const merged = mergeWorkflow(closed, older.snapshot!, older.baseline);
    expect(merged.issues).toEqual([]);
    expect(merged.snapshot?.followUpEvents).toEqual(closed.followUpEvents);
  });

  it('warns, and applies nothing, when the reading sheet is edited', () => {
    const wb = XLSX.read(bytes, { type: 'array' });
    wb.Sheets['跟進處理'].D7 = { t: 's', v: '改寫原因' };
    const result = parseWorkflowWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'edited.xlsx', '2026-09-11T04:00:00Z')!;
    expect(result.issues.some(issue => issue.sheet === '跟進處理' && issue.severity === 'warning')).toBe(true);
    expect(result.snapshot?.followUpEvents).toEqual(closed.followUpEvents);
  });
});

describe('floors keep no record of their own on import', () => {
  it('rejects a paper row with a floor and no unit, and says what to do', () => {
    const wb = XLSX.read(exportWorkflowWorkbook(workflowDemo), { type: 'array' });
    const data: Record<string, unknown> = { '紙本編號': 'QA-09', '紙本行號': '1', '到訪日期': excelDate('2026-09-10'), '工作員': '合成工作員', '大廈編號': 'bldg-yu-an', '樓層': '5F', '覆蓋結果': '未能進入' };
    XLSX.utils.sheet_add_aoa(wb.Sheets['紙本回錄'], [paperHeaders.map(h => data[h] ?? '')], { origin: -1 });
    const result = parseWorkflowWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'floor.xlsx', '2026-09-11T04:00:00Z')!;
    expect(result.snapshot).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'FLOOR_WITHOUT_UNIT', field: '單位', message: expect.stringMatching(/請補上單位.*整幢的記錄，樓層也要留空/) }));
  });
});
