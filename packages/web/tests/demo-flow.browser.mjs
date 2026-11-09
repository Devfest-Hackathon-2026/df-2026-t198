import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'demo-flow-browser'); const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } }); page.setDefaultTimeout(15000);
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i225-evidence';
const source = db.doc('students/trial-student/demo/current');
const ledger = () => db.collection('students/trial-student/assignments').get();
const pane = role => page.locator(`[data-demo-pane="${role}"]`);
const errors = []; page.on('pageerror', error => errors.push(error.message.replace(/https?:\/\/\S+/g, '[url]')));
const dueText = iso => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
async function reset() {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
}
try {
  await mkdir(evidence, { recursive: true });
  await page.goto('http://127.0.0.1:5177/demo-lms');
  await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await pane('supporter').getByText('書き方を書くレポート', { exact: true }).waitFor();
  const oldDue = (await source.get()).data().courses[0].assignments[0].dueAt;
  await pane('lms').locator('.demo-course a').first().click();
  await pane('lms').locator('.demo-task a').first().click();
  await pane('lms').locator('[data-demo-page="detail"]:visible').waitFor();
  await page.goBack();
  await pane('lms').locator('[data-demo-page="materials"]:visible').waitFor();
  await page.goBack();
  await pane('lms').locator('[data-demo-page="home"]:visible').waitFor();
  const oldStudent = await pane('student').locator('.demo-pane-body').innerText();
  const oldSupporter = await pane('supporter').locator('.demo-pane-body').innerText();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const reading = page.waitForRequest('**/api/v1/observations');
  await page.route('**/api/v1/observations', async route => { await held; await route.continue(); }, { times: 1 });
  await page.getByRole('button', { name: '「書き方を書くレポート」の締切を1日延ばす', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  const newDue = (await source.get()).data().courses[0].assignments[0].dueAt;
  assert.equal(Date.parse(newDue) - Date.parse(oldDue), 86400000);
  for (const role of ['student', 'supporter']) {
    await pane(role).getByText('まだLMSを開いていない', { exact: true }).waitFor();
    assert.ok((await pane(role).innerText()).includes(dueText(oldDue)));
    assert.ok(!(await pane(role).innerText()).includes(dueText(newDue)));
  }
  assert.equal(await pane('student').locator('.demo-pane-body').innerText(), oldStudent);
  assert.equal(await pane('supporter').locator('.demo-pane-body').innerText(), oldSupporter);
  const saved = () => ledger().then(value => value.docs.find(doc => doc.data().key.sourceId === 'DEMO101_TASK1').data());
  assert.equal(Date.parse((await saved()).officialDeadline.deadline.dueAt), Date.parse(oldDue));
  await page.screenshot({ path: `${evidence}/flow-source-only-1280.png`, fullPage: true });
  // No second click: the experience opens LMS automatically after showing the source-only state.
  await reading;
  assert.equal(Date.parse((await saved()).officialDeadline.deadline.dueAt), Date.parse(oldDue));
  release();
  await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  for (const role of ['student', 'supporter']) {
    await pane(role).locator('.deadline').filter({ hasText: dueText(newDue) }).waitFor();
    assert.equal(await pane(role).getByText('まだLMSを開いていない', { exact: true }).count(), 0);
    assert.equal(await pane(role).locator('.previous-deadline').first().innerText(), dueText(oldDue));
  }
  assert.equal(Date.parse((await saved()).officialDeadline.deadline.dueAt), Date.parse(newDue));
  await page.screenshot({ path: `${evidence}/flow-updated-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const role of ['LMS', '学生', '支援担当']) {
    await page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name: role, exact: true }).click();
    assert.equal(await page.locator('.demo-pane:visible').count(), 1);
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    await page.screenshot({ path: `${evidence}/flow-${{ LMS: 'lms', 学生: 'student', 支援担当: 'supporter' }[role]}-390.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '朝のメールを見る', exact: true }).click();
  await page.getByRole('region', { name: '今日やることのメール', exact: true }).waitFor();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  assert.equal(Date.parse((await saved()).officialDeadline.deadline.dueAt), Date.parse(newDue));
  await reset();
  assert.equal((await ledger()).size, 0);
  assert.equal(await page.locator('.demo-steps [aria-current="step"]').textContent(), '1LMSを開く');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/flow.json`, JSON.stringify({ status: 'pass', checks: [
    'student login alone shows the session assignment component', 'source-only state keeps both observed views and ledger unchanged',
    'automatic LMS open sends the rendered DOM observation', 'both views show old and new deadlines',
    '390px switches one pane at a time without overflow', 'morning email opens', 'hash back restores each LMS level',
    'reset cancellation keeps data; confirmed reset returns to first stage and clears ledger',
  ], browserErrors: errors }, null, 2));
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
