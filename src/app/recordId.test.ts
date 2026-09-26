import { afterEach, expect, it, vi } from 'vitest';
import { createRecordId } from './recordId';

afterEach(() => vi.unstubAllGlobals());
it('creates distinct version-4 identifiers when randomUUID is unavailable on HTTP', () => {
  const crypto = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const values = Array.from({ length: 100 }, () => createRecordId());
  for (const value of values) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(values).size).toBe(values.length);
});
