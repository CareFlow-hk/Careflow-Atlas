/**
 * `orgId` names the institution whose shared workspace this account works in. `platformAdmin`
 * marks the person running the site: only they turn site-wide switches, and an institution's
 * administrator cannot change their account. It is set on the server, never from the page.
 */
export interface Account { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; orgId?: string; platformAdmin?: boolean; disabled: boolean; pending: boolean; createdAt: number; }
export interface Session { user: Account; csrf: string; expiresAt: number; }
/** Browser copy of server/auth.mjs SESSION_IDLE_MS (the server cannot be bundled); keep the two equal. */
export const SESSION_IDLE_MS = 6 * 60 * 60_000;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
let csrf: string | undefined;
export function setCsrf(value?: string) { csrf = value; }
export async function api<T>(path: string, method = 'GET', body?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number; /** Test seam; production always uses the page's own fetch. */ fetcher?: typeof fetch }): Promise<T> {
  const requestCsrf = csrf;
  const request = options?.fetcher ?? fetch;
  const response = await request(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.any([AbortSignal.timeout(options?.timeoutMs ?? 15000), ...(options?.signal ? [options.signal] : [])]),
  });
  let value: T & { error?: string };
  try { value = await response.json(); }
  catch { throw new ApiError(response.status, '帳號服務未有回應，請檢查服務連接。'); }
  if (!response.ok) {
    if (response.status === 401 && requestCsrf === csrf && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('atlas-session-expired'));
    throw new ApiError(response.status, value.error ?? '請求失敗。');
  }
  return value;
}
