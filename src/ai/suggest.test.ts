import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import type { OutboundPreview } from './preview';
import { PATCH_ROW_LIMIT, suggestDraft, suggestFileMapping, suggestPatches } from './suggest';

const preview = (over: Partial<OutboundPreview> = {}): OutboundPreview => ({
  fileName: '回錄.xlsx', sheetName: '探訪記錄', sheets: [{ name: '探訪記錄', rows: 2, columns: 2 }],
  headerRow: 0, headers: ['姓名', '人數'], columnCount: 2, totalRows: 2,
  rows: [['姓名', '人數'], ['陳大文', '3']], rowNumbers: [1, 2],
  sensitiveColumns: [0], truncatedCells: 0, chunks: [{ start: 0, end: 2 }],
  ...over,
});

/* eslint-disable @typescript-eslint/no-explicit-any -- the request body is the point of these tests */
type Body = Record<string, any>;
type Captured = { seen: { url?: string; init?: RequestInit }; bodies: Body[]; fetcher: typeof fetch };

const marker = { at: '2026-10-25T08:00:00.000Z', provider: 'azure-openai', model: 'gpt-6-luna', requestId: 'resp_test' };

/**
 * Stands in for the server: records what the page sent and answers with the envelope
 * `/api/ai/assist` returns. Nothing here knows a provider's shape any more — the page talks
 * to our own endpoint only.
 */
