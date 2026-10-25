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
const credential = { provider: 'deepseek' as const, model: 'deepseek-chat', key: 'sk-test' };

const suggestion = {
  status: 'MATCH', sheetName: '探訪記錄', headerRow: 0,
  fields: [{ key: 'personName', columnIndex: 0, confidence: 0.8, reason: '表頭寫「姓名」' }],
  unmappedColumns: [{ columnIndex: 1, header: '人數', reason: '不是既有欄位' }],
  warnings: [],
};

type Body = { messages: { content: string }[] };
type Captured = { seen: { url?: string; init?: RequestInit }; bodies: Body[]; fetcher: typeof fetch };

function capture(reply: unknown | ((body: Body) => unknown)): Captured {
  const bodies: Body[] = [];
  const seen: { url?: string; init?: RequestInit } = {};
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const answer = typeof reply === 'function' ? reply(body) : reply;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { seen, bodies, fetcher };
}

describe('asking for a column mapping', () => {
  it('posts one JSON-mode request to the fixed endpoint, carrying the key only in the header', async () => {
    const { seen, fetcher } = capture(suggestion);
    const result = await suggestFileMapping({ preview: preview(), credential, fetcher });
    expect(result.suggestion.status).toBe('MATCH');
    expect(result.parts).toBe(1);
    expect(seen.url).toBe('https://api.deepseek.com/chat/completions');
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(seen.init?.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('與此無關的問題');
    expect(body.messages[1].content).toContain('陳大文');
    expect(String(seen.init?.body)).not.toContain('sk-test');
  });

  it('returns a refusal as a normal answer, not an error', async () => {
    const { fetcher } = capture({ status: 'REFUSE' });
    await expect(suggestFileMapping({ preview: preview(), credential, fetcher })).resolves.toMatchObject({ suggestion: { status: 'REFUSE', fields: [] } });
  });

  it('throws away a reply the rule detector would disagree with', async () => {
    const { fetcher } = capture({ ...suggestion, headerRow: 1 });
    await expect(suggestFileMapping({ preview: preview(), credential, fetcher })).rejects.toMatchObject({ kind: 'schema' });
  });

  it('throws away a reply with an invented field rather than keeping the rest', async () => {
    const { fetcher } = capture({ ...suggestion, fields: [{ key: 'householdSize', columnIndex: 0, confidence: 1, reason: '猜' }] });
    await expect(suggestFileMapping({ preview: preview(), credential, fetcher })).rejects.toMatchObject({ kind: 'schema' });
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
    const { bodies, fetcher } = capture((body: Body) => {
      const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf('{'), body.messages[1].content.lastIndexOf('}') + 1));
      return payload.part.index === 1 ? suggestion : { ...suggestion, headerRow: undefined };
    });
    const result = await suggestFileMapping({ preview: sheet, credential, fetcher });
    expect(result.parts).toBe(3);
    expect(bodies).toHaveLength(3);
    const sent = bodies.map(body => {
      const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf('{'), body.messages[1].content.lastIndexOf('}') + 1));
      return payload.rows.length as number;
    });
    expect(sent.reduce((total, count) => total + count, 0)).toBe(701);
  });

  it('refuses the whole answer when a later part moves a field to another column', async () => {
    const sheet = many(701);
    let call = 0;
    const { fetcher } = capture(() => (++call === 1 ? suggestion : { ...suggestion, headerRow: undefined, fields: [{ key: 'personName', columnIndex: 1, confidence: 0.6, reason: '看起來像' }] }));
    await expect(suggestFileMapping({ preview: sheet, credential, fetcher })).rejects.toThrow(/第 2\/3 段/);
  });

  it('stops after the first part when the header part is not outreach work', async () => {
    const sheet = many(701);
    const { bodies, fetcher } = capture({ status: 'REFUSE' });
    const result = await suggestFileMapping({ preview: sheet, credential, fetcher });
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
    const result = await suggestFileMapping({ preview: sheet, credential, fetcher });
    expect(result.suggestion.fields).toHaveLength(1);
    expect(result.suggestion.warnings.join(' ')).toContain('沿用第 1 段');
  });
});

