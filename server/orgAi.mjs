import { requireValue } from './auth.mjs';
import { AI_ASSIST_PROVIDERS } from './aiAssist.mjs';

/**
 * The institution's AI provider credential, as the server is allowed to hold it: sealed.
 *
 * The browser seals the key with the same institution keys that encrypt the workspace
 * (src/data/workspaceCipher.ts) and sends only that. The server therefore stores a value it
 * cannot read, cannot log and cannot leak: `docs/AI_ASSISTANT.md` 第 5 節. Anyone in the
 * institution who has unlocked the passphrase can open it, which is the accepted trade-off
 * recorded in the same document (第 2 節第 10 行) — the alternative, proxying provider calls
 * through this server, would put residents' text here.
 *
 * Only an administrator sets or removes it. Members read the sealed copy, never the status
 * of the plaintext, because there is no plaintext here to report.
 */
/**
 * Shared with the record marker in `server/aiAssist.mjs`; that module owns the list so it
 * survives this file's removal in phase 5.
 */
export const PROVIDERS = AI_ASSIST_PROVIDERS;

/** The same marker the workspace cipher writes; the server only checks the shape. */
const SEALED = /^enc:v1:[A-Za-z0-9+/]{16,8000}={0,2}$/;
/** Provider model names: letters, digits and . _ : - only. No spaces, no URLs. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function read(input) {
  requireValue(input && typeof input === 'object', 400, '密鑰資料格式不正確。');
  requireValue(typeof input.provider === 'string' && Object.hasOwn(PROVIDERS, input.provider), 400, '不支援這個 AI 供應商。');
  requireValue(typeof input.model === 'string' && MODEL.test(input.model), 400, 'AI 型號名稱格式不正確。');
  // Refusing anything unsealed keeps the promise that the server never sees a key: a client
  // that sends plaintext is a bug, not a value to store.
  requireValue(typeof input.sealedKey === 'string' && SEALED.test(input.sealedKey), 400, '密鑰必須先在瀏覽器用機構密語加密才可上傳。');
  return { provider: input.provider, model: input.model, sealedKey: input.sealedKey };
}

export function createOrgAiStore(auth) {
  auth.db.exec(`CREATE TABLE IF NOT EXISTS org_ai_settings (
    org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, model TEXT NOT NULL, sealed_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT);`);

  /**
   * What everyone in the institution may see: whether it is set and who last changed it.
   * Deliberately no masked tail and no length — those leak the key without helping anyone.
   */
  const status = orgId => {
    const row = auth.get(`SELECT a.provider, a.model, a.updated_at, u.name AS updated_by
      FROM org_ai_settings a LEFT JOIN users u ON u.id = a.updated_by WHERE a.org_id = ?`, orgId);
    if (!row) return { configured: false };
    return {
      configured: true,
      provider: row.provider,
      providerLabel: PROVIDERS[row.provider] ?? row.provider,
      model: row.model,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by ?? null,
    };
  };

  /** The sealed copy, for a browser that can unlock the institution's passphrase. */
  const sealed = orgId => {
    const row = auth.get('SELECT provider, model, sealed_key FROM org_ai_settings WHERE org_id = ?', orgId);
    return row ? { provider: row.provider, model: row.model, sealedKey: row.sealed_key } : null;
  };

  const put = (user, input) => {
    requireValue(user.role === 'ADMIN', 403, '設定 AI 密鑰需要機構管理員權限。');
    const value = read(input);
    return auth.transaction(() => {
      const existed = !!auth.get('SELECT 1 FROM org_ai_settings WHERE org_id = ?', user.org_id);
      auth.run(`INSERT INTO org_ai_settings(org_id, provider, model, sealed_key, updated_at, updated_by)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(org_id) DO UPDATE SET provider=excluded.provider, model=excluded.model,
          sealed_key=excluded.sealed_key, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      user.org_id, value.provider, value.model, value.sealedKey, Date.now(), user.id);
      // Neither the key nor any part of it reaches the log: only who changed which provider.
      auth.audit(user.id, existed ? 'ai_key_changed' : 'ai_key_set', `${value.provider}@${user.org_id}`);
      return status(user.org_id);
    });
  };

  const remove = user => {
    requireValue(user.role === 'ADMIN', 403, '移除 AI 密鑰需要機構管理員權限。');
    return auth.transaction(() => {
      const row = auth.get('SELECT provider FROM org_ai_settings WHERE org_id = ?', user.org_id);
      if (!row) return status(user.org_id);
      auth.run('DELETE FROM org_ai_settings WHERE org_id = ?', user.org_id);
      auth.audit(user.id, 'ai_key_removed', `${row.provider}@${user.org_id}`);
      return status(user.org_id);
    });
  };

  return { status, sealed, put, remove };
}
