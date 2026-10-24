import { describe, expect, it } from 'vitest';
import type { OutboundPreview } from './preview';
import { suggestFileMapping } from './suggest';

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
