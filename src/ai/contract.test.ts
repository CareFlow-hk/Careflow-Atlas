import { describe, expect, it } from 'vitest';
import { canonicalOptions, readSuggestion, requiredFields, type AiSuggestion } from './contract';

const context = { columnCount: 6, rowCount: 10, headerRow: 0 };

const match = (): AiSuggestion => ({
  status: 'MATCH', sheetName: '探訪記錄', headerRow: 0, profileId: 'one-person-per-row',
  fields: [{ key: 'personName', columnIndex: 0, confidence: 0.9, reason: '表頭寫「姓名」' }],
  unmappedColumns: [{ columnIndex: 4, header: '備註', reason: '不屬既有欄位' }],
  warnings: [],
});

describe('AI column-mapping contract', () => {
  it('accepts an exact match', () => {
    const read = readSuggestion(match(), context);
    expect(read).toEqual({ ok: true, value: match() });
  });

  it('accepts a refusal, and a no-match, without inventing fields', () => {
    expect(readSuggestion({ status: 'REFUSE' }, context)).toEqual({ ok: true, value: { status: 'REFUSE', fields: [], unmappedColumns: [], warnings: [] } });
    const none = readSuggestion({ status: 'NO_MATCH', fields: [] }, context);
    expect(none.ok && none.value.status).toBe('NO_MATCH');
  });

  it('only names fields that already exist', () => {
    expect(canonicalOptions().map(field => field.key)).toContain('personName');
    expect(canonicalOptions()).toHaveLength(32);
    const read = readSuggestion({ ...match(), fields: [{ key: 'householdSize', columnIndex: 0, confidence: 1, reason: '猜的' }] }, context);
    expect(read.ok).toBe(false);
  });

  it('discards the whole answer on a stray field, never keeping the rest', () => {
    const read = readSuggestion({ ...match(), extra: 'keep me' }, context);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain('合約以外');

    const nested = readSuggestion({ ...match(), fields: [{ key: 'personName', columnIndex: 0, confidence: 1, reason: 'x', guess: 'y' }] }, context);
    expect(nested.ok).toBe(false);
  });

  it('rejects an index outside the sheet instead of clamping it', () => {
    const read = readSuggestion({ ...match(), fields: [{ key: 'personName', columnIndex: 6, confidence: 1, reason: 'x' }] }, context);
    expect(read.ok).toBe(false);
    const negative = readSuggestion({ ...match(), fields: [{ key: 'personName', columnIndex: -1, confidence: 1, reason: 'x' }] }, context);
    expect(negative.ok).toBe(false);
  });

  it('rejects two fields on one column, and the same field twice', () => {
    const twice = readSuggestion({ ...match(), fields: [
      { key: 'personName', columnIndex: 0, confidence: 1, reason: 'a' },
      { key: 'personName', columnIndex: 1, confidence: 1, reason: 'b' },
    ] }, context);
    expect(twice.ok).toBe(false);
    const clash = readSuggestion({ ...match(), fields: [
      { key: 'personName', columnIndex: 0, confidence: 1, reason: 'a' },
      { key: 'phone', columnIndex: 0, confidence: 1, reason: 'b' },
    ] }, context);
    expect(clash.ok).toBe(false);
  });

  it('rejects a refusal that still carries suggestions', () => {
    expect(readSuggestion({ status: 'REFUSE', fields: [{ key: 'personName', columnIndex: 0, confidence: 1, reason: 'x' }] }, context).ok).toBe(false);
  });

  it('rejects an answer that disagrees with the header row recognition found', () => {
    expect(readSuggestion({ ...match(), headerRow: 3 }, context).ok).toBe(false);
    expect(readSuggestion({ ...match(), headerRow: 10 }, context).ok).toBe(false);
  });

  it('rejects an unmatched column that is also claimed by a field', () => {
    const read = readSuggestion({ ...match(), unmappedColumns: [{ columnIndex: 0, header: '姓名', reason: 'x' }] }, context);
    expect(read.ok).toBe(false);
  });

  it('rejects a reply that is not an object at all', () => {
    expect(readSuggestion('OK', context).ok).toBe(false);
    expect(readSuggestion([{ status: 'MATCH' }], context).ok).toBe(false);
    expect(readSuggestion(null, context).ok).toBe(false);
  });

  it('needs a reason for every suggestion, so the person can judge it', () => {
    expect(readSuggestion({ ...match(), fields: [{ key: 'personName', columnIndex: 0, confidence: 1, reason: '' }] }, context).ok).toBe(false);
    expect(readSuggestion({ ...match(), fields: [{ key: 'personName', columnIndex: 0, confidence: 2, reason: 'x' }] }, context).ok).toBe(false);
  });

  it('knows which fields the chosen format treats as required', () => {
    expect(requiredFields('one-person-per-row')).toContain('personName');
    expect(requiredFields(undefined)).toEqual([]);
  });
});
