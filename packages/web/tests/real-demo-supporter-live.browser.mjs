import assert from 'node:assert/strict';
import process from 'node:process';
import { readFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const projectId = 'project-00439085-4e2d-44c3-9a8';
const origin = `https://${projectId}.web.app`;
let phase = 'explicit-live-verification-required';
let browser;
try {
  assert.deepEqual(process.argv.slice(2), ['--verify-real-demo-supporter']);
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    assert.ok(!(key in process.env));
  }
  phase = 'local-credentials';
  const path = join(homedir(), 'dev/df-2026-t198/fixtures-local/real-demo-supporter.local.json');
  const info = await lstat(path);
  assert.ok(info.isFile());
  assert.equal(info.mode & 0o777, 0o600);
  const account = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(account.projectId, projectId);
  assert.equal(account.origin, origin);
  assert.equal(account.supporter.uid, 'real-demo-supporter');
  assert.equal(account.supporter.email, 'real-demo-supporter@example.invalid');
  assert.equal(typeof account.studentUid, 'string');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  let browserErrors = 0;
  page.on('pageerror', () => { browserErrors++; });
  // No console, request body, screenshot, trace, HAR, token or private assignment capture.
  phase = 'password-login';
  await page.goto(`${origin}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(account.supporter.email);
  await page.getByLabel('パスワード').fill(account.supporter.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  // This is intentionally a normal Auth user, without a demoAccounts profile.
  await page.getByRole('alert').filter({ hasText: '体験用のデータを開けませんでした' }).waitFor();
  phase = 'session-student-list';
  const responseReady = page.waitForResponse(response =>
    response.url() === `${origin}/api/v1/supporter/students` && response.request().method() === 'GET');
  await page.goto(`${origin}/session`);
  const response = await responseReady;
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { students: [{ uid: account.studentUid }] });
  const students = page.getByRole('navigation', { name: '担当する学生', exact: true });
  const expected = students.locator(`a[href="/session/${encodeURIComponent(account.studentUid)}"]`);
  await expected.waitFor();
  assert.equal(await students.getByRole('link').count(), 1);
  assert.equal(browserErrors, 0);
  // Do not open the student: this assertion requires no access to real coursework.
  phase = 'logout';
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('button', { name: 'Googleでログイン', exact: true }).waitFor();
  process.stdout.write('real-supporter-live: password login passed; expected students 1/1; logout passed; browser errors 0\n');
} catch {
  process.stderr.write(`real-supporter-verification-failed: ${phase}\n`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
