import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAuth } from './auth.mjs';
import { createAuthServer } from './http.mjs';
import { createOrg } from './orgs.mjs';

const password = 'Careflow test passphrase 2026!';

/**
 * The small fixture from auth.test.mjs, cut down to what the AI switch needs. It keeps its
 * own instance of the account service so the two files share nothing at run time.
 */
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-ai-test-'));
  const auth = openAuth(join(dir, 'auth.sqlite'), { now: () => Date.now() });
  const origin = 'http://127.0.0.1:5173';
  const server = createAuthServer(auth, { origin, secure: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); auth.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, csrf, headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    return { status: response.status, value: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function account(role = 'ADMIN', email = `${role.toLowerCase()}@example.test`) {
    const invite = auth.createUser({ email, name: role, role });
    await auth.redeem(invite.token, password, 'fixture');
    const login = await request('/api/login', { method: 'POST', body: { email, password } });
    assert.equal(login.status, 200);
    return { id: invite.user.id, email, cookie: login.cookie, csrf: login.value.csrf };
  }
  /** The platform administrator is set from the server's command line, never through the API. */
  async function platform(who) {
    auth.setPlatformAdmin(who.id, true);
    const login = await request('/api/login', { method: 'POST', body: { email: who.email, password } });
    Object.assign(who, { cookie: login.cookie, csrf: login.value.csrf });
    return who;
  }
  return { auth, request, account, platform };
}

/** A second institution, with its own administrator, so cross-institution reads are testable. */
const anotherOrg = auth => { createOrg(auth, 'org-other', '另一機構'); return 'org-other'; };

test('the retired credential routes answer 410 and store nothing', async t => {
  const f = await fixture(t);
  const admin = await f.account();
  const member = await f.account('MEMBER', 'staff@example.test');
  // Signing in still comes first: an anonymous caller learns nothing about the routes.
  assert.equal((await f.request('/api/org/ai')).status, 401);
  assert.equal((await f.request('/api/org/ai/key')).status, 401);
  // Phase 5 keeps the key in the server's .env (docs/AI_ASSISTANT.md 5.3). The institution's
  // sealed copy is gone: no handing it out, no storing one, no status to report — 410 on all
  // three, for every role, rather than a route that quietly does nothing.
  const sealedKey = `enc:v1:${Buffer.alloc(48, 7).toString('base64')}`;
  const credential = { provider: 'azure-openai', model: 'gpt-4.1-mini', sealedKey };
  for (const who of [admin, member]) {
    assert.equal((await f.request('/api/org/ai', who)).status, 410);
    assert.equal((await f.request('/api/org/ai/key', who)).status, 410);
    assert.equal((await f.request('/api/org/ai', { ...who, method: 'PUT', body: credential })).status, 410);
    assert.equal((await f.request('/api/org/ai', { ...who, method: 'DELETE' })).status, 410);
  }
  // Nothing was written: no table was even created, and no audit row mentions a key.
  const tables = f.auth.all("SELECT name FROM sqlite_master WHERE type='table' AND name='org_ai_settings'");
  assert.deepEqual(tables.map(row => ({ ...row })), []);
  assert.ok(!JSON.stringify(f.auth.all('SELECT * FROM audit')).includes(sealedKey.slice(7, 27)));
});

test('the AI switch belongs to the platform administrator, because the key is the platform’s', async t => {
  const f = await fixture(t);
  const orgAdmin = await f.account('ADMIN', 'org-admin@example.test');
  const member = await f.account('MEMBER', 'staff@example.test');
  const other = anotherOrg(f.auth);
  // Phase 5 moved the Azure key into the server's .env, shared by every institution, so the
  // switch that spends it is the platform's too (docs/AI_ASSISTANT.md 2.2 decision 18).
  // The institution administrator sees the state and cannot change it.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'aiAssistant', enabled: true } })).status, 403);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'aiAssistant', enabled: true, orgId: other } })).status, 403);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...member, body: { key: 'aiAssistant', enabled: true } })).status, 403);
  assert.equal((await f.request('/api/features', member)).value.features.aiAssistant, false);
  // The platform administrator turns it, for its own institution and for another.
  const owner = await f.platform(await f.account('ADMIN', 'owner@example.test'));
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...owner, body: { key: 'aiAssistant', enabled: true } })).status, 200);
  assert.equal((await f.request('/api/features', member)).value.features.aiAssistant, true);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...owner, body: { key: 'aiAssistant', enabled: true, orgId: other } })).status, 200);
  // An institution administrator does not get the site's list of institutions back.
  const refused = await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'workspaceSync', enabled: true } });
  assert.equal(refused.status, 403);
  assert.equal(refused.value.orgs, undefined);
});
