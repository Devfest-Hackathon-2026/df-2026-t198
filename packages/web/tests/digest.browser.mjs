import assert from 'node:assert/strict';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
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
const ref = db.doc('students/trial-student');
let planRef;
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
const confirmation = page => page.getByRole('region', { name: '準備の予定の操作', exact: true });
async function confirmPreview(label, action, capture) {
  const link = preview.getByRole('link', { name: label, exact: true });
  const target = ref.collection('plans').doc(new URL(await link.getAttribute('href')).searchParams.get('id'));
  const before = (await target.get()).data();
  await link.click();
  await confirmation(student).getByRole('button', { name: action, exact: true }).waitFor();
  assert.deepEqual((await target.get()).data(), before);
  if (capture) await screenshot(student, `${capture}-before`);
  await confirmation(student).getByRole('button', { name: action, exact: true }).click();
}
try {
  await mkdir(evidence, { recursive: true });
  // Give the new postponement scenario a weekday before the deadline, independently of the day it runs.
  // This is invented input for this test, not a change to the existing M6 scenario or oracle.
  const demoRef = ref.collection('demo').doc('current'); const demo = (await demoRef.get()).data();
  for (const course of demo.courses) for (const task of course.assignments) task.dueAt = new Date(Date.now() + 9 * 86400000).toISOString();
  await demoRef.set(demo);
  const contextRef = ref.collection('sessionContext').doc('current');
  const context = (await contextRef.get()).data();
  await contextRef.update({ nextSessionAt: new Date(Date.parse(context.nextSessionAt) + 7 * 86400000).toISOString() });
  await login(student, 'student'); await openLms();
  await studentScreen.goto(`${base}/student`); await studentScreen.locator('.timetable').waitFor();
  await login(supporter, 'supporter');
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '戸田 ひなた', exact: true }).click();
  await supporter.locator('.session-heading').waitFor();
  assert.equal(await supporter.locator('.session-heading h1').innerText(), '戸田 ひなた');
  assert.equal(await supporter.locator('.session-student-id').count(), 0);
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('link', { name: '🕒 後回し', exact: true }).waitFor();
  for (const page of [studentScreen, supporter]) {
    await preparationList(page).getByText('書き方を書くレポート', { exact: true }).waitFor();
    assert.equal(await preparationList(page).getByText('まだ', { exact: true }).count(), 0);
  }
  let doneUrl = await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href');
  const laterUrl = await preview.getByRole('link', { name: '🕒 後回し', exact: true }).getAttribute('href');
  assert.ok(doneUrl.startsWith(base)); assert.ok(laterUrl.includes('/student/plan?id='));
  assert.equal(new URL(doneUrl).searchParams.get('rev'), '1'); assert.equal(new URL(laterUrl).searchParams.get('rev'), '1');
  planRef = ref.collection('plans').doc(new URL(doneUrl).searchParams.get('id'));
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

  await confirmPreview('🕒 後回し', '後回し', 'preview-later');
  await preview.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  assert.match(await preview.getByRole('status').innerText(), /体験用の予定を更新しました/);
  assert.doesNotMatch(await preview.getByRole('status').innerText(), /拡張機能/);
  await preparationList(studentScreen).getByText('後回しにした', { exact: true }).waitFor();
  await preparationList(supporter).getByText('後回しにした', { exact: true }).waitFor();
  const moved = (await planRef.get()).data(); assert.notEqual(moved.date, before.date);
  const item = (await ref.collection('calendarItems').doc(moved.calendarItemKey).get()).data();
  assert.equal(item.eventId, beforeItem.eventId); assert.equal(item.appliedRevision, item.desiredRevision);
  const event = (await ref.collection('integrations').doc('calendar').get()).data().mockEvents[item.eventId];
  assert.equal(event.event.start.dateTime, moved.startsAt);
  await screenshot(student, 'preview-later-after');
  pass('preview later action moves durable event with the same id; both open screens update without reload');
  await linkPage.goto(laterUrl);
  await linkPage.getByRole('status').filter({ hasText: '変更していません' }).waitFor();
  await screenshot(linkPage, 'plan-link-moved');
  assert.deepEqual((await planRef.get()).data(), moved);
  await linkPage.reload(); await linkPage.getByRole('status').filter({ hasText: '変更していません' }).waitFor();
  assert.deepEqual((await planRef.get()).data(), moved);
  pass('same email link including reload cannot postpone the plan twice');
  await linkPage.goto(doneUrl);
  await linkPage.getByRole('status').filter({ hasText: '後回しにした' }).waitFor();
  assert.match(await linkPage.getByRole('status').innerText(), /変更していません/);
  assert.equal(await linkPage.getByRole('button', { name: 'もう一度試す', exact: true }).count(), 0);
  assert.deepEqual((await planRef.get()).data(), moved);
  await screenshot(linkPage, 'stale-action-conflict');
  pass('old done link after postponement reports a conflict, preserves the plan and points to the student screen');
  await preparationList(studentScreen).getByRole('button', { name: '後回し', exact: true }).click();
  await preparationList(studentScreen).getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  const movedAgain = (await planRef.get()).data();
  assert.equal(movedAgain.revision, moved.revision + 1); assert.notEqual(movedAgain.startsAt, moved.startsAt);
  await linkPage.goto(laterUrl); await linkPage.getByRole('status').filter({ hasText: '変更していません' }).waitFor();
  assert.ok((await linkPage.getByRole('status').innerText()).includes(movedAgain.startsAt.slice(11, 16)));
  assert.deepEqual((await planRef.get()).data(), movedAgain);
  pass('student can postpone again using the current revision while the earlier email remains replay safe');
  await supporter.getByRole('link', { name: '② 相談する', exact: true }).click();
  await supporter.locator('.session-timetable').waitFor();
  await preparationList(supporter).getByText('後回しにした', { exact: true }).waitFor();
  if (await supporter.getByRole('button', { name: '締切の週を見る', exact: true }).count()) {
    await supporter.getByRole('button', { name: '締切の週を見る', exact: true }).click();
  }
  await supporter.locator('.session-deadline').waitFor();
  await screenshot(supporter, 'session-plan-later');
  // README step 6: a fresh sample restores today's email while retaining the postponed plan.
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '見本の準備：' }).waitFor();
  const replacementLink = preview.getByRole('link', { name: '✅ 終わった', exact: true });
  await replacementLink.waitFor();
  const replacementRef = ref.collection('plans').doc(new URL(await replacementLink.getAttribute('href')).searchParams.get('id'));
  assert.notEqual(replacementRef.id, planRef.id);
  assert.deepEqual((await planRef.get()).data(), movedAgain);
  await confirmPreview('✅ 終わった', '終わった');
  await preview.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  assert.equal((await replacementRef.get()).data().status, 'done');
  assert.deepEqual((await planRef.get()).data(), movedAgain);
  pass('B4: later, prepare a fresh sample, and finish it from today\'s email while the postponed plan remains intact');
  await preparationList(studentScreen).locator('li').filter({ hasText: '後回しにした' }).getByRole('button', { name: '終わった', exact: true }).click();
  await preparationList(studentScreen).getByText('終わった（LMSへの提出は別）', { exact: true }).nth(1).waitFor();
  const finishedMoved = (await planRef.get()).data();
  await linkPage.goto(laterUrl);
  await linkPage.getByRole('status').filter({ hasText: 'もう「終わった」' }).waitFor();
  assert.doesNotMatch(await linkPage.getByRole('status').innerText(), /動かしました/);
  assert.deepEqual((await planRef.get()).data(), finishedMoved);
  await screenshot(linkPage, 'old-mail-after-done');
  pass('B1: the first email after completion reports the old plan\'s current state without a success claim');
  // Reset, prepare again, then exercise the other button inside the exact same preview.
  await student.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
  assert.equal((await ref.collection('plans').get()).size, 0);
  await preparationList(studentScreen).waitFor({ state: 'detached' });
  await preparationList(supporter).waitFor({ state: 'detached' });
  await openLms();
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('link', { name: '✅ 終わった', exact: true }).waitFor();
  doneUrl = await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href');
  planRef = ref.collection('plans').doc(new URL(doneUrl).searchParams.get('id'));
  await confirmPreview('✅ 終わった', '終わった');
  await preview.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  for (const page of [studentScreen, supporter]) await preparationList(page).getByText('終わった（LMSへの提出は別）', { exact: true }).waitFor();
  assert.equal((await planRef.get()).data().status, 'done');
  const assignments = (await ref.collection('assignments').get()).docs.map(doc => doc.data());
  assert.equal(assignments.find(row => row.key.sourceId === 'DEMO101_TASK1').submission, 'not-submitted');
  const finished = (await planRef.get()).data();
  await linkPage.goto(doneUrl); await linkPage.getByRole('status').filter({ hasText: 'もう「終わった」' }).waitFor();
  assert.deepEqual((await planRef.get()).data(), finished);
  await screenshot(studentScreen, 'student-done'); await screenshot(supporter, 'session-plan-done');
  await supporter.getByRole('link', { name: '① 確かめる', exact: true }).click();
  await preparationList(supporter).getByText('終わった（LMSへの提出は別）', { exact: true }).waitFor();
  await screenshot(supporter, 'session-check-done');
  pass('done preview button updates both session steps and student while preserving LMS submission, and duplicate link is stable');
  // Opening the action link in a different logged-in account cannot touch the owner's plan.
  await supporter.goto(doneUrl);
  await supporter.getByRole('status').filter({ hasText: '本人の準備の予定を見つけられませんでした' }).waitFor();
  assert.equal(await confirmation(supporter).getByRole('button').count(), 0);
  assert.deepEqual((await planRef.get()).data(), finished);
  pass('supporter account cannot execute student email actions');
  const loginPlan = { ...finished, planId: randomUUID(), status: 'active', revision: 1 };
  const loginRef = ref.collection('plans').doc(loginPlan.planId); await loginRef.set(loginPlan);
  const loginUrl = doneUrl.replace(planRef.id, loginRef.id);
  const signedOutContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const signedOut = await signedOutContext.newPage(); signedOut.setDefaultTimeout(15000);
  await signedOut.goto(loginUrl);
  await signedOut.getByRole('button', { name: 'Googleでログイン', exact: true }).waitFor();
  assert.deepEqual((await loginRef.get()).data(), loginPlan);
  await signedOut.getByRole('link', { name: '体験用LMSからログイン', exact: true }).click();
  await signedOut.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await signedOut.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await signedOut.getByRole('button', { name: 'ログイン', exact: true }).click();
  await confirmation(signedOut).getByRole('button', { name: '終わった', exact: true }).waitFor();
  assert.ok(signedOut.url().includes('/student/plan?id='));
  assert.equal(new URL(signedOut.url()).searchParams.get('rev'), '1');
  assert.deepEqual((await loginRef.get()).data(), loginPlan);
  await screenshot(signedOut, 'login-return-before');
  await confirmation(signedOut).getByRole('button', { name: '終わった', exact: true }).click();
  await confirmation(signedOut).getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  await loginRef.delete();
  await signedOutContext.close();
  pass('signed-out email link asks for login and resumes only after the owner authenticates');
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '見本の準備：' }).waitFor();
  await preview.getByRole('link', { name: '✅ 終わった', exact: true }).waitFor();
  const renewedId = new URL(await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href')).searchParams.get('id');
  assert.notEqual(renewedId, planRef.id);
  assert.deepEqual((await planRef.get()).data(), finished);
  assert.equal((await ref.collection('plans').doc(renewedId).get()).data().status, 'active');
  await screenshot(student, 'sample-preserves-done');
  pass('B4: prepare after completion creates a new active sample and retains the completed record');

  const form = studentScreen.locator('.preparation-form');
  await studentScreen.getByText('準備の予定を入れる', { exact: true }).click();
  const japanDate = offset => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  const fillPlan = async date => {
    await form.getByLabel('準備する日').fill(date); await form.getByLabel('時間割の時限').fill('3');
    await form.getByLabel('開始時刻').fill('13:00'); await form.getByLabel('終了時刻').fill('14:00');
  };
  const previousIds = new Set((await ref.collection('plans').get()).docs.map(doc => doc.id));
  const count = previousIds.size;
  await fillPlan(japanDate(7)); await form.getByRole('button', { name: '入れる', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '締切より後の予定は入れられません' }).waitFor();
  assert.equal((await ref.collection('plans').get()).size, count);
  await screenshot(studentScreen, 'after-deadline-rejected');
  pass('B2: student input after the deadline is rejected with a specific explanation and creates no plan');
  await fillPlan(japanDate(1)); await form.getByRole('button', { name: '入れる', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '準備の予定を入れました' }).waitFor();
  const activePlan = (await ref.collection('plans').get()).docs.find(doc => !previousIds.has(doc.id));
  const scheduled = activePlan.data();
  const scheduledRow = preparationList(studentScreen).locator('li').filter({ has: studentScreen.locator(`time[datetime="${scheduled.startsAt}"]`) });
  const taskRef = (await ref.collection('assignments').get()).docs.find(doc => doc.data().key.sourceId === scheduled.assignment.sourceId).ref;
  await taskRef.update({ 'officialDeadline.deadline': { kind: 'datetime', dueAt: `${japanDate(1)}T12:00:00+09:00`, dueText: '架空の前倒し', timeZone: 'Asia/Tokyo' } });
  await preparationList(studentScreen).getByText('締切より後の予定です', { exact: true }).waitFor();
  await supporter.goto(`${base}/session/trial-student/plan`);
  await preparationList(supporter).getByText('締切より後の予定です', { exact: true }).waitFor();
  if (await supporter.getByRole('button', { name: '締切の週を見る', exact: true }).count()) {
    await supporter.getByRole('button', { name: '締切の週を見る', exact: true }).click();
  }
  const marker = supporter.locator('.session-deadline');
  await marker.waitFor(); assert.match(await marker.innerText(), /締切.*12:00/);
  await scheduledRow.getByRole('button', { name: '後回し', exact: true }).click();
  await preparationList(studentScreen).getByRole('status').filter({ hasText: '予定を動かしませんでした' }).waitFor();
  assert.deepEqual((await activePlan.ref.get()).data(), scheduled);
  await screenshot(studentScreen, 'deadline-moved-before-plan'); await screenshot(supporter, 'session-deadline-marker');
  pass('B2: earlier deadline preserves and warns on the existing plan in both screens, marks the timetable and refuses postponement beyond it');
  // Exercise the real 409 response, rather than replacing the browser's fetch response.
  await confirmPreview('✅ 終わった', '終わった');
  await preview.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
  await taskRef.update({ 'officialDeadline.deadline': { kind: 'datetime', dueAt: `${japanDate(0)}T08:00:00+09:00`, dueText: '架空の前倒し', timeZone: 'Asia/Tokyo' } });
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '今日の空いたコマは課題の締切より後' }).waitFor();
  assert.doesNotMatch(await preview.locator(':scope > [role="status"]').innerText(), /先に「LMSを開く」/);
  await screenshot(student, 'sample-after-deadline');
  pass('sample creation 409 explains the deadline cause without asking the student to reload the LMS');
  // Issue #141: add only invented records for the submission stage and stateful links.
  await student.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
  await openLms();
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  await preview.getByRole('link', { name: '✅ 終わった', exact: true }).waitFor();
  const sampleId = new URL(await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href')).searchParams.get('id');
  const source = (await ref.collection('assignments').get()).docs[0].data();
  const submissionTask = { ...source, key: { system: 'ynu-lms', sourceId: 'fictional-141' },
    latest: { ...source.latest, courseId: 'fictional-141', sourceId: 'fictional-141', title: '架空の提出レポート',
      url: 'https://lms.example.invalid/lms/corsColl/linkKyozaiTitle' },
    submission: 'not-submitted', presenceState: 'active' };
  const submissionRef = ref.collection('assignments').doc('fictional-141');
  await ref.collection('courses').doc('fictional-141').set({ system: 'ynu-lms', courseId: 'fictional-141', name: '架空の提出演習', slots: [] });
  await submissionRef.set(submissionTask);
  await ref.collection('plans').doc('fictional-141').set({ ...(await ref.collection('plans').doc(sampleId).get()).data(),
    planId: 'fictional-141', assignment: submissionTask.key, status: 'done', title: submissionTask.latest.title });
  const submissionSection = preview.locator(':scope > div').getByRole('region', { name: '次は提出', exact: true });
  await submissionSection.waitFor();
  assert.equal(await submissionSection.getByRole('link', { name: 'LMSを開く', exact: true }).getAttribute('href'), 'https://lms.example.invalid/lms/homeHoml/doIndex');
  assert.match(await submissionSection.innerText(), /道順：ホーム › 架空の提出演習 › 架空の提出レポート/);
  assert.equal(await submissionSection.getByRole('link', { name: '✅ 終わった', exact: true }).count(), 0);
  assert.equal((await preview.innerText()).match(/返信の入力は不要です/g).length, 1);
  assert.equal(await preview.locator('article h3').count() >= 2, true);
  for (const [width, height, size] of [[1280, 960, 'wide'], [390, 844, 'narrow']]) {
    await student.setViewportSize({ width, height });
    assert.equal(await student.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    await preview.screenshot({ path: `${evidence}/submission-mail-${size}.png` });
  }
  await student.setViewportSize({ width: 1280, height: 960 });
  await studentScreen.getByRole('button', { name: /架空の提出演習/ }).click();
  const studentSource = studentScreen.locator('#course-assignments').getByRole('link', { name: 'LMSで見る ›', exact: true });
  assert.equal(await studentSource.getAttribute('href'), 'https://lms.example.invalid/lms/homeHoml/doIndex');
  await supporter.goto(`${base}/session/trial-student`);
  const sessionTask = supporter.locator('.session-task').filter({ hasText: '架空の提出レポート' });
  await sessionTask.locator('summary').click();
  assert.equal(await sessionTask.getByRole('link', { name: 'LMSで見る ›', exact: true }).getAttribute('href'), 'https://lms.example.invalid/lms/homeHoml/doIndex');
  assert.match(await sessionTask.innerText(), /ホーム › 架空の提出演習 › 架空の提出レポート/);
  pass('Issue #141: morning preview headings, unchanged buttons, one final note and submission stage; both screens use the definition home and route');
  const latestDoneUrl = await preview.getByRole('link', { name: '✅ 終わった', exact: true }).getAttribute('href');
  const samplePlan = (await ref.collection('plans').doc(sampleId).get()).data();
  const plannedTask = (await ref.collection('assignments').get()).docs.find(doc =>
    doc.data().key.system === samplePlan.assignment.system && doc.data().key.sourceId === samplePlan.assignment.sourceId);
  const directUrl = plannedTask.data().latest.url;
  // Mixed-source records exercise rendering only. The demo API correctly rejects such data.
  await submissionRef.delete();
  await ref.collection('plans').doc('fictional-141').delete();
  await ref.collection('courses').doc('fictional-141').delete();
  await linkPage.goto(latestDoneUrl);
  const nextSubmission = linkPage.getByRole('region', { name: '次は提出', exact: true });
  await confirmation(linkPage).getByRole('button', { name: '終わった', exact: true }).waitFor();
  assert.deepEqual((await ref.collection('plans').doc(sampleId).get()).data(), samplePlan);
  await linkPage.reload();
  await confirmation(linkPage).getByRole('button', { name: '終わった', exact: true }).waitFor();
  assert.deepEqual((await ref.collection('plans').doc(sampleId).get()).data(), samplePlan);
  await screenshot(linkPage, 'done-link-before');
  let attempts = 0;
  await linkPage.route('**/api/v1/plans/*/done?rev=1', async route => {
    attempts++; const response = await route.fetch();
    if (attempts === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await confirmation(linkPage).getByRole('button', { name: '終わった', exact: true }).dblclick();
  await confirmation(linkPage).getByRole('button', { name: 'もう一度試す', exact: true }).waitFor();
  await nextSubmission.waitFor();
  const afterLostResponse = (await ref.collection('plans').doc(sampleId).get()).data();
  await confirmation(linkPage).getByRole('button', { name: 'もう一度試す', exact: true }).click();
  await confirmation(linkPage).getByRole('status').filter({ hasText: 'もう「終わった」' }).waitFor();
  assert.equal(attempts, 2);
  assert.deepEqual((await ref.collection('plans').doc(sampleId).get()).data(), afterLostResponse);
  await linkPage.unroute('**/api/v1/plans/*/done?rev=1');
  await screenshot(linkPage, 'done-link-after');
  await linkPage.screenshot({ path: `${evidence}/submission-action.png`, fullPage: true });
  assert.equal(await nextSubmission.getByRole('link', { name: 'LMSを開く', exact: true }).getAttribute('href'), directUrl);
  assert.match(await nextSubmission.innerText(), /締切/);
  const actedPlan = (await ref.collection('plans').doc(sampleId).get()).data();
  const actedTask = (await ref.collection('assignments').get()).docs.find(doc => doc.data().key.sourceId === actedPlan.assignment.sourceId);
  await actedTask.ref.update({ submission: 'submitted' });
  await nextSubmission.waitFor({ state: 'detached' });
  await submissionSection.waitFor({ state: 'detached' });
  pass('Issue #157: open and reload preserve the active plan; explicit confirmation shows the submission step at 1280px and 390px');
  pass('Issue #141: done link shows current deadline and direct demo destination; live submitted state removes the stage in the action screen and mail preview');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', operations, browserErrors: 0 }, null, 2));
  log(JSON.stringify({ status: 'pass', operations: operations.length, browserErrors: 0, evidence }));
} catch (error) {
  await student.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  await writeFile(`${evidence}/failure.json`, JSON.stringify({ preview: await preview.innerText().catch(() => ''), linkStatus: await linkPage.getByRole('status').allTextContents(), browserErrors: errors, operations }, null, 2));
  throw error;
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
