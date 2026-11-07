import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';

const projectId = 'project-00439085-4e2d-44c3-9a8';
const origin = `https://${projectId}.web.app`;
const credentials = process.env.KADAI_DEMO_ACCOUNTS_FILE ??
  new URL('../../../fixtures-local/demo-accounts.local.json', import.meta.url);
const evidence = new URL('../../../docs/records/2026-11-06-issue-47-live/', import.meta.url);
// These are the existing local M6 steps. Failed and unreached steps stay in the denominator.
const steps = [
  '学生と支援担当が別のブラウザでログインする', 'LMSを開いて最初の課題を受け取る',
  '先生役で締切を延ばし、LMSだけが変わる', '学生がLMSを開き、新しい締切が台帳に入る',
  '開いたままの学生画面が変わる', '保存済みの体験用カレンダーの予定が動く',
  '開いたままの面談画面が変わる', '応答を失った再送でも履歴と予定が増えない',
].map(name => ({ name, status: 'not-run' }));
let phase = 'explicit-live-m6-required';
let browser;
let started = false;
let c14 = false;
let beforeDue;
let afterDue;
const errors = [];
const pass = index => { steps[index].status = 'pass'; };

// Decode only the Firestore REST value types used by the existing demo documents.
function decode(value) {
  if ('nullValue' in value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return fields(value.mapValue.fields);
  throw new Error('unsupported-firestore-value');
}
function fields(values = {}) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, decode(value)]));
}

