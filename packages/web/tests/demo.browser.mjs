import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'demo-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const student = await studentContext.newPage();
const supporter = await supporterContext.newPage();
const errors = [];
const requests = [];
for (const page of [student, supporter]) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => errors.push('browser-error'));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/')) requests.push({ path, status: response.status() });
  });
}
const base = 'http://127.0.0.1:5177';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i19-evidence';
const source = db.doc('students/trial-student/demo/current');
const ledger = () => db.collection('students/trial-student/assignments').get();
const changes = () => db.collection('students/trial-student/changes').get();
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
try {
  await login(student, 'student');
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  await login(supporter, 'supporter');
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '学生 trial-student', exact: true }).click();
  const deadlines = supporter.getByRole('region', { name: '次の面談までの締切' });
  assert.equal((await ledger()).size, 0);
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await deadlines.getByText('架空の観察ノート', { exact: true }).waitFor();
  assert.equal((await ledger()).size, 2);
  assert.equal(await deadlines.getByText('架空の振り返り', { exact: true }).count(), 0);
  const timetable = await studentContext.newPage();
  timetable.setDefaultTimeout(15000);
  timetable.on('pageerror', () => errors.push('browser-error'));
  await timetable.goto(`${base}/student`);
  await timetable.locator('.timetable').getByRole('button', { name: /架空の観察入門/ }).click();
  await timetable.getByRole('heading', { name: '架空の観察ノート', exact: true }).waitFor();
  const oldDeadline = (await ledger()).docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1').data().officialDeadline.deadline.dueAt;
  const beforeChanges = (await changes()).size;
  const sessionBefore = await deadlines.innerText();
  const beforeTimetable = await timetable.locator('.course-panel').innerText();
  await mkdir(evidence, { recursive: true });
  await student.screenshot({ path: `${evidence}/demo-wide.png`, fullPage: true });
  await student.getByRole('button', { name: '「架空の観察ノート」の締切を1日延ばす', exact: true }).click();
  await student.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  assert.equal((await changes()).size, beforeChanges);
  assert.equal((await ledger()).docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1').data().officialDeadline.deadline.dueAt, oldDeadline);
  assert.equal(await deadlines.innerText(), sessionBefore);
  assert.equal(await timetable.locator('.course-panel').innerText(), beforeTimetable);
  const newDue = (await source.get()).data().courses[0].assignments[0].dueAt;
  assert.equal(Date.parse(newDue) - Date.parse(oldDeadline), 86400_000);

  // Let the real server apply the observation, then drop the response to exercise a retry.
  let sentId;
  await student.route('**/api/v1/observations', async route => {
    sentId = route.request().postDataJSON().observationId;
    await route.fetch();
    await route.abort('failed');
  }, { times: 1 });
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('alert').filter({ hasText: '操作が終わりませんでした' }).waitFor();
  const afterApplied = (await changes()).size;
  assert.equal(afterApplied, beforeChanges + 1);
  const replay = student.waitForRequest('**/api/v1/observations');
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  assert.equal((await replay).postDataJSON().observationId, sentId);
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  assert.equal((await changes()).size, afterApplied);
  await supporter.waitForFunction(previous => globalThis.document.querySelector('[aria-labelledby="session-deadlines"]').innerText !== previous, sessionBefore);
  await timetable.waitForFunction(previous => globalThis.document.querySelector('.course-panel').innerText !== previous, beforeTimetable);
  assert.equal(Date.parse((await ledger()).docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1').data().officialDeadline.deadline.dueAt), Date.parse(newDue));
  await supporter.getByRole('region', { name: '前回の面談からの変化' }).getByText('締切が変わりました', { exact: false }).waitFor();
  await supporter.screenshot({ path: `${evidence}/session-updated.png`, fullPage: true });
  await student.setViewportSize({ width: 390, height: 844 });
  assert.equal(await student.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await student.screenshot({ path: `${evidence}/demo-narrow.png`, fullPage: true });
  assert.doesNotMatch(await student.locator('main').innerText(), /Googleでログイン|カレンダーに接続|YNUに接続/);
  await student.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await student.getByLabel('メールアドレス').waitFor();
  assert.doesNotMatch(await student.locator('main').innerText(), /架空の観察ノート|架空の観察入門/);
  await supporter.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await supporter.getByRole('heading', { name: '面談にログイン', exact: true }).waitFor();
  assert.doesNotMatch(await supporter.locator('main').innerText(), /架空の観察ノート|学生 trial-student/);
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', operations: [
    'email login in separate student and supporter browsers', 'source has no preseeded ledger',
    'rendered outerHTML through the common reader and observations API', 'empty course and submitted assignment',
    'teacher extends source only', 'open LMS changes ledger and both live screens',
    'lost response replay retains observation ID and adds no history', '390px layout', 'logout clears data',
  ], browserErrors: errors }, null, 2));
  log('PASS C32/C33: rendered HTML, teacher source change, observation replay, live student/session screens, separate logins and logout');
} catch (error) {
  await mkdir(evidence, { recursive: true });
  await student.screenshot({ path: `${evidence}/failure-student.png`, fullPage: true });
  log({ requests, errors, alerts: await student.getByRole('alert').allTextContents() });
  throw error;
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
