export interface DeviceLocationPrefs {
  version: 1;
  prompted: boolean;
  enabled: boolean;
}

export const DEFAULT_DEVICE_LOCATION_PREFS: DeviceLocationPrefs = { version: 1, prompted: false, enabled: false };
export const deviceLocationPrefsKey = (accountId: string) => `careflow-atlas.account.${accountId}.device-location.v1`;

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

/** Only the two preferences are persisted; a position fix never enters this repository. */
export function readDeviceLocationPrefs(accountId: string, storage: Storage | undefined = browserStorage()): { prefs: DeviceLocationPrefs; persistent: boolean } {
  if (!storage) return { prefs: { ...DEFAULT_DEVICE_LOCATION_PREFS }, persistent: false };
  let raw: string | null;
  try { raw = storage.getItem(deviceLocationPrefsKey(accountId)); }
  catch { return { prefs: { ...DEFAULT_DEVICE_LOCATION_PREFS }, persistent: false }; }
  if (!raw) return { prefs: { ...DEFAULT_DEVICE_LOCATION_PREFS }, persistent: true };
  try {
    const value = JSON.parse(raw) as Partial<DeviceLocationPrefs>;
    if (value.version !== 1 || typeof value.prompted !== 'boolean' || typeof value.enabled !== 'boolean') throw new Error('invalid preferences');
    return { prefs: { version: 1, prompted: value.prompted, enabled: value.enabled }, persistent: true };
  } catch { return { prefs: { ...DEFAULT_DEVICE_LOCATION_PREFS }, persistent: true }; }
}

export function writeDeviceLocationPrefs(accountId: string, prefs: DeviceLocationPrefs, storage: Storage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(deviceLocationPrefsKey(accountId), JSON.stringify(prefs)); return true; }
  catch { return false; }
}
