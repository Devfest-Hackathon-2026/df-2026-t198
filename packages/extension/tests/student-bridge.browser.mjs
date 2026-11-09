// Loads the built extension into a real Chromium and messages it from the student page's origin.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm --filter extension exec node tests/student-bridge.browser.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import console from 'node:console';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extensionId = 'ghlhpjencbpglkbjmhadcbjgjpngdhll';
const dir = await mkdtemp(join(tmpdir(), 'student-bridge-'));
let context;
try {
  // Never read the user's real config. Build an isolated copy with synthetic values.
  const extensionDir = join(dir, 'packages/extension');
  await mkdir(extensionDir, { recursive: true });
  for (const path of ['icons', 'src', 'package.json', 'build.mjs', 'build-config.mjs', 'bundle-audit.mjs', 'manifest.json', 'options.html', 'options.css', 'popup.html', 'popup.css']) {
    await cp(new URL(`../${path}`, import.meta.url), join(extensionDir, path), { recursive: true });
  }
  await cp(new URL('../../core/src', import.meta.url), join(dir, 'packages/core/src'), { recursive: true });
  await symlink(fileURLToPath(new URL('../../core/node_modules', import.meta.url)), join(dir, 'packages/core/node_modules'), 'dir');
  await cp(new URL('../../../lms-definitions', import.meta.url), join(dir, 'lms-definitions'), { recursive: true });
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(extensionDir, 'node_modules'), 'dir');
  await writeFile(join(extensionDir, 'config.local.json'), JSON.stringify({ oauthClientId: '123-synthetic.apps.googleusercontent.com',
    apiOrigin: 'https://api.example.invalid',
    firebase: { apiKey: 'synthetic-api-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' } }));
  await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: extensionDir });
  const dist = join(extensionDir, 'dist');

  context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  await context.route(/^https:\/\/(synthetic\.web\.app|other\.example\.test)\//, route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>架空の学生画面</title>' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host, extensionId);

  const ask = (page, message, wait = 20_000) => page.evaluate(([id, body, limit]) => new Promise(resolve => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) { resolve('no-runtime'); return; }
    globalThis.setTimeout(() => resolve('no-reply'), limit);
    try { runtime.sendMessage(id, body, reply => resolve(runtime.lastError ? 'not-delivered' : reply)); }
    catch { resolve('not-delivered'); }
  }), [extensionId, message, wait]);

  const student = await context.newPage();
  await student.goto('https://synthetic.web.app/student');
  const status = await ask(student, { type: 'todoku-status', uid: 'synthetic-student' });
  assert.deepEqual(status, { ok: true, account: 'none' });
  // This Chromium has no Google account: the real identity API opens its sign-in step and waits,
  // like a student who has not answered the dialog yet. Consent itself needs a real account.
  const waiting = ask(student, { type: 'todoku-calendar-connect', uid: 'synthetic-student' }, 8_000);
  await student.waitForTimeout(2_000);
  const second = await ask(student, { type: 'todoku-calendar-connect', uid: 'synthetic-student' });
  assert.deepEqual(second, { ok: false, code: 'busy' });
  const connect = await waiting;
  assert.ok(connect === 'no-reply' || (connect.ok === false && connect.code === 'authorization-denied'), JSON.stringify(connect));
  assert.deepEqual(await ask(student, { type: 'todoku-calendar-sync', uid: 'synthetic-student' }), { ok: false, code: 'not-connected' });
  for (const message of [{ type: 'digest-setting', enabled: true }, { type: 'auth-probe-run' }, { type: 'calendar-sync' },
    { type: 'todoku-calendar-connect', uid: 'synthetic-student', calendarId: 'chosen-by-the-page' }]) {
    assert.deepEqual(await ask(student, message), { ok: false, code: 'unconfigured' });
  }
  const saved = await worker.evaluate(() => globalThis.chrome.storage.local.get(null));
  // Nothing is saved before the student passes the dialog: no calendar was created or registered.
  assert.deepEqual(Object.keys(saved), []);

  const other = await context.newPage();
  await other.goto('https://other.example.test/student');
  const refused = await ask(other, { type: 'todoku-status', uid: 'synthetic-student' }, 3_000);
  assert.ok(refused === 'no-runtime' || refused === 'not-delivered', `unlisted origin reached the extension: ${JSON.stringify(refused)}`);

  console.log(JSON.stringify({ extensionId, chromium: context.browser()?.version() ?? 'persistent', status, connect, second,
    windows: context.pages().map(page => new URL(page.url()).origin), unlistedOrigin: refused, savedKeys: Object.keys(saved) }));
} finally {
  await context?.close();
  await rm(dir, { recursive: true, force: true });
}
