/**
 * What the server remembers about a request it made — metadata only (`docs/AI_ASSISTANT.md` 5.2).
 *
 * Never the prompt, never the answer, never a file name, header or cell value. The row
 * exists so the audit can answer «who used the assistant, when, with which model, how
 * much» without keeping anything a person typed.
 *
 * It is also the only thing that can make an `aiAssist` marker checkable: a record may
 * claim a `requestId`, and the server can say whether it issued that id to that
 * institution and when (phase 5 PR5). Until then the row is a record, not a gate.
 *
 * Rows expire; the retention window is timed and swept, not left to grow.
 */
export const AI_REQUEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function createAiRequestStore(auth, { retentionMs = AI_REQUEST_RETENTION_MS, now = Date.now } = {}) {
  auth.db.exec(`CREATE TABLE IF NOT EXISTS ai_requests (
    request_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    fallback_used INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    rows INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL);`);

  let sweptAt = 0;
  const clean = () => auth.run('DELETE FROM ai_requests WHERE expires_at<=?', now());

  const record = (result, user, kind) => {
    const created = now();
    // Expiry is swept on the write path rather than by a second timer: the table only grows
    // when a request happens, so that is also when old rows can first exist.
    if (created - sweptAt > 60 * 60 * 1000) { sweptAt = created; clean(); }
    auth.run(`INSERT INTO ai_requests(request_id, org_id, user_id, kind, model, fallback_used, duration_ms,
      status, rows, chunks, input_tokens, output_tokens, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    result.aiAssist.requestId, user.org_id, user.id, kind, result.aiAssist.model, result.fallback ? 1 : 0,
    result.durationMs, String(result.proposal?.status ?? 'UNKNOWN'), result.rows, result.chunks,
    result.usage?.inputTokens ?? null, result.usage?.outputTokens ?? null, created, created + retentionMs);
  };

  /** Did this server issue that id to that institution, and is it still inside the window? */
  const issued = (requestId, orgId) => {
    const row = auth.get('SELECT request_id, org_id, model, expires_at FROM ai_requests WHERE request_id=?', requestId);
    return row && row.org_id === orgId && row.expires_at > now() ? row : null;
  };

  return { record, issued, clean };
}
