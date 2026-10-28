import { describe, expect, it } from 'vitest';
import { canonicalOptions, readPatchReply, readSuggestion, requiredFields, type AiSuggestion } from './contract';

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

describe('the plan chat contract', () => {
  const context = { text: '第 2、3 行都是 2026-10-11 去過，已嘗試接觸', today: '2026-10-24', rows: [2, 3, 4], columnCount: 7, columns: { buildingName: 0, occurredAt: 1, occurredTime: 2, worker: 4, coverage: 5 } };
  const patch = (over: Record<string, unknown> = {}) => ({ row: 2, column: 5, field: null, value: '已嘗試接觸', reason: '你說第 2、3 行都是已嘗試接觸', ...over });

  it('accepts a cell patch on a row the person can see', () => {
    const read = readPatchReply({ status: 'PATCH', explanation: '改了兩行的覆蓋結果', patches: [patch(), patch({ row: 3 })], warnings: [] }, context);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.patches).toHaveLength(2);
      expect(read.value.patches[0]).toMatchObject({ row: 2, column: 5, field: null, value: '已嘗試接觸' });
    }
  });

  it('accepts a field patch for something the sheet has no column for', () => {
    const read = readPatchReply({ status: 'PATCH', explanation: '補了覆蓋結果', patches: [patch({ column: null, field: 'coverage' })] }, context);
    expect(read.ok).toBe(true);
  });

  it('cannot reach a row or a cell identity field', () => {
    const outside = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch({ row: 9 })] }, context);
    expect(outside.ok).toBe(false);
    const identity = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch({ column: null, field: 'recordId', value: 'paper:1' })] }, { ...context, rows: [2] });
    expect(identity.ok).toBe(false);
    const wide = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch({ column: 99 })] }, context);
    expect(wide.ok).toBe(false);
  });

  it('refuses a date or a time the person did not write', () => {
    const invented = readPatchReply({ status: 'PATCH', explanation: '改日期', patches: [patch({ column: 1, value: '2026-10-12' })] }, context);
    expect(invented.ok).toBe(false);
    const stated = readPatchReply({ status: 'PATCH', explanation: '改日期', patches: [patch({ column: 1, value: '2026-10-11' })] }, context);
    expect(stated.ok).toBe(true);
    const clock = readPatchReply({ status: 'PATCH', explanation: '改時間', patches: [patch({ column: 2, field: null, value: '19:05' })] }, context);
    expect(clock.ok).toBe(false);
  });

  it('still reads a value through the same option list the file uses', () => {
    const read = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch({ value: '好像去過' })] }, context);
    expect(read.ok).toBe(false);
  });

  it('allows clearing a cell, and refuses two patches on the same cell', () => {
    const cleared = readPatchReply({ status: 'PATCH', explanation: '清空了', patches: [patch({ value: '' })] }, context);
    expect(cleared.ok).toBe(true);
    const twice = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch(), patch()] }, context);
    expect(twice.ok).toBe(false);
  });

  it('lets the chat say no, with a reason, and changes nothing', () => {
    const read = readPatchReply({ status: 'REFUSE', explanation: '我看不出年份，請寫明日期' }, context);
    expect(read).toEqual({ ok: true, value: { status: 'REFUSE', explanation: '我看不出年份，請寫明日期', patches: [], warnings: [] } });
    expect(readPatchReply({ status: 'REFUSE', explanation: 'x', patches: [patch()] }, context).ok).toBe(false);
    expect(readPatchReply({ status: 'REFUSE' }, context).ok).toBe(false);
  });

  it('discards the whole answer on one stray key', () => {
    const read = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch({ extra: 1 })] }, context);
    expect(read.ok).toBe(false);
    const top = readPatchReply({ status: 'PATCH', explanation: 'x', patches: [patch()], delete: true }, context);
    expect(top.ok).toBe(false);
  });
});
