import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';

// Explicitly opt in: this test changes only the third demo pair and resets it afterwards.
assert.deepEqual(process.argv.slice(2), ['--verify-live-readme']);
const origin = 'https://project-00439085-4e2d-44c3-9a8.web.app';
const credentials = process.env.KADAI_DEMO_ACCOUNTS_FILE ??
  new URL('../../../fixtures-local/demo-accounts.local.json', import.meta.url);
const evidence = new URL('../../../docs/records/2026-11-07-issue-123/', import.meta.url);
assert.equal((await stat(credentials)).mode & 0o777, 0o600);
const accounts = JSON.parse(await readFile(credentials, 'utf8'));
assert.equal(accounts.origin, origin);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
const pair = accounts.pairs[2];
assert.equal(pair.pair, 'trial-3');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const supporterContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const student = await studentContext.newPage();
const supporter = await supporterContext.newPage();
let phase = 'login';
let reset;
let passed = false;
let browserErrors = 0;
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
  await mkdir(evidence, { recursive: true });
  await login(student, pair.student);
  await button(student, 'LMSを開く').waitFor();
  phase = 'step-1-reset-and-read';
  await resetDemo();
  const originalDue = (await student.locator('.demo-due').first().innerText()).match(/(\d{4})\/(\d{2})\/(\d{2})/);
  assert.ok(originalDue);
  await openLms();
  operations.push('1: 初期状態に戻し、LMSを開いて課題を受領');

  phase = 'step-2-student-screen';
  const popup = student.waitForEvent('popup');
  await student.getByRole('link', { name: '学生の画面を開く', exact: true }).click();
  const timetable = await popup;
  timetable.setDefaultTimeout(30000);
  timetable.on('pageerror', () => { browserErrors++; });
  await timetable.locator('.timetable').getByRole('button', { name: /架空の観察入門/ }).click();
  await timetable.getByRole('heading', { name: '架空の観察ノート', exact: true }).waitFor();
  const calendar = region(timetable, '締切のカレンダー');
  const calendarTask = calendar.locator('li').filter({ hasText: '架空の観察ノート' });
  await calendarTask.waitFor();
  const beforePanel = await timetable.locator('.course-panel').innerText();
  const beforeCalendar = await calendar.innerText();
  operations.push('2: 別タブの授業・締切と体験用カレンダーを表示');

  phase = 'step-3-supporter-preparation';
  await login(supporter, pair.supporter);
  phase = 'step-3-open-session';
  await supporter.getByRole('link', { name: '面談を開く', exact: true }).click();
  phase = 'step-3-choose-student';
  await supporter.getByRole('link', { name: `学生 ${pair.student.uid}`, exact: true }).click();
  const deadlines = region(supporter, '次の面談までの締切');
  await deadlines.getByText('架空の観察ノート', { exact: true }).waitFor();
  const beforeSession = await deadlines.innerText();
  operations.push('3: 別ブラウザの支援担当が学生の次の締切を表示');

  phase = 'step-4-source-only';
  await button(student, '「架空の観察ノート」の締切を1日延ばす').click();
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
  await calendar.locator(`td[data-date="${extendedDue[1]}-${extendedDue[2]}-${extendedDue[3]}"]`).getByText('架空の観察ノート', { exact: true }).waitFor();
  await screenshot(deadlines, 'session-deadline.png');
  phase = 'step-5-planning';
  await supporter.getByRole('link', { name: '② 相談する', exact: true }).click();
  phase = 'step-5-candidate';
  await supporter.locator('.session-candidate button').first().click();
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
  await deadlines.getByText('架空の観察ノート', { exact: true }).waitFor();
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
  const preview = region(student, '今朝のメール');
  await button(preview, '今日の準備の見本を用意する').click();
  await preview.getByRole('link', { name: '後回し', exact: true }).waitFor();
  await screenshot(preview, 'morning-mail.png');
  await preview.getByRole('link', { name: '後回し', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '次の空いたコマに動かしました' }).waitFor();
  for (const page of [timetable, supporter]) await plans(page).getByText('後回しにした', { exact: true }).waitFor();
  await screenshot(plans(timetable), 'preparation-later.png');
  await button(preview, '今日の準備の見本を用意する').click();
  await preview.getByRole('link', { name: '終わった', exact: true }).click();
  await preview.getByRole('status').filter({ hasText: '準備を「終わった」にしました' }).waitFor();
  for (const page of [timetable, supporter]) await plans(page).getByText('終わった（LMSへの提出は別）', { exact: true }).waitFor();
  await screenshot(plans(timetable), 'preparation-done.png');
  operations.push('6: 再取得で予定・変更は増えず、メール見本の後回し・終わったが両画面へ反映');
  assert.equal(browserErrors, 0);
  passed = true;
} catch {
  process.exitCode = 1;
} finally {
  try {
    await resetDemo();
    // Confirm reset via the still-open student tab before logging out.
    const timetable = studentContext.pages().find(page => new URL(page.url()).pathname === '/student');
    if (timetable) {
      await plans(timetable).waitFor({ state: 'detached' });
      await timetable.getByText('架空の観察ノート', { exact: true }).waitFor({ state: 'detached' });
    }
    reset = true;
    for (const page of [student, supporter]) {
      await page.goto(`${origin}/demo-lms`);
      await button(page, 'ログアウト').click();
      await page.getByLabel('パスワード').waitFor();
    }
  } catch { process.exitCode = 1; reset = false; }
  await browser.close();
  const result = { status: passed && reset ? 'pass' : 'fail', phase, operations, reset, browserErrors };
  await writeFile(new URL('operations.json', evidence), `${JSON.stringify(result, null, 2)}\n`);
  log(JSON.stringify(result));
}
