import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoService, extractionSchema, fallbackReason, photoSettings, validateExtraction, validateImage } from './photos.mjs';

const image = `data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10,...new Array(20).fill(0)]).toString('base64')}`;
const settings = { endpoint: 'https://CareFlow-VPS.services.ai.azure.com/openai/v1', model: 'gpt-6-luna', key: 'unit-test-secret', configured: true };
const output = value => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
const row = Object.fromEntries(Object.entries(extractionSchema.properties.rows.items.properties).map(([key, schema]) => [key, schema.type === 'array' ? [] : schema.type === 'number' ? 0.8 : schema.type === 'string' ? '' : null]));
const record = (rows = [row], warnings = []) => ({ rows, warnings, documentStatus: rows.length ? 'RECORDS' : 'EMPTY' });
const fallbackSettings = { ...settings, fallbackModel: 'gpt-6.1-sol' };
const poorRow = { ...row, confidence: 0.5, uncertainFields: ['building', 'followUp'], uncertainties: ['大廈與跟進字跡不清'] };

test('configuration never exposes keys and preserves the requested deployment', async () => {
  assert.equal(photoSettings({}).configured, false);
  assert.equal(photoSettings({ AZURE_OPENAI_API_KEY: 'key' }).model, 'gpt-6-luna');
  assert.equal(photoSettings({}).fallbackModel, 'gpt-6.1-sol');
  assert.equal(photoSettings({ AZURE_OPENAI_FALLBACK_DEPLOYMENT: '' }).fallbackModel, '');
  assert.equal(photoSettings({ AZURE_OPENAI_API_KEY: 'key', AZURE_OPENAI_ENDPOINT: 'http://unsafe.test/openai/v1' }).configured, false);
  const service = createPhotoService({ settings });
  assert.equal(JSON.stringify(service.status()).includes(settings.key), false);
  const missing = createPhotoService({ settings: { ...settings, configured: false }, fetchImpl: () => { throw new Error('must not call'); } });
  await assert.rejects(missing.recognize({ image }, 'a'), e => e.status === 503);
});
test('rejects unsupported types, fake magic, malformed base64 and oversized input', () => {
  assert.equal(validateImage({ image }), image);
  for (const value of ['https://example.test/image.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA', `data:image/jpeg;base64,${'A'.repeat(6 * 1024 * 1024)}`]) assert.throws(() => validateImage({ image: value }));
});
test('sends image input with strict structured output, store false and the exact Azure model', async () => {
  const result = record();
  const service = createPhotoService({ settings, fetchImpl: async (url, options) => {
    assert.equal(url, `${settings.endpoint}/responses`);
    assert.equal(options.headers['api-key'], settings.key);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.store, false);
    assert.equal(body.input[0].content[1].image_url, image);
    assert.equal(body.input[0].content[1].detail, 'original');
    assert.equal(body.text.format.strict, true);
    return output(result);
  } });
  assert.deepEqual(await service.recognize({ image }, 'a'), { ...result, model: 'gpt-6-luna' });
  assert.equal(validateExtraction({ ...result, injected: 'ignored instructions' }), false);
  assert.equal(validateExtraction(record([{ ...row, coverage: 'MADE_UP' }])), false);
});
test('provider failures, malformed results, refusal and incomplete output cannot become success', async () => {
  for (const response of [
    new Response('secret-provider-detail', { status: 401 }),
    new Response('not json'), output(record([{ ...row, confidence: 999 }])),
    new Response(JSON.stringify({ status: 'incomplete', output: [] })),
    new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'detail' }] }] })),
  ]) {
    const service = createPhotoService({ settings, fetchImpl: async () => response });
    await assert.rejects(service.recognize({ image }, 'a'), e => e.status >= 400 && !e.message.includes('secret-provider-detail'));
  }
});
test('abort, rate limiting and concurrent requests are bounded without automatic paid retries', async () => {
  let release; let calls = 0;
  const service = createPhotoService({ settings, fetchImpl: async () => { calls++; await new Promise(resolve => { release = resolve; }); return output(record([], ['沒有記錄'])); } });
  const pending = service.recognize({ image }, 'a');
  await assert.rejects(service.recognize({ image }, 'a'), e => e.status === 429);
  release(); await pending; assert.equal(calls, 1);
  const timeout = createPhotoService({ settings, fetchImpl: async () => { throw new DOMException('secret', 'TimeoutError'); } });
  await assert.rejects(timeout.recognize({ image }, 'a'), e => e.status === 504 && !e.message.includes('secret'));
});

test('quality gate requires low confidence AND multiple critical fields on at least 60% of rows', () => {
  assert.equal(fallbackReason(record([poorRow])), 'LOW_LEGIBILITY');
  for (const fields of [[], ['building'], ['building', 'building'], ['date', 'worker'], ['building', 'date', 'worker']]) {
    assert.equal(fallbackReason(record([{ ...poorRow, uncertainFields: fields }])), null);
  }
  assert.equal(fallbackReason(record([{ ...poorRow, confidence: 0.7 }])), null);
  assert.equal(fallbackReason(record([{ ...poorRow, confidence: 0.699 }])), 'LOW_LEGIBILITY');
  assert.equal(fallbackReason(record([poorRow, row])), null);
  assert.equal(fallbackReason(record([poorRow, poorRow, poorRow, row, row])), 'LOW_LEGIBILITY');
  assert.equal(fallbackReason(record([poorRow, poorRow, row, row, row])), null);
  assert.equal(fallbackReason(record([{ ...row, date: null, worker: null }], ['缺年份', '缺工作員', '有一處塗改'])), null);
  assert.equal(fallbackReason({ ...record([]), documentStatus: 'UNREADABLE' }), 'UNREADABLE');
  for (const documentStatus of ['EMPTY', 'NOT_OUTREACH', 'TOO_MANY_ROWS']) assert.equal(fallbackReason({ ...record([]), documentStatus }), null);
});