describe('columns the person withheld', () => {
  it('never puts a withheld cell in the request', async () => {
    const { bodies, fetcher } = capture({ status: 'MATCH', headerRow: 0, fields: [{ key: 'note', columnIndex: 1, confidence: 0.5, reason: '第二欄' }], unmappedColumns: [], warnings: [] });
    await suggestFileMapping({ preview: preview(), credential, fetcher, withheld: [0] });
    const content = bodies[0].messages[1].content;
    expect(content).not.toContain('陳大文');
    const payload = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    expect(payload.rows[0][0]).toBe('');
    expect(payload.rows[1][0]).toBe('');
    expect(payload.withheldColumns).toEqual([0]);
  });

  it('discards an answer that maps a field onto a withheld column', async () => {
    const { fetcher } = capture(suggestion);
    await expect(suggestFileMapping({ preview: preview(), credential, fetcher, withheld: [0] })).rejects.toMatchObject({ kind: 'schema' });
  });
});

describe('a file and a note sent together', () => {
  it('carries the note into the mapping request as data', async () => {
    const { bodies, fetcher } = capture(suggestion);
    await suggestFileMapping({ preview: preview(), credential, fetcher, context: '大廈名稱在第 3 欄' });
    const content = bodies[0].messages[1].content;
    expect(content).toContain('<context_note>');
    expect(content).toContain('大廈名稱在第 3 欄');
  });

  it('anchors a relative day in the note to the day the caller supplies', async () => {
    const { bodies, fetcher } = capture({
      status: 'DRAFT', buildingId: 'bldg-yu-an', floorLabel: null, unitLabel: null,
      occurredDate: '2026-10-24', occurredTime: null, workerName: null, coverage: null,
      contactOutcome: 'NO_ANSWER', assessment: null, sourceType: null, note: null,
      followUp: null, missing: ['覆蓋結果'], warnings: [],
    });
    const value = await suggestDraft({ text: '今日去咗 3樓 A 室，冇人應門。', snapshot: demoSnapshot, credential, fetcher, today: '2026-10-24' });
    expect(value.occurredDate).toBe('2026-10-24');
    expect(bodies[0].messages[1].content).toContain('"today":"2026-10-24"');
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
    const { seen, fetcher } = capture(answer);
    const result = await suggestPatches({
      text: '第 2 行係已嘗試接觸', preview: table, columns, rows: [2], credential, fetcher, today: '2026-10-24', withheld: table.sensitiveColumns,
    });
    expect(result.status).toBe('PATCH');
    expect(result.patches).toEqual([{ row: 2, column: 2, field: null, value: '已嘗試接觸', reason: '你說第 2 行已嘗試接觸' }]);
    const body = String(seen.init?.body);
    expect(body).not.toContain('61234567');
    expect(body).not.toContain('電話');
    expect(body).toContain('第 2 行係已嘗試接觸');
    expect(body).toContain('裕安樓');
  });

  it('will not let the reply reach a withheld column even if the model tries', async () => {
    const { fetcher } = capture({ ...answer, patches: [{ row: 2, column: 3, field: null, value: '61234567', reason: 'x' }] });
    await expect(suggestPatches({ text: '改電話', preview: table, columns, rows: [2], credential, fetcher, withheld: table.sensitiveColumns })).rejects.toThrow(/身分|不能/);
  });

  it('keeps a refusal as an answer with its reason', async () => {
    const { fetcher } = capture({ status: 'REFUSE', explanation: '我看不出年份，請寫明日期' });
    const result = await suggestPatches({ text: '改日期', preview: table, columns, rows: [2], credential, fetcher, today: '2026-10-24' });
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
    const result = await suggestPatches({ text: '全部標為已嘗試接觸', preview: many, columns: { buildingName: 0, coverage: 1 }, rows, credential, fetcher });
    const payload = JSON.parse(bodies[0].messages[1].content.slice(bodies[0].messages[1].content.indexOf('{'), bodies[0].messages[1].content.lastIndexOf('}') + 1));
    expect(payload.rows).toHaveLength(PATCH_ROW_LIMIT);
    expect(payload.omittedRows).toBe(600 - PATCH_ROW_LIMIT);
    expect(result.warnings.join('')).toContain('前 500 行');
  });
});
