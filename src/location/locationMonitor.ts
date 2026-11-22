import { DEVICE_LOCATION_MAX_AGE_MS, readDeviceFix, type DeviceFix, type DeviceLocationStatus } from '../domain/deviceLocation';
import { readDeviceLocationPrefs, writeDeviceLocationPrefs } from './locationPrefs';

export interface DevicePosition {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
}
export interface DevicePositionError { code: number; message?: string }
export interface DeviceGeolocation {
  getCurrentPosition(success: (position: DevicePosition) => void, error?: (error: DevicePositionError) => void, options?: PositionOptions): void;
  watchPosition(success: (position: DevicePosition) => void, error?: (error: DevicePositionError) => void, options?: PositionOptions): number;
  clearWatch(id: number): void;
}

export const DEVICE_POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 };

export interface DeviceLocationSnapshot {
  supported: boolean;
  prompted: boolean;
  enabled: boolean;
  status: DeviceLocationStatus;
  fix?: DeviceFix;
  preferencePersistent: boolean;
}

interface Options {
  geolocation?: DeviceGeolocation;
  storage?: Storage;
  secure?: boolean;
}

/**
 * The browser lifecycle without React. In particular, enable() reaches the browser directly
 * in the click handler (important on mobile Safari), while late callbacks carry a generation.
 */
export class DeviceLocationMonitor {
  private readonly geo?: DeviceGeolocation;
  private readonly accountId: string;
  private readonly storage?: Storage;
  private readonly supported: boolean;
  private readonly listeners = new Set<() => void>();
  private state: DeviceLocationSnapshot;
  private active = false;
  private visible = true;
  private running = false;
  private generation = 0;
  private watchId?: number;
  private expiry?: ReturnType<typeof setTimeout>;

  constructor(accountId: string, options: Options = {}) {
    this.accountId = accountId;
    this.geo = options.geolocation;
    this.storage = options.storage;
    this.supported = Boolean(this.geo && options.secure !== false);
    const stored = readDeviceLocationPrefs(accountId, options.storage);
    this.state = {
      supported: this.supported,
      prompted: stored.prefs.prompted,
      enabled: stored.prefs.enabled,
      status: this.supported ? 'idle' : 'unsupported',
      preferencePersistent: stored.persistent,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(next: Partial<DeviceLocationSnapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }
  private preferences(enabled: boolean, prompted: boolean, next: Partial<DeviceLocationSnapshot> = {}) {
    const preferencePersistent = writeDeviceLocationPrefs(this.accountId, { version: 1, enabled, prompted }, this.storage);
    this.patch({ enabled, prompted, preferencePersistent, ...next });
  }

  /** Start only for an entered workspace; opening settings does not tear down the monitor. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.cancel();
      this.patch({ fix: undefined, status: this.supported ? 'idle' : 'unsupported' });
    } else this.start();
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.cancel();
      if (this.state.enabled) this.patch({ status: this.supported ? 'idle' : 'unsupported', fix: undefined });
    } else this.start();
  }

  /** A first-consent acceptance and a settings switch both use this one entry point. */
  enable = () => {
    if (!this.supported) { this.patch({ status: 'unsupported' }); return; }
    this.preferences(true, true, { status: 'idle', fix: undefined });
    this.start();
  };

  disable = () => {
    this.cancel();
    this.preferences(false, true, { status: this.supported ? 'idle' : 'unsupported', fix: undefined });
  };

  decline = () => {
    this.cancel();
    this.preferences(false, true, { status: this.supported ? 'idle' : 'unsupported', fix: undefined });
  };

  private cancel() {
    this.generation++;
    this.running = false;
    if (this.watchId !== undefined) this.geo?.clearWatch(this.watchId);
    this.watchId = undefined;
    if (this.expiry !== undefined) clearTimeout(this.expiry);
    this.expiry = undefined;
  }

  private expireFixAt(fix: DeviceFix, generation: number) {
    if (this.expiry !== undefined) clearTimeout(this.expiry);
    // The domain rule includes the exact five-minute boundary; clear on the following tick.
    const delay = Math.max(0, fix.observedAt + DEVICE_LOCATION_MAX_AGE_MS - Date.now()) + 1;
    this.expiry = setTimeout(() => {
      if (!this.running || generation !== this.generation || this.state.fix?.observedAt !== fix.observedAt) return;
      this.expiry = undefined;
      this.patch({ fix: undefined, status: 'idle' });
    }, Math.min(delay, 2_147_483_647));
  }

  private start() {
    if (!this.supported || !this.geo || !this.active || !this.visible || !this.state.enabled || this.running) return;
    this.cancel();
    const generation = this.generation;
    this.running = true;
    this.patch({ status: 'requesting', fix: undefined });
    const success = (position: DevicePosition) => {
      if (!this.running || generation !== this.generation) return;
      const fix = readDeviceFix(position);
      if (!fix) { this.patch({ status: 'unavailable', fix: undefined }); return; }
      this.patch({ status: 'ready', fix });
      this.expireFixAt(fix, generation);
      if (this.watchId !== undefined) return;
      try { this.watchId = this.geo!.watchPosition(success, error, DEVICE_POSITION_OPTIONS); }
      catch { this.watchId = undefined; /* The one-shot fix remains usable until its expiry. */ }
    };
    const error = (failure: DevicePositionError) => {
      if (!this.running || generation !== this.generation) return;
      if (failure.code === 1) {
        this.cancel();
        this.preferences(false, true, { status: 'denied', fix: undefined });
      } else this.patch({ status: failure.code === 3 ? 'timeout' : 'unavailable' });
    };
    // Deliberately invoked synchronously by enable(), before returning to the browser event loop.
    try { this.geo.getCurrentPosition(success, error, DEVICE_POSITION_OPTIONS); }
    catch {
      if (generation !== this.generation) return;
      this.cancel();
      this.patch({ status: 'unavailable', fix: undefined });
    }
  }
}
