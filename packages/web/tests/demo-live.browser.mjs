import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { log } from 'node:console';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const local = process.argv[2] === '--verify-local-demo';
if (local && (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099')) throw new Error('local-emulators-required');
const projectId = local ? 'demo-kadai-hisho' : 'project-00439085-4e2d-44c3-9a8';
const origin = local ? 'http://127.0.0.1:5177' : `https://${projectId}.web.app`;
const credentials = new URL('../../../fixtures-local/demo-accounts.local.json', import.meta.url);
let browser;
let phase = 'explicit-live-verification-required';
const responses = [];
try {
  assert.deepEqual(process.argv.slice(2), [local ? '--verify-local-demo' : '--verify-live-demo']);
  if (!local) assert.equal((await stat(credentials)).mode & 0o777, 0o600);
  const accounts = local ? { projectId, origin, pairs: JSON.parse(process.env.KADAI_LOCAL_DEMO_PAIRS) }
    : JSON.parse(await readFile(credentials, 'utf8'));
  assert.equal(accounts.projectId, projectId);
  assert.equal(accounts.origin, origin);
  assert.equal(accounts.pairs.length, 3);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const views = [];
  const evidence = local ? new URL(`file://${process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-demo-local'}/live/`)
    : new URL('../../../docs/records/2026-11-06-issue-59/', import.meta.url);
  const documentBase = `${local ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com'}/v1/projects/${projectId}/databases/(default)/documents`;
  async function login(account) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => errors.push('browser-error'));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) responses.push({ path: url.pathname, status: response.status() });
      if (url.hostname === 'identitytoolkit.googleapis.com') responses.push({ service: 'auth', status: response.status() });
    });
    const session = { context, page, token: '' };
    // Keep ID tokens in memory only. Do not record traces, HAR, console or bodies.
    page.on('request', request => {
      if (request.url().startsWith(`${origin}/api/`)) {
        session.token = request.headers().authorization?.replace(/^Bearer /, '') || session.token;
      }
    });
    await page.goto(`${origin}/demo-lms`);
    await openJudgeLogin(page);
    await page.getByLabel('メールアドレス').fill(account.email);
    await page.getByLabel('パスワード').fill(account.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    return session;
  }
  async function openLms(page) {
    await page.getByRole('button', { name: /^LMSを(?:もう一度)?開く$/, exact: true }).click();
    await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  }
  for (const pair of accounts.pairs) {
    phase = `${pair.pair}-login-and-initial-observation`;
    const student = await login(pair.student);
    phase = `${pair.pair}-student-workspace`;
    await student.page.getByRole('button', { name: /^LMSを(?:もう一度)?開く$/, exact: true }).waitFor();
    await student.page.getByRole('button', { name: '3つ並べて見る', exact: true }).click();
    phase = `${pair.pair}-student-observation`;
    await openLms(student.page);
    await student.page.locator('.demo-more > summary').click();
    phase = `${pair.pair}-student-timetable`;
    const timetable = await student.context.newPage();
    timetable.setDefaultTimeout(30000);
    await timetable.goto(`${origin}/student`);
    await timetable.locator('.timetable').getByRole('button', { name: /文章表現/ }).click();
    await timetable.getByRole('heading', { name: '第3回レポート（要約と引用）', exact: true }).waitFor();
    const supporter = await login(pair.supporter);
    phase = `${pair.pair}-supporter-workspace`;
    await supporter.page.getByRole('link', { name: '面談を開く', exact: true }).click();
    const link = supporter.page.getByRole('navigation', { name: '担当する学生' }).locator(`a[href="/session/${pair.student.uid}"]`);
    phase = `${pair.pair}-supporter-student-list`;
    await link.waitFor();
    assert.equal(await supporter.page.getByRole('navigation', { name: '担当する学生' }).getByRole('link').count(), 1);
    await link.click();
    const deadlines = supporter.page.getByRole('region', { name: '次の面談までの締切' });
    phase = `${pair.pair}-supporter-deadlines`;
    await deadlines.getByText('第3回レポート（要約と引用）', { exact: true }).waitFor();
    views.push({ pair, student, supporter, timetable, deadlines,
      panelBefore: await timetable.locator('.course-panel').innerText(),
      sessionBefore: await deadlines.innerText(),
      sourceBefore: await student.page.getByRole('region', { name: '先生役の操作' }).innerText() });
  }
  phase = 'cross-pair-read-denial';
  let deniedReads = 0;
  for (const own of views) for (const other of views.filter(view => view !== own)) {
    for (const session of [own.student, own.supporter]) {
      assert.ok(session.token);
      for (const path of [`students/${other.pair.student.uid}/demo/current`, `students/${other.pair.student.uid}/assignments`]) {
        const response = await session.page.request.get(`${documentBase}/${path}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        assert.equal(response.status(), 403);
        deniedReads++;
        await response.dispose();
      }
    }
  }
  await mkdir(evidence, { recursive: true });
  const first = views[0];
  async function screenshot(page, filename) {
    await page.screenshot({ path: new URL(filename, evidence).pathname, fullPage: true,
      mask: [page.locator('input'), page.locator('h1'), page.locator('a[href*="trial-"]')], maskColor: '#d6d8dc' });
  }
  phase = 'teacher-extension-does-not-yet-change-ledger';
  await screenshot(first.timetable, 'student-before.png');
  await first.student.page.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true }).click();
  await first.student.page.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  assert.notEqual(await first.student.page.getByRole('region', { name: '先生役の操作' }).innerText(), first.sourceBefore);
  assert.equal(await first.timetable.locator('.course-panel').innerText(), first.panelBefore);
  assert.equal(await first.deadlines.innerText(), first.sessionBefore);
  phase = 'reopen-updates-student-and-supporter';
  await openLms(first.student.page);
  await first.timetable.waitForFunction(previous => globalThis.document.querySelector('.course-panel').innerText !== previous, first.panelBefore);
  await first.supporter.page.waitForFunction(previous => globalThis.document.querySelector('[aria-labelledby="session-deadlines"]').innerText !== previous, first.sessionBefore);
  await first.supporter.page.getByRole('region', { name: '前回の面談からの変化' }).getByText(/締切が .+ から .+ に変わりました/).waitFor();
  await screenshot(first.timetable, 'student-after.png');
  await screenshot(first.supporter.page, 'supporter-after.png');
  phase = 'other-pairs-unchanged-after-refetch';
  for (const view of views.slice(1)) {
    await openLms(view.student.page);
    assert.equal(await view.student.page.getByRole('region', { name: '先生役の操作' }).innerText(), view.sourceBefore);
    assert.equal(await view.timetable.locator('.course-panel').innerText(), view.panelBefore);
    assert.equal(await view.deadlines.innerText(), view.sessionBefore);
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('operations.json', evidence), JSON.stringify({ status: 'pass', origin,
    checkedAt: new Date().toISOString(), pairs: 3, isolatedBrowserContexts: 6, deniedCrossPairReads: deniedReads,
    operations: ['fresh browser email/password login for all six accounts', 'each supporter sees only their student',
      'LMS read populates all three student timetables and supporter sessions',
      'teacher extends only the fictional source before refetch', 'refetch updates both open trial-1 screens',
      'other two pairs retain source and ledger deadlines after refetch',
      'all student/supporter cross-pair source and assignment reads denied'], browserErrors: errors,
  }, null, 2) + '\n');
  log(`PASS live demo: 3 pairs, 6 isolated contexts, ${deniedReads} denied cross-pair reads, live timetable/session updates`);
} catch {
  // Never print Playwright errors: they may quote form inputs or request headers.
  process.stderr.write(`live-demo-verification-failed: ${phase}\n`);
  log({ responses });
  process.exitCode = 1;
} finally { if (browser) await browser.close(); }
