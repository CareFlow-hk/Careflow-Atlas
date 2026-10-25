import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiService, readAiRequest, AI_CHUNK_ROWS, AI_MAX_CONCURRENT, AI_PATCH_ROWS } from './aiProxy.mjs';
import { assertAiAssist } from './aiAssist.mjs';

/*
 * The proxy never talks to Azure in a test: every case passes its own `fetchImpl`, so these
 * run offline and the sentinel below is a placeholder that must never be a real key
 * (`docs/AI_ASSISTANT.md` 11, decision 21). CI must not spend quota, and no key may appear
 * in a test file, a log or a fixture.
 */
const settings = {
  endpoint: 'https://resource.example.test/openai/v1',
  model: 'primary-deployment',
  fallbackModel: 'fallback-deployment',
  key: 'placeholder-not-a-key',
  configured: true,
};
const user = { id: 'user-1', org_id: 'org-1' };
const answer = (value = { status: 'MATCH' }, extra = {}) => new Response(JSON.stringify({
  id: 'resp_test_1', status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 11, output_tokens: 7 }, ...extra,
}));

function mappingBody(overrides = {}) {
  return {
    kind: 'mapping',
    sheetName: 'Sheet1',
    part: { index: 1, count: 2 },
    headerRow: 0,
    columnCount: 3,
    withheldColumns: [2],
    profileIds: ['generic'],
    fields: [{ key: 'buildingName', label: '大廈' }],
    rows: [['大廈', '日期', '電話'], ['裕安樓', '2026-10-09', '']],
    context: '在裕安樓',
    ...overrides,
  };
}
const draftBody = (overrides = {}) => ({
  kind: 'draft',
  text: '今日去咗裕安樓 5 樓 B 室，冇人應門。',
  today: '2026-10-25',
  buildings: [{ id: 'b1', name: '裕安樓' }],
  locations: [{ buildingId: 'b1', floorLabel: '5樓', unitLabel: 'B室' }],
  coverage: [{ key: 'ATTEMPTED', label: '嘗試接觸' }],
  contacts: [{ key: 'NO_ANSWER', label: '無人應門' }],
  assessments: [{ key: 'UNKNOWN', label: '未知' }],
  categories: [{ key: 'GENERAL', label: '一般' }],
  ...overrides,
});
const patchBody = (overrides = {}) => ({
  kind: 'patch',
  text: '把第 2 行覆蓋結果改為已探訪',
  today: '2026-10-25',
  sheetName: 'Sheet1',
  columns: [{ columnIndex: 0, header: '大廈', field: 'buildingName', label: '大廈' }],
  rows: [{ row: 2, values: ['裕安樓'] }],
  omitted: 0,
  coverage: [{ key: 'VISITED_NO_FINDING', label: '已探訪' }],
  contacts: [{ key: 'UNKNOWN', label: '未知' }],
  assessments: [{ key: 'UNKNOWN', label: '未知' }],
  categories: [{ key: 'GENERAL', label: '一般' }],
  ...overrides,
});

test('the status names the deployment but never any part of the key', () => {
  const service = createAiService({ settings });
  const status = service.status();
  assert.deepEqual(status, { provider: 'azure-openai', configured: true, model: 'primary-deployment', fallbackModel: 'fallback-deployment' });
  assert.equal(JSON.stringify(status).includes(settings.key), false);
  assert.equal(Object.keys(status).some(key => /key|secret/i.test(key)), false);
});

test('an unconfigured server refuses with 503 without calling Azure', async () => {
  let called = false;
  const service = createAiService({ settings: { ...settings, configured: false }, fetchImpl: () => { called = true; } });
  await assert.rejects(service.assist(mappingBody(), user), error => error.status === 503);
  assert.equal(called, false);
});

