import { requireValue } from './auth.mjs';

/**
 * Site-wide feature switches, turned on and off by an administrator in the settings page
 * rather than by editing the server's .env over SSH. Everything starts off: a feature that
 * sends data somewhere new (photos to Azure, a workspace to this server) is opened on purpose,
 * by a named person, and the audit log says who and when.
 *
 * Secrets stay in .env. A switch never replaces a missing key: photo intake still needs the
 * Azure key configured, and an enabled switch without it does nothing.
 */
export const FEATURES = Object.freeze({
  photoIntake: { label: '照片回錄（Azure 辨識）' },
});

export function createFeatureStore(auth) {
  auth.db.exec(`CREATE TABLE IF NOT EXISTS features (
    key TEXT PRIMARY KEY, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);`);

  /** Every known switch with its current state; one never set is off. */
  const all = () => {
    const stored = new Map(auth.all('SELECT key, enabled FROM features').map(row => [row.key, !!row.enabled]));
    return Object.fromEntries(Object.keys(FEATURES).map(key => [key, stored.get(key) ?? false]));
  };
  const enabled = key => all()[key] === true;

  const set = (key, value, actorId) => {
    requireValue(Object.hasOwn(FEATURES, key), 400, '沒有這個功能開關。');
    requireValue(typeof value === 'boolean', 400, '開關只可以是開或關。');
    return auth.transaction(() => {
      if (enabled(key) === value) return all();
      auth.run(`INSERT INTO features(key, enabled, updated_at, updated_by) VALUES(?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      key, value ? 1 : 0, Date.now(), actorId);
      auth.audit(actorId, value ? 'feature_enabled' : 'feature_disabled', key);
      return all();
    });
  };

  return { all, enabled, set };
}
