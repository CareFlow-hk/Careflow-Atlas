import { describe, expect, it } from 'vitest';
import type { CanonicalField } from '../imports/profiles';
import { NO_EDITS, cellKey, editCounts, fieldEditKey, fieldKey, planInput, readEditKey, syntheticColumn, withEdit, withoutEdit } from './planEdits';

const columns: Partial<Record<CanonicalField, number | null>> = { buildingName: 0, occurredAt: 1, worker: 4, coverage: 5 };

describe('an edit key', () => {
  it('names a cell that exists in the sheet', () => {
    expect(readEditKey(cellKey(3, 1))).toEqual({ kind: 'cell', row: 3, column: 1 });
  });

  it('names a field the sheet has no column for', () => {
    expect(readEditKey(fieldKey(3, 'coverage'))).toEqual({ kind: 'field', row: 3, field: 'coverage' });
  });

  it('is not a way to reach any other shape', () => {
    expect(readEditKey('c:0:1')).toBeUndefined();
    expect(readEditKey('x:2:1')).toBeUndefined();
    expect(readEditKey('f:2:not-a-field')).toBeUndefined();
    expect(readEditKey('c:2')).toBeUndefined();
  });
});

describe('the mapping handed to the parser', () => {
  it('carries a cell edit at the column it belongs to', () => {
    const { mapping, overrides } = planInput(columns, withEdit(NO_EDITS, cellKey(2, 5), '已嘗試接觸', 'person'));
    expect(mapping).toEqual([
      { key: 'buildingName', columnIndex: 0 }, { key: 'occurredAt', columnIndex: 1 },
      { key: 'worker', columnIndex: 4 }, { key: 'coverage', columnIndex: 5 },
    ]);
    expect(overrides).toEqual([{ row: 2, column: 5, value: '已嘗試接觸' }]);
  });

  it('gives a field with no column a synthetic one, and only while it has a value', () => {
    const rest: Partial<Record<CanonicalField, number | null>> = { buildingName: 0, occurredAt: 1, worker: 4 };
    const edited = planInput(rest, withEdit(NO_EDITS, fieldKey(2, 'coverage'), '已嘗試接觸', 'person'));
    expect(edited.mapping).toContainEqual({ key: 'coverage', columnIndex: syntheticColumn('coverage') });
    expect(edited.overrides).toEqual([{ row: 2, column: syntheticColumn('coverage'), value: '已嘗試接觸' }]);
    expect(planInput(rest, NO_EDITS).mapping).not.toContainEqual({ key: 'coverage', columnIndex: syntheticColumn('coverage') });
  });

  it('keeps a synthetic column past anything a real sheet can have', () => {
    expect(syntheticColumn('coverage')).toBeGreaterThan(64);
    expect(syntheticColumn('coverage')).toBeGreaterThan(64);
    expect(syntheticColumn('coverage')).not.toBe(syntheticColumn('worker'));
  });

  it('does not add the same synthetic column twice for one field', () => {
    let edits = withEdit(NO_EDITS, fieldKey(2, 'coverage'), '已嘗試接觸', 'person');
    edits = withEdit(edits, fieldKey(3, 'coverage'), '未接觸', 'ai');
    const { mapping } = planInput({ buildingName: 0 }, edits);
    expect(mapping.filter(entry => entry.key === 'coverage')).toHaveLength(1);
  });
});

describe('where a value for a field lives', () => {
  it('is the sheet’s own cell when that field has a column', () => {
    expect(fieldEditKey(3, 'occurredAt', columns)).toBe(cellKey(3, 1));
  });

  it('is a field of its own when the sheet never had that column', () => {
    expect(fieldEditKey(3, 'coverage', { buildingName: 0 })).toBe(fieldKey(3, 'coverage'));
  });

  it('treats an explicitly unmapped column (null) as no column', () => {
    expect(fieldEditKey(3, 'worker', { worker: null })).toBe(fieldKey(3, 'worker'));
  });
});

describe('changing and undoing an edit', () => {
  it('records who changed the cell, for the badge in the table', () => {
    let edits = withEdit(NO_EDITS, cellKey(2, 1), '2026-10-11', 'person');
    edits = withEdit(edits, cellKey(3, 1), '2026-10-12', 'ai');
    expect(editCounts(edits)).toEqual({ person: 1, ai: 1 });
  });

  it('forgets the value and the source together', () => {
    const edits = withoutEdit(withEdit(NO_EDITS, cellKey(2, 1), '2026-10-11', 'ai'), cellKey(2, 1));
    expect(edits.values).toEqual({});
    expect(edits.sources).toEqual({});
    expect(editCounts(edits)).toEqual({ person: 0, ai: 0 });
  });
});
