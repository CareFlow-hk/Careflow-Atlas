import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ORG_ID, openAuth } from './auth.mjs';
import { createAuthServer } from './http.mjs';
import { createOrg, moveUser } from './orgs.mjs';

const password = 'Careflow test passphrase 2026!';

/**
 * The small fixture from auth.test.mjs, cut down to what the AI credential needs. It keeps
 * its own instance of the account service so the two files share nothing at run time.
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

const sealedKey = `enc:v1:${Buffer.alloc(48, 7).toString('base64')}`;
const credential = (extra = {}) => ({ provider: 'azure-openai', model: 'gpt-4.1-mini', sealedKey, ...extra });
/** A second institution, with its own administrator, so cross-institution reads are testable. */
const anotherOrg = auth => { createOrg(auth, 'org-other', '另一機構'); return 'org-other'; };

test('the AI credential is off, unreadable and unset until an administrator turns it on', async t => {
  const f = await fixture(t);
  const admin = await f.account();
  assert.equal((await f.request('/api/org/ai')).status, 401);
  assert.equal((await f.request('/api/org/ai/key')).status, 401);
  // The assistant is off for a new institution; nothing has been stored yet either.
  assert.deepEqual((await f.request('/api/org/ai', admin)).value, { configured: false });
  assert.equal((await f.request('/api/org/ai/key', admin)).status, 403);
  // A switch nobody could have set yet still refuses: off is off, not "not configured".
  assert.equal((await f.request('/api/org/ai/key', { ...admin, method: 'POST', body: {} })).status, 403);
});

test('only an institution administrator sets, changes and removes the key; members only read the status', async t => {
  const f = await fixture(t);
  const admin = await f.account(), member = await f.account('MEMBER');
  f.auth.run("INSERT INTO org_features(org_id,key,enabled,updated_at) VALUES(?,'aiAssistant',1,0)", DEFAULT_ORG_ID);
  // The status carries no part of the key, so every member may see it — there is nothing to leak.
  assert.equal((await f.request('/api/org/ai', member)).status, 200);
  assert.equal((await f.request('/api/org/ai', { ...member, method: 'PUT', body: credential() })).status, 403);
  assert.equal((await f.request('/api/org/ai', { ...member, method: 'DELETE' })).status, 403);
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential() })).status, 200);
  // A member uses the sealed copy exactly as the administrator does: that is the accepted trade-off.
  const theirs = await f.request('/api/org/ai/key', member);
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.value, { provider: 'azure-openai', model: 'gpt-4.1-mini', sealedKey });
  // And still cannot remove it.
  assert.equal((await f.request('/api/org/ai', { ...member, method: 'DELETE' })).status, 403);
  assert.equal((await f.request('/api/org/ai', admin)).value.configured, true);
});

test('what the server stores is only the sealed copy, and the status never repeats it', async t => {
  const f = await fixture(t);
  const admin = await f.account();
  f.auth.run("INSERT INTO org_features(org_id,key,enabled,updated_at) VALUES(?,'aiAssistant',1,0)", DEFAULT_ORG_ID);
  // A key sent in the clear is refused: the browser must seal it first, or the promise is void.
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ sealedKey: 'sk-live-abcdefghij' }) })).status, 400);
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ sealedKey: 'enc:v1:short' }) })).status, 400);
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ provider: 'some-other-ai' }) })).status, 400);
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ model: 'gpt 4 with spaces' }) })).status, 400);
  const saved = await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ provider: 'anthropic', model: 'claude-sonnet-5-5' }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(Object.keys(saved.value).sort(), ['configured', 'model', 'provider', 'providerLabel', 'updatedAt', 'updatedBy']);
  assert.equal(saved.value.configured, true);
  assert.equal(saved.value.providerLabel, 'Anthropic');
  assert.equal(saved.value.updatedBy, 'ADMIN');
  // The row holds the sealed value; the key it seals never appears anywhere the server can read.
  const row = f.auth.get('SELECT sealed_key FROM org_ai_settings WHERE org_id=?', DEFAULT_ORG_ID);
  assert.equal(row.sealed_key, sealedKey);
  assert.ok(!JSON.stringify(saved.value).includes(sealedKey.slice(0, 12)));
  // Removing is idempotent and takes the row with it.
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'DELETE' })).value.configured, false);
  assert.equal((await f.request('/api/org/ai', { ...admin, method: 'DELETE' })).value.configured, false);
  assert.equal(f.auth.get('SELECT 1 AS x FROM org_ai_settings WHERE org_id=?', DEFAULT_ORG_ID), undefined);
  assert.equal((await f.request('/api/org/ai/key', admin)).status, 404);
});

