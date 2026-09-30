import { createServer } from 'node:http';
import { HttpError, requireValue, publicUser, SESSION_IDLE_MS } from './auth.mjs';

export function createAuthServer(auth, { origin, secure = true, trustProxy = false }) {
  requireValue(new URL(origin).origin === origin, 500, 'APP_ORIGIN 必須是完整 origin，不帶路徑或末尾斜線。');
  requireValue(!secure || origin.startsWith('https://'), 500, '安全 Cookie 需要 HTTPS APP_ORIGIN。');
  const cookieName = secure ? '__Host-atlas_session' : 'atlas_session';
  const cookie = (token, maxAge = 43200) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const view = row => ({ user: publicUser(auth.userById(row.user_id)), csrf: row.csrf, expiresAt: row.expires_at });
  const link = token => `${origin}/#set-password=${token}`;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && path === '/api/health') {
        auth.get('SELECT 1'); return send(res, 200, { ok: true });
      }
      requireValue(path.startsWith('/api/'), 404, '找不到接口。');
      const mutation = req.method !== 'GET';
      if (mutation) {
        requireValue(req.headers.origin === origin, 403, '請求來源不匹配。');
        requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 415, '需要 JSON 請求。');
      }
      requireValue(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 403, '不允許跨站請求。');
      let body = {};
      if (mutation) {
        requireValue(!req.headers['content-length'] || Number(req.headers['content-length']) <= 8192, 413, '請求過大。');
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; requireValue(length <= 8192, 413, '請求過大。'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'JSON 格式不正確。'); }
        requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, '無效請求。');
      }
      // Only enable behind the bundled proxy, which overwrites this header.
      const ip = trustProxy ? String(req.headers['x-real-ip'] ?? req.socket.remoteAddress) : req.socket.remoteAddress;
      if (req.method === 'POST' && path === '/api/login') {
        const result = await auth.login(body.email, body.password, ip);
        res.setHeader('Set-Cookie', cookie(result.token)); return send(res, 200, view(result.row));
      }
      if (req.method === 'POST' && path === '/api/set-password') {
        await auth.redeem(body.token, body.password, ip);
        res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true });
      }
      const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const row = auth.session(token);
      requireValue(row, 401, '請登入後繼續。');
      if (mutation) requireValue(req.headers['x-csrf-token'] === row.csrf, 403, '請求校驗失敗，請重新整理頁面。');
      const user = auth.assertSession(row);
      if (req.method === 'GET' && path === '/api/session') return send(res, 200, view(row));
      if (req.method === 'POST' && path === '/api/logout') {
        auth.transaction(() => { auth.run('DELETE FROM sessions WHERE hash=?', row.hash); auth.audit(user.id, 'logout'); });
        res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/password') {
        await auth.changePassword(row, body.oldPassword, body.password);
        res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/sessions') return send(res, 200, { sessions: auth.all('SELECT id,created_at,seen_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? AND seen_at>? ORDER BY created_at DESC', user.id, Date.now(), Date.now() - SESSION_IDLE_MS).map(s => ({ ...s, current: s.id === row.id })) });
      if (req.method === 'POST' && path === '/api/sessions/revoke-others') {
        auth.transaction(() => { auth.run('DELETE FROM sessions WHERE user_id=? AND id<>?', user.id, row.id); auth.audit(user.id, 'other_sessions_revoked'); });
        return send(res, 200, { ok: true });
      }
      if (path.startsWith('/api/admin/')) {
        auth.assertSession(row, true);
        if (req.method === 'GET' && path === '/api/admin/users') return send(res, 200, { users: auth.all('SELECT * FROM users ORDER BY created_at,id').map(publicUser) });
        if (req.method === 'GET' && path === '/api/admin/audit') return send(res, 200, { events: auth.all('SELECT a.*,u.email AS actor_email,t.email AS target_email FROM audit a LEFT JOIN users u ON u.id=a.actor LEFT JOIN users t ON t.id=a.target ORDER BY a.id DESC LIMIT 100') });
        if (req.method === 'POST' && path === '/api/admin/users') {
          auth.limit(`admin:${user.id}`, 30);
          const result = auth.createUser(body, user.id); return send(res, 201, { user: result.user, link: link(result.token) });
        }
        const match = path.match(/^\/api\/admin\/users\/([\w-]+)(\/reset)?$/);
        if (match && req.method === 'PATCH' && !match[2]) return send(res, 200, { user: auth.updateUser(row, match[1], body) });
        if (match && req.method === 'POST' && match[2]) {
          auth.limit(`admin:${user.id}`, 30);
          const target = auth.userById(match[1]); requireValue(target && !target.disabled, 400, '帳號不存在或已停用。');
          const token = auth.transaction(() => auth.grant(target.id, user.id));
          return send(res, 200, { link: link(token) });
        }
      }
      throw new HttpError(404, '找不到接口。');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 429 || status === 503) res.setHeader('Retry-After', status === 429 ? '900' : '5');
      // Never log request bodies, passwords, cookies, reset tokens or SQL values.
      if (status === 500) process.stderr.write('Account request failed unexpectedly.\n');
      if (!res.headersSent) send(res, status, { error: status === 500 ? '服務暫時不可用。' : error.message });
      else res.end();
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxRequestsPerSocket = 100;
  return server;
}
