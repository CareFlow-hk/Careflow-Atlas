import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { districtDemo } from '../data/districtDemo';
import { proposeLocation } from '../domain/structure';
import { parseGenericRows, readSheetMatrix } from './genericRows';
const bytes = readFileSync(new URL('../../samples/ai-assistant/西營盤社區客廳_洗樓Excel_mock.xlsx', import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const matrix = readSheetMatrix(buffer, '洗樓記錄')!;
const base = {
  buffer, matrix, sheetName: '洗樓記錄', headerRow: 1, fileName: '西營盤社區客廳_洗樓Excel_mock.xlsx', snapshot: districtDemo,
  mapping: [
    { key: 'occurredAt' as const, columnIndex: 0 }, { key: 'worker' as const, columnIndex: 1 },
    { key: 'buildingName' as const, columnIndex: 2 }, { key: 'floor' as const, columnIndex: 4 },
    { key: 'note' as const, columnIndex: 5 },
  ], extraColumns: [{ header: '地址', columnIndex: 3 }, { header: '備註', columnIndex: 6 }],
};
// Explicit synthetic reviewer answers, not production defaults or AI-inferred facts.
const reviewed = {
  ...base, sheetYear: 2026,
  mapping: [...base.mapping, { key: 'coverage' as const, columnIndex: 60 }, { key: 'assessment' as const, columnIndex: 61 }, { key: 'sourceType' as const, columnIndex: 62 }],
  overrides: matrix.matrix.slice(1).flatMap((_, index) => [
    { row: index + 2, column: 60, value: 'ATTEMPTED' },
    { row: index + 2, column: 61, value: 'UNKNOWN' },
    { row: index + 2, column: 62, value: 'STAFF_OBSERVATION' },
  ]),
};
describe('the synthetic Sai Ying Pun floor sheet', () => {
  it('succeeds for most rows after explicit year and mandatory review answers, with no implicit structures', () => {
    const before = parseGenericRows(base);
    expect(before.rows).toHaveLength(74);
    expect(before.counts.READY).toBe(0);
    const onlyYear = parseGenericRows({ ...base, sheetYear: 2026 });
    expect(onlyYear.counts.READY).toBe(0);
    const after = parseGenericRows(reviewed);
    expect(after.counts.READY).toBeGreaterThan(37);
    // An Ho has no floors yet: accepting the structure proposal is explicit.
    const firstStructure = after.pending.find(place => place.rowNumbers.includes(2))!;
    expect(after.rows[0].input).toBeUndefined();
    let withFloor = districtDemo;
    for (const unit of firstStructure.structureUnits!) {
      const applied = proposeLocation(withFloor, firstStructure.buildingId, firstStructure.floorLabel, unit)!.apply(withFloor);
      if ('error' in applied) throw new Error(applied.error);
      withFloor = applied.snapshot;
    }
    const multiple = parseGenericRows({ ...reviewed, snapshot: withFloor }).rows[0];
    expect(multiple.input?.floorId).toBeTruthy();
    expect(multiple.input?.unitId).toBeUndefined();
    expect(multiple.input?.note).toContain('3F ABC');
    expect(districtDemo.units).toHaveLength(base.snapshot.units.length);
    const split = after.pending.find(place => place.description?.includes('A 單位分成 4 間'))!;
    expect(split.structureUnits).toHaveLength(4);
    let snapshot = districtDemo;
    for (const unit of split.structureUnits!) {
      const proposal = proposeLocation(snapshot, split.buildingId, split.floorLabel, unit)!;
      const applied = proposal.apply(snapshot);
      expect('error' in applied).toBe(false);
      if (!('error' in applied)) snapshot = applied.snapshot;
    }
    expect(snapshot.units.length).toBeGreaterThan(districtDemo.units.length);
  });
  it('leaves ambiguous notations in NEEDS_REVIEW with their reasons', () => {
    const result = parseGenericRows(reviewed);
    for (const notation of ['3FH', '6F–8F', '6F 後座', '12-13F', '8F 2A1']) {
      const index = matrix.matrix.findIndex(row => row[4] === notation);
      const row = result.rows.find(row => row.rowNumber === index + 1)!;
      expect(row.status).toBe('NEEDS_REVIEW');
      expect(row.issues.some(issue => issue.code === 'LOCATION_REVIEW')).toBe(true);
      expect(row.input).toBeUndefined();
    }
  });
  it('refuses unknown buildings rather than manufacturing a target', () => {
    const result = parseGenericRows({ ...reviewed, overrides: [...reviewed.overrides, { row: 2, column: 2, value: '不在工作區的合成大廈' }] });
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues.some(issue => issue.code === 'BUILDING')).toBe(true);
    expect(result.rows[0].input).toBeUndefined();
  });
});
