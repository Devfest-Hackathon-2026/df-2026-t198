import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-plans-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'plans-browser'); const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const student = await studentContext.newPage(); const supporter = await supporterContext.newPage();
const errors = [];
for (const page of [student, supporter]) { page.setDefaultTimeout(15000); page.on('pageerror', () => errors.push('browser-error')); }
const base = process.env.KADAI_WEB_ORIGIN;
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i49-browser';
const ref = db.doc('students/trial-student');
const plans = () => ref.collection('plans').get();
const target = () => ref.collection('integrations').doc('calendar').get();
const active = async () => (await plans()).docs.filter(doc => doc.data().status === 'active');
const operations = [];
const pass = name => operations.push(name);
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
async function assertNoPreparationEvents() {
  assert.equal(Object.values((await target()).data().mockEvents).filter(value => value.event.summary.startsWith('準備：')).length, 0);
}
try {
  await mkdir(evidence, { recursive: true });
  // Candidate dates depend on today. Keep the fictional assignment beyond the next weekdays.
  const demo = ref.collection('demo').doc('current'); const data = (await demo.get()).data();
  for (const course of data.courses) for (const task of course.assignments) task.dueAt = new Date(Date.now() + 9 * 86400000).toISOString();
  await demo.set(data);
  await ref.collection('sessionContext').doc('current').update({ nextSessionAt: new Date(Date.now() + 10 * 86400000).toISOString() });
  await login(student, 'student'); await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await student.goto(`${base}/student`); await student.locator('.timetable').waitFor();
  await login(supporter, 'supporter'); await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '学生 trial-student', exact: true }).click();
  await supporter.getByRole('link', { name: '② 相談する', exact: true }).click();
  assert.equal(await supporter.getByRole('button', { name: '学生に確認を頼む', exact: true }).count(), 0);
  await supporter.locator('.session-candidate button').first().click();
  await supporter.getByLabel('開始時刻', { exact: true }).fill('09:00');
  await supporter.getByLabel('終了時刻', { exact: true }).fill('10:00');
  await supporter.locator('.preparation-form').getByRole('button', { name: '入れる', exact: true }).click();
  const ownList = student.getByRole('region', { name: '入れた準備の予定', exact: true });
  await ownList.getByText('支援担当が入れました', { exact: true }).waitFor();
  const [saved] = await active(); assert.ok(saved); const plan = saved.data();
  assert.equal(plan.confirmedBy, 'trial-supporter'); assert.equal(plan.createdByRole, 'supporter');
  await student.locator('.timetable .preparation-cell').getByText('支援担当が入れました', { exact: true }).waitFor();
  const calendar = student.getByRole('region', { name: '締切のカレンダー', exact: true });
  const preparationEvent = calendar.locator('.calendar-event').filter({ hasText: '準備' }).getByText('架空の観察ノート', { exact: true });
  await calendar.getByText('体験用の予定です。Googleカレンダーには入りません。', { exact: true }).waitFor();
  await preparationEvent.waitFor();
  const item = (await ref.collection('calendarItems').doc(plan.calendarItemKey).get()).data();
  assert.equal(item.appliedRevision, item.desiredRevision);
  assert.equal((await target()).data().mockEvents[item.eventId].event.start.dateTime, plan.startsAt);
  pass('supporter adds candidate; author, dated timetable and durable mock event appear in the open student screen');
  await supporter.screenshot({ path: `${evidence}/supporter-wide.png`, fullPage: true });
  await student.screenshot({ path: `${evidence}/student-wide.png`, fullPage: true });
  await student.reload(); await ownList.getByText('支援担当が入れました', { exact: true }).waitFor();
  await preparationEvent.waitFor();
  assert.equal((await active()).length, 1); pass('reload retains one saved plan');
  await student.setViewportSize({ width: 390, height: 844 });
  assert.equal(await student.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await student.screenshot({ path: `${evidence}/student-narrow.png`, fullPage: true });
  pass('390px student timetable and removal control remain reachable');
  await ownList.getByRole('button', { name: /準備を外す/ }).click();
  await student.locator('.timetable .preparation-cell').waitFor({ state: 'detached' });
  await preparationEvent.waitFor({ state: 'detached' });
  assert.equal((await plans()).docs.find(doc => doc.id === saved.id).data().status, 'cancelled');
  await assertNoPreparationEvents();
  await supporter.getByRole('region', { name: '入れた準備の予定' }).waitFor({ state: 'detached' });
  pass('student removes supporter plan; both screens and durable mock destination remove it');
  await student.getByText('準備の予定を入れる', { exact: true }).click();
  const form = student.locator('.preparation-form');
  await form.getByLabel('準備する日', { exact: true }).fill(plan.date);
  await form.getByLabel('時間割の時限', { exact: true }).fill('3');
  await form.getByLabel('開始時刻', { exact: true }).fill('13:00');
  await form.getByLabel('終了時刻', { exact: true }).fill('14:30');
  // Lose the successful response once: the retry must use the same plan ID.
  let lost = false;
  await student.route('**/api/v1/students/trial-student/plans/*', async route => {
    if (route.request().method() !== 'PUT' || lost) return route.continue();
    lost = true; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed');
  });
  await form.getByRole('button', { name: '入れる', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '保存を確認できませんでした' }).waitFor();
  await form.getByRole('button', { name: '入れる', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '準備の予定を入れました' }).waitFor();
  await ownList.getByText('学生が入れました', { exact: true }).waitFor();
  assert.equal((await active()).length, 1);
  await preparationEvent.waitFor();
  pass('student adds a plan; lost response retry keeps one plan and one calendar event');
  await supporter.getByRole('region', { name: '入れた準備の予定' }).getByText('学生が入れました', { exact: true }).waitFor();
  assert.equal(await supporter.getByRole('region', { name: '入れた準備の予定' }).getByRole('button').count(), 0);
  await ownList.getByRole('button', { name: /準備を外す/ }).click();
  await preparationEvent.waitFor({ state: 'detached' });
  await assertNoPreparationEvents(); pass('student removes own plan; supporter cannot remove the student plan');
  await student.getByRole('link', { name: '自分の面談日時を見る・変える' }).click();
  await student.getByText('面談日時を変える', { exact: true }).click();
  await student.getByLabel('次の面談（日本時間）').fill(`${plan.date}T16:00`);
  await student.getByRole('button', { name: '面談日時を保存', exact: true }).click();
  await student.waitForFunction(() => globalThis.document.querySelector('.session-dates strong')?.textContent.includes('16:00'));
  assert.equal((await ref.collection('sessionContext').doc('current').get()).data().nextSessionAt, `${plan.date}T16:00:00+09:00`);
  await supporter.waitForFunction(() => globalThis.document.querySelector('.session-dates strong')?.textContent.includes('16:00'));
  await supporter.getByText('面談日時を変える', { exact: true }).click();
  await supporter.getByLabel('次の面談（日本時間）').fill(`${plan.date}T17:00`);
  await supporter.getByRole('button', { name: '面談日時を保存', exact: true }).click();
  await student.waitForFunction(() => globalThis.document.querySelector('.session-dates strong')?.textContent.includes('17:00'));
  pass('student and supporter both save session dates; the other open screen updates');
  await ref.collection('supporters').doc('trial-supporter').update({ revokedAt: new Date().toISOString() });
  await supporter.getByRole('alert').filter({ hasText: /表示.*消しました/ }).waitFor();
  assert.equal(await supporter.locator('.session-candidate, .preparation-form, .preparation-list').count(), 0);
  pass('revoked sharing removes planning data and controls');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', operations, browserErrors: errors.length }, null, 2));
  log(JSON.stringify({ observations: [{ requirement_id: 'plans-browser', status: 'pass', observed: {
    operations: operations.length, browserErrors: errors.length }, evidence_files: ['operations.json', 'supporter-wide.png', 'student-wide.png', 'student-narrow.png'] }] }));
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
