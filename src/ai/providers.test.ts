import { describe, expect, it } from 'vitest';
import { blockedProviders, callableProviders, providerSpec, PROVIDER_SPECS } from './providers';

describe('AI provider whitelist', () => {
  it('offers only providers that have both a fixed endpoint and a measured call path', () => {
    const callable = callableProviders();
    expect(callable.map(spec => spec.id)).toEqual(['deepseek']);
    for (const spec of callable) {
      expect(spec.endpoint, spec.id).toMatch(/^https:\/\//);
      expect(spec.headers && spec.body && spec.reply, spec.id).toBeTruthy();
    }
  });

  it('keeps every blocked provider with the reason it is blocked, not silently missing', () => {
    expect(blockedProviders().map(spec => spec.id)).toEqual(['azure-openai', 'openai', 'anthropic']);
    for (const spec of PROVIDER_SPECS) {
      expect(spec.cors.length, spec.id).toBeGreaterThan(10);
      if (!spec.browserDirect) expect(spec.endpoint, spec.id).toBeUndefined();
    }
  });

  it('does not accept a provider it does not know', () => {
    expect(providerSpec('gemini')).toBeUndefined();
    expect(providerSpec('')).toBeUndefined();
  });

  it('pins the DeepSeek request shape, which is what the provider actually receives', () => {
    const spec = providerSpec('deepseek')!;
    expect(spec.headers?.('sk-test')).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' });
    expect(spec.body?.({ model: 'deepseek-chat', system: 'SYS', user: 'USER' })).toEqual({
      model: 'deepseek-chat', temperature: 0, stream: false, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }],
    });
  });

  it('reads the assistant text out of the provider envelope, and nothing else', () => {
    const spec = providerSpec('deepseek')!;
    expect(spec.reply?.({ choices: [{ message: { content: '{"status":"REFUSE"}' } }] })).toBe('{"status":"REFUSE"}');
    expect(spec.reply?.({ choices: [] })).toBe('');
    expect(spec.reply?.({})).toBe('');
  });
});
