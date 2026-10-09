import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { openAuth, SESSION_IDLE_MS } from './auth.mjs';
import { createAuthServer } from './http.mjs';
import { config } from './config.mjs';

const password = 'Careflow test passphrase 2026!';
async function fixture(t, settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-auth-test-'));
  const path = join(dir, 'auth.sqlite');
  let clock = Date.now();
  const auth = openAuth(path, { now: () => clock });
  const origin = 'http://127.0.0.1:5173';
  const server = createAuthServer(auth, { origin, secure: false, ...settings });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); auth.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, csrf, headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const value = await response.json();
    return { status: response.status, value, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  async function account(role = 'ADMIN', email = `${role.toLowerCase()}@example.test`) {
    const invite = auth.createUser({ email, name: role, role });
    await auth.redeem(invite.token, password, 'fixture');
    const login = await request('/api/login', { method: 'POST', body: { email, password } });
    assert.equal(login.status, 200);
    return { id: invite.user.id, email, cookie: login.cookie, csrf: login.value.csrf, token: invite.token };
  }
  return { auth, request, account, dir, path, tick: ms => { clock += ms; } };
}

test('unauthenticated access, origin, CSRF and content type are enforced on the server', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/users')).status, 401);
  const admin = await f.account();
  assert.equal((await f.request('/api/logout', { method: 'POST', ...admin, headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await f.request('/api/logout', { method: 'POST', cookie: admin.cookie })).status, 403);
  assert.equal((await f.request('/api/logout', { method: 'POST', ...admin, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await f.request('/api/session', { ...admin, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const session = await f.request('/api/session', admin);
  assert.equal(session.status, 200); assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.ok(!JSON.stringify(session.value).includes('password_hash'));
});

test('photo endpoints require a session and CSRF; their larger body limit does not expand account routes', async t => {
  let calls = 0;
  const photos = { status: () => ({ configured: true, model: 'gpt-6-luna' }), recognize: async () => { calls++; return { rows: [], warnings: [], model: 'gpt-6-luna' }; } };
  const f = await fixture(t, { photos });
  assert.equal((await f.request('/api/photos/status')).status, 401);
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST' })).status, 401);
  const member = await f.account('MEMBER');
  assert.equal((await f.request('/api/photos/status', member)).status, 200);
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST', cookie: member.cookie })).status, 403);
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST', ...member, headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST', ...member, body: { image: 'x'.repeat(10000) } })).status, 200);
  assert.equal(calls, 1);
  assert.equal((await f.request('/api/password', { method: 'POST', ...member, body: { extra: 'x'.repeat(10000) } })).status, 413);
});

test('invitation activation, password policy, expiry and one-time use', async t => {
  const f = await fixture(t);
  const invite = f.auth.createUser({ email: 'Person@Example.test', name: 'Member', role: 'MEMBER' });
  assert.equal(invite.user.email, 'person@example.test');
  await assert.rejects(f.auth.redeem(invite.token, 'short', 'test'), /15–128/);
  await f.auth.redeem(invite.token, password, 'test');
  await assert.rejects(f.auth.redeem(invite.token, password, 'test'), /連結無效/);
  const other = f.auth.createUser({ email: 'other@example.test', name: 'Other', role: 'MEMBER' });
  f.tick(60 * 60_000 + 1);
  await assert.rejects(f.auth.redeem(other.token, password, 'test'), /連結無效/);
  const raw = readFileSync(f.path);
  assert.equal(raw.includes(Buffer.from(password)), false);
  assert.equal(raw.includes(Buffer.from(invite.token)), false);
});

test('member cannot manage accounts; duplicate emails rejected; admin can invite', async t => {
  const f = await fixture(t); const admin = await f.account(); const member = await f.account('MEMBER');
  for (const path of ['/api/admin/users', '/api/admin/audit']) assert.equal((await f.request(path, member)).status, 403);
  assert.equal((await f.request(`/api/admin/users/${admin.id}`, { method: 'PATCH', ...member, body: { role: 'MEMBER', name: 'pwn', disabled: true } })).status, 403);
  const created = await f.request('/api/admin/users', { method: 'POST', ...admin, body: { name: 'New', email: 'new@example.test', role: 'MEMBER' } });
  assert.equal(created.status, 201); assert.match(created.value.link, /#set-password=/);
  assert.equal((await f.request('/api/admin/users', { method: 'POST', ...admin, body: { name: 'New', email: 'NEW@example.test', role: 'MEMBER' } })).status, 409);
  const audit = await f.request('/api/admin/audit', admin);
  assert.ok(audit.value.events.some(e => e.action === 'user_created'));
  assert.ok(!JSON.stringify(audit.value).includes(created.value.link.split('=')[1]));
});

test('last activated admin cannot be removed even if another invitation is pending', async t => {
  const f = await fixture(t); const admin = await f.account();
  f.auth.createUser({ name: 'Pending', email: 'pending@example.test', role: 'ADMIN' });
  for (const change of [{ role: 'MEMBER', disabled: false }, { role: 'ADMIN', disabled: true }]) {
    assert.equal((await f.request(`/api/admin/users/${admin.id}`, { method: 'PATCH', ...admin, body: { name: 'Admin', ...change } })).status, 409);
  }
  assert.equal((await f.request('/api/session', admin)).status, 200);
});

test('disable revokes every session and reset grant; enabling does not restore them', async t => {
  const f = await fixture(t); const admin = await f.account(); const member = await f.account('MEMBER');
  const reset = await f.request(`/api/admin/users/${member.id}/reset`, { method: 'POST', ...admin });
  const update = disabled => f.request(`/api/admin/users/${member.id}`, { method: 'PATCH', ...admin, body: { name: 'Member', role: 'MEMBER', disabled } });
  assert.equal((await update(true)).status, 200);
  assert.equal((await f.request('/api/session', member)).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { email: member.email, password } })).status, 401);
  await update(false);
  await assert.rejects(f.auth.redeem(reset.value.link.split('=')[1], password, 'test'), /連結無效/);
  assert.equal((await f.request('/api/session', member)).status, 401);
});

test('password reset invalidates old grants and every session; no auto login', async t => {
  const f = await fixture(t); const admin = await f.account(); const member = await f.account('MEMBER');
  const make = () => f.request(`/api/admin/users/${member.id}/reset`, { method: 'POST', ...admin });
  const a = (await make()).value.link.split('=')[1], b = (await make()).value.link.split('=')[1];
  await assert.rejects(f.auth.redeem(a, password, 'test'), /連結無效/);
  const reset = await f.request('/api/set-password', { method: 'POST', body: { token: b, password: password + 'new' } });
  assert.equal(reset.status, 200); assert.equal(reset.cookie, 'atlas_session=');
  assert.equal((await f.request('/api/session', member)).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { email: member.email, password } })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { email: member.email, password: password + 'new' } })).status, 200);
});

