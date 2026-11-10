import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-emulators-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'demo-reset-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(15000);
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i19-evidence';
const student = db.doc('students/trial-student');
const source = student.collection('demo').doc('current');
const open = page.getByRole('button', { name: 'LMSを開く', exact: true });
const teacher = page.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true });
const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
try {
  const stale = (await source.get()).data();
  stale.courses[0].assignments[0].dueAt = '2000-01-01T08:00:00.000Z';
  await source.set(stale);
  const other = db.doc('students/other-demo-pair/demo/current');
  await other.set(stale);
  await page.goto('http://127.0.0.1:5177/demo-lms');
  await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await open.waitFor();
  const current = (await source.get()).data();
  assert.ok(Date.parse(current.courses[0].assignments[0].dueAt) > Date.now());
  assert.ok(Date.parse((await student.collection('sessionContext').doc('current').get()).data().nextSessionAt) > Date.now());
  assert.deepEqual(await page.locator('.demo-steps > li').evaluateAll(rows => rows.map(row => row.firstElementChild.textContent + row.querySelector('b').textContent)), [
    '1LMSを開く', '2先生が締切を延ばす', '3学生と支援担当の画面', '4朝のメール',
  ]);
  assert.equal(await page.locator('.demo-command .td-btn-primary').count(), 1);
  await page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name: '学生', exact: true }).waitFor();
  await page.locator('.demo-more > summary').click();
  assert.equal(await page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name: 'LMS', exact: true }).getAttribute('aria-pressed'), 'true');
  const markers = await page.locator('.demo-list-end, .demo-availability').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  assert.ok(markers.length > 0 && markers.every(width => width <= 1));
  assert.equal(await page.locator('[data-demo-page="materials"] [data-demo-page="detail"]').count(), 0);
  assert.equal(await page.locator('[data-demo-page="detail"] h1').count(), 5);
  // Return the extension response while withholding the corresponding source snapshot.
  const dueAt = new Date(Date.parse(current.courses[0].assignments[0].dueAt) + 86400_000).toISOString();
  await page.route('**/api/v1/demo/extend', route => route.fulfill({ json: { sourceId: 'DEMO101_TASK1', dueAt } }), { times: 1 });
  await teacher.click();
  await status('LMSの締切が変わるのを待っています');
  assert.equal(await open.isDisabled(), true);
  current.courses[0].assignments[0].dueAt = dueAt;
  await source.set(current);
  await status('LMSの締切を1日延ばしました');
  assert.equal(await open.isEnabled(), true);
  // A fresh login preserves this extension rather than resetting every visit.
  await page.reload(); await open.waitFor();
  await page.locator('.demo-more > summary').click();
  assert.equal((await source.get()).data().courses[0].assignments[0].dueAt, dueAt);
  let previousId;
  let previousRetryable = false;
  for (const failure of [400, 403, 500, 'network']) {
    let sentId;
    await page.route('**/api/v1/observations', async route => {
      sentId = route.request().postDataJSON().observationId;
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({ status: failure, json: { error: 'test-rejection' } });
    }, { times: 1 });
    await open.click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.demo-command p[role]').getAttribute('role'), 'alert');
    if (previousId) assert.equal(sentId === previousId, previousRetryable);
    previousId = sentId; previousRetryable = failure === 500 || failure === 'network';
    assert.equal(await teacher.isDisabled(), previousRetryable);
    assert.match(await page.getByRole('alert').innerText(), previousRetryable ? /接続を確かめて/ : /体験用アカウントの設定/);
  }
  const retry = page.waitForRequest('**/api/v1/observations');
  await open.click();
  assert.equal((await retry).postDataJSON().observationId, previousId);
  await status('課題を確認しました');
  assert.equal(await page.locator('.demo-command p[role]').getAttribute('role'), 'status');
  assert.equal((await student.collection('assignments').get()).size, 5);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/issue-68-wide.png`, fullPage: true });
  // End with an explicit reset; the existing, unchanged M6 scenario runs next.
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await status('体験を最初の状態に戻しました');
  assert.equal(await page.locator('[data-demo-page="home"] .demo-course').count(), 6);
  for (const name of ['assignments', 'courses', 'changes', 'fetchStates', 'observationReceipts', 'calendarItems']) {
    assert.equal((await student.collection(name).get()).size, 0);
  }
  assert.equal((await student.collection('integrations').doc('calendar').get()).exists, false);
  assert.deepEqual((await other.get()).data(), stale);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await page.screenshot({ path: `${evidence}/issue-68-narrow.png`, fullPage: true });
  await writeFile(`${evidence}/issue-68.json`, JSON.stringify({ status: 'pass', checks: [
    'stale first login refreshes dates', 'fresh login preserves extension', 'four ordered stages, one main action and adjacent result',
    'hidden markers keep h1 and reader boundaries', 'extension waits for source snapshot',
    '400/403 discard pending; 500/network replay the same ID', 'reset clears derived data and leaves another pair unchanged', '390px layout',
  ] }, null, 2));
  log('PASS Issue 68: reset, freshness, ordered stages, hidden markers, delayed snapshot, 4xx/5xx/network retries');
} finally {
  await browser.close(); await db.terminate(); await deleteApp(app);
}
