#!/usr/bin/env node
/* Optional real-package LuCI smoke. It is intentionally not part of tests/run.sh:
 * provide a disposable QEMU URL and password explicitly when running it. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.MULTILOGIN_QEMU_URL;
const password = process.env.MULTILOGIN_LUCI_PASSWORD;
if (!base || !password) {
  process.stderr.write('usage: MULTILOGIN_QEMU_URL=http://127.0.0.1:8584 MULTILOGIN_LUCI_PASSWORD=... node tests/qemu-playwright-smoke.mjs\n');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

async function login() {
  await page.goto(`${base}/cgi-bin/luci/`, { waitUntil: 'domcontentloaded' });
  const loginField = page.locator('#luci_password');
  if (await loginField.count()) {
    await loginField.fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForTimeout(400);
  }
  assert.equal(await page.locator('#luci_password').count(), 0, 'LuCI login did not complete');
}

async function checkRoute(route, expectedMethod, expectedOk) {
  const events = [];
  const onRequest = (request) => {
    if (request.url().includes('/ubus/'))
      events.push({ type: 'request', body: request.postData() || '' });
  };
  const onResponse = async (response) => {
    if (!response.url().includes('/ubus/'))
      return;
    let body = '';
    try { body = await response.text(); } catch {}
    events.push({ type: 'response', status: response.status(), body });
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  await page.goto(`${base}/cgi-bin/luci/admin/services/multilogin/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  page.off('request', onRequest);
  page.off('response', onResponse);

  const responseBodies = events.filter((event) => event.type === 'response').flatMap((event) => {
    try { return JSON.parse(event.body); } catch { return []; }
  });
  const multiloginResults = responseBodies.flatMap((batch) => batch ?? [])
    .filter((entry) => entry?.result?.[1] && entry.result[1].raw_url !== undefined || entry?.result?.[1]?.data);
  assert.ok(multiloginResults.length > 0, `${route} did not return a MultiLogin response`);
  const matching = multiloginResults.find((entry) => entry.result[1]?.data?.raw_url !== undefined || entry.result[1]?.data?.settings_enabled !== undefined);
  if (expectedMethod === 'get_overview')
    assert.equal(matching?.result?.[1]?.ok, expectedOk, `${route} overview envelope is not successful`);
  assert.equal(events.some((event) => event.body.includes('"url"') || event.body.includes('"path"')), false, `${route} exposed a URL/path request field`);
  assert.equal(pageErrors.length, 0, `${route} raised browser errors: ${pageErrors.join('; ')}`);
  const text = await page.locator('body').innerText();
  assert.equal(/invalid request fields|提交的脚本状态无效/.test(text), false, `${route} still shows the rpcd request-boundary failure`);
  process.stdout.write(`PASS qemu-playwright ${route}: ${events.filter((event) => event.type === 'request').length} ubus request batch(es)\n`);
}

await login();
await checkRoute('overview', 'get_overview', true);
await checkRoute('scripts', 'script_info', true);
await browser.close();
