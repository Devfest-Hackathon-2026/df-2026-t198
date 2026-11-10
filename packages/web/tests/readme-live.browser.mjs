import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { log } from 'node:console';
import { readFile, mkdtemp, writeFile, stat } from 'node:fs/promises';

// Live verification changes only the third demo pair. Local verification needs no account file.
const local = process.argv[2] === '--verify-local-readme';
assert.deepEqual(process.argv.slice(2), [local ? '--verify-local-readme' : '--verify-live-readme']);
const origin = local ? process.env.KADAI_WEB_ORIGIN : 'https://project-00439085-4e2d-44c3-9a8.web.app';
const evidence = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'kadai-i123-'))}/`);
let pair;
if (local) {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-kadai-hisho');
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) assert.match(process.env[key] ?? '', /^127\.0\.0\.1:\d+$/);
  assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(process.env.KADAI_DEMO_PASSWORD?.length >= 8);
  pair = Object.fromEntries(['student', 'supporter'].map(role => [role, {
    uid: `trial-${role}`, email: `trial-${role}@example.invalid`, password: process.env.KADAI_DEMO_PASSWORD,
  }]));
} else {
  const credentials = process.env.KADAI_DEMO_ACCOUNTS_FILE ?? new URL('../../../fixtures-local/demo-accounts.local.json', import.meta.url);
  assert.equal((await stat(credentials)).mode & 0o777, 0o600);
  const accounts = JSON.parse(await readFile(credentials, 'utf8'));
  assert.equal(accounts.origin, origin);
  assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  pair = accounts.pairs[2];
  assert.equal(pair.pair, 'trial-3');
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const student = await studentContext.newPage();
const supporter = await supporterContext.newPage();
let phase = 'login';
let reset;
let cleanupPhase = 'not-started';
let passed = false;
let browserErrors = 0;
let announcementStatus;
let failureKind;
const cleanupFailures = [];
const operations = [];
for (const page of [student, supporter]) {
  page.setDefaultTimeout(30000);
  // Never capture request bodies, console messages, traces, HAR or raw errors.
  page.on('pageerror', () => { browserErrors++; });
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const region = (page, name) => page.getByRole('region', { name, exact: true });
const plans = page => region(page, '入れた準備の予定');
async function login(page, account) {
  await page.goto(`${origin}/demo-lms`);
  await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill(account.email);
  await page.getByLabel('パスワード').fill(account.password);
  await button(page, 'ログイン').click();
}
async function openLms() {
  await button(student, 'LMSを開く').click();
  await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
}
async function resetDemo() {
  await button(student, '体験を最初からやり直す').click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
}
async function screenshot(locator, name) {
  // Capture only fictional task/plan content, excluding account headers and login fields.
  const text = await locator.innerText();
  for (const account of [pair.student, pair.supporter]) {
    for (const value of [account.email, account.password, account.uid]) assert.ok(!text.includes(value));
  }
  await locator.screenshot({ path: new URL(name, evidence).pathname });
}
try {
  await login(student, pair.student);
  await button(student, 'LMSを開く').waitFor();
  phase = 'step-1-reset-and-read';
  await resetDemo();
  const originalDue = (await student.locator('.demo-due').first().innerText()).match(/(\d{4})\/(\d{2})\/(\d{2})/);
  assert.ok(originalDue);
  const expectedInitialDay = new Date(Date.now() + 9 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 10);
  assert.equal(originalDue.slice(1).join('-'), expectedInitialDay);
  assert.match(await student.locator('.demo-due').first().innerText(), /17:00/);
  await openLms();
  operations.push('1: 初期状態に戻し、LMSを開いて課題を受領');

  phase = 'step-2-student-screen';
  const popup = student.waitForEvent('popup');
  await student.getByRole('link', { name: '学生の画面を開く', exact: true }).click();
  const timetable = await popup;
  timetable.setDefaultTimeout(30000);
  timetable.on('pageerror', () => { browserErrors++; });
  await timetable.locator('.timetable').getByRole('button', { name: /文章表現/ }).click();
  await timetable.getByRole('heading', { name: '第3回レポート（要約と引用）', exact: true }).waitFor();
  const calendar = region(timetable, '締切のカレンダー');
  const calendarTask = calendar.locator('li').filter({ hasText: '第3回レポート（要約と引用）' });
  await calendarTask.waitFor();
  const beforePanel = await timetable.locator('.course-panel').innerText();
  const beforeCalendar = await calendar.innerText();
  operations.push('2: 別タブの授業・締切と体験用カレンダーを表示');

  phase = 'step-3-supporter-preparation';
  await login(supporter, pair.supporter);
  phase = 'step-3-open-session';
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  phase = 'step-3-choose-student';
  await supporter.locator(`a[href="/session/${pair.student.uid}"]`).click();
  const deadlines = region(supporter, '次の面談までの締切');
  await deadlines.getByText('第3回レポート（要約と引用）', { exact: true }).waitFor();
  const beforeSession = await deadlines.innerText();
  operations.push('3: 別ブラウザの支援担当が学生の次の締切を表示');

  phase = 'step-4-source-only';
  await button(student, '「第3回レポート（要約と引用）」の締切を1日延ばす').click();
  await student.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  const extendedDue = (await student.locator('.demo-due').first().innerText()).match(/(\d{4})\/(\d{2})\/(\d{2})/);
  assert.ok(extendedDue);
  const dueDay = parts => Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  assert.equal(dueDay(extendedDue) - dueDay(originalDue), 86400_000);
  assert.equal(await timetable.locator('.course-panel').innerText(), beforePanel);
  assert.equal(await calendar.innerText(), beforeCalendar);
  assert.equal(await deadlines.innerText(), beforeSession);
  operations.push('4: 先生の締切変更だけでは学生・カレンダー・面談の締切は変わらない');

  phase = 'step-5-live-updates';
  await openLms();
  await timetable.waitForFunction(previous => globalThis.document.querySelector('.course-panel').innerText !== previous, beforePanel);
  await timetable.waitForFunction(previous => globalThis.document.querySelector('[aria-labelledby="demo-calendar-title"]').innerText !== previous, beforeCalendar);
  await supporter.waitForFunction(previous => globalThis.document.querySelector('[aria-labelledby="session-deadlines"]').innerText !== previous, beforeSession);
  const changes = region(supporter, '前回の面談からの変化').getByText(/締切が .+ から .+ に変わりました/);
  await changes.waitFor();
  const expectedDue = `${Number(extendedDue[2])}/${Number(extendedDue[3])} 17:00`;
  assert.ok((await timetable.locator('.course-panel').innerText()).includes(expectedDue));
  assert.ok((await deadlines.innerText()).includes(expectedDue));
  await calendar.locator(`td[data-date="${extendedDue[1]}-${extendedDue[2]}-${extendedDue[3]}"]`).getByText('第3回レポート（要約と引用）', { exact: true }).waitFor();
  await screenshot(deadlines, 'session-deadline.png');
  phase = 'step-5-planning';
  await supporter.getByRole('link', { name: '② 相談する', exact: true }).click();
  phase = 'step-5-candidate';
  await supporter.locator('.session-candidate').getByRole('button', { name: /限に入れる$/ }).first().click();
  await supporter.getByLabel('開始時刻', { exact: true }).fill('09:00');
  await supporter.getByLabel('終了時刻', { exact: true }).fill('10:00');
  phase = 'step-5-save';
  await button(supporter.locator('.preparation-form'), '入れる').click();
  phase = 'step-5-student-author';
  await plans(timetable).getByText('支援担当が入れました', { exact: true }).waitFor();
  await timetable.locator('.timetable .preparation-cell').waitFor();
  await screenshot(plans(timetable), 'supporter-preparation.png');
  // A reload distinguishes a saved plan from transient form state.
  await supporter.reload();
  await plans(supporter).getByText('支援担当が入れました', { exact: true }).waitFor();
  await plans(timetable).getByRole('button', { name: /準備を外す/ }).click();
  await plans(timetable).waitFor({ state: 'detached' });
  await plans(supporter).waitFor({ state: 'detached' });
  await timetable.locator('.timetable .preparation-cell').waitFor({ state: 'detached' });
  await supporter.getByRole('link', { name: '① 確かめる', exact: true }).click();
  await deadlines.getByText('第3回レポート（要約と引用）', { exact: true }).waitFor();
  const updatedCalendar = await calendar.innerText();
  const updatedPanel = await timetable.locator('.course-panel').innerText();
  const updatedSession = await deadlines.innerText();
  operations.push('5: 再取得で両画面とカレンダーが更新、支援担当の準備を保存・再読込で保持、学生が取消');

  phase = 'step-6-repeat-and-mail';
  await openLms();
  assert.equal(await calendarTask.count(), 1);
  assert.equal(await changes.count(), 1);
  assert.equal(await calendar.innerText(), updatedCalendar);
  assert.equal(await timetable.locator('.course-panel').innerText(), updatedPanel);
  assert.equal(await deadlines.innerText(), updatedSession);
  const preview = student.getByRole('region').filter({ has: button(student, '今日の準備の見本を用意する') });
  await button(preview, '今日の準備の見本を用意する').click();
  await preview.getByRole('link', { name: '後回しにする', exact: true }).waitFor();
  await screenshot(preview, 'morning-mail.png');
  const originalLaterUrl = await preview.getByRole('link', { name: '後回しにする', exact: true }).getAttribute('href');
  const originalId = new URL(originalLaterUrl, origin).searchParams.get('id');
  await preview.getByRole('link', { name: '後回しにする', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  for (const page of [timetable, supporter]) await plans(page).getByText('後回しにした', { exact: true }).waitFor();
  await screenshot(plans(timetable), 'preparation-later.png');
  await button(preview, '今日の準備の見本を用意する').click();
  await student.waitForFunction(previousId => [...globalThis.document.querySelectorAll('a')].some(link =>
    link.textContent === '終わった' && new URL(link.href).searchParams.get('id') !== previousId), originalId);
  const doneUrl = await preview.getByRole('link', { name: '終わった', exact: true }).getAttribute('href');
  const newId = new URL(doneUrl, origin).searchParams.get('id');
  assert.ok(originalId && newId);
  assert.notEqual(newId, originalId);
  assert.equal(new URL(doneUrl, origin).searchParams.get('rev'), '1');
  await preview.getByRole('link', { name: '終わった', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: 'LMSへの提出は別に行ってください' }).waitFor();
  for (const page of [timetable, supporter]) await plans(page).getByText('終わった（LMSへの提出は別）', { exact: true }).waitFor();
  for (const page of [timetable, supporter]) {
    await plans(page).getByText('後回しにした', { exact: true }).waitFor();
    assert.equal(await plans(page).locator('li').count(), 2);
  }
  await screenshot(plans(timetable), 'preparation-done.png');
  operations.push('6: 再取得で予定・変更は増えず、後回しの記録を保ち新ID・版1の見本を作成、終わったが両画面へ反映');

  phase = 'step-6-announcement-publish';
  await button(student.locator('.demo-teacher-action').filter({ hasText: '第3回レポート（要約と引用）' }), 'お知らせを出す').click();
  await student.getByRole('status').filter({ hasText: 'お知らせを出しました' }).waitFor();
  assert.deepEqual((await student.locator('.demo-due').first().innerText()).match(/(\d{4})\/(\d{2})\/(\d{2})/), extendedDue);
  phase = 'step-6-announcement-parse';
  const [response] = await Promise.all([
    student.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/announcements'),
    openLms(),
  ]);
  const parsed = await response.json();
  const statuses = ['proposal', 'abstained', 'invalid-output', 'invalid-input', 'model-error', 'duplicate', 'budget-limit'];
  announcementStatus = { http: response.status(), status: statuses.includes(parsed.status) ? parsed.status : 'unexpected' };
  assert.equal(announcementStatus.status, 'proposal');
  phase = 'step-6-announcement-student-review';
  await timetable.locator('.course-panel').getByText('要確認', { exact: true }).waitFor();
  await timetable.locator('.course-panel').getByText(/お知らせでは締切が/).waitFor();
  phase = 'step-6-announcement-session-review';
  await deadlines.getByText(/お知らせでは締切が/).waitFor();
  phase = 'step-6-announcement-deadline';
  assert.ok((await timetable.locator('.course-panel').innerText()).includes(expectedDue));
  assert.ok((await deadlines.innerText()).includes(expectedDue));
  await calendar.locator(`td[data-date="${extendedDue[1]}-${extendedDue[2]}-${extendedDue[3]}"]`).getByText('第3回レポート（要約と引用）', { exact: true }).waitFor();
  assert.equal(await changes.count(), 1);
  await screenshot(deadlines, 'announcement-review.png');
  operations.push('6追加: お知らせを出してLMSを開くと両画面に要確認、公式締切・カレンダーの日付と変更件数は維持');
  assert.equal(browserErrors, 0);
  passed = true;
} catch (error) {
  failureKind = ['TimeoutError', 'AssertionError'].includes(error.name) ? error.name : 'other';
  process.exitCode = 1;
} finally {
  try {
    cleanupPhase = 'reset';
    await resetDemo();
    // Confirm reset via the still-open student tab before logging out.
    const timetable = studentContext.pages().find(page => new URL(page.url()).pathname === '/student');
    if (timetable) {
      cleanupPhase = 'clear-plans';
      await plans(timetable).waitFor({ state: 'detached' });
      cleanupPhase = 'clear-tasks';
      await timetable.getByText('第3回レポート（要約と引用）', { exact: true }).waitFor({ state: 'detached' });
    }
    reset = true;
  } catch { process.exitCode = 1; reset = false; cleanupFailures.push(cleanupPhase); }
  let logoutCount = 0;
  for (const [role, page] of [['student', student], ['supporter', supporter]]) {
    try {
      cleanupPhase = `logout-${role}`;
      await page.goto(`${origin}/demo-lms`);
      await button(page, 'ログアウト').click();
      await page.getByLabel('パスワード').waitFor();
      logoutCount++;
    } catch { process.exitCode = 1; cleanupFailures.push(cleanupPhase); }
  }
  const loggedOut = logoutCount === 2;
  if (reset && loggedOut) cleanupPhase = 'done';
  await browser.close();
  const result = { status: passed && reset && loggedOut ? 'pass' : 'fail', phase, operations, reset, loggedOut, cleanupPhase, cleanupFailures, browserErrors, announcementStatus, failureKind };
  await writeFile(new URL('operations.json', evidence), `${JSON.stringify(result, null, 2)}\n`);
  log(JSON.stringify({ ...result, evidenceDir: evidence.pathname }));
}