test('a caller cannot set the model, store, endpoint, prompt or timeout', () => {
  for (const field of ['model', 'store', 'endpoint', 'system', 'schema', 'timeout', 'retry', 'provider', 'apiKey']) {
    assert.throws(() => readAiRequest({ ...mappingBody(), [field]: 'x' }), error => error.status === 400, field);
  }
  // An institution id in the body is not how the server picks the institution: it is
  // ignored, and the session's org is used (doc 3).
  assert.equal(readAiRequest({ ...mappingBody(), orgId: 'another-org' }).kind, 'mapping');
});

test('a mapping request may carry the sheet header row it read', () => {
  // `headers` here is the worksheet's own column headers, not the outbound HTTP headers:
  // the page sends it with the part that holds the header row. Refusing it made every
  // sheet with a detected header fail before the model was ever asked (2026-10-25).
  const headers = ['大廈', '日期', '電話'];
  const request = readAiRequest(mappingBody({ headers }));
  assert.deepEqual(request.request.headers, headers);
  assert.equal(request.kind, 'mapping');
});

test('the request carries the server prompt, the configured deployment and store:false', async () => {
  let seen;
  const service = createAiService({ settings, fetchImpl: async (url, options) => {
    seen = { url, headers: options.headers, body: JSON.parse(options.body) };
    return answer();
  } });
  const result = await service.assist(mappingBody(), user);
  assert.equal(seen.url, `${settings.endpoint}/responses`);
  assert.equal(seen.headers['api-key'], settings.key);
  assert.equal(seen.body.model, 'primary-deployment');
  assert.equal(seen.body.store, false);
  assert.match(seen.body.instructions, /欄位對應助手/);
  const text = seen.body.input[0].content[0].text;
  assert.match(text, /<sheet_data>/);
  assert.match(text, /裕安樓/);
  // The prompt is the server's own constant, not whatever the caller typed.
  assert.equal(result.proposal.status, 'MATCH');
  assert.equal(result.aiAssist.requestId, 'resp_test_1');
  assert.equal(result.aiAssist.provider, 'azure-openai');
  assert.equal(result.aiAssist.model, 'primary-deployment');
  assert.equal(result.rows, 2);
  assert.equal(result.chunks, 2);
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 });
  assert.equal(result.fallback, null);
});

test('rate limits and server errors retry once, and the marker names the model that answered', async () => {
  const models = [];
  const service = createAiService({ settings, fetchImpl: async (_url, options) => {
    const { model } = JSON.parse(options.body);
    models.push(model);
    return model === settings.model ? new Response('busy', { status: 429 }) : answer();
  } });
  const result = await service.assist(mappingBody(), user);
  assert.deepEqual(models, ['primary-deployment', 'fallback-deployment']);
  assert.equal(result.aiAssist.model, 'fallback-deployment');
  assert.deepEqual(result.fallback, { primaryModel: 'primary-deployment', model: 'fallback-deployment', reason: 'HTTP 429' });
});

test('a rejected key and a content refusal are never retried', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const service = createAiService({ settings, fetchImpl: async () => { calls++; return new Response('no', { status }); } });
    await assert.rejects(service.assist(mappingBody(), user), error => error.status === 502 && /金鑰被拒/.test(error.message));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const filtered = createAiService({ settings, fetchImpl: async () => { calls++; return answer({}, { incomplete_details: { reason: 'content_filter' } }); } });
  await assert.rejects(filtered.assist(mappingBody(), user), error => error.status === 422);
  assert.equal(calls, 1);
});

test('a timeout is a 504 and a broken answer is never half-used', async () => {
  const slow = createAiService({ settings, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
  }), timeoutMs: 10 });
  await assert.rejects(slow.assist(mappingBody(), user), error => error.status === 504);

  const broken = createAiService({ settings: { ...settings, fallbackModel: '' }, fetchImpl: async () => new Response(JSON.stringify({
    id: 'r', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }],
  })) });
  await assert.rejects(broken.assist(mappingBody(), user), error => error.status === 502);
});

