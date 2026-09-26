import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2];
const setup = readFileSync(process.argv[3], 'utf8').match(/https?:\/\/\S+#set-password=[\w-]+/)?.[0];
assert.ok(setup, 'bootstrap link exists');
const password = 'Atlas browser test passphrase 2026!';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
let count = 0;
const pass = name => { count++; console.log(`PASS ${name}`); };
const contexts = [];
async function page() { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context); return context.newPage(); }
async function login(p, email, value = password) {
  await p.goto(base); await p.getByLabel('邮箱', { exact: true }).fill(email);
  await p.getByLabel('密码', { exact: true }).fill(value); await p.getByRole('button', { name: '登录', exact: true }).click();
  await p.getByRole('button', { name: '账号设置', exact: true }).waitFor();
}
async function activate(p, link) {
  await p.goto(link); await p.getByLabel('新密码', { exact: true }).fill(password); await p.getByLabel('确认密码', { exact: true }).fill(password);
  assert.equal(new URL(p.url()).hash, '');
  await p.getByRole('button', { name: '设置密码', exact: true }).click(); await p.getByRole('button', { name: '登录', exact: true }).waitFor();
}
try {
  const admin = await page(); const errors = []; admin.on('pageerror', e => errors.push(e.message));
  await admin.goto(base); await admin.getByRole('heading', { name: '登录工作台' }).waitFor();
  assert.equal(await admin.locator('.app-shell').count(), 0); pass('unauthenticated workspace is not mounted');
  await activate(admin, setup); await login(admin, 'atlas-test@example.test'); pass('bootstrap, password activation and login');
  await admin.reload(); await admin.getByRole('button', { name: '账号设置', exact: true }).waitFor(); pass('session survives page reload');
  await admin.getByRole('button', { name: '账号设置', exact: true }).click();
  await admin.getByLabel('姓名', { exact: true }).fill('Test Member'); await admin.getByLabel('邮箱', { exact: true }).fill('member@example.test');
  await admin.getByRole('button', { name: '创建邀请', exact: true }).click();
  const link = await admin.getByLabel('一次性链接').inputValue();
  const member = await page(); await activate(member, link); await login(member, 'member@example.test'); pass('administrator invite and member activation');
  await member.getByRole('button', { name: '账号设置', exact: true }).click();
  assert.equal(await member.getByRole('heading', { name: '机构账号' }).count(), 0);
  assert.equal((await member.request.get(`${base}/api/admin/users`)).status(), 403); pass('member cannot access administrator API or controls');
  await member.getByRole('button', { name: '返回工作台', exact: true }).click();
  await member.getByRole('button', { name: '紙本與 Excel', exact: true }).click();
  await member.getByRole('button', { name: '檢視 mock 範例', exact: true }).click();
  await member.getByRole('button', { name: '確認合併資料', exact: true }).click(); await member.locator('.list-heading').waitFor();
  await member.getByRole('button', { name: '退出登录', exact: true }).click(); await member.getByRole('button', { name: '登录', exact: true }).waitFor();
  await login(member, 'atlas-test@example.test'); assert.equal(await member.locator('.list-heading').count(), 0); pass('account switch cannot inherit previous demo data');
  await member.getByRole('button', { name: '退出登录', exact: true }).click(); await login(member, 'member@example.test'); await member.locator('.list-heading').waitFor(); pass('original account retains its own demo cache');
  const sibling = await member.context().newPage(); await sibling.goto(base); await sibling.locator('.list-heading').waitFor();
  await member.getByRole('button', { name: '退出登录', exact: true }).click(); await sibling.getByRole('heading', { name: '登录工作台' }).waitFor();
  await login(member, 'member@example.test'); await sibling.close(); pass('logout clears other tabs through account notification');
  const row = admin.getByRole('row').filter({ hasText: 'member@example.test' }).first(); await row.getByRole('button', { name: '停用', exact: true }).click();
  await member.evaluate(() => globalThis.dispatchEvent(new globalThis.Event('focus'))); await member.getByRole('heading', { name: '登录工作台' }).waitFor(); pass('disabled account loses access on session recheck without page reload');
  await row.getByRole('button', { name: '启用', exact: true }).click();
  await row.getByRole('button', { name: '重置密码', exact: true }).click();
  const reset = await admin.getByLabel('一次性链接').inputValue(); await activate(member, reset); await login(member, 'member@example.test'); pass('administrator recovery link works');
  await member.getByRole('button', { name: '账号设置', exact: true }).click();
  await member.getByLabel('当前密码').fill(password); await member.getByLabel('新密码', { exact: true }).fill(password + ' changed'); await member.getByLabel('确认新密码').fill(password + ' changed');
  await member.getByRole('button', { name: '修改并重新登录' }).click(); await member.getByRole('heading', { name: '登录工作台' }).waitFor();
  await login(member, 'member@example.test', password + ' changed'); pass('self-service password change requires reauthentication');
  const idle = await page(); await idle.clock.install({ time: new Date() });
  await login(idle, 'member@example.test', password + ' changed');
  let polls = 0; idle.on('request', request => { if (request.url() === `${base}/api/session`) polls++; });
  await Promise.all([idle.waitForResponse(`${base}/api/session`), idle.clock.runFor(30_000)]);
  await idle.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(resolve)));
  await idle.clock.runFor(90_000);
  assert.equal(polls, 1, 'polling itself must not count as user activity');
  await idle.close(); pass('idle browser stops renewing sessions without user activity');
  await admin.getByRole('button', { name: '隐藏链接', exact: true }).click();
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.ok(await admin.evaluate(() => globalThis.document.documentElement.scrollWidth <= 390));
  await admin.locator('.account-page').evaluate(el => { el.scrollTop = 0; });
  await admin.screenshot({ path: process.env.AUTH_SCREENSHOT || '/tmp/atlas-account-settings.png', fullPage: true });
  pass('mobile account settings fit viewport');
  assert.deepEqual(errors, []); pass('no uncaught admin browser errors');
  console.log(`${count} account browser checks passed`);
} finally { for (const context of contexts) await context.close(); await browser.close(); }