function capture(reply: unknown | ((body: Body) => unknown)): Captured {
  const bodies: Body[] = [];
  const seen: { url?: string; init?: RequestInit } = {};
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const answer = typeof reply === 'function' ? reply(body) : reply;
    return new Response(JSON.stringify({ kind: body.kind, proposal: answer, aiAssist: marker }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { seen, bodies, fetcher };
}

const suggestion = {
  status: 'MATCH', sheetName: '探訪記錄', headerRow: 0,
  fields: [{ key: 'personName', columnIndex: 0, confidence: 0.8, reason: '表頭寫「姓名」' }],
  unmappedColumns: [{ columnIndex: 1, header: '人數', reason: '不是既有欄位' }],
  warnings: [],
};

describe('asking for a column mapping', () => {
  it('posts one request to our own endpoint, carrying no provider, no key and no prompt', async () => {
    const { seen, bodies, fetcher } = capture(suggestion);
    const result = await suggestFileMapping({ preview: preview(), fetcher });
    expect(result.suggestion.status).toBe('MATCH');
    expect(result.parts).toBe(1);
    expect(seen.url).toBe('/api/ai/assist');
    const body = bodies[0];
    expect(body.kind).toBe('mapping');
    // The server owns every one of these; a page that set them would be refused with 400.
    for (const field of ['model', 'provider', 'system', 'instructions', 'store', 'endpoint', 'apiKey']) {
      expect(body).not.toHaveProperty(field);
    }
    expect(String(seen.init?.body)).not.toMatch(/sk-|api-key|Bearer/i);
    expect(body.rows[1]).toContain('陳大文');
  });

  it('leaves the header names out when the sheet has no header row to name', async () => {
    // A workbook the rule detector could not find a header in is exactly the one the
    // assistant is asked about. Sending `headers: []` there claimed to name zero columns
    // while the request carried several, and the server refused the whole request with
    // 400 before the model ever saw it (2026-10-25).
    const { bodies, fetcher } = capture({ ...suggestion, headerRow: undefined });
    await suggestFileMapping({ preview: preview({ headerRow: null, headers: [] }), fetcher });
    expect(bodies[0]).not.toHaveProperty('headers');
    expect(bodies[0].columnCount).toBe(2);
  });

  it('keeps the server’s marker so every record can say which request read the sheet', async () => {
    const { fetcher } = capture(suggestion);
    const result = await suggestFileMapping({ preview: preview(), fetcher });
    expect(result.aiAssist).toEqual(marker);
  });

  it('returns a refusal as a normal answer, not an error', async () => {
    const { fetcher } = capture({ status: 'REFUSE' });
    await expect(suggestFileMapping({ preview: preview(), fetcher })).resolves.toMatchObject({ suggestion: { status: 'REFUSE', fields: [] } });
  });

  it('throws away a reply the rule detector would disagree with', async () => {
    const { fetcher } = capture({ ...suggestion, headerRow: 1 });
    await expect(suggestFileMapping({ preview: preview(), fetcher })).rejects.toMatchObject({ kind: 'schema' });
  });

  it('throws away a reply with an invented field rather than keeping the rest', async () => {
    const { fetcher } = capture({ ...suggestion, fields: [{ key: 'householdSize', columnIndex: 0, confidence: 1, reason: '猜' }] });
    await expect(suggestFileMapping({ preview: preview(), fetcher })).rejects.toMatchObject({ kind: 'schema' });
  });
});

describe('a worksheet read in parts', () => {
  const many = (rows: number): OutboundPreview => {
    const data = [['姓名', '人數'], ...Array.from({ length: rows - 1 }, (_, index) => [`住戶${index}`, '3'])];
    const chunks = [];
    for (let start = 0; start < data.length; start += 300) chunks.push({ start, end: Math.min(start + 300, data.length) });
    return preview({ rows: data, totalRows: data.length, rowNumbers: data.map((_, index) => index + 1), chunks });
  };

  it('sends every row, and the parts add up to the whole sheet', async () => {
    const sheet = many(701);
    const { bodies, fetcher } = capture((body: Body) => (body.part.index === 1 ? suggestion : { ...suggestion, headerRow: undefined }));
    const result = await suggestFileMapping({ preview: sheet, fetcher });
    expect(result.parts).toBe(3);
    expect(bodies).toHaveLength(3);
    const sent = bodies.map(body => body.rows.length as number);
    expect(sent.reduce((total, count) => total + count, 0)).toBe(701);
  });

  it('refuses the whole answer when a later part moves a field to another column', async () => {
    const sheet = many(701);
    let call = 0;
    const { fetcher } = capture(() => (++call === 1 ? suggestion : { ...suggestion, headerRow: undefined, fields: [{ key: 'personName', columnIndex: 1, confidence: 0.6, reason: '看起來像' }] }));
    await expect(suggestFileMapping({ preview: sheet, fetcher })).rejects.toThrow(/第 2\/3 段/);
  });

  it('stops after the first part when the header part is not outreach work', async () => {
    const sheet = many(701);
    const { bodies, fetcher } = capture({ status: 'REFUSE' });
    const result = await suggestFileMapping({ preview: sheet, fetcher });
    expect(result.suggestion.status).toBe('REFUSE');
    // Three parts exist. Asking about the same payroll sheet again buys the same answer,
    // so only the part that carries the header is sent.
    expect(bodies).toHaveLength(1);
    expect(result.parts).toBe(1);
  });

  it('keeps the first part’s mapping when a later part finds nothing, and says so', async () => {
    const sheet = many(701);
    let call = 0;
    const { fetcher } = capture(() => (++call === 1 ? suggestion : { status: 'NO_MATCH', fields: [], unmappedColumns: [], warnings: [] }));
    const result = await suggestFileMapping({ preview: sheet, fetcher });
    expect(result.suggestion.fields).toHaveLength(1);
    expect(result.suggestion.warnings.join(' ')).toContain('沿用第 1 段');
  });
});

describe('columns the person withheld', () => {
  it('never puts a withheld cell in the request', async () => {
    const { bodies, fetcher } = capture({ status: 'MATCH', headerRow: 0, fields: [{ key: 'note', columnIndex: 1, confidence: 0.5, reason: '第二欄' }], unmappedColumns: [], warnings: [] });
    await suggestFileMapping({ preview: preview(), fetcher, withheld: [0] });
    expect(bodies[0].rows[0][0]).toBe('');
    expect(bodies[0].rows[1][0]).toBe('');
    expect(bodies[0].withheldColumns).toEqual([0]);
  });

  it('discards an answer that maps a field onto a withheld column', async () => {
    const { fetcher } = capture(suggestion);
    await expect(suggestFileMapping({ preview: preview(), fetcher, withheld: [0] })).rejects.toMatchObject({ kind: 'schema' });
  });
});

describe('a file and a note sent together', () => {
  it('carries the note into the mapping request as data', async () => {
    const { bodies, fetcher } = capture(suggestion);
    await suggestFileMapping({ preview: preview(), fetcher, context: '大廈名稱在第 3 欄' });
    expect(bodies[0].context).toBe('大廈名稱在第 3 欄');
  });

  it('anchors a relative day in the note to the day the caller supplies', async () => {
    const { bodies, fetcher } = capture({
      status: 'DRAFT', drafts: [{ buildingId: 'bldg-yu-an', floorLabel: null, unitLabel: null,
      occurredDate: '2026-10-24', occurredTime: null, workerName: null, coverage: null,
      contactOutcome: 'NO_ANSWER', assessment: null, sourceType: null, note: null,
      followUp: null, missing: ['覆蓋結果'], warnings: [], }],
    });
    const { draft, aiAssist } = await suggestDraft({ text: '今日去咗 3樓 A 室，冇人應門。', snapshot: demoSnapshot, fetcher, today: '2026-10-24' });
    expect(draft.drafts[0].occurredDate).toBe('2026-10-24');
    expect(aiAssist).toEqual(marker);
    expect(bodies[0].today).toBe('2026-10-24');
  });
});

describe('asking the plan chat to change cells', () => {
  const table = preview({
    headers: ['大廈', '日期', '覆蓋結果', '電話'],
    columnCount: 4, totalRows: 2,
    rows: [['大廈', '日期', '覆蓋結果', '電話'], ['裕安樓', '2026-10-05', '', '61234567']],
    rowNumbers: [1, 2], sensitiveColumns: [3],
  });
  const columns = { buildingName: 0, occurredAt: 1, coverage: 2 };
  const answer = {
    status: 'PATCH', explanation: '把第 2 行標為已嘗試接觸',
    patches: [{ row: 2, column: 2, field: null, value: '已嘗試接觸', reason: '你說第 2 行已嘗試接觸' }], warnings: [],
  };

  it('sends the plan rows without the personal column, and returns the checked change', async () => {
    const { bodies, fetcher } = capture(answer);
    const result = await suggestPatches({
      text: '第 2 行係已嘗試接觸', preview: table, columns, rows: [2], fetcher, today: '2026-10-24', withheld: table.sensitiveColumns,
    });
    expect(result.status).toBe('PATCH');
    expect(result.patches).toEqual([{ row: 2, column: 2, field: null, value: '已嘗試接觸', reason: '你說第 2 行已嘗試接觸' }]);
    const body = String(bodies[0]);
    expect(body).not.toContain('61234567');
    expect(body).not.toContain('電話');
    expect(bodies[0].text).toBe('第 2 行係已嘗試接觸');
    expect(JSON.stringify(bodies[0].rows)).toContain('裕安樓');
    expect(bodies[0].kind).toBe('patch');
  });

  it('will not let the reply reach a withheld column even if the model tries', async () => {
    const { fetcher } = capture({ ...answer, patches: [{ row: 2, column: 3, field: null, value: '61234567', reason: 'x' }] });
    await expect(suggestPatches({ text: '改電話', preview: table, columns, rows: [2], fetcher, withheld: table.sensitiveColumns })).rejects.toThrow(/身分|不能/);
  });

  it('keeps a refusal as an answer with its reason', async () => {
    const { fetcher } = capture({ status: 'REFUSE', explanation: '我看不出年份，請寫明日期' });
    const result = await suggestPatches({ text: '改日期', preview: table, columns, rows: [2], fetcher, today: '2026-10-24' });
    expect(result).toMatchObject({ status: 'REFUSE', explanation: '我看不出年份，請寫明日期', patches: [] });
  });

  it('does not send more than one request can carry, and says so', async () => {
    const many = preview({
      headers: ['大廈', '覆蓋結果'], columnCount: 2, totalRows: 601,
      rows: [['大廈', '覆蓋結果'], ...Array.from({ length: 600 }, () => ['裕安樓', ''])],
      rowNumbers: Array.from({ length: 601 }, (_, index) => index + 1),
    });
    const rows = Array.from({ length: 600 }, (_, index) => index + 2);
    const { bodies, fetcher } = capture({ ...answer, patches: [{ row: 2, column: 1, field: null, value: '已嘗試接觸', reason: 'x' }] });
    const result = await suggestPatches({ text: '全部標為已嘗試接觸', preview: many, columns: { buildingName: 0, coverage: 1 }, rows, fetcher });
    expect(bodies[0].rows).toHaveLength(PATCH_ROW_LIMIT);
    expect(bodies[0].omitted).toBe(600 - PATCH_ROW_LIMIT);
    expect(result.warnings.join('')).toContain('前 500 行');
  });
});