test('change password requires current password and logs out all devices', async t => {
  const f = await fixture(t); const admin = await f.account();
  assert.equal((await f.request('/api/password', { method: 'POST', ...admin, body: { oldPassword: 'wrong', password } })).status, 400);
  assert.equal((await f.request('/api/password', { method: 'POST', ...admin, body: { oldPassword: password, password: password + 'new' } })).status, 200);
  assert.equal((await f.request('/api/session', admin)).status, 401);
});

test('logout and revoke-other-sessions only affect intended sessions', async t => {
  const f = await fixture(t); const admin = await f.account();
  const second = await f.request('/api/login', { method: 'POST', body: { email: admin.email, password } });
  assert.notEqual(second.cookie, admin.cookie);
  const list = await f.request('/api/sessions', admin); assert.equal(list.value.sessions.length, 2);
  assert.equal((await f.request('/api/sessions/revoke-others', { method: 'POST', ...admin })).status, 200);
  assert.equal((await f.request('/api/session', { cookie: second.cookie })).status, 401);
  assert.equal((await f.request('/api/session', admin)).status, 200);
  await f.request('/api/logout', { method: 'POST', ...admin });
  assert.equal((await f.request('/api/session', admin)).status, 401);
});

test('idle and absolute session expiration are enforced server-side', async t => {
  const f = await fixture(t); const admin = await f.account();
  f.tick(SESSION_IDLE_MS - 60_000); assert.equal((await f.request('/api/session', admin)).status, 200);
  f.tick(SESSION_IDLE_MS + 1); assert.equal((await f.request('/api/session', admin)).status, 401);
  const login = await f.request('/api/login', { method: 'POST', body: { email: admin.email, password } });
  f.auth.run('UPDATE sessions SET expires_at=0');
  assert.equal((await f.request('/api/session', { cookie: login.cookie })).status, 401);
});

test('login throttling persists across database connections and ignores spoofed proxy header', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/api/login', { method: 'POST', body: { email: 'unknown@example.test', password }, headers: { 'x-real-ip': `fake-${i}` } })).status, 401);
  const denied = await f.request('/api/login', { method: 'POST', body: { email: 'unknown@example.test', password } });
  assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '900');
  const second = openAuth(f.path);
  try { assert.throws(() => second.limit('login-email:unknown@example.test', 10), /頻繁/); } finally { second.close(); }
});

