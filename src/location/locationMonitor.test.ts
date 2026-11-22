import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_POSITION_OPTIONS, DeviceLocationMonitor, type DeviceGeolocation, type DevicePosition, type DevicePositionError } from './locationMonitor';
import { readDeviceLocationPrefs, writeDeviceLocationPrefs } from './locationPrefs';
import { usableDeviceFix } from '../domain/deviceLocation';

const now = Date.UTC(2026, 10, 22, 8);
const position = (over: Partial<DevicePosition> = {}): DevicePosition => ({
  coords: { latitude: 22.2865, longitude: 114.14175, accuracy: 25 }, timestamp: now, ...over,
});

function harness() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as unknown as Storage;
  const current: Array<{ success: (value: DevicePosition) => void; error?: (value: DevicePositionError) => void }> = [];
  const watches: Array<{ success: (value: DevicePosition) => void; error?: (value: DevicePositionError) => void }> = [];
  const geo: DeviceGeolocation = {
    getCurrentPosition: vi.fn((success, error) => { current.push({ success, error }); }),
    watchPosition: vi.fn((success, error) => { watches.push({ success, error }); return watches.length; }),
    clearWatch: vi.fn(),
  };
  return { geo, storage, current, watches, monitor: new DeviceLocationMonitor('user-1', { geolocation: geo, storage, secure: true }) };
}

describe('DeviceLocationMonitor', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not call the browser for a decline, and remembers the choice', () => {
    const { monitor, geo, storage } = harness();
    monitor.setActive(true);
    monitor.decline();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(monitor.getSnapshot()).toMatchObject({ prompted: true, enabled: false, status: 'idle' });
    expect(readDeviceLocationPrefs('user-1', storage).prefs).toEqual({ version: 1, prompted: true, enabled: false });
  });

  it('requests high accuracy, starts one watch after a fix, and clears everything on disable', () => {
    const { monitor, geo, current, watches, storage } = harness();
    monitor.setActive(true);
    monitor.enable();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), DEVICE_POSITION_OPTIONS);
    current[0].success(position());
    expect(monitor.getSnapshot()).toMatchObject({ enabled: true, status: 'ready', fix: { lat: 22.2865, lng: 114.14175, accuracy: 25 } });
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    watches[0].success(position({ timestamp: now + 1_000 }));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    monitor.disable();
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(monitor.getSnapshot()).toMatchObject({ enabled: false, status: 'idle', fix: undefined });
    expect(readDeviceLocationPrefs('user-1', storage).prefs.enabled).toBe(false);
  });

  it('keeps Safari epoch and slightly future browser timestamps usable from callback receipt', () => {
    const { monitor, current, watches } = harness();
    monitor.setActive(true);
    monitor.enable();
    current[0].success(position({ timestamp: now - 978_307_200_030, coords: { latitude: 22.2865, longitude: 114.14175, accuracy: 35 } }));
    expect(monitor.getSnapshot()).toMatchObject({ status: 'ready', fix: { observedAt: now, accuracy: 35 } });
    expect(usableDeviceFix(monitor.getSnapshot().fix, now)).toBe(true);
    vi.advanceTimersByTime(1_000);
    watches[0].success(position({ timestamp: now + 5_000 }));
    expect(monitor.getSnapshot().fix?.observedAt).toBe(now + 1_000);
    expect(usableDeviceFix(monitor.getSnapshot().fix, now + 1_000)).toBe(true);
  });

  it('starts automatically for an opted-in account only after the workspace is active', () => {
    const { monitor, geo, storage } = harness();
    writeDeviceLocationPrefs('user-1', { version: 1, prompted: true, enabled: true }, storage);
    const restored = new DeviceLocationMonitor('user-1', { geolocation: geo, storage, secure: true });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    restored.setActive(true);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(monitor.getSnapshot().enabled).toBe(false);
  });

  it('ignores a late success after cancellation, including StrictMode cleanup', () => {
    const { monitor, current, geo } = harness();
    monitor.enable();
    monitor.setActive(true);
    monitor.setActive(false);
    current[0].success(position());
    expect(monitor.getSnapshot().fix).toBeUndefined();
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('treats browser denial as off without confusing a timeout for denial', () => {
    const { monitor, current } = harness();
    monitor.setActive(true);
    monitor.enable();
    current[0].error?.({ code: 3 });
    expect(monitor.getSnapshot()).toMatchObject({ enabled: true, status: 'timeout' });
    monitor.setVisible(false);
    monitor.setVisible(true);
    current[1].error?.({ code: 1 });
    expect(monitor.getSnapshot()).toMatchObject({ enabled: false, prompted: true, status: 'denied', fix: undefined });
    current[0].success(position());
    expect(monitor.getSnapshot().fix).toBeUndefined();
  });

  it('stops watching while hidden and starts a fresh request when visible again', () => {
    const { monitor, geo, current } = harness();
    monitor.setActive(true);
    monitor.enable();
    current[0].success(position());
    monitor.setVisible(false);
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(monitor.getSnapshot().status).toBe('idle');
    current[0].success(position());
    expect(monitor.getSnapshot().fix).toBeUndefined();
    monitor.setVisible(true);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('expires a fix so an old position cannot keep sorting or moving the map', () => {
    const { monitor, current } = harness();
    monitor.setActive(true);
    monitor.enable();
    current[0].success(position());
    vi.advanceTimersByTime(300_000);
    expect(monitor.getSnapshot().fix).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(monitor.getSnapshot()).toMatchObject({ status: 'idle', fix: undefined });
  });

  it('keeps a valid one-shot fix if watchPosition throws, but still expires it', () => {
    const { monitor, current, geo } = harness();
    vi.mocked(geo.watchPosition).mockImplementation(() => { throw new Error('watch unavailable'); });
    monitor.setActive(true);
    monitor.enable();
    current[0].success(position());
    expect(monitor.getSnapshot().status).toBe('ready');
    expect(monitor.getSnapshot().fix).toBeDefined();
    vi.advanceTimersByTime(300_001);
    expect(monitor.getSnapshot().fix).toBeUndefined();
  });

  it('reports unavailable rather than throwing when the browser API itself fails', () => {
    const { monitor, geo } = harness();
    vi.mocked(geo.getCurrentPosition).mockImplementation(() => { throw new Error('insecure'); });
    monitor.setActive(true);
    monitor.enable();
    expect(monitor.getSnapshot()).toMatchObject({ enabled: true, status: 'unavailable', fix: undefined });
  });

  it('does not call an unsupported or insecure browser, but still permits turning off a stored preference', () => {
    const { monitor, geo, storage } = harness();
    writeDeviceLocationPrefs('user-1', { version: 1, prompted: true, enabled: true }, storage);
    const insecure = new DeviceLocationMonitor('user-1', { geolocation: undefined, storage, secure: false });
    insecure.setActive(true);
    expect(insecure.getSnapshot().status).toBe('unsupported');
    insecure.disable();
    expect(insecure.getSnapshot().enabled).toBe(false);
    insecure.enable();
    expect(insecure.getSnapshot()).toMatchObject({ enabled: true, prompted: true, status: 'unsupported', fix: undefined });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(monitor.getSnapshot().supported).toBe(true);
  });
});
