import assert from 'node:assert/strict';
import { readFile, writeFile, cp, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { localProcesses } from './helpers/local-processes.mjs';

// Run after pnpm --filter web... build. No real Firebase project or account is needed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { start, finish, ready, checkPorts, stop } = localProcesses({ ...process.env, KADAI_API_PORT: '1' }, 'pwa');
const directory = await mkdtemp(join(tmpdir(), 'todoku-pwa-'));
const release = join(directory, 'release');
const next = join(directory, 'next');
const base = 'http://127.0.0.1:5192';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i232-pwa';
let browser;
try {
  await checkPorts([5192]);
  await cp(new URL('../dist/', import.meta.url), release, { recursive: true });
  const preview = start('pnpm', ['--filter', 'web', 'exec', 'vite', 'preview', '--outDir', release,
    '--host', '127.0.0.1', '--port', '5192', '--strictPort'], true);
  await ready(base, preview);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const browserErrors = [];
  context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)));
  const page = await context.newPage();
  await page.goto(`${base}/student`);
  await page.waitForFunction(() => globalThis.navigator.serviceWorker.controller);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const parsed = await cdp.send('Page.getAppManifest');
  assert.equal(parsed.errors.length, 0);
  const manifest = JSON.parse(parsed.data);
  assert.equal(manifest.name, 'ToDoku'); assert.equal(manifest.short_name, 'ToDoku');
  assert.equal(manifest.lang, 'ja'); assert.equal(manifest.start_url, '/student');
  assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#18202e'); assert.equal(manifest.background_color, '#f7f8f4');
  for (const [path, size] of [...manifest.icons.map(icon => [icon.src, Number(icon.sizes.split('x')[0])]), ['/apple-touch-icon.png', 180]]) {
    const response = await context.request.get(`${base}${path}`); assert.equal(response.status(), 200);
    const png = await response.body();
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, []);
  const initial = await page.evaluate(() => globalThis.caches.keys());
  assert.equal(initial.length, 1); assert.match(initial[0], /^todoku-pwa-[a-f0-9]{16}$/);
  for (const [path, method] of [['/api/health', 'GET'], ['/__/auth/', 'GET'], ['/student', 'POST']]) {
    const received = page.waitForResponse(response => response.url() === `${base}${path}` && response.request().method() === method);
    await page.evaluate(async ({ path, method }) => { await globalThis.fetch(path, { method }); }, { path, method });
    assert.equal((await received).fromServiceWorker(), false, `${method} ${path} bypasses the worker`);
  }
  const keys = await page.evaluate(async () => {
    const cache = await globalThis.caches.open((await globalThis.caches.keys())[0]);
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  assert.ok(keys.includes('/index.html'));
  assert.ok(keys.some(path => path.endsWith('.js'))); assert.ok(keys.some(path => path.endsWith('.css')));
  assert.ok(keys.every(path => path === '/index.html' || /^\/assets\/[\w-]+-[\w-]{8,}\.(js|css)$/.test(path)));
  await mkdir(evidence, { recursive: true });
  await context.setOffline(true);
  const offline = await page.goto(`${base}/student`);
  assert.equal(offline.status(), 200); assert.equal(offline.fromServiceWorker(), true);
  await page.locator('.app-shell').waitFor();
  await page.screenshot({ path: join(evidence, 'offline-390.png'), fullPage: true });
  await context.setOffline(false);

  // A real second build changes JS bytes/hashes, without editing any tracked source.
  await finish(start('pnpm', ['--filter', 'web', 'exec', 'vite', 'build', '--minify', 'false', '--outDir', next], true));
  const oldHtml = await readFile(join(release, 'index.html'), 'utf8');
  const newHtml = await readFile(join(next, 'index.html'), 'utf8');
  assert.notEqual(newHtml, oldHtml);
  const oldWorker = await readFile(join(release, 'sw.js'), 'utf8');
  const newWorker = await readFile(join(next, 'sw.js'), 'utf8');
  assert.notEqual(newWorker, oldWorker, 'the actual build changes the worker version automatically');
  await cp(next, release, { recursive: true });
  await page.close();
  const reopened = await context.newPage();
  const updated = await reopened.goto(`${base}/student`);
  assert.equal(await updated.text(), newHtml, 'the next open receives the new HTML immediately');
  let current = initial;
  for (let attempt = 0; attempt < 100; attempt++) {
    current = await reopened.evaluate(() => globalThis.caches.keys());
    if (current.length === 1 && current[0] !== initial[0]) break;
    await new Promise(resolve => globalThis.setTimeout(resolve, 100));
  }
  assert.equal(current.length, 1);
  assert.notEqual(current[0], initial[0], 'the new cache replaces the original cache');
  await context.setOffline(true);
  const updatedOffline = await reopened.reload();
  assert.equal(await updatedOffline.text(), newHtml);
  await reopened.locator('.app-shell').waitFor();
  await context.setOffline(false);
  // A clean context loading Vite development mode must not install the production worker.
  await checkPorts([5193]);
  const dev = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5193', '--strictPort'], true);
  await ready('http://127.0.0.1:5193', dev);
  const devPage = await (await browser.newContext()).newPage();
  await devPage.goto('http://127.0.0.1:5193/student');
  await devPage.locator('.app-shell').waitFor();
  assert.equal(await devPage.evaluate(async () => (await globalThis.navigator.serviceWorker.getRegistrations()).length), 0);
  assert.deepEqual(browserErrors, []);
  const result = { chromium: browser.version(), manifest: 'pass', installabilityErrors: [], iconSizes: [192, 512, 512, 180],
    excludedRequests: 'pass', cachePaths: keys, offlineShell: 'pass', viewport: 390,
    update: { old: initial[0], current: current[0], nextOpen: 'new HTML', offlineAfterUpdate: 'new HTML', obsoleteCaches: 0 },
    developmentRegistrations: 0, browserErrors: 0, phoneHomeScreenAndGoogleLogin: 'not tested' };
  await writeFile(join(evidence, 'pwa.json'), `${JSON.stringify(result, null, 2)}\n`);
  log(JSON.stringify(result));
} finally {
  await browser?.close(); stop(); await rm(directory, { recursive: true, force: true });
}
