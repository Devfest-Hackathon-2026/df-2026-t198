import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { openJudgeLogin } from './helpers/judge-login.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.SESSION_DEMO_PASSWORD) {
  throw new Error('local-session-required');
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'student-list-browser');
const db = getFirestore(app);
const browser = await chromium.launch();
const dir = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-f2-browser';
const now = new Date('2026-11-10T06:00:00Z');
const errors = []; const measurements = [];
try {
  await mkdir(dir, { recursive: true });
  for (const [suffix, name, day, count] of [['a', '架空の学生あおい', '2026-11-15', 2], ['b', '架空の学生みどり', '2026-11-11', 1]]) {
    const uid = `demo-student-${suffix}`; const student = db.collection('students').doc(uid);
    await db.doc(`demoAccounts/${uid}`).set({ role: 'student', studentId: uid, displayName: name });
    const tasks = await student.collection('assignments').get();
    const deadline = { kind: 'date', date: day, timeZone: 'Asia/Tokyo', dueText: '架空の日付' };
    for (const task of tasks.docs) await task.ref.update({ 'officialDeadline.deadline': deadline });
    await student.collection('sessionContext').doc('current').set({ lastSessionAt: '2026-11-09T06:00:00Z', nextSessionAt: '2026-11-16T06:00:00Z' });
    for (const change of (await student.collection('changes').get()).docs) await change.ref.delete();
    for (let i = 0; i < count; i++) await student.collection('changes').doc(`fictional-${i}`).set({ changeId: `fictional-${i}`,
      assignmentKey: tasks.docs[0].data().key, kind: 'new', before: null, after: null,
      recordedAt: now.toISOString(), observationId: 'fictional' });
    await student.collection('fetchStates').doc('demo-lms').set({ studentId: uid, system: 'demo-lms',
      lastSucceededAt: '2026-11-10T05:00:00Z', lastAttemptedAt: '2026-11-10T05:00:00Z',
      lastResult: 'success', lastFailureKind: null, lastAppliedObservationId: 'fictional' });
  }
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    // Permit only local application/emulator traffic; never fall back to a live service.
    await context.route('**/*', route => {
      const hostname = new URL(route.request().url()).hostname;
      return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', () => errors.push('browser-error'));
    await page.clock.setFixedTime(now);
    await page.goto(`${process.env.KADAI_WEB_ORIGIN}/session`);
    await openJudgeLogin(page);
    await page.getByLabel('メールアドレス').fill('demo-supporter@example.invalid');
    await page.getByLabel('パスワード').fill(process.env.SESSION_DEMO_PASSWORD);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    const links = page.locator('.session-students nav a');
    await page.waitForFunction(() => globalThis.document.querySelectorAll('.session-students nav a').length === 2);
    assert.deepEqual(await links.locator('strong').allTextContents(), ['架空の学生みどり', '架空の学生あおい']);
    const first = await links.first().innerText();
    for (const fact of ['2026/11/11（日付のみ）', '今週の締切 1件', '前回の面談からの変化 1件', '準備の予定：なし', '11/10(火) 14:00']) assert.ok(first.includes(fact), fact);
    assert.equal(await page.locator('.session-student-id').count(), 0);
    await page.evaluate(() => globalThis.document.fonts.ready);
    const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `${dir}/list-${width}.png`, fullPage: true });
    await page.getByLabel('並べ方').selectOption('changes');
    assert.deepEqual(await links.locator('strong').allTextContents(), ['架空の学生あおい', '架空の学生みどり']);
    await page.getByRole('link', { name: '架空の学生みどり', exact: true }).click();
    await page.locator('.session-steps').waitFor();
    assert.equal(new URL(page.url()).pathname, '/session/demo-student-b');
    assert.equal(await page.locator('h1').innerText(), '架空の学生みどり');
    await page.getByRole('link', { name: '学生を選び直す', exact: true }).click();
    await page.getByRole('link', { name: '架空の学生みどり', exact: true }).waitFor();
    const grant = db.doc('students/demo-student-b/supporters/demo-supporter');
    await grant.update({ revokedAt: now.toISOString() });
    await page.getByRole('link', { name: '架空の学生みどり', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('架空の学生みどり', { exact: true }).count(), 0);
    assert.equal(await links.count(), 1);
    await page.screenshot({ path: `${dir}/revoked-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('heading', { name: '面談にログイン' }).waitFor();
    assert.equal(await links.count(), 0);
    await grant.update({ revokedAt: null });
    measurements.push({ width, rows: 2, overflow, deadlineOrder: true, changeOrder: true, opensSession: true, revocation: true, logout: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${dir}/browser.json`, JSON.stringify({ measurements, errors }, null, 2));
  log(JSON.stringify({ measurements, errors }));
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
