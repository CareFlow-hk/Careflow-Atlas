import { describe, expect, it } from 'vitest';
import type { GenericParseResult, ParsedRow, PendingPlace } from '../imports/genericRows';
import { placeKey, plannedRows, placesToCreate, placeAction, recordAction } from './aiPlan';

const row = (over: Partial<ParsedRow> & { rowNumber: number }): ParsedRow => ({ status: 'READY', issues: [], ...over });

const place: PendingPlace = {
  buildingId: 'bldg-yu-an', buildingName: '裕安樓', floorLabel: '9F', newFloor: true, unitLabel: '9F A室', rowNumbers: [4, 5],
};

const sheet = (rows: ParsedRow[], pending: PendingPlace[] = []): GenericParseResult => ({
  rows, notes: [], blankRows: 0, pending,
  counts: rows.reduce((counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }), { READY: 0, NEEDS_REVIEW: 0, INVALID: 0 }),
});

describe('what the plan says it will do', () => {
  it('names the building, the floor and the unit a record will land in', () => {
    const action = recordAction(row({ rowNumber: 2, buildingName: '裕安樓', location: '5F B室', occurredAt: '2026-10-05', workerName: '陳同事', coverage: '未能完成探訪' }));
    expect(action.sentence).toBe('在「裕安樓 · 5F B室」新增 1 筆到訪記錄');
    expect(action.detail).toContain('第 2 行');
    expect(action.detail).toContain('2026-10-05');
  });

  it('says 「整幢」 when the row is not tied to a floor or unit', () => {
    expect(recordAction(row({ rowNumber: 3, buildingName: '裕安樓' })).sentence).toBe('在「裕安樓（整幢）」新增 1 筆到訪記錄');
  });

  it('offers a missing floor together with its unit, in one action', () => {
    expect(placeAction(place).sentence).toBe('在「裕安樓」新增「9F」這一層與「9F A室」');
    expect(placeAction({ ...place, newFloor: false }).sentence).toBe('在「裕安樓」新增「9F A室」');
  });
});

describe('what the plan will actually run', () => {
  const waiting = row({ rowNumber: 4, status: 'NEEDS_REVIEW', issues: [{ code: 'LOCATION', message: '系統還沒有' }] });
  const alsoMissing = row({ rowNumber: 5, status: 'NEEDS_REVIEW', issues: [{ code: 'MISSING_DATE', message: '未填到訪日期。' }, { code: 'LOCATION', message: '系統還沒有' }] });
  const ready = row({ rowNumber: 2, buildingName: '裕安樓', location: '5F B室', input: { id: 'a', visitId: 'v', buildingId: 'b', occurredAt: '2026-10-05', recordedAt: '2026-10-05', workerName: '陳同事', coverage: 'ATTEMPTED', evidence: [] } });
  const twin = row({ rowNumber: 3, buildingName: '裕安樓', location: '5F B室', suspectedDuplicateOfRow: 2, input: { ...ready.input!, id: 'b' } });

  it('counts a row that only waits for the new place once that place is made', () => {
    const result = sheet([ready, waiting, alsoMissing], [place]);
    expect(plannedRows(result, new Set([placeKey(place)])).map(item => item.rowNumber)).toEqual([2, 4]);
  });

  it('leaves the waiting row out when the place is not being made', () => {
    const result = sheet([ready, waiting], [place]);
    expect(plannedRows(result, new Set()).map(item => item.rowNumber)).toEqual([2]);
  });

  it('does not promise a row that has another problem as well', () => {
    const result = sheet([alsoMissing], [place]);
    expect(plannedRows(result, new Set([placeKey(place)]))).toEqual([]);
  });

  it('never writes a suspected repeat on its own', () => {
    const result = sheet([ready, twin], []);
    expect(plannedRows(result, new Set()).map(item => item.rowNumber)).toEqual([2]);
  });

  it('creates a place only when it makes a row writable', () => {
    expect(placesToCreate(sheet([ready, waiting], [place]))).toEqual([place]);
    // Row 5 is also missing a date, so creating the place would still not write it.
    expect(placesToCreate(sheet([alsoMissing], [place]))).toEqual([]);
    expect(placesToCreate(sheet([ready], [place]))).toEqual([]);
  });
});
