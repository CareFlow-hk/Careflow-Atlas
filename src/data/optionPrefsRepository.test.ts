import { describe, expect, it } from 'vitest';
import { addCustomOption } from '../domain/optionPrefs';
import { OptionPrefsRepository } from './optionPrefsRepository';
import { OutreachRepository, PersistenceError, type PersistenceAdapter } from './repository';

/** A storage that fails on demand, so the fallbacks can be exercised. */
class MemoryAdapter implements PersistenceAdapter {
  readonly items = new Map<string, string>();
  constructor(private readonly broken = false) {}
  read(key: string): string | null { if (this.broken) throw new PersistenceError('boom'); return this.items.get(key) ?? null; }
  write(key: string, value: string): void { if (this.broken) throw new PersistenceError('boom'); this.items.set(key, value); }
}

describe('self-defined options are stored per account', () => {
  it('keeps one account’s shortcuts out of another’s', () => {
    const adapter = new MemoryAdapter();
    const first = new OptionPrefsRepository(adapter, 'careflow-atlas.account.a.options');
    const second = new OptionPrefsRepository(adapter, 'careflow-atlas.account.b.options');
    first.save(addCustomOption({}, 'coverage', { label: '只走到樓梯口', mapsTo: 'ATTEMPTED' }));
    expect(first.get().coverage).toHaveLength(1);
    expect(second.get()).toEqual({});
  });

  it('does not disturb the snapshot beside it', () => {
    const adapter = new MemoryAdapter();
    const prefs = new OptionPrefsRepository(adapter, 'careflow-atlas.account.a.options');
    const snapshot = new OutreachRepository(adapter, 'careflow-atlas.account.a.demo');
    prefs.save(addCustomOption({}, 'coverage', { label: '甲', mapsTo: 'ATTEMPTED' }));
    expect(snapshot.getSnapshot()).toBeUndefined();
    expect(adapter.items.has('careflow-atlas.account.a.demo')).toBe(false);
  });

  it('writes back only what it could read again', () => {
    const adapter = new MemoryAdapter();
    const prefs = new OptionPrefsRepository(adapter);
    // A mapping that names no state never reaches storage.
    expect(prefs.save({ coverage: [{ id: 'x', label: '壞', mapsTo: 'SUSPECTED' }] })).toEqual({});
    expect(adapter.items.get('careflow-field-outreach.options')).toBe('{}');
  });

  it('falls back to the built-in menu rather than blocking entry when storage misbehaves', () => {
    // Losing a shortcut must never cost someone their observation.
    const prefs = new OptionPrefsRepository(new MemoryAdapter(true));
    expect(prefs.get()).toEqual({});
    expect(() => prefs.save({})).toThrow(PersistenceError);
  });

  it('returns an empty menu for a corrupted value instead of throwing', () => {
    const adapter = new MemoryAdapter();
    adapter.items.set('careflow-field-outreach.options', '{not json');
    expect(new OptionPrefsRepository(adapter).get()).toEqual({});
  });
});
