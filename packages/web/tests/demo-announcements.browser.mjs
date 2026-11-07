import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-emulators-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'announcement-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const page = await context.newPage();
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporter = await supporterContext.newPage();
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i84-evidence';
const student = db.doc('students/trial-student');
const source = student.collection('demo').doc('current');
const tasks = () => student.collection('assignments').get();
const task = async () => (await tasks()).docs.find(doc => doc.data().key.sourceId === 'DEMO101_TASK1').data();
const calls = async () => JSON.parse(await readFile(`${evidence}/fake-model.json`, 'utf8')).calls;
const open = page.getByRole('button', { name: 'LMSを開く', exact: true });
const publish = page.locator('.demo-teacher-action').filter({ hasText: '書き方を書くレポート' })
  .getByRole('button', { name: 'お知らせを出す', exact: true });
const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
const notices = page.locator('[data-demo-announcement]');
const errors = [];
for (const view of [page, supporter]) { view.setDefaultTimeout(15000); view.on('pageerror', () => errors.push('browser-error')); }
async function login(view, role) {
  await view.goto('http://127.0.0.1:5177/demo-lms');
  await view.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await view.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await view.getByRole('button', { name: 'ログイン', exact: true }).click();
}
try {
  await mkdir(evidence, { recursive: true });
  await login(page, 'student');
  await open.waitFor();
  await login(supporter, 'supporter');
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '田中 太郎', exact: true }).click();
  const original = (await source.get()).data();
  await publish.click();
  await status('お知らせを出しました');
  assert.equal(await notices.count(), 1);
  const announced = (await source.get()).data();
  assert.deepEqual(announced.courses, original.courses);
  assert.equal((await tasks()).size, 0, 'publishing must not write the ledger');
  assert.match(await notices.innerText(), /書き方を書くレポートの提出期限/);
  // The reader must send what the LMS DOM says, not reach back into Firestore.
  const sent = page.waitForRequest('**/api/v1/announcements');
  const parsed = page.waitForResponse('**/api/v1/announcements');
  await open.click();
  const payload = (await sent).postDataJSON();
  assert.deepEqual(payload, { system: 'demo-lms', ...announced.announcements[0] });
  assert.equal((await parsed).status(), 200);
  assert.equal((await (await parsed).json()).status, 'proposal');
  await status('課題を確認しました。学生の画面');
  const after = await task();
  assert.equal(Date.parse(after.officialDeadline.deadline.dueAt), Date.parse(original.courses[0].assignments[0].dueAt));
  assert.equal(after.reviewReasons.length, 1);
  assert.equal(await calls(), 1);
  const timetable = await context.newPage();
  await timetable.goto('http://127.0.0.1:5177/student');
  await timetable.locator('.timetable').getByRole('button', { name: /レポートの書き方の書き方/ }).click();
  await timetable.locator('.course-panel').getByText('要確認', { exact: true }).waitFor();
  await timetable.locator('.course-panel').getByText(/お知らせでは締切が/).waitFor();
  await supporter.getByText(/お知らせでは締切が/).first().waitFor();
  const changes = (await student.collection('changes').get()).size;
  await open.click(); await status('課題を確認しました。学生の画面');
  assert.equal(await calls(), 1, 'same announcement is parsed once');
  assert.equal((await task()).reviewReasons.length, 1);
  assert.equal((await student.collection('changes').get()).size, changes);
  await page.screenshot({ path: `${evidence}/demo-wide.png`, fullPage: true });
  await timetable.screenshot({ path: `${evidence}/student-review.png`, fullPage: true });
  await supporter.screenshot({ path: `${evidence}/session-review.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await page.screenshot({ path: `${evidence}/demo-narrow.png`, fullPage: true });
  // Unavailable parsing cannot roll back or hide the successful observation.
  await page.route('**/api/v1/announcements', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }), { times: 1 });
  await open.click(); await status('課題を確認しました。お知らせの確認は終わりませんでした');
  await page.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await status('体験を最初の状態に戻しました');
  assert.equal(await notices.count(), 0);
  assert.deepEqual((await source.get()).data().announcements, []);
  assert.equal((await tasks()).size, 0);
  await open.click(); await status('課題を確認しました。学生の画面');
  assert.deepEqual((await task()).reviewReasons, []);
  assert.equal(await calls(), 1);
  await publish.click(); await status('お知らせを出しました');
  assert.notEqual((await source.get()).data().announcements[0].announcement.announcementId, payload.announcement.announcementId);
  await open.click(); await status('課題を確認しました。学生の画面');
  assert.equal(await calls(), 2, 'fresh notice after reset is not mistaken for the old notice');
  assert.equal((await task()).reviewReasons.length, 1);
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', environment: 'local Auth/Firestore + Chromium',
    model: 'fake', realCalls: 0, fakeCalls: 2, checks: ['publish changes source notice only', 'read rendered DOM and send after observation',
      'official deadline unchanged', 'student and session review reason', 'repeated open parses once', '390px no overflow',
      '503 parsing preserves observation', 'reset clears notices and reviews', 'republish after reset works'], browserErrors: errors }, null, 2));
  log('PASS Issue 84: publish -> DOM -> API -> review, deduplication, reset, fake Gemini only');
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
