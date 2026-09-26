import { resolve } from 'node:path';
export function config() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error('请配置 APP_ORIGIN，例如 http://127.0.0.1:5173 或 HTTPS 域名。');
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN 必须是 HTTP(S) origin，不带路径。');
  const secure = url.protocol === 'https:';
  if (!secure && !(process.env.ALLOW_INSECURE_LOCALHOST === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('非 HTTPS 仅允许显式开启的 localhost 开发模式。');
  return { origin, secure, trustProxy: process.env.TRUST_PROXY === 'true', path: process.env.AUTH_DB_PATH ?? resolve('.private/auth.sqlite'), host: process.env.AUTH_HOST ?? '127.0.0.1', port: Number(process.env.AUTH_PORT ?? 3001) };
}
