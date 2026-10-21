import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { DEFAULT_ORG_ID, openAuth, SESSION_IDLE_MS } from './auth.mjs';
import { createAuthServer } from './http.mjs';
import { createFeatureStore } from './features.mjs';
import { createOrg, listOrgs, moveUser, renameOrg } from './orgs.mjs';
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
  /*
   * The workspace routes need the sync switch on and an institution key in place, as in a
   * deployment where an administrator has done both. The key is opaque to the server, so
   * any well-formed one will do here.
   */
  function openWorkspace(orgId = DEFAULT_ORG_ID) {
    auth.run("INSERT OR IGNORE INTO org_features(org_id,key,enabled,updated_at) VALUES(?,'workspaceSync',1,0)", orgId);
    auth.run('INSERT OR REPLACE INTO org_keys(org_id,key_id,salt,iterations,wrapped,updated_at) VALUES(?,?,?,?,?,0)', orgId, testKey.keyId, testKey.salt, testKey.iterations, testKey.wrapped);
  }
  /** The site's platform administrator: set on the server's command line, never through the API. */
  const platform = who => auth.setPlatformAdmin(who.id, true) && relogin(who);
  async function relogin(who) {
    const login = await request('/api/login', { method: 'POST', body: { email: who.email, password } });
    Object.assign(who, { cookie: login.cookie, csrf: login.value.csrf });
    return who;
  }
  return { auth, request, account, platform, openWorkspace, dir, path, tick: ms => { clock += ms; } };
}
const testKey = { keyId: 'a'.repeat(32), salt: Buffer.alloc(16, 1).toString('base64'), iterations: 600_000, wrapped: Buffer.alloc(60, 2).toString('base64') };
/** What the browser sends for a sensitive field; the server only checks the marker. */
const sealed = text => `enc:v1:${Buffer.from(text).toString('base64')}`;

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
  f.auth.run("INSERT INTO features(key,enabled,updated_at) VALUES('photoIntake',1,0)");
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

test('an administrator only sees and manages their own institution', async t => {
  const f = await fixture(t); const admin = await f.account(); const outsider = await f.account('MEMBER', 'outsider@example.test');
  // Move one account into a second institution; nothing else about it changes.
  f.auth.run('INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)', 'org-other', '另一機構', 0);
  f.auth.run('UPDATE users SET org_id=? WHERE id=?', 'org-other', outsider.id);
  assert.deepEqual((await f.request('/api/admin/users', admin)).value.users.map(u => u.id), [admin.id]);
  assert.equal((await f.request(`/api/admin/users/${outsider.id}`, { method: 'PATCH', ...admin, body: { name: 'pwn' } })).status, 404);
  assert.equal((await f.request(`/api/admin/users/${outsider.id}/reset`, { method: 'POST', ...admin })).status, 400);
  // The outsider's own workspace stays separate from this institution's.
  f.openWorkspace(); f.openWorkspace('org-other');
  const snapshot = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '機構一', buildings: [], floors: [], units: [], observations: [] };
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot } })).status, 200);
  assert.deepEqual((await f.request('/api/workspace', outsider)).value, {});
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
  f.auth.run('PRAGMA user_version=3');
  assert.throws(() => openAuth(f.path), /拒絕降級/);
});