test('Sol reads the same image independently once, with truthful result and fallback provenance', async () => {
  const calls = [];
  const service = createPhotoService({ settings: fallbackSettings, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return output(calls.length === 1 ? record([poorRow]) : record([{ ...row, building: '德昌樓' }]));
  } });
  const result = await service.recognize({ image }, 'a');
  assert.deepEqual(calls.map(c => c.model), ['gpt-6-luna', 'gpt-6.1-sol']);
  assert.deepEqual(calls[1], { ...calls[0], model: 'gpt-6.1-sol' });
  assert.equal(result.rows[0].building, '德昌樓');
  assert.equal(result.model, 'gpt-6.1-sol');
  assert.deepEqual(result.fallback, { primaryModel: 'gpt-6-luna', model: 'gpt-6.1-sol', reason: 'LOW_LEGIBILITY', outcome: 'used' });
});

test('clear, blank and non-outreach pages, disabled or identical deployments never pay for fallback', async () => {
  for (const [config, extraction] of [
    [fallbackSettings, record()], [fallbackSettings, record([])],
    [fallbackSettings, { ...record([]), documentStatus: 'NOT_OUTREACH' }],
    [{ ...fallbackSettings, fallbackModel: '' }, record([poorRow])],
    [{ ...fallbackSettings, fallbackModel: settings.model }, record([poorRow])],
  ]) {
    let calls = 0;
    const service = createPhotoService({ settings: config, fetchImpl: async () => { calls++; return output(extraction); } });
    const result = await service.recognize({ image }, 'a');
    assert.equal(calls, 1); assert.equal(result.model, 'gpt-6-luna'); assert.equal(result.fallback, undefined);
  }
});

test('unreadable and invalid structured output can fall back, but there is never a third attempt', async () => {
  for (const first of [
    () => output({ ...record([]), documentStatus: 'UNREADABLE' }),
    () => new Response('not json'), () => output(record([{ ...row, confidence: 2 }])),
    () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] })),
  ]) {
    let calls = 0;
    const service = createPhotoService({ settings: fallbackSettings, fetchImpl: async () => ++calls === 1 ? first() : output(record([poorRow])) });
    const result = await service.recognize({ image }, 'a');
    assert.equal(calls, 2); assert.equal(result.model, 'gpt-6.1-sol');
  }
});

test('authentication, quota, transport, timeout and safety failures never initiate fallback', async () => {
  for (const first of [
    ...[400, 401, 403, 404, 429, 500].map(status => () => new Response('secret-provider-detail', { status })),
    () => { throw new TypeError('network secret'); },
    () => { throw new DOMException('secret', 'TimeoutError'); },
    () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'secret' }] }] })),
    () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] })),
  ]) {
    let calls = 0;
    const service = createPhotoService({ settings: fallbackSettings, fetchImpl: async () => { calls++; return first(); } });
    await assert.rejects(service.recognize({ image }, 'a'), e => e.status >= 400 && !e.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('failed or shorter fallback preserves usable primary rows without claiming Sol produced them', async () => {
  for (const [second, outcome] of [
    [() => new Response('secret-provider-detail', { status: 404 }), 'failed'],
    [() => new Response('not json'), 'failed'],
    [() => { throw new DOMException('secret', 'TimeoutError'); }, 'failed'],
    [() => output(record([])), 'kept_primary'],
  ]) {
    let calls = 0;
    const service = createPhotoService({ settings: fallbackSettings, fetchImpl: async () => ++calls === 1 ? output(record([poorRow])) : second() });
    const result = await service.recognize({ image }, 'a');
    assert.equal(calls, 2); assert.equal(result.model, 'gpt-6-luna');
    assert.deepEqual(result.rows, [poorRow]); assert.equal(result.fallback.outcome, outcome);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  let calls = 0;
  const bothInvalid = createPhotoService({ settings: fallbackSettings, fetchImpl: async () => { calls++; return new Response('not json'); } });
  await assert.rejects(bothInvalid.recognize({ image }, 'a'), e => e.status === 502);
  assert.equal(calls, 2);
});

test('cancellation reaches either attempt and the account stays locked until fallback finishes', async () => {
  for (const stopAt of [1, 2]) {
    const abort = new AbortController(); let calls = 0; let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const service = createPhotoService({ settings: fallbackSettings, fetchImpl: async (_, options) => {
      calls++;
      if (calls < stopAt) return output(record([poorRow]));
      entered();
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    } });
    const pending = service.recognize({ image }, 'a', abort.signal);
    await started;
    await assert.rejects(service.recognize({ image }, 'a'), e => e.status === 429);
    abort.abort();
    await assert.rejects(pending, e => e.status === 504);
    assert.equal(calls, stopAt);
    await assert.rejects(service.recognize({ image }, 'a', abort.signal), e => e.status === 504);
    assert.equal(calls, stopAt);
  }
});

test('a fallback refusal remains a refusal even when primary rows exist', async () => {
  let calls = 0;
  const service = createPhotoService({ settings: fallbackSettings, fetchImpl: async () => ++calls === 1 ? output(record([poorRow])) :
    new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'secret' }] }] })) });
  await assert.rejects(service.recognize({ image }, 'a'), e => e.status === 422);
  assert.equal(calls, 2);
});