test('the AI switch belongs to the institution administrator, for their own institution only', async t => {
  const f = await fixture(t);
  const orgAdmin = await f.account('ADMIN', 'org-admin@example.test');
  const member = await f.account('MEMBER', 'staff@example.test');
  const other = anotherOrg(f.auth);
  // Their own institution: yes. A member: no. Another institution's switches: no.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'aiAssistant', enabled: true } })).status, 200);
  assert.equal((await f.request('/api/features', member)).value.features.aiAssistant, true);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...member, body: { key: 'aiAssistant', enabled: true } })).status, 403);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'aiAssistant', enabled: true, orgId: other } })).status, 403);
  assert.equal((await f.request('/api/features', member)).value.features.aiAssistant, true);
  // The switches that send data off this deployment stay the platform administrator's.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'photoIntake', enabled: true } })).status, 403);
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'workspaceSync', enabled: true } })).status, 403);
  // The platform administrator may still turn an institution's assistant on its behalf.
  const owner = await f.platform(await f.account('ADMIN', 'owner@example.test'));
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...owner, body: { key: 'aiAssistant', enabled: true, orgId: other } })).status, 200);
  // An institution administrator does not get the site's list of institutions back.
  const turned = await f.request('/api/admin/features', { method: 'PUT', ...orgAdmin, body: { key: 'aiAssistant', enabled: true } });
  assert.deepEqual(turned.value.orgs, []);
});

test('each institution keeps its own credential; another institution cannot read it', async t => {
  const f = await fixture(t);
  const ours = await f.account('ADMIN', 'ours@example.test');
  const other = anotherOrg(f.auth);
  const theirs = await f.account('ADMIN', 'theirs@example.test');
  moveUser(f.auth, theirs.email, other);
  const relogin = await f.request('/api/login', { method: 'POST', body: { email: theirs.email, password } });
  Object.assign(theirs, { cookie: relogin.cookie, csrf: relogin.value.csrf });
  for (const orgId of [DEFAULT_ORG_ID, other]) f.auth.run("INSERT INTO org_features(org_id,key,enabled,updated_at) VALUES(?,'aiAssistant',1,0)", orgId);
  const mine = credential({ model: 'gpt-4.1' });
  assert.equal((await f.request('/api/org/ai', { ...ours, method: 'PUT', body: mine })).status, 200);
  // The other institution's assistant is on and has nothing set: not our key, not an error.
  assert.deepEqual((await f.request('/api/org/ai', theirs)).value, { configured: false });
  assert.equal((await f.request('/api/org/ai/key', theirs)).status, 404);
  assert.equal((await f.request('/api/org/ai', { ...theirs, method: 'PUT', body: credential({ model: 'claude-sonnet-5-5', provider: 'anthropic' }) })).status, 200);
  assert.equal((await f.request('/api/org/ai/key', ours)).value.model, 'gpt-4.1');
  assert.equal((await f.request('/api/org/ai/key', theirs)).value.model, 'claude-sonnet-5-5');
  // Neither can turn the other's switch.
  assert.equal((await f.request('/api/admin/features', { method: 'PUT', ...theirs, body: { key: 'aiAssistant', enabled: false, orgId: DEFAULT_ORG_ID } })).status, 403);
});

test('setting and removing the credential is audited without the key ever reaching the log', async t => {
  const f = await fixture(t);
  const admin = await f.account();
  f.auth.run("INSERT INTO org_features(org_id,key,enabled,updated_at) VALUES(?,'aiAssistant',1,0)", DEFAULT_ORG_ID);
  await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ provider: 'openai', model: 'gpt-4.1' }) });
  await f.request('/api/org/ai', { ...admin, method: 'PUT', body: credential({ provider: 'deepseek', model: 'deepseek-chat' }) });
  await f.request('/api/org/ai', { ...admin, method: 'DELETE' });
  const events = f.auth.all("SELECT actor, action, target FROM audit WHERE action LIKE 'ai_key_%' ORDER BY id").map(row => ({ ...row }));
  assert.deepEqual(events, [
    { actor: admin.id, action: 'ai_key_set', target: `openai@${DEFAULT_ORG_ID}` },
    { actor: admin.id, action: 'ai_key_changed', target: `deepseek@${DEFAULT_ORG_ID}` },
    { actor: admin.id, action: 'ai_key_removed', target: `deepseek@${DEFAULT_ORG_ID}` },
  ]);
  assert.ok(!JSON.stringify(f.auth.all('SELECT * FROM audit')).includes(sealedKey.slice(7, 27)));
});
