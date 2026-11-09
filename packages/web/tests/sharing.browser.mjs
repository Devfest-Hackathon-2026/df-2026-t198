import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-sharing-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const { getAuth } = requireServer('firebase-admin/auth');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'sharing-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext();
const supporterContext = await browser.newContext();
const student = await studentContext.newPage(); const supporter = await supporterContext.newPage();
for (const page of [student, supporter]) page.setDefaultTimeout(15000);
const base = process.env.KADAI_WEB_ORIGIN;
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i257-browser';
const grant = db.doc('students/trial-student/supporters/trial-supporter');
const profile = db.doc('demoAccounts/trial-student');
const panel = () => student.getByRole('region', { name: '共有している支援担当', exact: true });
const revoke = () => panel().getByRole('button', { name: '共有をやめる', exact: true });
const restore = () => panel().getByRole('button', { name: 'もう一度共有する', exact: true });
const readySession = () => supporter.getByRole('region', { name: /^次の面談までの締切/ });
const errors = []; const checks = [];
for (const page of [student, supporter]) page.on('pageerror', () => errors.push('browser-error'));
async function login(page, role) {
  await page.goto(`${base}/demo-lms`); await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
}
async function stopSharing() {
  student.once('dialog', async dialog => {
    assert.match(dialog.message(), /この支援担当はあなたの時間割・課題・準備の予定を見られなくなります/);
    await dialog.accept();
  });
  await revoke().click();
  await panel().getByRole('status').filter({ hasText: '共有をやめました。' }).waitFor();
  await restore().waitFor();
}
try {
  await mkdir(evidence, { recursive: true });
  await getAuth(app).updateUser('trial-supporter', { displayName: '架空の支援担当A' });
  await login(student, 'student');
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await login(supporter, 'supporter');
  for (const width of [1280, 390]) {
    for (const page of [student, supporter]) await page.setViewportSize({ width, height: width === 1280 ? 960 : 844 });
    await student.goto(`${base}/student`); await revoke().waitFor();
    await panel().getByText('架空の支援担当A', { exact: true }).waitFor();
    await supporter.goto(`${base}/session/trial-student`); await readySession().waitFor();
    assert.equal(await student.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    const before = await grant.get();
    student.once('dialog', dialog => dialog.dismiss()); await revoke().click();
    assert.equal((await grant.get()).updateTime.isEqual(before.updateTime), true);
    await student.screenshot({ path: `${evidence}/student-active-${width}.png`, fullPage: true });
    // Failed writes must leave the grant and the open session intact.
    await student.route('**/api/v1/sharing/supporters/trial-supporter/revoke', route => route.fulfill({ status: 403, json: { error: 'forbidden' } }), { times: 1 });
    student.once('dialog', dialog => dialog.accept()); await revoke().click();
    await panel().getByRole('alert').waitFor();
    assert.equal((await grant.get()).updateTime.isEqual(before.updateTime), true);
    assert.equal(await readySession().count(), 1);
    await stopSharing();
    await supporter.getByRole('alert').filter({ hasText: /表示.*消しました/ }).waitFor();
    assert.equal(await readySession().count(), 0);
    assert.equal(await supporter.locator('.session-dates, .session-candidate, .session-task').count(), 0);
    await student.screenshot({ path: `${evidence}/student-revoked-${width}.png`, fullPage: true });
    await supporter.screenshot({ path: `${evidence}/supporter-revoked-${width}.png`, fullPage: true });
    await supporter.goto(`${base}/session`);
    await supporter.getByRole('link', { name: '自分の面談を見る', exact: true }).waitFor();
    assert.equal(await supporter.locator('a[href="/session/trial-student"]').count(), 0);
    await restore().click();
    await panel().getByRole('status').filter({ hasText: '共有を再開しました。' }).waitFor();
    await revoke().waitFor();
    await supporter.goto(`${base}/session`);
    await supporter.getByRole('link', { name: '田中 太郎', exact: true }).click(); await readySession().waitFor();
    assert.deepEqual((await grant.get()).data(), { scopes: ['all'], revokedAt: null });
    checks.push({ width, confirmationCancel: true, failurePreservesGrant: true, openSessionCleared: true, removedFromList: true, restored: true, overflow: false });
  }
  await stopSharing();
  await student.goto(`${base}/demo-lms`);
  student.once('dialog', dialog => dialog.accept());
  await student.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
  assert.equal((await grant.get()).data().revokedAt, null);
  await student.goto(`${base}/student`); await revoke().waitFor();
  await grant.delete();
  await panel().waitFor({ state: 'detached' });
  await grant.set({ scopes: ['all'], revokedAt: null }); await revoke().waitFor();
  await profile.update({ public: true });
  const loaded = student.waitForResponse(response => response.url().endsWith('/api/v1/sharing/supporters') && response.ok());
  await student.reload(); assert.equal((await (await loaded).json()).canManage, false);
  assert.equal(await panel().count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/sharing.json`, JSON.stringify({ status: 'pass', checks, resetRestored: true, emptyHidden: true, publicHidden: true, pageErrors: errors }, null, 2) + '\n');
} finally {
  await profile.update({ public: false });
  await grant.set({ scopes: ['all'], revokedAt: null });
  await browser.close(); await db.terminate(); await deleteApp(app);
}
