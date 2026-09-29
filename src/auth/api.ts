export interface Account { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; disabled: boolean; pending: boolean; createdAt: number; }
export interface Session { user: Account; csrf: string; expiresAt: number; }
/** Browser copy of server/auth.mjs SESSION_IDLE_MS (the server cannot be bundled); keep the two equal. */
export const SESSION_IDLE_MS = 6 * 60 * 60_000;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
let csrf: string | undefined;
export function setCsrf(value?: string) { csrf = value; }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const requestCsrf = csrf;
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15000),
  });
  let value: T & { error?: string };
  try { value = await response.json(); }
  catch { throw new ApiError(response.status, '账号服务未响应，请检查服务连接。'); }
  if (!response.ok) {
    if (response.status === 401 && requestCsrf === csrf && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('atlas-session-expired'));
    throw new ApiError(response.status, value.error ?? '请求失败。');
  }
  return value;
}
