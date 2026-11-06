import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-digest-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'digest-browser'); const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const student = await studentContext.newPage(); const supporter = await supporterContext.newPage();
const studentScreen = await studentContext.newPage(); const linkPage = await studentContext.newPage();
const errors = []; const operations = []; const pass = name => operations.push(name);
for (const page of [student, supporter, studentScreen, linkPage]) {
  page.setDefaultTimeout(15000); page.on('pageerror', () => errors.push('browser-error'));
}
const base = process.env.KADAI_WEB_ORIGIN; const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i112-browser';
const ref = db.doc('students/trial-student'); const planId = '11200000-0000-4000-8000-000000000001';
const planRef = ref.collection('plans').doc(planId);
const preview = student.getByRole('region', { name: '今日やることのメール', exact: true });
const preparationList = page => page.getByRole('region', { name: '入れた準備の予定', exact: true });
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
async function openLms() {
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
}
async function screenshot(page, name) {
  for (const [width, height, size] of [[1280, 960, 'wide'], [390, 844, 'narrow']]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `${name} fits ${width}px`);
    await page.screenshot({ path: `${evidence}/${name}-${size}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 960 });
}
try {
  await mkdir(evidence, { recursive: true });
  // Give the new postponement scenario a weekday before the deadline, independently of the day it runs.
  // This is invented input for this test, not a change to the existing M6 scenario or oracle.
  const demoRef = ref.collection('demo').doc('current'); const demo = (await demoRef.get()).data();
  for (const course of demo.courses) for (const task of course.assignments) task.dueAt = new Date(Date.now() + 9 * 86400000).toISOString();
  await demoRef.set(demo);
  await login(student, 'student'); await openLms();
  await studentScreen.goto(`${base}/student`); await studentScreen.locator('.timetable').waitFor();
  await login(supporter, 'supporter');
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '学生 trial-student', exact: true }).click();
  await supporter.locator('.session-heading').waitFor();
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('link', { name: '🕒 後回し', exact: true }).waitFor();
  for (const page of [studentScreen, supporter]) {
    await preparationList(page).getByText('架空の観察ノート', { exact: true }).waitFor();
    assert.equal(await preparationList(page).getByText('まだ', { exact: true }).count(), 0);
  }
  const doneUrl = await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href');
  const laterUrl = await preview.getByRole('link', { name: '🕒 後回し', exact: true }).getAttribute('href');
  assert.ok(doneUrl.startsWith(base)); assert.ok(laterUrl.includes('/student/plan?id='));
  assert.equal(new URL(doneUrl).searchParams.get('rev'), '1'); assert.equal(new URL(laterUrl).searchParams.get('rev'), '1');
  const before = (await planRef.get()).data();
  const beforeItem = (await ref.collection('calendarItems').doc(before.calendarItemKey).get()).data();
  assert.equal(beforeItem.appliedRevision, beforeItem.desiredRevision);
  await screenshot(student, 'morning-mail'); await screenshot(studentScreen, 'student-still'); await screenshot(supporter, 'session-check-still');
  pass('server-composed morning email, safe action links, student and open supporter screen show the same active plan');
  // Invented fetch state checks the changed student notice without changing the M6 scenario.
  const fetchRef = ref.collection('fetchStates').doc('fictional-copy-review');
  const lastSucceededAt = new Date(Date.now() - 4 * 86400000).toISOString();
  const lastDay = new Date(lastSucceededAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
  await fetchRef.set({ system: 'ynu-lms', lastSucceededAt, lastResult: 'success' });
  await studentScreen.getByText(`YNU LMS：${lastDay}から更新がありません。LMSを開くと新しくなります。`, { exact: true }).waitFor();
  await screenshot(studentScreen, 'student-stale');
  await fetchRef.set({ system: 'ynu-lms', lastSucceededAt: new Date().toISOString(), lastResult: 'failed' });
  await studentScreen.getByText('YNU LMS：課題をすべて確認できていません。LMSを開いて確かめてください。', { exact: true }).waitFor();
  await screenshot(studentScreen, 'student-failed');
  await fetchRef.delete();
  pass('student stale and failed notices explain the next action at 1280px and 390px');

  await preview.getByRole('link', { name: '🕒 後回し', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  await preparationList(studentScreen).getByText('後回しにした', { exact: true }).waitFor();
  await preparationList(supporter).getByText('後回しにした', { exact: true }).waitFor();
  const moved = (await planRef.get()).data(); assert.notEqual(moved.date, before.date);
  const item = (await ref.collection('calendarItems').doc(moved.calendarItemKey).get()).data();
  assert.equal(item.eventId, beforeItem.eventId); assert.equal(item.appliedRevision, item.desiredRevision);
  const event = (await ref.collection('integrations').doc('calendar').get()).data().mockEvents[item.eventId];
  assert.equal(event.event.start.dateTime, moved.startsAt);
  pass('preview later action moves durable event with the same id; both open screens update without reload');
  await linkPage.goto(laterUrl);
  await linkPage.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  await screenshot(linkPage, 'plan-link-moved');
  assert.deepEqual((await planRef.get()).data(), moved);
  await linkPage.reload(); await linkPage.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  assert.deepEqual((await planRef.get()).data(), moved);
  pass('same email link including reload cannot postpone the plan twice');
  await linkPage.goto(doneUrl);
  await linkPage.getByRole('status').filter({ hasText: '予定が変わりました。学生の画面で確かめてください' }).waitFor();
  assert.equal(await linkPage.getByRole('button', { name: 'もう一度試す', exact: true }).count(), 0);
  assert.deepEqual((await planRef.get()).data(), moved);
  await screenshot(linkPage, 'stale-action-conflict');
  pass('old done link after postponement reports a conflict, preserves the plan and points to the student screen');
  await preparationList(studentScreen).getByRole('button', { name: '後回し', exact: true }).click();
  await preparationList(studentScreen).getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  const movedAgain = (await planRef.get()).data();
  assert.equal(movedAgain.revision, moved.revision + 1); assert.notEqual(movedAgain.startsAt, moved.startsAt);
  await linkPage.goto(laterUrl); await linkPage.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  assert.deepEqual((await planRef.get()).data(), movedAgain);
  pass('student can postpone again using the current revision while the earlier email remains replay safe');
  await supporter.getByRole('link', { name: '② 相談する', exact: true }).click();
  await preparationList(supporter).getByText('後回しにした', { exact: true }).waitFor();
  await screenshot(supporter, 'session-plan-later');
  // Reset, prepare again, then exercise the other button inside the exact same preview.
  await student.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
  assert.equal((await ref.collection('plans').get()).size, 0);
  await preparationList(studentScreen).waitFor({ state: 'detached' });
  await preparationList(supporter).waitFor({ state: 'detached' });
  await openLms();
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('link', { name: '✅ 終わった', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  for (const page of [studentScreen, supporter]) await preparationList(page).getByText('終わった（LMSへの提出は別）', { exact: true }).waitFor();
  assert.equal((await planRef.get()).data().status, 'done');
  const assignments = (await ref.collection('assignments').get()).docs.map(doc => doc.data());
  assert.equal(assignments.find(row => row.key.sourceId === 'DEMO101_TASK1').submission, 'not-submitted');
  const finished = (await planRef.get()).data();
  await linkPage.goto(doneUrl); await linkPage.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  assert.deepEqual((await planRef.get()).data(), finished);
  await screenshot(studentScreen, 'student-done'); await screenshot(supporter, 'session-plan-done');
  await supporter.getByRole('link', { name: '① 確かめる', exact: true }).click();
  await preparationList(supporter).getByText('終わった（LMSへの提出は別）', { exact: true }).waitFor();
  await screenshot(supporter, 'session-check-done');
  pass('done preview button updates both session steps and student while preserving LMS submission, and duplicate link is stable');
  // Opening the action link in a different logged-in account cannot touch the owner's plan.
  await supporter.goto(doneUrl);
  await supporter.getByRole('status').filter({ hasText: 'この予定を変更できませんでした' }).waitFor();
  assert.deepEqual((await planRef.get()).data(), finished);
  pass('supporter account cannot execute student email actions');
  const signedOutContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const signedOut = await signedOutContext.newPage(); signedOut.setDefaultTimeout(15000);
  await signedOut.goto(doneUrl);
  await signedOut.getByRole('button', { name: 'Googleでログイン', exact: true }).waitFor();
  assert.deepEqual((await planRef.get()).data(), finished);
  await signedOut.getByRole('link', { name: '体験用LMSからログイン', exact: true }).click();
  await signedOut.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await signedOut.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await signedOut.getByRole('button', { name: 'ログイン', exact: true }).click();
  await signedOut.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  assert.ok(signedOut.url().includes('/student/plan?id='));
  assert.equal(new URL(signedOut.url()).searchParams.get('rev'), '1');
  assert.deepEqual((await planRef.get()).data(), finished);
  await signedOutContext.close();
  pass('signed-out email link asks for login and resumes only after the owner authenticates');
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('link', { name: '✅ 終わった', exact: true }).waitFor();
  const renewed = (await planRef.get()).data();
  assert.equal(renewed.status, 'active'); assert.equal(renewed.revision, finished.revision + 1);
  assert.equal(new URL(await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href')).searchParams.get('rev'), String(renewed.revision));
  pass('preparing the demo again after completion renews the same plan and publishes current revision links');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', operations, browserErrors: 0 }, null, 2));
  log(JSON.stringify({ status: 'pass', operations: operations.length, browserErrors: 0, evidence }));
} catch (error) {
  await student.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  await writeFile(`${evidence}/failure.json`, JSON.stringify({ preview: await preview.innerText().catch(() => ''), operations }, null, 2));
  throw error;
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