test('the request is bounded before anything is sent', () => {
  assert.throws(() => readAiRequest(mappingBody({ rows: new Array(AI_CHUNK_ROWS + 1).fill(['a', 'b', 'c']) })), error => error.status === 400);
  assert.throws(() => readAiRequest(mappingBody({ rows: [['a', 'b']] })), error => error.status === 400);
  assert.throws(() => readAiRequest(mappingBody({ columnCount: 200 })), error => error.status === 400);
  assert.throws(() => readAiRequest(mappingBody({ withheldColumns: [9] })), error => error.status === 400);
  assert.throws(() => readAiRequest(mappingBody({ rows: new Array(AI_CHUNK_ROWS).fill(['x'.repeat(4000), 'b', 'c']) })), error => error.status === 413);
  assert.throws(() => readAiRequest(draftBody({ text: 'x'.repeat(8001) })), error => error.status === 400);
  assert.throws(() => readAiRequest(patchBody({ rows: new Array(AI_PATCH_ROWS + 1).fill({ row: 1, values: ['a'] }) })), error => error.status === 400);
  assert.throws(() => readAiRequest({ kind: 'anything' }), error => error.status === 400);
  assert.throws(() => readAiRequest({ kind: 'mapping' }), error => error.status === 400);
});

test('one institution cannot run more requests at once than the cap allows', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const service = createAiService({ settings, fetchImpl: async () => { await blocked; return answer(); } });
  const running = Array.from({ length: AI_MAX_CONCURRENT }, () => service.assist(mappingBody(), user));
  await assert.rejects(service.assist(mappingBody(), user), error => error.status === 429);
  // Another institution is unaffected: the cap is per institution, not site-wide.
  const otherRunning = [service.assist(mappingBody(), { ...user, org_id: 'org-2' })];
  release();
  await Promise.all([...running, ...otherRunning]);
});

test('draft and patch are built by the server from their own prompts', async () => {
  const prompts = [];
  const service = createAiService({ settings, fetchImpl: async (_url, options) => {
    prompts.push(JSON.parse(options.body).instructions);
    return answer({ status: 'DRAFT' });
  } });
  await service.assist(draftBody(), user);
  await service.assist(patchBody(), user);
  assert.match(prompts[0], /到訪記錄草稿助手/);
  assert.match(prompts[1], /表格修改助手/);
});

test('an answer without an id still gets one the server can vouch for', async () => {
  const service = createAiService({ settings, fetchImpl: async () => new Response(JSON.stringify({
    status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"status":"REFUSE"}' }] }],
  })) });
  const result = await service.assist(mappingBody(), user);
  assert.match(result.aiAssist.requestId, /^[0-9a-f-]{36}$/);
});

test('the record marker accepts the proxy’s own output and keeps historical providers saving', () => {
  assert.doesNotThrow(() => assertAiAssist({ aiAssist: { at: '2026-10-25T08:00:00.000Z', provider: 'azure-openai', model: 'primary-deployment', requestId: 'resp_test_1' } }));
  // Phase 1–4 markers ride along in every whole-snapshot save; dropping one would make the
  // institution's workspace unsavable forever (doc 5.3).
  for (const provider of ['deepseek', 'openai', 'anthropic']) {
    assert.doesNotThrow(() => assertAiAssist({ aiAssist: { at: '2026-10-01T00:00:00.000Z', provider, model: 'old-model' } }));
  }
  assert.throws(() => assertAiAssist({ aiAssist: { at: '2026-10-25T08:00:00.000Z', provider: 'made-up', model: 'm' } }), error => error.status === 400);
  assert.throws(() => assertAiAssist({ aiAssist: { at: '2026-10-25T08:00:00.000Z', provider: 'azure-openai', model: 'm', requestId: 'bad id with spaces' } }), error => error.status === 400);
  assert.throws(() => assertAiAssist({ aiAssist: { at: 'not a date', provider: 'azure-openai', model: 'm' } }), error => error.status === 400);
});
