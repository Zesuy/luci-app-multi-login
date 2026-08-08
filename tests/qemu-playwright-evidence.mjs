#!/usr/bin/env node
/* Optional screenshot evidence for an explicitly prepared disposable QEMU.
 * It performs LuCI login and read-only navigation only. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

process.umask(0o077);

const base = process.env.MULTILOGIN_QEMU_URL;
const password = process.env.MULTILOGIN_LUCI_PASSWORD;
const evidenceDirectory = process.env.MULTILOGIN_QEMU_EVIDENCE_DIR;
const repositoryCommit = process.env.MULTILOGIN_QEMU_REPOSITORY_COMMIT || '';
const packageName = process.env.MULTILOGIN_QEMU_PACKAGE_NAME || '';
const packageSha256 = process.env.MULTILOGIN_QEMU_PACKAGE_SHA256 || '';

if (!base || !password || !evidenceDirectory || !path.isAbsolute(evidenceDirectory)) {
  process.stderr.write('usage: MULTILOGIN_QEMU_URL=http://127.0.0.1:8584 MULTILOGIN_LUCI_PASSWORD=... MULTILOGIN_QEMU_EVIDENCE_DIR=/empty/absolute/path node tests/qemu-playwright-evidence.mjs\n');
  process.exit(2);
}
let baseUrl;
try {
  baseUrl = new URL(base);
} catch {
  throw new Error('MULTILOGIN_QEMU_URL must be a valid URL');
}
if (
  baseUrl.protocol !== 'http:' ||
  baseUrl.hostname !== '127.0.0.1' ||
  !/^[0-9]+$/.test(baseUrl.port) ||
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.pathname !== '/' ||
  baseUrl.search ||
  baseUrl.hash
) {
  throw new Error('MULTILOGIN_QEMU_URL must be an uncredentialed http://127.0.0.1:<port> root URL');
}
if (!fs.existsSync(evidenceDirectory) || !fs.statSync(evidenceDirectory).isDirectory() || fs.lstatSync(evidenceDirectory).isSymbolicLink())
  throw new Error('evidence directory must be an existing non-symlink directory');
if (fs.readdirSync(evidenceDirectory).length !== 0)
  throw new Error('evidence directory must be empty; existing evidence is never overwritten');
if (packageSha256 && !/^[0-9a-f]{64}$/.test(packageSha256))
  throw new Error('package SHA-256 must be 64 lowercase hexadecimal characters');

const routes = [
  ['overview', 'overview'],
  ['configuration', 'configuration'],
  ['network', 'network'],
  ['troubleshooting', 'maintenance/troubleshooting'],
  ['scripts', 'maintenance/scripts'],
];
const viewports = [
  ['1440', { width: 1440, height: 900 }, routes],
  ['390', { width: 390, height: 844 }, routes],
  ['375', { width: 375, height: 812 }, routes.filter(([name]) => ['configuration', 'scripts'].includes(name))],
];
const plannedFiles = viewports.flatMap(([label, , selectedRoutes]) => selectedRoutes.map(([name]) => `${label}-${name}.png`));
plannedFiles.push('evidence.json');
for (const file of plannedFiles)
  assert.equal(fs.existsSync(path.join(evidenceDirectory, file)), false, `refusing to overwrite ${file}`);

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function login(page) {
  await page.goto(`${base}/cgi-bin/luci/`, { waitUntil: 'domcontentloaded' });
  const loginField = page.locator('#luci_password');
  if (await loginField.count()) {
    await loginField.fill(password);
    const namedButton = page.getByRole('button', { name: /^(Log in|登录)$/i });
    if (await namedButton.count())
      await namedButton.first().click();
    else
      await page.locator('input[type="submit"], button[type="submit"]').first().click();
    await page.waitForTimeout(400);
  }
  assert.equal(await page.locator('#luci_password').count(), 0, 'LuCI login did not complete');
}

const browser = await chromium.launch({ headless: true });
const records = [];
try {
  for (const [viewportLabel, viewport, selectedRoutes] of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page);
    for (const [routeName, routePath] of selectedRoutes) {
      const pageErrors = [];
      const onPageError = (error) => pageErrors.push(error.message);
      page.on('pageerror', onPageError);
      await page.goto(`${base}/cgi-bin/luci/admin/services/multilogin/${routePath}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      const body = await page.locator('body').innerText();
      assert.equal(/invalid request fields|提交的脚本状态无效|nullnull/.test(body), false, `${viewportLabel}/${routeName} contains a known failure marker`);
      const dimensions = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      const overflow = dimensions.scrollWidth - dimensions.innerWidth;
      assert.ok(overflow <= 1, `${viewportLabel}/${routeName} has ${overflow}px horizontal page overflow`);
      assert.deepEqual(pageErrors, [], `${viewportLabel}/${routeName} raised page errors`);
      const filename = `${viewportLabel}-${routeName}.png`;
      const screenshot = path.join(evidenceDirectory, filename);
      await page.screenshot({ path: screenshot, fullPage: true });
      records.push({
        route: routePath,
        viewport,
        screenshot: filename,
        sha256: digest(screenshot),
        horizontal_overflow_px: overflow,
        page_error_count: pageErrors.length,
      });
      page.off('pageerror', onPageError);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const evidence = {
  schema: 1,
  generated_at: new Date().toISOString(),
  repository_commit: repositoryCommit,
  package_name: packageName,
  package_sha256: packageSha256,
  read_only_navigation: true,
  portal_actions_performed: false,
  records,
};
const evidenceFile = path.join(evidenceDirectory, 'evidence.json');
fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
process.stdout.write(`PASS qemu-playwright evidence: ${records.length} screenshots in ${evidenceDirectory}\n`);
