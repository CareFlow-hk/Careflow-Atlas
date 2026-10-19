import { requireValue } from './auth.mjs';

/**
 * The institution's workspace key, as the server is allowed to hold it: locked.
 *
 * The browser makes a random data key, locks it with a key derived from the institution's
 * passphrase (PBKDF2), and sends only the locked copy, the salt and the iteration count. The
 * server stores those so a colleague's browser can unlock the same data key with the same
 * passphrase. Neither the passphrase nor the data key ever reaches this process, so a copy
 * of the database (or of the VPS) does not open the encrypted fields in the workspace.
 *
 * `keyId` is a fingerprint the browser derives from the data key. It reveals nothing about
 * the key, but lets the server tell a passphrase change (same data key, locked again) from a
 * different key — which would leave every stored field unreadable, so it is only accepted
 * while the institution's workspace holds no records.
 */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const b64 = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max && BASE64.test(value);
export const MIN_ITERATIONS = 200_000;

function checkKey(input) {
  requireValue(input && typeof input === 'object', 400, '密鑰資料格式不正確。');
  requireValue(typeof input.keyId === 'string' && /^[0-9a-f]{32}$/.test(input.keyId), 400, '密鑰編號格式不正確。');
  requireValue(b64(input.salt, 16, 64), 400, '密鑰鹽值格式不正確。');
  requireValue(Number.isInteger(input.iterations) && input.iterations >= MIN_ITERATIONS && input.iterations <= 10_000_000, 400, '密鑰推導次數不正確。');
  requireValue(b64(input.wrapped, 40, 200), 400, '鎖住的密鑰格式不正確。');
  return { keyId: input.keyId, salt: input.salt, iterations: input.iterations, wrapped: input.wrapped };
}

export function createWorkspaceKeyStore(auth) {
  auth.db.exec(`CREATE TABLE IF NOT EXISTS org_keys (
    org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, wrapped TEXT NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT);`);

  const get = orgId => {
    const row = auth.get('SELECT key_id, salt, iterations, wrapped, updated_at FROM org_keys WHERE org_id=?', orgId);
    return row ? { keyId: row.key_id, salt: row.salt, iterations: row.iterations, wrapped: row.wrapped, updatedAt: row.updated_at } : undefined;
  };

  /** Whether the institution's workspace holds nothing a new key would leave unreadable. */
  const workspaceEmpty = orgId => {
    const row = auth.get('SELECT snapshot FROM org_workspaces WHERE org_id=?', orgId);
    if (!row) return true;
    const snapshot = JSON.parse(row.snapshot);
    return Object.values(snapshot).every(value => !Array.isArray(value) || value.length === 0);
  };

  /*
   * Three cases, told apart by the fingerprint: the first key, the same key locked with a new
   * passphrase, or a different key. The last throws away access to every encrypted field, so
   * it is refused while there is anything in the workspace; an administrator clears it first.
   */
  const set = (user, input) => {
    requireValue(user.role === 'ADMIN', 403, '設定機構密語需要管理員權限。');
    const key = checkKey(input);
    return auth.transaction(() => {
      const current = get(user.org_id);
      if (current && current.keyId !== key.keyId) {
        requireValue(workspaceEmpty(user.org_id), 409, '工作區仍有資料，不能換成另一把密鑰；換了之後現有資料會無法解開。請先匯出 Excel 並清空工作區。');
      }
      auth.run(`INSERT INTO org_keys(org_id,key_id,salt,iterations,wrapped,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(org_id) DO UPDATE SET key_id=excluded.key_id, salt=excluded.salt, iterations=excluded.iterations,
        wrapped=excluded.wrapped, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      user.org_id, key.keyId, key.salt, key.iterations, key.wrapped, Date.now(), user.id);
      auth.audit(user.id, !current ? 'workspace_key_created' : current.keyId === key.keyId ? 'workspace_key_rewrapped' : 'workspace_key_replaced', user.org_id);
      return get(user.org_id);
    });
  };

  return { get, set, workspaceEmpty };
}
