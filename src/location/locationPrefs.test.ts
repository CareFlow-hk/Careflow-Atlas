import { describe, expect, it, vi } from 'vitest';
import { deviceLocationPrefsKey, readDeviceLocationPrefs, writeDeviceLocationPrefs } from './locationPrefs';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    asStorage() { return this as unknown as Storage; },
  };
};

describe('per-account browser location preferences', () => {
  it('starts without consent or enablement and never stores a coordinate', () => {
    const storage = memoryStorage();
    expect(readDeviceLocationPrefs('user-1', storage.asStorage())).toEqual({ prefs: { version: 1, prompted: false, enabled: false }, persistent: true });
    expect(writeDeviceLocationPrefs('user-1', { version: 1, prompted: true, enabled: true }, storage.asStorage())).toBe(true);
    expect(readDeviceLocationPrefs('user-1', storage.asStorage()).prefs).toEqual({ version: 1, prompted: true, enabled: true });
    expect(storage.values.get(deviceLocationPrefsKey('user-1'))).toBe('{"version":1,"prompted":true,"enabled":true}');
  });

  it('keeps two accounts in the same browser independent', () => {
    const storage = memoryStorage();
    writeDeviceLocationPrefs('user-1', { version: 1, prompted: true, enabled: true }, storage.asStorage());
    writeDeviceLocationPrefs('user-2', { version: 1, prompted: true, enabled: false }, storage.asStorage());
    expect(readDeviceLocationPrefs('user-1', storage.asStorage()).prefs.enabled).toBe(true);
    expect(readDeviceLocationPrefs('user-2', storage.asStorage()).prefs.enabled).toBe(false);
  });

  it('fails closed for malformed or unknown stored values', () => {
    for (const raw of ['not json', 'null', '{"version":2,"prompted":true,"enabled":true}', '{"version":1,"prompted":true,"enabled":"yes"}']) {
      const storage = memoryStorage();
      storage.values.set(deviceLocationPrefsKey('user-1'), raw);
      expect(readDeviceLocationPrefs('user-1', storage.asStorage())).toEqual({ prefs: { version: 1, prompted: false, enabled: false }, persistent: true });
    }
  });

  it('distinguishes unavailable storage from a valid decline', () => {
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => { throw new Error('blocked'); });
    expect(readDeviceLocationPrefs('user-1', storage.asStorage())).toEqual({ prefs: { version: 1, prompted: false, enabled: false }, persistent: false });
    expect(readDeviceLocationPrefs('user-1').persistent).toBe(false);
  });

  it('reports a failed write without claiming that the preference persisted', () => {
    const storage = memoryStorage();
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    expect(writeDeviceLocationPrefs('user-1', { version: 1, prompted: true, enabled: true }, storage.asStorage())).toBe(false);
  });
});
