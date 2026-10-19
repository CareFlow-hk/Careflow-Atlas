import { requireValue } from './auth.mjs';
import { assertWorkspaceWrite } from './workspaceAccess.mjs';

/**
 * The institution's business snapshot, stored whole, one row per organisation.
 *
 * This is deliberately not the relational W2–W4 schema from BACKEND_GAP_ANALYSIS.md: it
 * pins a signed-in account's workspace to the server so it no longer lives only in one
 * browser. Domain validation lives in the shared contract (src/domain/schema.ts); the
 * server refuses only what it cannot serve back, so a malformed body never becomes stored
 * data. Whole-document versioning means a write from another device is reported (409) and
 * never silently overwrites the one already there.
 *
 * Every member of an organisation reads and writes the same row; `workspaceAccess.mjs`
 * decides which changes a member may make. The request never names an organisation, so a
 * member of one cannot reach another's workspace.
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

const parse = row => row ? JSON.parse(row.snapshot) : undefined;

/** What a cleared institution holds: a valid, empty synthetic workspace, not an absent row. */
const EMPTY_WORKSPACE = {
  schemaVersion: '0.1-demo', isSynthetic: true, notice: '工作區已由管理員清空。',
  buildings: [], floors: [], units: [], households: [], people: [], householdMemberships: [],
  householdResidences: [], memberships: [], visits: [], observations: [],
};

export function createWorkspaceStore(auth) {
  // The table is created with the account schema (server/auth.mjs), where the v1 → v2
  // migration seeds it; keeping one owner of the schema avoids two versions of it.
  const get = orgId => {
    const row = auth.get('SELECT snapshot, version, updated_at FROM org_workspaces WHERE org_id=?', orgId);
    if (!row) return undefined;
    return { snapshot: JSON.parse(row.snapshot), version: row.version, updatedAt: row.updated_at };
  };

  const put = (user, input) => {
    const snapshot = checkSnapshot(input?.snapshot);
    const json = JSON.stringify(snapshot);
    requireValue(Buffer.byteLength(json) <= WORKSPACE_BODY_LIMIT, 413, '工作區資料過大。');
    const baseVersion = input?.baseVersion ?? undefined;
    return auth.transaction(() => {
      const row = auth.get('SELECT snapshot, version FROM org_workspaces WHERE org_id=?', user.org_id);
      const current = row?.version;
      /*
       * Creating: the caller must not claim a version it never read. Replacing: it must name
       * the version it started from, so a write that landed from another device is reported
       * instead of being overwritten.
       */
      requireValue(current === undefined ? baseVersion === undefined : baseVersion === current, 409,
        current === undefined ? '資料已在其他裝置建立，請重新載入。' : '資料已在其他裝置更新，請重新載入。');
      assertWorkspaceWrite(user, parse(row), snapshot);
      const version = (current ?? 0) + 1;
      if (current === undefined) auth.run('INSERT INTO org_workspaces(org_id,snapshot,version,updated_at) VALUES(?,?,?,?)', user.org_id, json, version, Date.now());
      else auth.run('UPDATE org_workspaces SET snapshot=?,version=?,updated_at=? WHERE org_id=?', json, version, Date.now(), user.org_id);
      auth.audit(user.id, 'workspace_saved', user.id);
      return { version };
    });
  };

  /*
   * Clearing keeps the row, holding an empty workspace with a higher version. Deleting the
   * row instead would tell every other browser "nothing is stored here", so a colleague's
   * stale copy would look like the first write and silently put the cleared data back. This
   * way their next read sees the empty version and their stale copy loses to it.
   */
  const remove = user => auth.transaction(() => {
    const current = auth.get('SELECT version FROM org_workspaces WHERE org_id=?', user.org_id)?.version ?? 0;
    const version = current + 1;
    auth.run('INSERT INTO org_workspaces(org_id,snapshot,version,updated_at) VALUES(?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET snapshot=excluded.snapshot,version=excluded.version,updated_at=excluded.updated_at',
      user.org_id, JSON.stringify(EMPTY_WORKSPACE), version, Date.now());
    auth.audit(user.id, 'workspace_cleared', user.id);
    return { version };
  });

  return { get, put, remove };
}
