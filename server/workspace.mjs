import { requireValue } from './auth.mjs';

/**
 * The business snapshot, stored whole, one row per account.
 *
 * This is deliberately not the relational W2–W4 schema from BACKEND_GAP_ANALYSIS.md: it
 * pins a signed-in account's workspace to the server so it no longer lives only in one
 * browser. Domain validation lives in the shared contract (src/domain/schema.ts); the
 * server refuses only what it cannot serve back, so a malformed body never becomes stored
 * data. Whole-document versioning means a write from another device is reported (409) and
 * never silently overwrites the one already there.
 */
export const WORKSPACE_BODY_LIMIT = 5 * 1024 * 1024;

const requiredArrays = ['buildings', 'floors', 'units', 'observations'];

function checkSnapshot(snapshot) {
  requireValue(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 400, '工作區資料格式不正確。');
  requireValue(typeof snapshot.schemaVersion === 'string', 400, '工作區資料缺少 schemaVersion。');
  /*
   * The demo/production boundary, enforced here rather than trusted from the client: this
   * store exists so a prototype workspace survives a browser, and it deliberately refuses
   * anything not marked synthetic. Real business data needs the W2 relational store; until
   * that exists, no unmarked document can be parked here and later mistaken for it.
   */
  requireValue(snapshot.isSynthetic === true && snapshot.schemaVersion === '0.1-demo', 400,
    '帳號端目前只接受標記為合成示範的資料。正式業務資料要等 W2 的資料庫，不會寫進這張表。');
  for (const key of requiredArrays) requireValue(Array.isArray(snapshot[key]), 400, `工作區資料缺少 ${key}。`);
  return snapshot;
}

export function createWorkspaceStore(auth) {
  auth.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    snapshot TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL);`);

  const get = userId => {
    const row = auth.get('SELECT snapshot, version, updated_at FROM workspaces WHERE user_id=?', userId);
    if (!row) return undefined;
    return { snapshot: JSON.parse(row.snapshot), version: row.version, updatedAt: row.updated_at };
  };

  const put = (userId, input) => {
    const snapshot = checkSnapshot(input?.snapshot);
    const json = JSON.stringify(snapshot);
    requireValue(Buffer.byteLength(json) <= WORKSPACE_BODY_LIMIT, 413, '工作區資料過大。');
    const baseVersion = input?.baseVersion ?? undefined;
    return auth.transaction(() => {
      const row = auth.get('SELECT version FROM workspaces WHERE user_id=?', userId);
      const current = row?.version;
      /*
       * Creating: the caller must not claim a version it never read. Replacing: it must name
       * the version it started from, so a write that landed from another device is reported
       * instead of being overwritten.
       */
      requireValue(current === undefined ? baseVersion === undefined : baseVersion === current, 409,
        current === undefined ? '資料已在其他裝置建立，請重新載入。' : '資料已在其他裝置更新，請重新載入。');
      const version = (current ?? 0) + 1;
      if (current === undefined) auth.run('INSERT INTO workspaces(user_id,snapshot,version,updated_at) VALUES(?,?,?,?)', userId, json, version, Date.now());
      else auth.run('UPDATE workspaces SET snapshot=?,version=?,updated_at=? WHERE user_id=?', json, version, Date.now(), userId);
      auth.audit(userId, 'workspace_saved', userId);
      return { version };
    });
  };

  const remove = userId => auth.transaction(() => {
    auth.run('DELETE FROM workspaces WHERE user_id=?', userId);
    auth.audit(userId, 'workspace_cleared', userId);
  });

  return { get, put, remove };
}
