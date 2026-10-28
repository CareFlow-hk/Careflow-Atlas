/** The one place a person's page asks for AI help.
 *
 * Since phase 5 there is one door and it is ours: `POST /api/ai/assist`
 * (`docs/AI_ASSISTANT.md` 5.2). The endpoint, the deployment, the model, the system prompt
 * and `store:false` all belong to the server, so this bundle holds no key and a modified
 * page cannot widen what leaves the device. It follows that this module no longer knows
 * any provider's envelope — only our own answer.
 *
 * What it still does is tell failures apart: a closed switch, a spent quota, a reply that
 * broke its contract and a dropped connection each need a different sentence, and saying
 * only 「失敗」 leaves the person guessing. The server writes most of those sentences; the
 * kind is kept so a caller can react differently.
 *
 * The reply is checked here as well as on the server. The rules in `contract.ts` are what
 * the plan screen relies on, and a reply that breaks them is discarded whole.
 */
import { ApiError, api } from '../auth/api';

/**
 * Longer than the server's own budget (60 s per call, 120 s for the pair), so a slow answer
 * is reported by the server as 「逾時」 rather than by the browser as a dropped connection.
 */
export const AI_TIMEOUT_MS = 150_000;

export type AiKind = 'mapping' | 'draft' | 'patch';

/**
 * The server's record of one request, written onto every record that answer produces.
 *
 * It is a disclosure, not a proof: the server can only vouch that it made the request, never
 * that a person really used the assistant (`docs/AI_ASSISTANT.md` 6.3). `requestId` is the
 * upstream's own id, so an administrator can match the row to `ai_requests`.
 */
export interface AiAssistMarker { at: string; provider: string; model: string; requestId?: string }

export type AiErrorKind = 'auth' | 'quota' | 'network' | 'timeout' | 'http' | 'schema';

export class AiRequestError extends Error {
  constructor(public kind: AiErrorKind, message: string) { super(message); this.name = 'AiRequestError'; }
}

export interface AiAnswer<T> { proposal: T; aiAssist: AiAssistMarker }

const SCHEMA_MESSAGE = 'AI 回覆格式不正確，已作廢，未寫入任何資料。';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const name = (error: unknown) => (error as { name?: unknown } | null)?.name;

/**
 * The server's refusal, as the sentence the person sees and the kind its caller may act on.
 * `403` is the switch (or a session that ended), `429` the quota or the institution's two
 * in-flight calls, `504` a timeout the server already gave up on.
 */
function translate(error: unknown): never {
  if (error instanceof AiRequestError) throw error;
  if (error instanceof ApiError) {
    const kind: AiErrorKind = error.status === 401 || error.status === 403 ? 'auth'
      : error.status === 429 ? 'quota'
      : error.status === 504 ? 'timeout'
      : 'http';
    throw new AiRequestError(kind, error.message);
  }
  if (name(error) === 'TimeoutError') throw new AiRequestError('timeout', '等候太久，已取消；可再試一次或改用人手對應。');
  if (name(error) === 'AbortError') throw new AiRequestError('timeout', '已取消這次請求。');
  throw new AiRequestError('network', '無法連線到 AI 服務，請檢查網絡後再試。');
}

/** One request in, one proposal out. Throws `AiRequestError` rather than a bare failure. */
export async function callAi<T>(kind: AiKind, request: object, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<AiAnswer<T>> {
  let reply: unknown;
  try {
    reply = await api<unknown>('/ai/assist', 'POST', { kind, ...request }, { signal: options.signal, timeoutMs: AI_TIMEOUT_MS, fetcher: options.fetcher });
  } catch (error) { translate(error); }

  if (!isObject(reply) || !isObject(reply.proposal) || !isObject(reply.aiAssist)) throw new AiRequestError('schema', SCHEMA_MESSAGE);
  const marker = reply.aiAssist;
  const wellFormed = typeof marker.at === 'string' && Number.isFinite(Date.parse(marker.at))
    && typeof marker.provider === 'string' && typeof marker.model === 'string'
    && (marker.requestId === undefined || typeof marker.requestId === 'string');
  if (!wellFormed) throw new AiRequestError('schema', SCHEMA_MESSAGE);
  return {
    proposal: reply.proposal as T,
    aiAssist: {
      at: marker.at as string, provider: marker.provider as string, model: marker.model as string,
      ...(typeof marker.requestId === 'string' ? { requestId: marker.requestId } : {}),
    },
  };
}
