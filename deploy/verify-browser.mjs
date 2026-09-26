#!/usr/bin/env node
// Optional real-browser regression suite; install Playwright separately.
// npm install --no-save --package-lock=false playwright && npx playwright install chromium
// node deploy/verify-browser.mjs [http://127.0.0.1:8080]
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';

const base = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
let key;
const email = process.env.AUTH_TEST_EMAIL, password = process.env.AUTH_TEST_PASSWORD;
if (!email || !password) throw new Error('Set AUTH_TEST_EMAIL and AUTH_TEST_PASSWORD for an isolated test account.');
async function authenticate(context) {
  const response = await context.request.post(`${base}/api/login`, { headers: { origin: base }, data: { email, password } });
  assert.equal(response.status(), 200);
  const session = await response.json();
  key = `careflow-atlas.account.${session.user.id}.demo`;
}
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('Install optional Playwright and Chromium first; see docs/DOCKER.md.'); process.exit(2); }
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const check = async (name, run) => {
  try { await run(); results.push(['PASS', name]); console.log(`PASS ${name}`); }
  catch (error) { results.push(['FAIL', name]); console.error(`FAIL ${name}: ${error.message}`); }
};
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const failedLocal = [];
page.on('requestfailed', request => { if (request.url().startsWith(base) && request.failure()?.errorText !== 'net::ERR_ABORTED') failedLocal.push(request.url()); });
const network = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (/tiles\.openfreemap\.org|\.pbf(?:\?|$)/.test(response.url())) network.push({ url: response.url(), ok: response.ok() }); });
const snapshot = () => page.evaluate(k => JSON.parse(globalThis.localStorage.getItem(k)), key);
const openImport = () => page.getByRole('button', { name: '紙本與 Excel', exact: true }).click();
const sample = async () => {
  await openImport();
  await page.getByRole('button', { name: '檢視 mock 範例', exact: true }).click();
  await page.locator('.cf-review').waitFor();
};
const merge = async () => {
  const button = page.getByRole('button', { name: '確認合併資料', exact: true });
  assert.equal(await button.isEnabled(), true);
  await button.click();
  await page.locator('dialog.cf-dialog--import').waitFor({ state: 'hidden' });
};
try {
  await check('page mounts', async () => {
    await authenticate(context);
    assert.equal((await page.goto(base))?.status(), 200);
    await page.locator('.brand strong').waitFor();
  });
  await check('mapping change invalidates the original import payload', async () => {
    await sample();
    assert.equal(await page.getByRole('button', { name: '確認合併資料', exact: true }).isEnabled(), true);
    await page.getByLabel('工作員 對應欄位', { exact: true }).selectOption('7');
    assert.equal(await page.getByRole('button', { name: '確認合併資料', exact: true }).isDisabled(), true);
    assert.match(await page.locator('.cf-review').innerText(), /不會合併更改前/);
    assert.equal(await snapshot(), null);
    await page.locator('dialog[open]').getByRole('button', { name: '關閉', exact: true }).click();
  });
  await check('Chinese workbook merge and reload preserve exact data', async () => {
    await sample(); await merge();
    const before = await snapshot();
    assert.ok(before.observations.length > 0);
    await page.reload(); await page.locator('.list-heading').waitFor();
    assert.deepEqual(await snapshot(), before);
  });
  await check('building, floor and unit navigation; append observation', async () => {
    await page.locator('.building-list button').first().click();
    await page.locator('.cf-floor-strip button').first().click();
    await page.locator('.cf-units button').first().click();
    const before = await snapshot();
    await page.getByRole('button', { name: /記錄今次結果/ }).click();
    await page.locator('textarea[name="finding"]').fill('合成审查回归：追加观察');
    await page.getByRole('button', { name: '儲存記錄', exact: true }).click();
    await page.locator('.cf-editor').waitFor({ state: 'hidden' });
    const after = await snapshot();
    assert.equal(after.observations.length, before.observations.length + 1);
    assert.deepEqual(after.observations.slice(0, -1), before.observations);
    await page.reload(); await page.locator('.list-heading').waitFor();
    assert.deepEqual(await snapshot(), after);
  });
  await check('district merge preserves existing history and reaches 20 buildings', async () => {
    const before = await snapshot();
    await openImport();
    await page.getByRole('button', { name: '檢視街區範例', exact: true }).click();
    await page.locator('.cf-review').waitFor(); await merge();
    const after = await snapshot();
    assert.equal(after.buildings.length, 20);
    for (const observation of before.observations) assert.deepEqual(after.observations.find(o => o.id === observation.id), observation);
  });
  await check('Excel and JSON export produce downloads', async () => {
    await openImport();
    for (const name of ['匯出目前 Excel', '完整 JSON 備份']) {
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name, exact: true }).click();
      const download = await downloading;
      assert.equal(await download.failure(), null);
      assert.match(download.suggestedFilename(), name.includes('Excel') ? /\.xlsx$/ : /\.json$/);
    }
    await page.locator('dialog[open]').getByRole('button', { name: '關閉', exact: true }).click();
  });
  await check('legacy workbook remains importable without losing newer data', async () => {
    const before = await snapshot();
    await openImport();
    await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('../public/demo/careflow-field-outreach-demo.xlsx', import.meta.url)));
    await page.locator('.cf-review').waitFor(); await merge();
    assert.deepEqual(await snapshot(), before);
  });
  await check('paper form preview opens and closes', async () => {
    await openImport();
    await page.getByRole('button', { name: '列印大廈紙本', exact: true }).click();
    await page.getByRole('dialog', { name: '大廈紙本預覽' }).waitFor();
    assert.equal(await page.locator('.paper-page tbody tr').count(), 10);
    await page.getByRole('button', { name: '關閉紙本預覽', exact: true }).click();
  });
  await check('map floor labels remain interactive after the MapLibre upgrade', async () => {
    await page.locator('.building-list button').first().click();
    const label = page.getByRole('button', { name: /在立體地圖選擇 5F/ });
    await label.click({ timeout: 25000 });
    assert.equal(await page.locator('.cf-floor-strip button[aria-pressed="true"]').innerText(), '5F\n復訪');
    await page.getByRole('button', { name: '返回街區總覽', exact: true }).click();
  });
  await check('mobile list and observation form fit the viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '清單', exact: true }).click();
    await page.locator('.building-list button').first().click();
    await page.locator('.cf-floor-strip button').first().click();
    await page.locator('.cf-units button').first().click();
    await page.getByRole('button', { name: /記錄今次結果/ }).click();
    const bounds = await page.locator('dialog[open]').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 390));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '地圖', exact: true }).click();
    await page.getByRole('button', { name: '返回街區總覽', exact: true }).click();
  });
  await check('no uncaught browser errors or failed local resources', async () => { assert.deepEqual(errors, []); assert.deepEqual(failedLocal, []); });
  await check('MapLibre creates a nonempty canvas', async () => {
    await page.locator('.maplibregl-canvas').waitFor({ timeout: 25000 });
    const size = await page.locator('.maplibregl-canvas').boundingBox();
    assert.ok(size?.width > 0 && size?.height > 0);
    await page.locator('.building-map-marker').first().waitFor({ timeout: 25000 });
  });
  // Requests alone are not evidence of a loaded basemap.
  if (network.some(r => r.ok && /\.pbf(?:\?|$)/.test(r.url))) { results.push(['PASS', 'external basemap']); console.log('PASS external basemap tiles returned successfully'); }
  else { results.push(['WARN', 'external basemap not verified']); console.log('WARN external basemap not verified; successful tile responses were not observed'); }
  await page.screenshot({ path: '/tmp/careflow-atlas-browser-review.png', fullPage: true });
  await check('HTTP-compatible startup without crypto.randomUUID', async () => {
    const http = await browser.newContext();
    await authenticate(http);
    await http.addInitScript(() => Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined }));
    const httpPage = await http.newPage();
    await httpPage.goto(base);
    await httpPage.locator('.brand strong').waitFor();
    await http.close();
  });
  await check('map network failure still permits list, forms and persistence', async () => {
    const offline = await browser.newContext();
    await authenticate(offline);
    await offline.route('https://tiles.openfreemap.org/**', route => route.abort());
    const fallback = await offline.newPage();
    await fallback.goto(base);
    await fallback.getByRole('button', { name: '紙本與 Excel', exact: true }).click();
    await fallback.getByRole('button', { name: '檢視 mock 範例', exact: true }).click();
    await fallback.getByRole('button', { name: '確認合併資料', exact: true }).click();
    await fallback.locator('.list-heading').waitFor();
    assert.ok(await fallback.evaluate(k => JSON.parse(globalThis.localStorage.getItem(k)).buildings.length > 0, key));
    await offline.close();
  });
} finally { await browser.close(); }
const failed = results.filter(([status]) => status === 'FAIL').length;
console.log(`${results.filter(([status]) => status === 'PASS').length} passed, ${failed} failed, ${results.filter(([status]) => status === 'WARN').length} unverified`);
process.exitCode = failed ? 1 : 0;
