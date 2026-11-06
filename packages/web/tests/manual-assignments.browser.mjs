import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-manual-tests-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'manual-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const student = await studentContext.newPage(); const supporter = await supporterContext.newPage();
const errors = [];
for (const page of [student, supporter]) { page.setDefaultTimeout(15000); page.on('pageerror', () => errors.push('browser-error')); }
const base = process.env.KADAI_WEB_ORIGIN;
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i98-browser';
const ref = db.doc('students/trial-student');
const rows = () => ref.collection('manualAssignments').get();
const target = () => ref.collection('integrations').doc('calendar').get();
const operations = [];
const pass = name => operations.push(name);
const manualList = page => page.getByRole('region', { name: '手で入れた課題', exact: true });
const calendar = student.getByRole('region', { name: '締切のカレンダー', exact: true });
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
async function form(page, title, date, time, course = '') {
  await manualList(page).getByText('課題を手で入れる', { exact: true }).click();
  const editor = manualList(page).locator('.manual-assignment-form');
  await editor.getByLabel('課題の名前', { exact: true }).fill(title);
  await editor.getByLabel('締切の日付', { exact: true }).fill(date);
  if (time) await editor.getByLabel('締切の時刻（任意）', { exact: true }).fill(time);
  await editor.getByLabel('授業（任意）', { exact: true }).selectOption(course);
  await editor.getByLabel('メモ（任意・300文字まで）', { exact: true }).fill('架空の紙を持参');
  return editor;
}
async function assertWidth(page) {
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
}
try {
  await mkdir(evidence, { recursive: true });
  await login(student, 'student');
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  const dueDate = new Date(Date.now() + 2 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  await student.goto(`${base}/student`); await student.locator('.timetable').waitFor();
  await login(supporter, 'supporter'); await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '学生 trial-student', exact: true }).click();
  const paper = '架空の紙のレポート';
  const course = JSON.stringify(['demo-lms', 'DEMO101']);
  const editor = await form(supporter, paper, dueDate, null, course);
  await editor.getByRole('button', { name: '課題を入れる', exact: true }).click();
  await editor.getByRole('status').filter({ hasText: '課題を入れました' }).waitFor();
  await student.getByRole('region', { name: '締切の近い課題', exact: true }).getByText(paper, { exact: false }).waitFor();
  await manualList(student).getByText('手で入れた課題（支援担当が入れました）', { exact: true }).waitFor();
  const deadlines = supporter.getByRole('region', { name: '次の面談までの締切', exact: true });
  await deadlines.getByRole('heading', { name: paper, exact: true }).waitFor();
  await deadlines.getByText(/日付のみ/).waitFor();
  await calendar.getByText(paper, { exact: true }).waitFor();
  const [saved] = (await rows()).docs; assert.ok(saved);
  const item = (await ref.collection('calendarItems').doc(saved.data().calendarItemKey).get()).data();
  assert.equal(item.appliedRevision, item.desiredRevision);
  assert.equal((await target()).data().mockEvents[item.eventId].event.start.date, dueDate);
  await student.locator('.course-cell').filter({ hasText: '架空の観察入門' }).first().click();
  const panel = student.getByRole('complementary', { name: '架空の観察入門の課題', exact: true });
  await panel.getByRole('heading', { name: paper, exact: true }).waitFor();
  assert.equal(await panel.locator('.manual-assignment a').count(), 0);
  pass('supporter adds date-only task; student course, upcoming list, session deadlines and durable mock calendar update');
  for (const width of [1280, 390]) {
    for (const [name, page] of [['student', student], ['supporter', supporter]]) {
      await page.setViewportSize({ width, height: 960 }); await assertWidth(page);
      await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
    }
  }
  pass('1280px and 390px retain readable author, date, memo and removal controls without document overflow');
  await student.reload(); await manualList(student).getByRole('heading', { name: paper }).waitFor();
  assert.equal((await rows()).size, 1);
  await manualList(student).getByRole('button', { name: `${paper}を消す`, exact: true }).click();
  await manualList(student).getByRole('heading', { name: paper }).waitFor({ state: 'detached' });
  await deadlines.getByRole('heading', { name: paper }).waitFor({ state: 'detached' });
  await calendar.getByText(paper, { exact: true }).waitFor({ state: 'detached' });
  assert.equal((await rows()).docs[0].data().status, 'cancelled');
  assert.equal((await target()).data().mockEvents[item.eventId], undefined);
  pass('reload retains task; student removes supporter task from both screens and persisted calendar');
  const ownTitle = '架空の手渡しプリント';
  const ownForm = await form(student, ownTitle, dueDate, '14:35');
  let lost = false;
  await student.route('**/api/v1/students/trial-student/manual-assignments/*', async route => {
    if (route.request().method() !== 'PUT' || lost) return route.continue();
    lost = true; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed');
  });
  await ownForm.getByRole('button', { name: '課題を入れる', exact: true }).click();
  await ownForm.getByRole('status').filter({ hasText: '保存を確認できませんでした' }).waitFor();
  await ownForm.getByRole('button', { name: '課題を入れる', exact: true }).click();
  await ownForm.getByRole('status').filter({ hasText: '課題を入れました' }).waitFor();
  await deadlines.getByRole('heading', { name: ownTitle }).waitFor();
  await deadlines.getByText(/14:35/).waitFor();
  assert.equal(await manualList(supporter).getByRole('button', { name: `${ownTitle}を消す`, exact: true }).count(), 0);
  assert.equal((await rows()).docs.filter(doc => doc.data().status === 'active').length, 1);
  await calendar.getByText(ownTitle, { exact: true }).waitFor();
  pass('student adds without a course and with time; lost response retries once; supporter cannot remove student task');
  await student.goto(`${base}/demo-lms`);
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  assert.equal((await rows()).docs.filter(doc => doc.data().status === 'active').length, 1);
  await student.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
  await deadlines.getByRole('heading', { name: ownTitle }).waitFor({ state: 'detached' });
  assert.equal((await rows()).size, 0);
  assert.equal((await ref.collection('calendarItems').get()).size, 0);
  assert.equal((await target()).exists, false);
  pass('opening LMS preserves manual tasks; demo reset clears manual tasks and their calendar destination');
  // A supporter can remove their own task from the session screen too.
  const lastForm = manualList(supporter).locator('.manual-assignment-form');
  await lastForm.getByLabel('課題の名前', { exact: true }).fill('架空の面談で追加');
  await lastForm.getByLabel('締切の日付', { exact: true }).fill(dueDate);
  await lastForm.getByLabel('授業（任意）', { exact: true }).selectOption('');
  await lastForm.getByRole('button', { name: '課題を入れる', exact: true }).click();
  await manualList(supporter).getByRole('button', { name: '架空の面談で追加を消す', exact: true }).click();
  await manualList(supporter).getByRole('heading', { name: '架空の面談で追加' }).waitFor({ state: 'detached' });
  pass('supporter removes own task from session');
  await ref.collection('supporters').doc('trial-supporter').update({ revokedAt: new Date().toISOString() });
  await supporter.getByRole('alert').filter({ hasText: /表示.*消しました/ }).waitFor();
  assert.equal(await supporter.locator('.manual-assignment, .manual-assignment-form').count(), 0);
  pass('revoked sharing clears manual tasks and controls');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', operations, browserErrors: errors.length }, null, 2));
  log(JSON.stringify({ observations: [{ requirement_id: 'manual-browser', status: 'pass', observed: {
    operations: operations.length, browserErrors: errors.length }, evidence_files: ['operations.json', 'student-1280.png', 'student-390.png', 'supporter-1280.png', 'supporter-390.png'] }] }));
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
