import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-screens-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i226-browser';
const base = process.env.KADAI_WEB_ORIGIN;
const errors = []; const checks = [];
const pass = name => checks.push(name);
async function fits(page) {
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
}
try {
  await mkdir(evidence, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', () => errors.push('browser-error'));
    await page.goto(`${base}/demo-lms`);
    await openJudgeLogin(page);
    await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
    await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
    const preview = page.getByRole('region', { name: '今日やることのメール', exact: true });
    await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
    const envelope = preview.getByRole('button', { name: /今日やること.*を開く/ });
    await envelope.waitFor();
    await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).waitFor();
    assert.equal(await preview.getByRole('link', { name: /終わった/ }).count(), 0);
    await preview.screenshot({ path: `${evidence}/inbox-${width}.png`, animations: 'disabled' });
    await envelope.click();
    await preview.getByRole('link', { name: /終わった/ }).waitFor();
    await preview.screenshot({ path: `${evidence}/mail-${width}.png`, animations: 'disabled' });
    await preview.getByRole('button', { name: '受信箱に戻る', exact: true }).click();
    await envelope.waitFor(); pass(`${width}: inbox opens and closes without performing a plan action`);

    await page.goto(`${base}/student`);
    await page.locator('.student-overview').waitFor();
    await page.getByRole('heading', { name: '今週の締切', exact: true }).waitFor();
    await page.getByRole('link', { name: 'アプリのホーム' }).waitFor();
    await page.waitForFunction(() => globalThis.document.querySelector('.app-home')?.getAttribute('href') === '/demo-lms');
    assert.equal(await page.getByText('LMSは、大学の授業支援システムです。準備は、課題に取り組む時間のことです。', { exact: true }).count(), 0);
    if (width === 390) {
      assert.equal(await page.getByRole('tab', { name: '締切', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.student-timetable').isVisible(), false);
      await page.getByRole('tab', { name: '時間割', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.locator('.timetable').waitFor();
      assert.equal(await page.locator('.student-deadlines').isVisible(), false);
      await page.screenshot({ path: `${evidence}/timetable-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('tab', { name: '準備', exact: true }).click();
      await page.getByRole('region', { name: '入れた準備の予定', exact: true }).waitFor();
      assert.equal(await page.locator('.student-timetable').isVisible(), false);
      await page.screenshot({ path: `${evidence}/preparation-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('tab', { name: '締切', exact: true }).click();
    } else {
      const deadlines = await page.locator('.student-deadlines').boundingBox();
      const timetable = await page.locator('.student-timetable').boundingBox();
      assert.ok(deadlines.x + deadlines.width <= timetable.x);
      assert.equal(await page.getByRole('tablist').isVisible(), false);
      // The navigation is only needed when seven days overflow their frame.
      await page.locator('.student-calendar').evaluate(element => { element.style.maxWidth = '400px'; });
      await page.locator('.calendar-navigation').waitFor();
      await page.locator('.student-calendar').evaluate(element => { element.style.removeProperty('max-width'); });
      await page.getByRole('region', { name: '締切のカレンダー', exact: true }).locator('.calendar-navigation').waitFor({ state: 'detached' });
    }
    await fits(page);
    await page.screenshot({ path: `${evidence}/student-${width}.png`, fullPage: true, animations: 'disabled' });
    pass(`${width}: timetable and preparation are reachable in the specified desktop/mobile layout`);

    await page.goto(`${base}/session/trial-student`);
    const table = page.getByRole('table', { name: '次の面談までの課題', exact: true });
    await table.waitFor();
    assert.equal(await page.locator('.td-detail').count(), 0);
    await table.getByRole('button', { name: '書き方を書くレポート', exact: true }).click();
    await page.locator('.td-detail').waitFor();
    await page.locator('.td-detail').getByRole('link', { name: /LMSで見る/ }).waitFor();
    await fits(page);
    await page.screenshot({ path: `${evidence}/session-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.locator('.td-detail').getByRole('button', { name: '閉じる', exact: true }).click();
    assert.equal(await page.locator('.td-detail').count(), 0);
    pass(`${width}: task table selects and closes the source detail panel`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/screens.json`, JSON.stringify({ passed: checks.length, checks, browserErrors: errors.length }, null, 2));
  log(JSON.stringify({ passed: checks.length, browserErrors: errors.length }));
} finally { await browser.close(); }
