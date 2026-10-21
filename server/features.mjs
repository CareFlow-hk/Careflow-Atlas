import { requireValue } from './auth.mjs';

/**
 * Feature switches, turned on and off by the platform administrator in the settings page
 * rather than by editing the server's .env over SSH. Everything starts off: a feature that
 * sends data somewhere new (photos to Azure, a workspace to this server) is opened on purpose,
 * by a named person, and the audit log says who and when.
 *
 * A switch is either site-wide (one setting for everyone) or per institution (2026-10-21):
 * cross-device sync is opened for one institution at a time, so CareFlow's own test
 * institution can sync while a partner whose rollout is not ready stays on its devices.
 *
 * Secrets stay in .env. A switch never replaces a missing key: photo intake still needs the
 * Azure key configured, and an enabled switch without it does nothing.
 */
export const FEATURES = Object.freeze({
  photoIntake: { label: '照片回錄（Azure 辨識）', scope: 'site' },
  // Also needs the institution's passphrase set (server/workspaceKey.mjs) before it stores anything.
  workspaceSync: { label: '跨裝置同步（加密後存到伺服器）', scope: 'org' },
});
const keysOf = scope => Object.keys(FEATURES).filter(key => FEATURES[key].scope === scope);

export function createFeatureStore(auth) {
  auth.db.exec(`CREATE TABLE IF NOT EXISTS features (
    key TEXT PRIMARY KEY, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS org_features (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, key TEXT NOT NULL,
      enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT, PRIMARY KEY (org_id, key));`);
  /*
   * A switch that used to be site-wide and is now per institution keeps its state: every
   * institution that exists gets the old value, and the site-wide row goes. Running it again
   * finds nothing to move.
   */
  auth.transaction(() => {
    for (const key of keysOf('org')) {
      const old = auth.get('SELECT enabled, updated_at, updated_by FROM features WHERE key=?', key);
      if (!old) continue;
      for (const { id } of auth.all('SELECT id FROM organizations')) {
        auth.run('INSERT OR IGNORE INTO org_features(org_id,key,enabled,updated_at,updated_by) VALUES(?,?,?,?,?)', id, key, old.enabled, old.updated_at, old.updated_by);
      }
      auth.run('DELETE FROM features WHERE key=?', key);
    }
  });

  /** Every known switch as it applies to one institution; one never set is off. */
  const all = orgId => {
    const site = new Map(auth.all('SELECT key, enabled FROM features').map(row => [row.key, !!row.enabled]));
    const org = new Map(auth.all('SELECT key, enabled FROM org_features WHERE org_id=?', orgId ?? '').map(row => [row.key, !!row.enabled]));
    return Object.fromEntries(Object.keys(FEATURES).map(key => [key, (FEATURES[key].scope === 'org' ? org : site).get(key) ?? false]));
  };
  const enabled = (key, orgId) => all(orgId)[key] === true;

  /** Per-institution switches for every institution, for the platform administrator's list. */
  const byOrg = () => {
    const rows = auth.all('SELECT org_id, key, enabled FROM org_features');
    const result = {};
    for (const { id } of auth.all('SELECT id FROM organizations')) result[id] = Object.fromEntries(keysOf('org').map(key => [key, false]));
    for (const row of rows) if (result[row.org_id] && Object.hasOwn(FEATURES, row.key)) result[row.org_id][row.key] = !!row.enabled;
    return result;
  };

  /** `orgId` names the institution for a per-institution switch; a site-wide one ignores it. */
  const set = (key, value, actorId, orgId) => {
    requireValue(Object.hasOwn(FEATURES, key), 400, '沒有這個功能開關。');
    requireValue(typeof value === 'boolean', 400, '開關只可以是開或關。');
    const perOrg = FEATURES[key].scope === 'org';
    if (perOrg) requireValue(typeof orgId === 'string' && auth.get('SELECT 1 FROM organizations WHERE id=?', orgId), 400, '沒有這個機構。');
    return auth.transaction(() => {
      if (enabled(key, orgId) === value) return all(orgId);
      if (perOrg) {
        auth.run(`INSERT INTO org_features(org_id, key, enabled, updated_at, updated_by) VALUES(?,?,?,?,?)
          ON CONFLICT(org_id, key) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
        orgId, key, value ? 1 : 0, Date.now(), actorId);
      } else {
        auth.run(`INSERT INTO features(key, enabled, updated_at, updated_by) VALUES(?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
        key, value ? 1 : 0, Date.now(), actorId);
      }
      // The target names the institution too, so the log says whose sync was opened.
      auth.audit(actorId, value ? 'feature_enabled' : 'feature_disabled', perOrg ? `${key}@${orgId}` : key);
      return all(orgId);
    });
  };

  return { all, enabled, byOrg, set };
}