try {
  assert.deepEqual(process.argv.slice(2), ['--verify-live-m6']);
  assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  phase = 'credential-file-check';
  assert.equal((await stat(credentials)).mode & 0o777, 0o600);
  const accounts = JSON.parse(await readFile(credentials, 'utf8'));
  assert.equal(accounts.projectId, projectId);
  assert.equal(accounts.origin, origin);
  const pair = accounts.pairs.find(candidate => candidate.pair === 'trial-1');
  assert.ok(pair?.student && pair?.supporter);
  started = true;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true });
  async function login(account) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => errors.push('browser-error'));
    const session = { context, page, token: '', observationId: '' };
    // Never record traces, HAR, console, request bodies or credentials.
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith('/api/')) return;
      session.token = request.headers().authorization?.replace(/^Bearer /, '') || session.token;
      if (url.pathname === '/api/v1/observations') session.observationId = request.postDataJSON().observationId;
    });
    await page.goto(`${origin}/demo-lms`);
    await page.getByLabel('メールアドレス').fill(account.email);
    await page.getByLabel('パスワード').fill(account.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    return session;
  }
  phase = 'separate-logins';
  const student = await login(pair.student);
  await student.page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  const supporter = await login(pair.supporter);
  await supporter.page.getByRole('link', { name: '面談を開く', exact: true }).click();
  await supporter.page.getByRole('link', { name: `学生 ${pair.student.uid}`, exact: true }).click();
  pass(0);

  const documentBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/students/${pair.student.uid}`;
  async function read(path, query = '') {
    assert.ok(student.token);
    const response = await student.page.request.get(`${documentBase}/${path}${query}`, {
      headers: { Authorization: `Bearer ${student.token}` },
    });
    try {
      assert.equal(response.status(), 200);
      return await response.json();
    } finally { await response.dispose(); }
  }
  const document = async path => fields((await read(path)).fields);
  async function collection(path) {
    const documents = [];
    let pageToken = '';
    do {
      const page = await read(path, `?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`);
      documents.push(...page.documents ?? []);
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return documents.sort((a, b) => a.name.localeCompare(b.name)).map(doc => ({
      data: fields(doc.fields), updateTime: doc.updateTime,
    }));
  }
  const ledger = () => collection('assignments');
  const changes = () => collection('changes');
  const calendarItems = () => collection('calendarItems');
  const calendarTarget = () => document('integrations/calendar');
  const task = rows => rows.find(row => row.data.latest.sourceId === 'DEMO101_TASK1').data;
  async function openLms() {
    await student.page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
    await student.page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  }
  phase = 'initial-observation-and-receipt';
  await openLms();
  const initialLedger = await ledger();
  assert.equal(initialLedger.length, 5);
  const initialReceipt = await document(`observationReceipts/${student.observationId}`);
  assert.equal(initialReceipt.observationId, student.observationId);
  assert.equal(initialReceipt.result.status, 'applied');
  assert.equal(task(initialLedger).officialDeadline.observationId, student.observationId);
  beforeDue = task(initialLedger).officialDeadline.deadline.dueAt;
  c14 = true;
  const deadlines = supporter.page.getByRole('region', { name: '次の面談までの締切' });
  await deadlines.getByText('書き方を書くレポート', { exact: true }).waitFor();
  pass(1);

  const timetable = await student.context.newPage();
  timetable.setDefaultTimeout(30000);
  timetable.on('pageerror', () => errors.push('browser-error'));
  await timetable.goto(`${origin}/student`);
  await timetable.locator('.timetable').getByRole('button', { name: /レポートの書き方の書き方/ }).click();
  await timetable.getByRole('heading', { name: '書き方を書くレポート', exact: true }).waitFor();
  const calendar = timetable.getByRole('region', { name: '締切のカレンダー', exact: true });
  await calendar.getByText(/書き方を書くレポート/).waitFor();
  const beforeCalendar = await calendar.innerText();
  const initialTarget = await calendarTarget();
  const initialItems = await calendarItems();
  assert.equal(initialTarget.mode, 'mock');
  assert.equal(initialTarget.executor, 'demo');
  const oldEventId = Object.keys(initialTarget.mockEvents).find(id =>
    initialTarget.mockEvents[id].event.summary.includes('書き方を書くレポート'));
  assert.ok(oldEventId);
  const beforeChanges = await changes();
  const sessionBefore = await deadlines.innerText();
  const panelBefore = await timetable.locator('.course-panel').innerText();
  await mkdir(evidence, { recursive: true });
  async function screenshot(page, filename) {
    await page.screenshot({ path: new URL(filename, evidence).pathname, fullPage: true,
      mask: [page.locator('input'), page.locator('h1'), page.locator('a[href*="trial-"]')], maskColor: '#d6d8dc' });
  }
  await screenshot(timetable, 'student-before.png');
  phase = 'teacher-changes-source-only';
  await student.page.getByRole('button', { name: '「書き方を書くレポート」の締切を1日延ばす', exact: true }).click();
  await student.page.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  afterDue = (await document('demo/current')).courses[0].assignments[0].dueAt;
  assert.equal(Date.parse(afterDue) - Date.parse(beforeDue), 86400_000);
  assert.deepEqual(await ledger(), initialLedger);
  assert.deepEqual(await changes(), beforeChanges);
  assert.deepEqual(await calendarItems(), initialItems);
  assert.deepEqual(await calendarTarget(), initialTarget);
  assert.equal(await deadlines.innerText(), sessionBefore);
  assert.equal(await timetable.locator('.course-panel').innerText(), panelBefore);
  assert.equal(await calendar.innerText(), beforeCalendar);
  pass(2);

  phase = 'observation-with-lost-response';
  let sentId;
  let appliedStatus;
  await student.page.route('**/api/v1/observations', async route => {
    sentId = route.request().postDataJSON().observationId;
    const response = await route.fetch();
    appliedStatus = response.status();
    await response.dispose();
    await route.abort('failed');
  }, { times: 1 });
  await student.page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.page.getByRole('alert').filter({ hasText: '操作が終わりませんでした' }).waitFor();
  assert.equal(appliedStatus, 200);
  const appliedLedger = await ledger();
  assert.equal(Date.parse(task(appliedLedger).officialDeadline.deadline.dueAt), Date.parse(afterDue));
  assert.equal(task(appliedLedger).officialDeadline.observationId, sentId);
  const receipt = await read(`observationReceipts/${sentId}`);
  assert.equal(fields(receipt.fields).observationId, sentId);
  assert.equal(fields(receipt.fields).result.status, 'applied');
  const afterChanges = await changes();
  assert.equal(afterChanges.length, beforeChanges.length + 1);
  const change = afterChanges.find(row => row.data.observationId === sentId).data;
  assert.equal(change.kind, 'deadline-changed');
  assert.equal(change.assignmentKey.sourceId, 'DEMO101_TASK1');
  assert.equal(Date.parse(change.before.dueAt), Date.parse(beforeDue));
  assert.equal(Date.parse(change.after.dueAt), Date.parse(afterDue));
  pass(3);

  phase = 'live-student-screen';
  const expectedDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric',
    day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(afterDue));
  await timetable.waitForFunction(previous => globalThis.document.querySelector('.course-panel').innerText !== previous, panelBefore);
  assert.ok((await timetable.locator('.course-panel').innerText()).includes(expectedDate));
  pass(4);

  phase = 'persisted-calendar-and-revisions';
  const eventDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(afterDue));
  const eventTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(afterDue));
  const eventCard = calendar.locator(`td[data-date="${eventDay}"] .calendar-event`).filter({ hasText: '書き方を書くレポート' });
  await eventCard.getByText(eventTime, { exact: true }).waitFor();
  const savedTarget = await calendarTarget();
  const savedItems = await calendarItems();
  assert.equal(Object.keys(savedTarget.mockEvents).length, 5);
  assert.equal(Date.parse(savedTarget.mockEvents[oldEventId].event.start.dateTime), Date.parse(afterDue));
  for (const { data: item } of savedItems) {
    assert.equal(item.appliedRevision, item.desiredRevision);
    assert.deepEqual(savedTarget.mockEvents[item.eventId], {
      itemKey: item.itemKey, generation: item.generation, revision: item.appliedRevision, event: item.desired.event,
    });
  }
  assert.equal(await calendar.locator('li').filter({ hasText: '書き方を書くレポート' }).count(), 1);
  pass(5);
  await screenshot(timetable, 'student-after.png');

  phase = 'live-supporter-screen';
  await supporter.page.waitForFunction(previous =>
    globalThis.document.querySelector('[aria-labelledby="session-deadlines"]').innerText !== previous, sessionBefore);
  await supporter.page.getByRole('region', { name: '前回の面談からの変化' }).getByText(/締切が .+ から .+ に変わりました/).first().waitFor();
  assert.ok((await deadlines.innerText()).includes(expectedDate));
  pass(6);
  await screenshot(supporter.page, 'supporter-after.png');

  phase = 'same-id-retry-and-further-open';
  await openLms();
  assert.equal(student.observationId, sentId);
  assert.deepEqual(await read(`observationReceipts/${sentId}`), receipt);
  assert.deepEqual(await ledger(), appliedLedger);
  assert.deepEqual(await changes(), afterChanges);
  assert.deepEqual(await calendarTarget(), savedTarget);
  assert.deepEqual(await calendarItems(), savedItems);
  await openLms();
  assert.notEqual(student.observationId, sentId);
  assert.deepEqual(await changes(), afterChanges);
  assert.deepEqual(await calendarTarget(), savedTarget);
  assert.deepEqual(await calendarItems(), savedItems);
  assert.deepEqual(errors, []);
  pass(7);
} catch {
  const failed = steps.find(step => step.status === 'not-run');
  if (failed) failed.status = 'fail';
  // Playwright errors can contain form inputs, headers or URLs. Print only the fixed phase.
  process.stderr.write(`live-m6-verification-failed: ${phase}\n`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (started) {
    const passed = steps.filter(step => step.status === 'pass').length;
    await mkdir(evidence, { recursive: true });
    await writeFile(new URL('m6.json', evidence), JSON.stringify({
      environment: 'deployed Cloud Run + Firebase Hosting/Auth/Firestore + Chromium', origin,
      calendar: 'mock', pair: 'trial-1', measuredAt: new Date().toISOString(),
      passed, total: steps.length, percent: 100 * passed / steps.length, steps, c14,
      sourceDeadlineBefore: beforeDue, sourceDeadlineAfter: afterDue,
      browserErrors: errors.length, failurePhase: process.exitCode ? phase : null,
    }, null, 2) + '\n');
    process.stdout.write(`M6 live: ${passed}/${steps.length} (${100 * passed / steps.length}%), mock calendar; C14: ${c14}\n`);
  }
}
