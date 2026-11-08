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
const { getAuth } = requireServer('firebase-admin/auth');
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
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5177';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i19-evidence';
// Fixed C34 steps: failures and unreached steps remain in the denominator.
const steps = [
  '学生と支援担当が別のブラウザでログインする', 'LMSを開いて最初の課題を受け取る',
  '先生役で締切を延ばし、LMSだけが変わる', '学生がLMSを開き、新しい締切が台帳に入る',
  '開いたままの学生画面が変わる', '保存済みの体験用カレンダーの予定が動く',
  '開いたままの面談画面が変わる', '応答を失った再送でも履歴と予定が増えない',
].map(name => ({ name, status: 'not-run' }));
const pass = index => { steps[index].status = 'pass'; };
const calendarTarget = () => db.doc('students/trial-student/integrations/calendar').get();
const calendarItems = () => db.collection('students/trial-student/calendarItems').get();
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
  for (const path of ['/student', '/session']) {
    await student.goto(`${base}${path}`);
    const entry = student.locator('main a').first();
    await entry.waitFor();
    assert.equal(await entry.getAttribute('href'), '/demo-lms');
    await entry.click();
    await student.getByLabel('メールアドレス').waitFor();
  }
  assert.deepEqual(await student.locator('.app-header nav a').allTextContents(), ['体験用LMS', '学生', '面談']);
  assert.equal(await student.title(), 'ToDoku');
  assert.equal(await student.locator('.app-header > a').innerText(), 'ToDoku');
  await student.getByRole('heading', { name: 'ToDokuを試す', exact: true }).waitFor();
  assert.match(await student.locator('main').innerText(), /ここで扱う授業と課題は架空のものです/);
  // A signed-in account without a demo profile can return to the demo login.
  await getAuth(app).createUser({ uid: 'non-demo-student', email: 'trial-ordinary@example.invalid',
    password: process.env.KADAI_DEMO_PASSWORD });
  await login(student, 'ordinary');
  const nonDemoNotice = student.getByRole('alert').filter({ hasText:
    'このアカウントは体験用ではありません。ログアウトして、体験用のアカウントでログインしてください。' });
  await nonDemoNotice.waitFor();
  assert.equal(await student.getByRole('button', { name: 'LMSを開く', exact: true }).count(), 0);
  await nonDemoNotice.locator('..').getByRole('button', { name: 'ログアウト', exact: true }).click();
  await student.getByLabel('メールアドレス').waitFor();
  await student.getByLabel('パスワード').waitFor();
  assert.equal(await nonDemoNotice.count(), 0);
  await login(student, 'student');
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  await login(supporter, 'supporter');
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.getByRole('link', { name: '田中 太郎', exact: true }).click();
  pass(0);
  const deadlines = supporter.getByRole('region', { name: '次の面談までの締切' });
  assert.equal((await ledger()).size, 0);
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await deadlines.getByText('書き方を書くレポート', { exact: true }).waitFor();
  assert.equal((await ledger()).size, 5);
  assert.equal(await deadlines.getByText('第3回 ふりかえり', { exact: true }).count(), 0);
  pass(1);
  const timetable = await studentContext.newPage();
  timetable.setDefaultTimeout(15000);
  timetable.on('pageerror', () => errors.push('browser-error'));
  await timetable.goto(`${base}/student`);
  assert.equal(await timetable.title(), 'ToDoku');
  await timetable.locator('.timetable').waitFor();
  assert.deepEqual((await timetable.locator('.course-cell strong').allTextContents()).sort(), [
    'レポートの書き方の書き方', 'キャンパス植物図鑑演習', 'Re:線形代数', '学食経済学', '自転車置き場の社会学', '90分の数理',
  ].sort());
  for (const [name, weekday, period] of [
    ['レポートの書き方の書き方', 1, 2], ['キャンパス植物図鑑演習', 4, 4], ['Re:線形代数', 2, 1],
    ['学食経済学', 3, 3], ['自転車置き場の社会学', 3, 1], ['90分の数理', 5, 2],
  ]) {
    await timetable.locator(`.timetable tbody tr:nth-child(${period}) td:nth-of-type(${weekday})`)
      .getByRole('button').filter({ hasText: name }).waitFor();
  }
  await timetable.locator('.timetable').getByRole('button', { name: /レポートの書き方の書き方/ }).click();
  await timetable.getByRole('heading', { name: '書き方を書くレポート', exact: true }).waitFor();
  const oldDeadline = (await ledger()).docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1').data().officialDeadline.deadline.dueAt;
  const calendar = timetable.getByRole('region', { name: '締切のカレンダー', exact: true });
  await calendar.getByText(/書き方を書くレポート/).waitFor();
  await timetable.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await timetable.locator('.course-cell').first().evaluate(node => globalThis.getComputedStyle(node).transitionDuration), '0s');
  const beforeCalendar = await calendar.innerText();
  assert.equal(await calendar.locator('th').count(), 7);
  assert.equal(await timetable.getByRole('heading', { name: '締切の近い課題' }).count(), 0);
  assert.equal(await timetable.locator('.changed').count(), 0);
  assert.equal(await supporter.locator('.changed').count(), 0);
  const eventCard = calendar.locator('.calendar-event').filter({ hasText: '書き方を書くレポート' });
  const eventDay = () => eventCard.locator('..').locator('..').getAttribute('data-date');
  const oldDay = await eventDay();
  const jstDay = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(value));
  assert.equal(oldDay, jstDay(oldDeadline));
  const today = jstDay(Date.now());
  assert.equal(Date.parse(`${oldDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`), 3 * 86400000);
  assert.equal(await calendar.evaluate(node => node.getBoundingClientRect().bottom < globalThis.document.querySelector('.timetable').getBoundingClientRect().top), true);
  const initialTarget = (await calendarTarget()).data();
  assert.equal(initialTarget.mode, 'mock');
  assert.equal(initialTarget.executor, 'demo');
  const oldEventId = Object.keys(initialTarget.mockEvents).find(id => initialTarget.mockEvents[id].event.summary.includes('書き方を書くレポート'));
  assert.ok(oldEventId);
  const beforeChanges = (await changes()).size;
  const sessionBefore = await deadlines.innerText();
  const beforeTimetable = await timetable.locator('.course-panel').innerText();
  await mkdir(evidence, { recursive: true });
  await timetable.screenshot({ path: `${evidence}/student-before-wide.png`, fullPage: true });
  await timetable.locator('.timetable').screenshot({ path: `${evidence}/landing-student.png` });
  await timetable.setViewportSize({ width: 390, height: 844 });
  await timetable.screenshot({ path: `${evidence}/student-before-narrow.png`, fullPage: true });
  await timetable.setViewportSize({ width: 1280, height: 960 });
  await student.screenshot({ path: `${evidence}/demo-wide.png`, fullPage: true });
  await student.locator('[data-demo-page="home"]').screenshot({ path: `${evidence}/landing-lms.png` });
  await student.getByRole('button', { name: '「書き方を書くレポート」の締切を1日延ばす', exact: true }).click();
  await student.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  assert.equal((await changes()).size, beforeChanges);
  assert.equal((await ledger()).docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1').data().officialDeadline.deadline.dueAt, oldDeadline);
  assert.equal(await deadlines.innerText(), sessionBefore);
  assert.equal(await timetable.locator('.course-panel').innerText(), beforeTimetable);
  const newDue = (await source.get()).data().courses[0].assignments[0].dueAt;
  assert.equal(Date.parse(newDue) - Date.parse(oldDeadline), 86400_000);
  assert.deepEqual((await calendarTarget()).data(), initialTarget);
  assert.equal(await calendar.innerText(), beforeCalendar);
  pass(2);

  // Let the real server apply the observation, then drop the response to exercise a retry.
  let sentId;
  await student.route('**/api/v1/observations', async route => {
    sentId = route.request().postDataJSON().observationId;
    await route.fetch();
    await route.abort('failed');
  }, { times: 1 });
  const openedAt = Date.now();
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('alert').filter({ hasText: '操作が終わりませんでした' }).waitFor();
  // Observe all highlights immediately after the first applied response (before replay).
  const highlighted = [timetable.locator('.course-cell').filter({ hasText: 'レポートの書き方の書き方' }),
    eventCard, timetable.locator('.course-panel .assignment').filter({ hasText: '書き方を書くレポート' }).locator('.deadline'), deadlines.locator('.deadline')];
  for (const target of highlighted) {
    await target.locator('xpath=self::*[contains(@class,"changed")]').waitFor({ timeout: Math.max(1, 2000 - (Date.now() - openedAt)) });
    assert.equal(await target.evaluate(node => globalThis.getComputedStyle(node).color), 'rgb(196, 58, 38)');
  }
  const oldDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(oldDeadline));
  const previousDeadline = timetable.locator('.course-panel .previous-deadline');
  assert.equal(await previousDeadline.innerText(), oldDate);
  assert.equal(await previousDeadline.evaluate(node => globalThis.getComputedStyle(node).textDecorationLine), 'line-through');
  const highlightAt = Date.now();
  assert.ok(highlightAt - openedAt <= 2000, 'all deadlines highlight within two seconds of opening LMS');
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
  pass(3);
  const expectedDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(newDue));
  assert.ok((await timetable.locator('.course-panel').innerText()).includes(expectedDate));
  pass(4);
  await eventCard.waitFor();
  assert.equal(await eventDay(), jstDay(newDue));
  assert.equal(Date.parse(`${await eventDay()}T00:00:00Z`) - Date.parse(`${oldDay}T00:00:00Z`), 86400000);
  assert.match(await eventCard.innerText(), /17:00/);
  const savedTarget = (await calendarTarget()).data();
  assert.equal(Object.keys(savedTarget.mockEvents).length, 5);
  assert.equal(Date.parse(savedTarget.mockEvents[oldEventId].event.start.dateTime), Date.parse(newDue));
  for (const item of (await calendarItems()).docs.map(doc => doc.data())) {
    assert.equal(item.appliedRevision, item.desiredRevision);
    assert.deepEqual(savedTarget.mockEvents[item.eventId], {
      itemKey: item.itemKey, generation: item.generation, revision: item.appliedRevision, event: item.desired.event,
    });
  }
  assert.equal(await eventCard.count(), 1);
  pass(5);
  await timetable.screenshot({ path: `${evidence}/calendar-updated.png`, fullPage: true });
  await timetable.locator('.timetable').screenshot({ path: `${evidence}/landing-updated.png` });
  const previousDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(oldDeadline));
  await supporter.getByRole('region', { name: '前回の面談からの変化' })
    .getByText(`締切が ${previousDate} から ${expectedDate} に変わりました`, { exact: false }).waitFor();
  assert.ok((await deadlines.innerText()).includes(expectedDate));
  pass(6);
  // A further open uses a new observation ID but must not duplicate the same event.
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  assert.equal((await changes()).size, afterApplied);
  assert.deepEqual((await calendarTarget()).data(), savedTarget);
  pass(7);
  await supporter.screenshot({ path: `${evidence}/session-updated.png`, fullPage: true });
  await supporter.locator('.session-page').screenshot({ path: `${evidence}/landing-session.png` });
  await timetable.waitForTimeout(Math.max(0, 7000 - (Date.now() - highlightAt)));
  for (const target of highlighted) assert.match(await target.getAttribute('class'), /changed/);
  await timetable.waitForTimeout(Math.max(0, 10000 - (Date.now() - highlightAt)));
  for (const target of highlighted) {
    assert.doesNotMatch(await target.getAttribute('class'), /changed/);
    assert.notEqual(await target.evaluate(node => globalThis.getComputedStyle(node).color), 'rgb(196, 58, 38)');
  }
  assert.equal(await previousDeadline.count(), 0);
  const fetchState = db.doc('students/trial-student/fetchStates/demo-lms');
  const fresh = (await fetchState.get()).data().lastSucceededAt;
  assert.equal(await timetable.getByText('から更新がありません', { exact: false }).count(), 0);
  await fetchState.update({ lastSucceededAt: new Date(Date.now() - 3 * 86400000 - 60000).toISOString() });
  await timetable.getByText('から更新がありません', { exact: false }).waitFor();
  await timetable.screenshot({ path: `${evidence}/stale-wide.png`, fullPage: true });
  await timetable.setViewportSize({ width: 390, height: 844 });
  const scroll = timetable.locator('.calendar-scroll');
  assert.equal(await scroll.evaluate(node => node.scrollWidth > node.clientWidth), true);
  await scroll.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  assert.ok(await scroll.evaluate(node => node.scrollLeft) > 0);
  assert.equal(await timetable.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await timetable.screenshot({ path: `${evidence}/stale-narrow.png`, fullPage: true });
  await scroll.evaluate(node => { node.scrollLeft = 0; });
  await fetchState.update({ lastSucceededAt: fresh });
  await timetable.getByText('から更新がありません', { exact: false }).waitFor({ state: 'detached' });
  await student.setViewportSize({ width: 390, height: 844 });
  assert.equal(await student.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await student.screenshot({ path: `${evidence}/demo-narrow.png`, fullPage: true });
  await timetable.setViewportSize({ width: 390, height: 844 });
  assert.equal(await timetable.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await timetable.screenshot({ path: `${evidence}/calendar-narrow.png`, fullPage: true });
  await student.locator('.demo-more > summary').click();
  const preview = student.getByRole('region', { name: '今日やることのメール', exact: true });
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  const done = preview.getByRole('link', { name: '✅ 終わった', exact: true });
  await done.waitFor();
  const sampleId = new URL(await done.getAttribute('href')).searchParams.get('id');
  const sample = (await db.doc(`students/trial-student/plans/${sampleId}`).get()).data();
  assert.deepEqual(sample.assignment, { system: 'demo-lms', sourceId: 'DEMO101_TASK1' });
  assert.match(await preview.innerText(), /書き方を書くレポート/);
  assert.doesNotMatch(await student.locator('main').innerText(), /Googleでログイン|カレンダーに接続|YNUに接続/);
  await student.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await student.getByLabel('メールアドレス').waitFor();
  assert.doesNotMatch(await student.locator('main').innerText(), /書き方を書くレポート|レポートの書き方の書き方/);
  await timetable.getByRole('button', { name: 'Googleでログイン', exact: true }).waitFor();
  assert.equal(await timetable.getByRole('region', { name: '締切のカレンダー', exact: true }).count(), 0);
  await supporter.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await supporter.getByRole('heading', { name: '面談にログイン', exact: true }).waitFor();
  assert.doesNotMatch(await supporter.locator('main').innerText(), /書き方を書くレポート|学生 trial-student/);
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ status: 'pass', operations: [
    'email login in separate student and supporter browsers', 'source has no preseeded ledger',
    'rendered outerHTML through the common reader and observations API', 'empty course and submitted assignment',
    'teacher extends source only', 'open LMS changes ledger and both live screens',
    'lost response replay retains observation ID and adds no history', '390px layout', 'logout clears data',
    '7 JST day columns, event moves one day without reload', 'initial deadlines are not highlighted',
    'student cells, calendar, panel and session highlight within 2 seconds and clear by 10 seconds',
    'all signed-out entry routes reach demo login', '72 hour stale notice and fresh data hides it',
    '390px calendar scrolls within its container',
  ], browserErrors: errors }, null, 2));
  log('PASS C32/C33: rendered HTML, teacher source change, observation replay, live student/session screens, separate logins and logout');
} catch (error) {
  const failed = steps.find(step => step.status === 'not-run');
  if (failed) failed.status = 'fail';
  await mkdir(evidence, { recursive: true });
  await student.screenshot({ path: `${evidence}/failure-student.png`, fullPage: true });
  log({ requests, errors, alerts: await student.getByRole('alert').allTextContents() });
  throw error;
} finally {
  const passed = steps.filter(step => step.status === 'pass').length;
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/m6.json`, JSON.stringify({ environment: 'local Auth/Firestore emulators + Chromium',
    calendar: 'mock', measuredAt: new Date().toISOString(), passed, total: steps.length, percent: 100 * passed / steps.length, steps }, null, 2));
  log(`M6: ${passed}/${steps.length} (${100 * passed / steps.length}%), emulator/mock only`);
  await browser.close(); await db.terminate(); await deleteApp(app);
}