test('an existing v1 account database keeps its accounts and adopts the institution workspace', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-migrate-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'auth.sqlite');
  const before = new DatabaseSync(path);
  before.exec(`PRAGMA user_version=1;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','MEMBER')), disabled INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE workspaces (
      user_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  before.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run('u1', 'old@example.test', '舊帳號', 'ADMIN', 1);
  before.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run('u2', 'older@example.test', '舊成員', 'MEMBER', 2);
  const older = JSON.stringify({ schemaVersion: '0.1-demo', isSynthetic: true, notice: '較舊' });
  const newer = JSON.stringify({ schemaVersion: '0.1-demo', isSynthetic: true, notice: '較新' });
  before.prepare('INSERT INTO workspaces(user_id,snapshot,version,updated_at) VALUES(?,?,?,?)').run('u2', older, 3, 10);
  before.prepare('INSERT INTO workspaces(user_id,snapshot,version,updated_at) VALUES(?,?,?,?)').run('u1', newer, 9, 20);
  before.close();

  const auth = openAuth(path);
  try {
    assert.equal(auth.get('PRAGMA user_version').user_version, 2);
    // Both existing accounts belong to the default institution from now on.
    assert.deepEqual(auth.all('SELECT id, org_id FROM users ORDER BY id').map(u => [u.id, u.org_id]), [['u1', DEFAULT_ORG_ID], ['u2', DEFAULT_ORG_ID]]);
    // The most recently written account copy is the one the team was using; it seeds the
    // institution workspace. The v1 rows stay for rollback.
    const seeded = auth.get('SELECT snapshot, version FROM org_workspaces WHERE org_id=?', DEFAULT_ORG_ID);
    assert.deepEqual(JSON.parse(seeded.snapshot), JSON.parse(newer));
    assert.equal(seeded.version, 1);
    assert.equal(auth.get('SELECT COUNT(*) AS n FROM workspaces').n, 2);
    // The first administrator — the one `bootstrap` made — keeps the switches; nobody else gains them.
    assert.deepEqual(auth.all('SELECT id, platform_admin FROM users ORDER BY id').map(u => [u.id, u.platform_admin]), [['u1', 1], ['u2', 0]]);
  } finally { auth.close(); }

  // Re-opening is idempotent: the seed is not later overwritten by an older copy.
  const again = openAuth(path);
  try {
    assert.deepEqual(JSON.parse(again.get('SELECT snapshot FROM org_workspaces WHERE org_id=?', DEFAULT_ORG_ID).snapshot), JSON.parse(newer));
  } finally { again.close(); }
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

test('the workspace is shared by the institution, is versioned, and refuses a stale write', async t => {
  const f = await fixture(t);
  const admin = await f.account('ADMIN', 'admin-workspace@example.test');
  const a = await f.account('MEMBER', 'a@example.test');
  const b = await f.account('MEMBER', 'b@example.test');
  f.openWorkspace();
  assert.equal((await f.request('/api/workspace')).status, 401);
  assert.deepEqual((await f.request('/api/workspace', a)).value, {});
  const snapshot = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '', buildings: [], floors: [], units: [], observations: [] };
  const created = await f.request('/api/workspace', { method: 'PUT', ...a, body: { snapshot } });
  assert.equal(created.status, 200); assert.equal(created.value.version, 1);
  // Every member of the same institution sees the copy another member wrote.
  const seenByB = await f.request('/api/workspace', b);
  assert.equal(seenByB.value.version, 1); assert.deepEqual(seenByB.value.snapshot, snapshot);
  const read = await f.request('/api/workspace', a);
  assert.equal(read.value.version, 1); assert.deepEqual(read.value.snapshot, snapshot);
  // A write that started from an old version is reported, not applied.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...a, body: { snapshot, baseVersion: 0 } })).status, 409);
  const next = { ...snapshot, notice: 'changed' };
  const updated = await f.request('/api/workspace', { method: 'PUT', ...b, body: { snapshot: next, baseVersion: 1 } });
  assert.equal(updated.status, 200); assert.equal(updated.value.version, 2);
  assert.equal((await f.request('/api/workspace', a)).value.snapshot.notice, 'changed');
  // A malformed body is refused and leaves the stored copy exactly as it was.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...a, body: { snapshot: { schemaVersion: '0.1-demo' }, baseVersion: 2 } })).status, 400);
  assert.equal((await f.request('/api/workspace', a)).value.snapshot.notice, 'changed');
  // Clearing empties the institution's document, so a member cannot do it.
  assert.equal((await f.request('/api/workspace', { method: 'DELETE', ...a })).status, 403);
  const cleared = await f.request('/api/workspace', { method: 'DELETE', ...admin });
  assert.equal(cleared.status, 200); assert.equal(cleared.value.version, 3);
  // The row stays, holding an empty workspace at a higher version. Deleting it would let a
  // colleague's stale browser look like the first writer and put the cleared data back.
  const afterClear = await f.request('/api/workspace', b);
  assert.equal(afterClear.value.version, 3);
  assert.deepEqual(afterClear.value.snapshot.observations, []);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...b, body: { snapshot, baseVersion: 2 } })).status, 409);
  assert.deepEqual((await f.request('/api/workspace', b)).value.snapshot.observations, []);
  /*
   * The demo/production boundary: this store holds the prototype's synthetic workspace only,
   * so a document without the synthetic marker is refused before it is ever stored.
   */
  const production = { ...snapshot, isSynthetic: false };
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...a, body: { snapshot: production } })).status, 400);
  assert.equal((await f.request('/api/workspace', a)).value.version, 3);
});

test('a member may only withdraw their own records; an administrator may withdraw any', async t => {
  const f = await fixture(t);
  const admin = await f.account('ADMIN', 'admin-withdraw@example.test');
  const member = await f.account('MEMBER', 'member-withdraw@example.test');
  f.openWorkspace();
  const base = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '', buildings: [], floors: [], units: [], observations: [], visits: [], followUpEvents: [] };
  const mine = { id: 'obs-mine', createdBy: { accountId: member.id, name: 'member' }, note: sealed('own record') };
  const first = await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, observations: [mine] } } });
  assert.equal(first.status, 200);
  let version = first.value.version;
  const stored = async () => (await f.request('/api/workspace', member)).value.snapshot;

  // Withdrawing one's own record is allowed, and names the person acting.
  const withdrawn = { ...mine, deleted: { at: '2026-10-19T00:00:00.000Z', by: { accountId: member.id, name: 'member' } } };
  const own = await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, observations: [withdrawn] }, baseVersion: version } });
  assert.equal(own.status, 200); version = own.value.version;

  // The withdrawal marker is the only thing a member may change.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, observations: [{ ...withdrawn, note: sealed('rewritten') }] }, baseVersion: version } })).status, 403);
  // A member cannot remove a record outright: that is what a structure delete by a
  // member would otherwise do to someone else's records.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, observations: [] }, baseVersion: version } })).status, 403);

  // Adding a record is open to both roles; withdrawing someone else's is not.
  const theirs = { id: 'obs-theirs', createdBy: { accountId: admin.id, name: 'admin' }, note: sealed('their record') };
  // A record is saved under the name of whoever saves it, never a colleague's.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, observations: [withdrawn, theirs] }, baseVersion: version } })).status, 403);
  const add = await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: { ...base, observations: [withdrawn, theirs] }, baseVersion: version } });
  assert.equal(add.status, 200); version = add.value.version;
  const withdrawTheirs = { ...theirs, deleted: { at: '2026-10-19T00:00:00.000Z', by: { accountId: member.id, name: 'member' } } };
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, observations: [withdrawn, withdrawTheirs] }, baseVersion: version } })).status, 403);
  // An administrator may withdraw any record, under their own name.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: { ...base, observations: [withdrawn, withdrawTheirs] }, baseVersion: version } })).status, 403);
  const adminWithdrew = { ...theirs, deleted: { at: '2026-10-19T00:00:00.000Z', by: { accountId: admin.id, name: 'admin' } } };
  const byAdmin = await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: { ...base, observations: [withdrawn, adminWithdrew] }, baseVersion: version } });
  assert.equal(byAdmin.status, 200); version = byAdmin.value.version;

  /*
   * Structure is additive for a member: adding a floor or a unit is fine, taking one away
   * is not — not even a unit they added themselves a moment ago and that holds no records
   * (2026-10-19 review). The refusal names the action rather than a missing record.
   */
  const floor = { id: 'floor-1', buildingId: 'b1', level: 1, label: '1樓' };
  const unit = { id: 'unit-1', buildingId: 'b1', floorId: 'floor-1', label: '1樓 A室' };
  const withStructure = await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, floors: [floor], units: [unit], observations: [withdrawn, adminWithdrew] }, baseVersion: version } });
  assert.equal(withStructure.status, 200); version = withStructure.value.version;
  // Removing the unit, on its own or with a record, is refused.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, floors: [floor], units: [], observations: [withdrawn, adminWithdrew] }, baseVersion: version } })).status, 403);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, floors: [floor], units: [], observations: [adminWithdrew] }, baseVersion: version } })).status, 403);
  // So is removing the floor, with or without its units.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, floors: [], units: [], observations: [withdrawn, adminWithdrew] }, baseVersion: version } })).status, 403);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: { ...base, floors: [], units: [unit], observations: [withdrawn, adminWithdrew] }, baseVersion: version } })).status, 403);
  // Nothing the member tried reached the stored copy.
  assert.deepEqual(await stored(), { ...base, floors: [floor], units: [unit], observations: [withdrawn, adminWithdrew] });
  // An administrator may take the structure away.
  const byAdminStructure = await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: { ...base, floors: [], units: [], observations: [withdrawn, adminWithdrew] }, baseVersion: version } });
  assert.equal(byAdminStructure.status, 200);
  assert.deepEqual(await stored(), { ...base, floors: [], units: [], observations: [withdrawn, adminWithdrew] });
});

test('feature switches start off, only the platform administrator turns them, and photo intake obeys', async t => {
  let calls = 0;
  const photos = { status: () => ({ configured: true, model: 'gpt-6-luna' }), recognize: async () => { calls++; return { rows: [], warnings: [], model: 'gpt-6-luna' }; } };
  const f = await fixture(t, { photos });
  const admin = await f.platform(await f.account()), member = await f.account('MEMBER');
  // An institution's administrator sees the switches but cannot turn them.
  const orgAdmin = await f.account('ADMIN', 'org-admin@example.test');
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'photoIntake', enabled: true } })).status, 403);
  assert.equal((await f.request('/api/features', orgAdmin)).value.features.photoIntake, false);
  assert.deepEqual((await f.request('/api/features', member)).value, { features: { photoIntake: false, workspaceSync: false } });
  assert.equal((await f.request('/api/photos/status', member)).value.enabled, false);
  // Off: refused before the upload is read, so nothing reaches Azure.
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST', ...member, body: { image: 'x' } })).status, 403);
  assert.equal(calls, 0);
  // A member cannot turn it on; an unknown or malformed switch is refused.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...member, body: { key: 'photoIntake', enabled: true } })).status, 403);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'nope', enabled: true } })).status, 400);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'photoIntake', enabled: 'yes' } })).status, 400);
  const on = await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'photoIntake', enabled: true } });
  assert.deepEqual(on.value.features, { photoIntake: true, workspaceSync: false });
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST', ...member, body: { image: 'x' } })).status, 200);
  assert.equal(calls, 1);
  // Setting the same value again writes nothing new; each real change is audited with who did it.
  await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'photoIntake', enabled: true } });
  await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'photoIntake', enabled: false } });
  const events = f.auth.all("SELECT actor, action, target FROM audit WHERE action LIKE 'feature_%' ORDER BY id").map(row => ({ ...row }));
  assert.deepEqual(events, [{ actor: admin.id, action: 'feature_enabled', target: 'photoIntake' }, { actor: admin.id, action: 'feature_disabled', target: 'photoIntake' }]);
  assert.equal((await f.request('/api/photos/recognize', { method: 'POST', ...member, body: { image: 'x' } })).status, 403);
});

test('the workspace stays on the device until an administrator turns sync on and sets a key', async t => {
  const f = await fixture(t);
  const admin = await f.platform(await f.account()), member = await f.account('MEMBER');
  const snapshot = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '', buildings: [], floors: [], units: [], observations: [] };
  // Off: no read, no write, no clear — refused before anything is stored.
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await f.request('/api/workspace', { method, ...admin, body: method === 'PUT' ? { snapshot } : undefined })).status, 403, method);
  }
  assert.equal(f.auth.get('SELECT COUNT(*) AS n FROM org_workspaces').n, 0);
  // The key can be looked at (and set) before sync is on, so the first copy is encrypted.
  assert.deepEqual((await f.request('/api/workspace/key', member)).value, { key: null });
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'workspaceSync', enabled: true } })).status, 200);
  // On, but no key yet: nothing could be encrypted, so nothing is stored.
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot } })).status, 409);

  // Only an administrator sets the key; every member can read the locked copy to unlock it.
  const key = { keyId: 'b'.repeat(32), salt: Buffer.alloc(16, 3).toString('base64'), iterations: 600_000, wrapped: Buffer.alloc(60, 4).toString('base64') };
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...member, body: key })).status, 403);
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...admin, body: { ...key, iterations: 1000 } })).status, 400);
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...admin, body: { ...key, keyId: 'not hex' } })).status, 400);
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...admin, body: key })).status, 200);
  assert.deepEqual((await f.request('/api/workspace/key', member)).value.key, { ...key, updatedAt: (await f.request('/api/workspace/key', member)).value.key.updatedAt });
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot } })).status, 200);

  // A sensitive field in the clear is refused; ciphertext and blanks are stored.
  const person = { id: 'p1', displayName: sealed('陳大文'), phone: '', addressNote: undefined };
  const plain = { ...snapshot, people: [{ ...person, phone: '91234567' }] };
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: plain, baseVersion: 1 } })).status, 400);
  const evidence = { ...snapshot, observations: [{ id: 'o1', createdBy: { accountId: admin.id, name: 'ADMIN' }, evidence: [sealed('門口有鞋'), '有人應門'] }] };
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: evidence, baseVersion: 1 } })).status, 400);
  const options = { ...snapshot, observations: [{ id: 'o1', createdBy: { accountId: admin.id, name: 'ADMIN' }, evidence: [], optionNotes: { coverage: '鄰居說搬走了' } }] };
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: options, baseVersion: 1 } })).status, 400);
  const ok = await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: { ...snapshot, people: [person] }, baseVersion: 1 } });
  assert.equal(ok.status, 200);
  assert.ok(!f.auth.get('SELECT snapshot FROM org_workspaces').snapshot.includes('陳大文'));
  // Colleagues poll the version alone; the copy is only fetched when it moved.
  assert.deepEqual((await f.request('/api/workspace/version', member)).value, { version: 2 });

  // A new passphrase locks the same key again: accepted while there is data. A different
  // key would leave that data unreadable, so it waits until the workspace is cleared.
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...admin, body: { ...key, wrapped: Buffer.alloc(60, 5).toString('base64') } })).status, 200);
  const other = { ...key, keyId: 'c'.repeat(32) };
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...admin, body: other })).status, 409);
  assert.equal((await f.request('/api/workspace', { method: 'DELETE', ...admin })).status, 200);
  assert.equal((await f.request('/api/workspace/key', { method: 'PUT', ...admin, body: other })).status, 200);
  const events = f.auth.all("SELECT action FROM audit WHERE action LIKE 'workspace_key_%' ORDER BY id").map(row => row.action);
  assert.deepEqual(events, ['workspace_key_created', 'workspace_key_rewrapped', 'workspace_key_replaced']);

  // Turned off again, the server stops serving the copy it holds.
  await f.request('/api/admin/features', { method: 'PUT', ...admin, body: { key: 'workspaceSync', enabled: false } });
  assert.equal((await f.request('/api/workspace', member)).status, 403);
  assert.equal((await f.request('/api/workspace/version', member)).status, 403);
});

test('a member may correct anything but remove nothing, and signs their own work', async t => {
  const f = await fixture(t);
  const admin = await f.account(), member = await f.account('MEMBER');
  f.openWorkspace();
  const person = { id: 'p1', displayName: sealed('陳大文'), phone: sealed('91234567') };
  const household = { id: 'h1', label: sealed('陳家') };
  const building = { id: 'b1', name: '福滿大廈', address: '第三街 1 號' };
  const task = { id: 'o-task', createdBy: { accountId: admin.id, name: 'ADMIN' }, evidence: [], followUp: { action: sealed('再訪'), status: 'OPEN' } };
  const base = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '', buildings: [building], floors: [], units: [], people: [person], households: [household], observations: [task], followUpEvents: [] };
  let version = (await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: base } })).value.version;
  const put = (who, snapshot) => f.request('/api/workspace', { method: 'PUT', ...who, body: { snapshot, baseVersion: version } });

  // Correcting a phone number or a building name is open to a member.
  const corrected = { ...base, people: [{ ...person, phone: sealed('98765432') }], buildings: [{ ...building, name: '福滿大樓' }] };
  const fixed = await put(member, corrected);
  assert.equal(fixed.status, 200); version = fixed.value.version;
  // Removing a person or a household is not, and says who to ask.
  const gone = await put(member, { ...corrected, people: [] });
  assert.equal(gone.status, 403); assert.match(gone.value.error, /管理員/);
  assert.equal((await put(member, { ...corrected, households: [] })).status, 403);
  assert.equal((await put(member, { ...corrected, buildings: [] })).status, 403);

  // A follow-up event names the account that pressed the button.
  const event = by => ({ id: 'e1', observationId: 'o-task', action: 'DONE', at: '2026-10-19T00:00:00.000Z', operator: by });
  assert.equal((await put(member, { ...corrected, followUpEvents: [event({ accountId: admin.id, name: 'ADMIN' })] })).status, 403);
  // So does a record, for an administrator too.
  const forged = { id: 'o-forged', createdBy: { accountId: member.id, name: 'MEMBER' }, evidence: [] };
  assert.equal((await put(admin, { ...corrected, observations: [task, forged] })).status, 403);
  // A member's record must say who saved it; an unsigned one could never be withdrawn.
  assert.equal((await put(member, { ...corrected, observations: [task, { id: 'o-anon', evidence: [] }] })).status, 403);
  const signed = await put(member, { ...corrected, observations: [task, forged], followUpEvents: [event({ accountId: member.id, name: 'MEMBER' })] });
  assert.equal(signed.status, 200); version = signed.value.version;

  // An administrator may remove what a member may not.
  assert.equal((await put(admin, { ...corrected, people: [], households: [], observations: [task, forged], followUpEvents: [event({ accountId: member.id, name: 'MEMBER' })] })).status, 200);
});

test('an administrator filling an empty workspace keeps the names the records already carry', async t => {
  const f = await fixture(t);
  const admin = await f.account(), member = await f.account('MEMBER');
  f.openWorkspace();
  const base = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '', buildings: [], floors: [], units: [], observations: [] };
  const first = await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: base } });
  const cleared = await f.request('/api/workspace', { method: 'DELETE', ...admin });
  // Putting a backup back after a clear: the records were saved by a colleague, not by the
  // administrator restoring them, and stay that way.
  const restored = { ...base, observations: [{ id: 'o1', createdBy: { accountId: member.id, name: 'MEMBER' }, evidence: [] }, { id: 'o-demo', evidence: [] }] };
  assert.equal(first.status, 200);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...member, body: { snapshot: restored, baseVersion: cleared.value.version } })).status, 403);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', ...admin, body: { snapshot: restored, baseVersion: cleared.value.version } })).status, 200);
});

test('an institution administrator cannot take the platform administrator account away', async t => {
  const f = await fixture(t);
  const owner = await f.platform(await f.account('ADMIN', 'owner@example.test'));
  const orgAdmin = await f.account('ADMIN', 'samson@example.test');
  const member = await f.account('MEMBER');
  const users = (await f.request('/api/admin/users', orgAdmin)).value.users;
  assert.deepEqual(users.filter(u => u.platformAdmin).map(u => u.email), ['owner@example.test']);
  // No disable, no rename, no reset link they could hand themselves.
  const patch = changes => f.request(`/api/admin/users/${owner.id}`, { method: 'PATCH', ...orgAdmin, body: { name: 'ADMIN', role: 'ADMIN', disabled: false, ...changes } });
  assert.equal((await patch({ disabled: true })).status, 403);
  assert.equal((await patch({ name: 'pwn' })).status, 403);
  assert.equal((await f.request(`/api/admin/users/${owner.id}/reset`, { method: 'POST', ...orgAdmin })).status, 403);
  assert.equal((await f.request('/api/session', owner)).status, 200);
  // Their own colleagues they still manage.
  assert.equal((await f.request(`/api/admin/users/${member.id}`, { method: 'PATCH', ...orgAdmin, body: { name: 'MEMBER', role: 'MEMBER', disabled: true } })).status, 200);
  assert.equal((await f.request(`/api/admin/users/${orgAdmin.id}/reset`, { method: 'POST', ...owner })).status, 200);
  // A platform administrator stays an administrator until the flag is taken away on the server.
  const self = await f.request(`/api/admin/users/${owner.id}`, { method: 'PATCH', ...owner, body: { name: 'ADMIN', role: 'MEMBER', disabled: false } });
  assert.equal(self.status, 409);
  // The flag goes only to an active administrator, and is never set through the API.
  assert.throws(() => f.auth.setPlatformAdmin(member.id, true), /管理員/);
  await f.request(`/api/admin/users/${orgAdmin.id}`, { method: 'PATCH', ...owner, body: { name: 'ADMIN', role: 'ADMIN', disabled: false, platformAdmin: true } });
  assert.equal(f.auth.userById(orgAdmin.id).platform_admin, 0);
  const actions = f.auth.all("SELECT action FROM audit WHERE action LIKE 'platform_admin_%'").map(row => row.action);
  assert.deepEqual(actions, ['platform_admin_granted']);
});

test('cross-device sync is switched per institution, and only by the platform administrator', async t => {
  const f = await fixture(t);
  const owner = await f.platform(await f.account('ADMIN', 'owner@example.test'));
  const partnerAdmin = await f.account('ADMIN', 'partner-admin@example.test');
  createOrg(f.auth, 'org-careflow', 'CareFlow');
  moveUser(f.auth, owner.email, 'org-careflow');
  const ours = await f.platform(owner);
  const theirs = await f.account('MEMBER', 'partner-staff@example.test');
  const snapshot = { schemaVersion: '0.1-demo', isSynthetic: true, notice: '', buildings: [], floors: [], units: [], observations: [] };
  // On for our own institution: our workspace syncs, the partner's stays on its devices.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...ours, body: { key: 'workspaceSync', enabled: true } })).status, 200);
  assert.equal((await f.request('/api/features', ours)).value.features.workspaceSync, true);
  assert.equal((await f.request('/api/features', theirs)).value.features.workspaceSync, false);
  assert.equal((await f.request('/api/workspace', theirs)).status, 403);
  assert.equal((await f.request('/api/workspace', ours)).status, 200);
  // Turned on for the partner by name; an institution that does not exist is refused.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...ours, body: { key: 'workspaceSync', enabled: true, orgId: 'org-nope' } })).status, 400);
  const opened = await f.request('/api/admin/features', { method: 'PUT', ...ours, body: { key: 'workspaceSync', enabled: true, orgId: DEFAULT_ORG_ID } });
  assert.equal(opened.status, 200);
  assert.equal(opened.value.orgs[DEFAULT_ORG_ID].workspaceSync, true);
  assert.equal((await f.request('/api/features', theirs)).value.features.workspaceSync, true);
  // The partner's administrator neither switches it nor lists the institutions, but sees in
  // their own log that it was opened for them.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...partnerAdmin, body: { key: 'workspaceSync', enabled: false } })).status, 403);
  assert.equal((await f.request('/api/admin/orgs', partnerAdmin)).status, 403);
  const log = (await f.request('/api/admin/audit', partnerAdmin)).value.events.map(e => [e.action, e.target]);
  assert.ok(log.some(([action, target]) => action === 'feature_enabled' && target === `workspaceSync@${DEFAULT_ORG_ID}`));
  const orgs = (await f.request('/api/admin/orgs', ours)).value.orgs;
  assert.deepEqual(orgs.map(o => [o.id, o.admins, o.members, o.features.workspaceSync]), [[DEFAULT_ORG_ID, 1, 1, true], ['org-careflow', 1, 0, true]]);
  // A site-wide switch stays site-wide.
  await f.request('/api/admin/features', { method: 'PUT', ...ours, body: { key: 'photoIntake', enabled: true } });
  assert.equal((await f.request('/api/features', theirs)).value.features.photoIntake, true);
  void snapshot;
});

test('a site-wide sync switch from before becomes every institution\'s own', async t => {
  const f = await fixture(t);
  createOrg(f.auth, 'org-careflow', 'CareFlow');
  f.auth.run("INSERT INTO features(key,enabled,updated_at) VALUES('workspaceSync',1,5)");
  const features = createFeatureStore(f.auth);
  assert.equal(features.enabled('workspaceSync', DEFAULT_ORG_ID), true);
  assert.equal(features.enabled('workspaceSync', 'org-careflow'), true);
  assert.equal(f.auth.get("SELECT COUNT(*) AS n FROM features WHERE key='workspaceSync'").n, 0);
  // Opening the store again moves nothing twice.
  createFeatureStore(f.auth);
  assert.equal(f.auth.get('SELECT COUNT(*) AS n FROM org_features').n, 2);
});

test('institutions are created, renamed and joined from the command line, never leaving one without an administrator', async t => {
  const f = await fixture(t);
  const admin = await f.account('ADMIN', 'only-admin@example.test');
  const member = await f.account('MEMBER', 'member@example.test');
  assert.throws(() => createOrg(f.auth, 'careflow', 'CareFlow'), /org-/);
  assert.throws(() => createOrg(f.auth, 'org-careflow', '  '), /名稱/);
  assert.equal(createOrg(f.auth, 'org-careflow', 'CareFlow').name, 'CareFlow');
  assert.throws(() => createOrg(f.auth, 'org-careflow', 'again'), /已經存在/);
  assert.equal(renameOrg(f.auth, DEFAULT_ORG_ID, '明愛西營盤社區客廳').name, '明愛西營盤社區客廳');
  // The only administrator cannot leave: nobody would be left to manage the institution.
  assert.throws(() => moveUser(f.auth, admin.email, 'org-careflow'), /機構管理員/);
  assert.throws(() => moveUser(f.auth, 'nobody@example.test', 'org-careflow'), /不存在/);
  assert.throws(() => moveUser(f.auth, member.email, 'org-nope'), /沒有這個機構/);
  // A member moves; their sessions end and they sign in to the new institution's workspace.
  assert.equal((await f.request('/api/session', member)).status, 200);
  assert.deepEqual(moveUser(f.auth, member.email, 'org-careflow'), { email: member.email, from: DEFAULT_ORG_ID, to: 'org-careflow' });
  assert.equal((await f.request('/api/session', member)).status, 401);
  assert.deepEqual(listOrgs(f.auth).map(o => [o.id, o.name, o.admins, o.members]), [[DEFAULT_ORG_ID, '明愛西營盤社區客廳', 1, 0], ['org-careflow', 'CareFlow', 0, 1]]);
  assert.deepEqual(f.auth.all("SELECT action FROM audit WHERE action IN ('org_created','org_renamed','user_moved') ORDER BY id").map(r => r.action), ['org_created', 'org_renamed', 'user_moved']);
});