test('async password operations cannot resurrect a disabled account or revoked session', async t => {
  const f = await fixture(t); const admin = await f.account(); const member = await f.account('MEMBER');
  const changing = f.auth.changePassword(f.auth.session(member.cookie.split('=')[1]), password, password + 'new');
  f.auth.updateUser(f.auth.session(admin.cookie.split('=')[1]), member.id, { name: 'Member', role: 'MEMBER', disabled: true });
  await assert.rejects(changing, /登入已過期/);
  const pending = f.auth.login(admin.email, password, 'race');
  f.auth.run('UPDATE users SET version=version+1 WHERE id=?', admin.id);
  await assert.rejects(pending, /不可用/);
});

test('backup and restore preserve users and allow recovery, secrets never appear in public rows', async t => {
  const f = await fixture(t); const admin = await f.account();
  const output = join(f.dir, 'backup.sqlite'); await backup(f.auth.db, output);
  const restored = openAuth(output);
  try {
    assert.equal(restored.get('PRAGMA integrity_check').integrity_check, 'ok');
    const result = await restored.login(admin.email, password, 'restored');
    assert.ok(result.token);
    assert.equal(restored.userById(admin.id).email, admin.email);
  } finally { restored.close(); }
});

test('configuration refuses accidental plain HTTP production and malformed origins', () => {
  const saved = { ...process.env };
  try {
    process.env.APP_ORIGIN = 'http://example.test'; process.env.ALLOW_INSECURE_LOCALHOST = 'true'; assert.throws(config, /非 HTTPS/);
    process.env.APP_ORIGIN = 'https://example.test/path'; assert.throws(config, /origin/);
    process.env.APP_ORIGIN = 'https://example.test'; assert.equal(config().secure, true);
  } finally { process.env = saved; }
});

test('secure deployment uses host-scoped HttpOnly cookie and does not persist raw session tokens', async t => {
  const f = await fixture(t, { origin: 'https://atlas.example.test', secure: true });
  const invite = f.auth.createUser({ email: 'admin@example.test', name: 'Admin', role: 'ADMIN' });
  await f.auth.redeem(invite.token, password, 'setup');
  const login = await f.request('/api/login', { method: 'POST', headers: { origin: 'https://atlas.example.test' }, body: { email: 'admin@example.test', password } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /^__Host-atlas_session=/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(login.headers.get('set-cookie').includes(flag));
  assert.notEqual(f.auth.get('SELECT hash FROM sessions').hash, login.cookie.split('=')[1]);
});

test('simultaneous redemption of the same link succeeds only once', async t => {
  const f = await fixture(t);
  const invite = f.auth.createUser({ email: 'race@example.test', name: 'Race', role: 'MEMBER' });
  const results = await Promise.allSettled([f.auth.redeem(invite.token, password, 'first'), f.auth.redeem(invite.token, password, 'second')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.auth.get('SELECT COUNT(*) AS n FROM grants').n, 0);
});

test('newer account database schema cannot be silently downgraded', async t => {
  const f = await fixture(t);
  f.auth.run('PRAGMA user_version=2');
  assert.throws(() => openAuth(f.path), /拒絕降級/);
});

test('a password link names its account so password managers save the right one', async t => {
  const f = await fixture(t);
  const invite = f.auth.createUser({ email: 'Member@Example.test', name: '成員', role: 'MEMBER' });
  const info = await f.request('/api/grant-info', { method: 'POST', body: { token: invite.token } });
  assert.equal(info.status, 200);
  assert.deepEqual(info.value, { email: 'member@example.test', name: '成員' });
  assert.equal((await f.request('/api/grant-info', { method: 'POST', body: { token: 'x'.repeat(43) } })).status, 400);
  await f.auth.redeem(invite.token, password, 'test');
  assert.equal((await f.request('/api/grant-info', { method: 'POST', body: { token: invite.token } })).status, 400, 'a used link names nobody');
});

test('a failed login records which existing account it was for, never the password', async t => {
  const f = await fixture(t);
  const member = await f.account('MEMBER');
  assert.equal((await f.request('/api/login', { method: 'POST', body: { email: member.email, password: 'wrong passphrase 2026' } })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { email: 'nobody@example.test', password: 'wrong passphrase 2026' } })).status, 401);
  const failed = f.auth.all("SELECT target FROM audit WHERE action='login_failed' ORDER BY id");
  assert.deepEqual(failed.map(r => r.target), [member.id, null]);
  assert.ok(!JSON.stringify(f.auth.all('SELECT * FROM audit')).includes('wrong passphrase'));
});
