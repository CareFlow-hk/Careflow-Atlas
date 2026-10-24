/** The one place a person's browser talks to an AI provider.
 *
 * It is called directly from the page — no server in between — so the institution's
 * workspace never passes through the VPS (`docs/AI_ASSISTANT.md` 9). That also means this
 * is the only place a provider's failure modes can be told apart: a rejected key, a quota
 * limit, a blocked browser call and a timeout each need a different sentence, and saying
 * only "失敗" leaves the administrator guessing.
 *
 * The reply is parsed as JSON here and nowhere else; the key is passed in and never
 * stored, logged, or put in an error message.
 */
import type { ProviderSpec } from './providers';
import type { ScopedPrompt } from './scope';

export const AI_TIMEOUT_MS = 60_000;

export type AiErrorKind = 'auth' | 'quota' | 'network' | 'timeout' | 'http' | 'schema';

export class AiRequestError extends Error {
  constructor(public kind: AiErrorKind, message: string) { super(message); this.name = 'AiRequestError'; }
}

export interface CallInput {
  model: string;
  key: string;
  prompt: ScopedPrompt;
  timeoutMs?: number;
  /** Test seam; production always uses the page's own fetch. */
  fetcher?: typeof fetch;
}

const SCHEMA_MESSAGE = 'AI 回覆格式不正確，已作廢，未寫入任何資料。';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function failure(status: number): AiRequestError {
  if (status === 401 || status === 403) return new AiRequestError('auth', '密鑰已失效或被拒絕，請機構管理員在設定 › AI 助手更新。');
  if (status === 429) return new AiRequestError('quota', '已達供應商額度或頻率上限，請稍後再試，或請機構管理員在供應商端提高額度。');
  // DeepSeek answers 402 when the account is out of credit; that is a quota problem, not a broken key.
  if (status === 402) return new AiRequestError('quota', '供應商帳戶餘額不足，請機構管理員在供應商端充值。');
  return new AiRequestError('http', `供應商未能處理這次請求（HTTP ${status}）。請機構管理員核對設定的型號是否正確。`);
}

/** Sends one prompt and returns the parsed JSON object, or throws `AiRequestError`. */
export async function callProvider(spec: ProviderSpec, input: CallInput): Promise<Record<string, unknown>> {
  if (!spec.browserDirect || !spec.endpoint || !spec.headers || !spec.body || !spec.reply) {
    throw new AiRequestError('network', `尚未開放「${spec.label}」由瀏覽器直接呼叫。`);
  }
  const fetcher = input.fetcher ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, input.timeoutMs ?? AI_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetcher(spec.endpoint, {
      method: 'POST',
      headers: spec.headers(input.key),
      body: JSON.stringify(spec.body({ model: input.model, system: input.prompt.system, user: input.prompt.user })),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    if (timedOut) throw new AiRequestError('timeout', '等候太久，已取消；可再試一次或改用人手對應。');
    throw new AiRequestError('network', '無法連線到該供應商。若剛換過供應商，可能是端點不允許瀏覽器直連。');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw failure(response.status);

  let envelope: unknown;
  try { envelope = await response.json(); }
  catch { throw new AiRequestError('schema', SCHEMA_MESSAGE); }

  const text = spec.reply(envelope).trim();
  if (!text) throw new AiRequestError('schema', SCHEMA_MESSAGE);
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new AiRequestError('schema', SCHEMA_MESSAGE); }
  if (!isObject(parsed)) throw new AiRequestError('schema', SCHEMA_MESSAGE);
  return parsed;
}
