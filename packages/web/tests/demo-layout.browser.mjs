import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { openJudgeLogin } from './helpers/judge-login.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-demo-layout';
const errors = []; page.on('pageerror', error => errors.push(error.message));
const main = page.locator('.demo-shell');
const preview = page.getByRole('region', { name: '今日やることのメール', exact: true });
const confirmation = page.getByRole('region', { name: '準備の予定の操作', exact: true });
const tab = name => page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name, exact: true });
const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
async function capture(name, target = page) {
  for (const [width, height] of [[1280, 960], [390, 844]]) {
    await target.setViewportSize({ width, height });
    assert.equal(await target.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `${name}: no overflow at ${width}`);
    if (name.startsWith('confirmation')) assert.ok((await target.locator('.plan-confirmation').boundingBox()).width >= Math.min(520, width - 64), 'confirmation uses the available width');
    await target.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await target.setViewportSize({ width: 1280, height: 960 });
}
async function guideAction() {
  assert.equal(await main.locator('.td-btn-primary:visible').count(), 1);
  assert.equal(await main.locator('.demo-steps [aria-current="step"] .td-btn-primary:visible').count(), 1);
  for (const button of await main.locator('.rd-demo-controls button:visible, .demo-secondary button:visible').all()) {
    assert.equal(await button.evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
}
try {
  await mkdir(evidence, { recursive: true });
  await page.goto('http://127.0.0.1:5177/demo-lms'); await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  await guideAction(); await capture('lms-home');
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).click(); await status('課題を確認しました');
  await guideAction();
  const lms = page.locator('[data-demo-pane="lms"]');
  await lms.locator('.demo-course a').first().click(); await capture('lms-materials');
  await lms.locator('.demo-task a').first().click(); await capture('lms-detail');
  assert.equal(await lms.locator('.rd-lms-notice:visible').count(), 0, 'the extension notice is absent before extending');
  await page.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true }).click();
  await status('LMSの締切を1日延ばしました');
  await lms.locator('.rd-lms-notice:visible').waitFor();
  assert.equal(await lms.locator('[data-demo-page="detail"]:visible .previous-deadline').count(), 1);
  await capture('lms-extended'); await status('課題を確認しました');
  await tab('学生').click(); await capture('observed-student');
  await tab('支援担当').click(); await capture('observed-supporter');
  await guideAction();
  await page.getByRole('button', { name: '朝のメールを見る', exact: true }).click();
  await preview.locator('.digest-open-mail').waitFor();
  assert.equal(await main.locator('.rd-demo-stage:visible').count(), 0, 'mail is a separate view');
  assert.equal(await main.locator('.td-btn-primary:visible').count(), 0);
  const done = preview.getByRole('link', { name: /終わった/ }).first();
  const later = preview.getByRole('link', { name: /後回し/ }).first();
  assert.equal(await done.evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgb(22, 33, 58)');
  assert.equal(await later.evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  await capture('mail');
  const direct = await page.context().newPage();
  await direct.goto(await done.getAttribute('href'));
  await direct.getByRole('region', { name: '準備の予定の操作', exact: true }).getByRole('button', { name: '終わった', exact: true }).waitFor();
  const quietActions = direct.locator('.student-workspace > :not(.plan-confirmation) .td-btn-primary:visible');
  for (const button of await quietActions.all()) {
    assert.equal(await button.evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
  await capture('confirmation-direct', direct); await direct.close();
  await done.click(); await confirmation.getByRole('button', { name: '終わった', exact: true }).waitFor();
  assert.equal(await preview.locator('.digest-open-mail:visible').count(), 0);
  assert.equal(await main.locator('.td-btn-primary:visible').count(), 1);
  await capture('confirmation-before');
  await confirmation.getByRole('button', { name: '終わった', exact: true }).click();
  await status('準備が終わりました');
  await confirmation.getByRole('region', { name: '次は提出', exact: true }).getByRole('link', { name: 'LMSを開く', exact: true }).waitFor();
  assert.equal(await confirmation.locator('button').count(), 0);
  await capture('confirmation-after');
  await page.getByRole('button', { name: '体験に戻る', exact: true }).click();
  await tab('LMS').click(); await guideAction();
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/layout.json`, JSON.stringify({ status: 'pass', checks: [
    'one primary action inside the current guide step; secondary controls are text',
    'home, materials, detail, student and supporter views fit at 1280 and 390',
    'extension notice appears only after extending, with one old deadline',
    'mail replaces the walkthrough; only done is filled',
    'confirmation replaces mail; direct link keeps other actions quiet; explicit click records completion',
    'after completion only the next-submission LMS action is filled; return to experience works',
  ], browserErrors: errors }, null, 2));
} finally { await browser.close(); }
