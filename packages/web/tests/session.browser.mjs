import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.SESSION_DEMO_PASSWORD) throw new Error('local-session-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'session-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(15000);
const dir = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i21-evidence';
const errors = [];
page.on('pageerror', () => errors.push('browser-error'));
const student = db.collection('students').doc('demo-student-a');
const grant = student.collection('supporters').doc('demo-supporter');
const contextRef = student.collection('sessionContext').doc('current');
const originalContext = (await contextRef.get()).data();
assert.ok(originalContext);
try {
  await page.goto('http://127.0.0.1:5177/session');
  await page.getByLabel('メールアドレス').fill('demo-supporter@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.SESSION_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: '学生 demo-student-a', exact: true }).click();
  const deadlines = page.getByRole('region', { name: '次の面談までの締切' });
  const changes = page.getByRole('region', { name: '前回の面談からの変化' });
  const decisions = page.getByRole('region', { name: '今日決めること' });
  await deadlines.getByRole('heading', { name: '架空の数学レポート' }).waitFor();
  await changes.getByText('課題が出ました', { exact: true }).waitFor();
  await decisions.getByText('要確認', { exact: true }).waitFor();
  assert.match(await decisions.innerText(), /LMSで日付を確かめます/);
  assert.match(await deadlines.innerText(), /日付のみ/);
  assert.equal(await page.getByRole('heading', { name: '今日決めること', exact: true }).count(), 1);
  assert.doesNotMatch(await page.locator('main').innerText(), /一緒に決めること|一緒に確かめること|前回決めたこと|準備の候補|未提出/);
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/session-wide.png`, fullPage: true });

  await page.getByRole('button', { name: '学生 demo-student-b', exact: true }).click();
  await deadlines.getByRole('heading', { name: '架空の物理演習' }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /架空の数学レポート/);
  await page.getByRole('button', { name: '学生 demo-student-a', exact: true }).click();
  await deadlines.getByRole('heading', { name: '架空の数学レポート' }).waitFor();

  await page.getByText('面談日時を変える', { exact: true }).click();
  const nextInput = page.getByLabel('次の面談（日本時間）');
  const save = page.getByRole('button', { name: '面談日時を保存', exact: true });
  // A next session at the start of today excludes the future task; no oracle dates are moved.
  const before = new Date().toISOString().slice(0, 10) + 'T00:00';
  await nextInput.fill(before); await save.click();
  await page.waitForFunction(text => !globalThis.document.getElementById('session-deadlines').parentElement.innerText.includes(text), '架空の数学レポート');
  assert.equal((await contextRef.get()).data().nextSessionAt, before + ':00+09:00');
  // Reopen after the live context update remounts the editor.
  await page.getByText('面談日時を変える', { exact: true }).click();
  await nextInput.fill(''); await save.click();
  await page.getByText('次の面談日時を決めると、この期間の締切が出ます。').waitFor();
  assert.equal((await contextRef.get()).data().nextSessionAt, null);
  await contextRef.set(originalContext);
  await deadlines.getByRole('heading', { name: '架空の数学レポート' }).waitFor();

  const task = (await student.collection('assignments').get()).docs[0];
  await task.ref.update({ 'latest.title': '数学レポートの変更後' });
  await deadlines.getByRole('heading', { name: '数学レポートの変更後' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await page.screenshot({ path: `${dir}/session-narrow.png`, fullPage: true });

  await grant.update({ revokedAt: new Date().toISOString() });
  await page.getByRole('alert').filter({ hasText: /表示.*消しました/ }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /数学レポートの変更後|日付のみ|今回、課題の締切/);
  assert.equal(await page.locator('#session-changes').count(), 0);
  await page.getByRole('button', { name: '一覧を更新', exact: true }).click();
  await page.getByRole('button', { name: '学生 demo-student-a', exact: true }).waitFor({ state: 'detached' });
  await page.screenshot({ path: `${dir}/session-revoked.png`, fullPage: true });

  await page.getByRole('button', { name: '学生 demo-student-b', exact: true }).click();
  await deadlines.getByRole('heading', { name: '架空の物理演習' }).waitFor();
  await page.getByRole('link', { name: '学生', exact: true }).click();
  // The student route uses the same authenticated Firebase account.
  await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
  await page.getByRole('link', { name: '面談', exact: true }).click();
  await page.getByRole('button', { name: '学生 demo-student-b', exact: true }).click();
  await deadlines.getByRole('heading', { name: '架空の物理演習' }).waitFor();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('heading', { name: '面談にログイン', exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /架空の物理演習|学生 demo-student/);
  assert.deepEqual(errors, []);
  await writeFile(`${dir}/operations.json`, JSON.stringify({ status: 'pass', operations: [
    'allowed student selection', 'deadline/change/review sections', 'student switch', 'session time edit',
    'unset session time', 'live assignment update', '390px layout', 'revocation clears all sections',
    'revoked student removed', 'shared identity across routes', 'logout clears students and data',
  ], browserErrors: errors, viewport: [1280, 960, 390, 844] }, null, 2));
  log('PASS C23: student selection, session sections, dates, live changes, narrow layout, revocation, shared login and logout');
} finally {
  await grant.set({ scopes: ['all'], revokedAt: null });
  await contextRef.set(originalContext);
  await browser.close(); await db.terminate(); await deleteApp(app);
}
