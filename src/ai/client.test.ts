import { describe, expect, it } from 'vitest';
import { AiRequestError, callProvider } from './client';
import { providerSpec } from './providers';
import { mappingPrompt } from './scope';

const spec = providerSpec('deepseek')!;
const prompt = mappingPrompt({ sheetName: '工作表1', headerRow: null, rows: [['姓名']], columnCount: 1, profileIds: [], fields: [], part: { index: 1, count: 1 }, withheldColumns: [] });

const envelope = (content: string) => ({ choices: [{ message: { content } }] });
const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

const call = (fetcher: typeof fetch, timeoutMs?: number) =>
  callProvider(spec, { model: 'deepseek-chat', key: 'sk-test', prompt, fetcher, timeoutMs });

describe('talking to the provider from the browser', () => {
  it('returns the parsed JSON object on success', async () => {
    const value = await call(respond(200, envelope('{"status":"REFUSE"}')));
    expect(value).toEqual({ status: 'REFUSE' });
  });

  it('tells a rejected key apart from a quota limit, a server error and a blocked browser call', async () => {
    await expect(call(respond(401, {}))).rejects.toMatchObject({ kind: 'auth' });
    await expect(call(respond(403, {}))).rejects.toMatchObject({ kind: 'auth' });
    await expect(call(respond(429, {}))).rejects.toMatchObject({ kind: 'quota' });
    await expect(call(respond(402, {}))).rejects.toMatchObject({ kind: 'quota' });
    await expect(call(respond(500, {}))).rejects.toMatchObject({ kind: 'http' });
  });

  it('names the network as the suspect when the request never leaves', async () => {
    const refusal: typeof fetch = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(call(refusal)).rejects.toMatchObject({ kind: 'network' });
  });

  it('gives up after the timeout instead of waiting forever', async () => {
    const never = ((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    await expect(call(never, 10)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('rejects a reply that is not JSON instead of reading it as prose', async () => {
    await expect(call(respond(200, envelope('OK')))).rejects.toMatchObject({ kind: 'schema' });
    await expect(call(respond(200, envelope('')))).rejects.toMatchObject({ kind: 'schema' });
    await expect(call(respond(200, envelope('[1,2,3]')))).rejects.toMatchObject({ kind: 'schema' });
  });

  it('never puts the key in an error message', async () => {
    const failure = await call(respond(401, {})).catch((error: AiRequestError) => error);
    expect(failure).toBeInstanceOf(AiRequestError);
    expect((failure as Error).message).not.toContain('sk-test');
  });
});
