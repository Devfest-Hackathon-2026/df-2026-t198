import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'no-preference' });
page.setDefaultTimeout(15000);
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-demo-screen';
const tab = name => page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name, exact: true });
const pane = role => page.locator(`[data-demo-pane="${role}"]`);
const confirmed = () => page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
const selected = async role => { await pane(role).waitFor({ state: 'visible' }); assert.equal(await page.locator('.demo-pane:visible').count(), 1); };
async function extend() {
  const button = page.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true });
  if (!await button.isVisible()) await page.locator('.demo-more > summary').click();
  await button.click();
}
async function reset() {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
}
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await mkdir(evidence, { recursive: true });
  await page.goto('http://127.0.0.1:5177/demo-lms'); await openJudgeLogin(page);
  assert.equal(await page.locator('.app-header nav').count(), 0);
  await page.screenshot({ path: `${evidence}/entry-1440.png`, fullPage: true });
  await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  await selected('lms'); assert.equal(await page.locator('[data-demo-pane]').count(), 3);
  assert.equal(await page.locator('.app-header nav').count(), 0);
  assert.equal(await page.locator('.rd-demo-external .rd-demo-role').count(), 0);
  await page.getByText('大学のLMS', { exact: true }).waitFor();
  await page.getByText('体験用の見本', { exact: true }).waitFor();
  await page.locator('.rd-demo-product > b').getByText('ToDoku', { exact: true }).waitFor();
  await page.getByText('ほかの課題の延長やお知らせは、下の「先生役の操作・メールの見本」から', { exact: true }).waitFor();
  await reset();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).click(); await confirmed();
  const confirmedAt = Date.now();
  await selected('lms'); await selected('student'); assert.ok(Date.now() - confirmedAt >= 600);
  await page.screenshot({ path: `${evidence}/one-screen-1280.png`, fullPage: true, animations: 'disabled' });
  await extend(); await selected('lms');
  await page.getByRole('button', { name: 'LMSをもう一度開く', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: 'LMSの締切が変わりました。学生と支援担当' }).waitFor();
  await pane('lms').locator('[data-demo-page="detail"]:visible').waitFor();
  await confirmed(); await selected('student');
  const studentAt = Date.now(); await selected('supporter'); assert.ok(Date.now() - studentAt >= 2000);
  await page.getByRole('status').filter({ hasText: '支援担当の画面にも、同じ変更が出ています' }).waitFor();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await extend(); await confirmed(); await selected('student');
    const geometry = await tab('学生').evaluate(node => {
      const box = node.getBoundingClientRect();
      const header = globalThis.document.querySelector('.app-header').getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, header: header.bottom, height: globalThis.innerHeight };
    });
    assert.ok(geometry.top >= geometry.header && geometry.bottom <= geometry.height, JSON.stringify(geometry));
    await page.screenshot({ path: `${evidence}/auto-switch-${viewport.width}.png`, animations: 'disabled' });
    await selected('supporter');
    for (const [name, role] of [['LMS', 'lms'], ['学生', 'student'], ['支援担当', 'supporter']]) {
      await tab(name).click();
      await page.screenshot({ path: `${evidence}/single-${role}-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
    }
    if (viewport.width > 760) {
      await page.getByRole('button', { name: '3つ並べて見る', exact: true }).click();
      await page.getByRole('heading', { name: '大学のLMS（見本）', exact: true }).waitFor();
      assert.equal(await pane('lms').evaluate(node => globalThis.getComputedStyle(node).borderInlineEndWidth), '3px');
      await page.screenshot({ path: `${evidence}/parallel-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: '1画面ずつ見る', exact: true }).click();
    } else {
      // Parallel mode keeps the existing single-pane presentation on mobile.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: '3つ並べて見る', exact: true }).click();
      await page.setViewportSize(viewport);
      assert.equal(await page.locator('.demo-pane:visible').count(), 1);
      await page.screenshot({ path: `${evidence}/parallel-responsive-390.png`, fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: '1画面ずつ見る', exact: true }).click();
      await page.setViewportSize(viewport);
    }
  }
  await page.setViewportSize({ width: 1280, height: 960 });
  await extend(); await selected('lms'); await tab('学生').click(); await confirmed();
  await page.waitForTimeout(3500); await selected('student');
  // Cancel after the first automatic switch too, while the 2.5s timer is pending.
  await extend(); await confirmed(); await selected('student'); await tab('LMS').click();
  await page.waitForTimeout(3000); await selected('lms');
  await page.getByLabel('自動で切り替える', { exact: true }).uncheck();
  await extend(); await confirmed(); await page.waitForTimeout(3500); await selected('lms');
  await tab('学生').click(); await selected('student');
  await tab('支援担当').click(); await selected('supporter');
  await page.getByLabel('自動で切り替える', { exact: true }).check();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await extend(); await confirmed(); await page.waitForTimeout(3500); await selected('lms');
  assert.equal(await page.getByLabel('自動で切り替える', { exact: true }).isDisabled(), true);
  assert.equal(await pane('lms').evaluate(node => globalThis.getComputedStyle(node).animationName), 'none');
  await tab('学生').click(); await selected('student');
  await page.getByRole('button', { name: '3つ並べて見る', exact: true }).click();
  assert.equal(await page.locator('.demo-pane:visible').count(), 3);
  await page.getByRole('button', { name: '1画面ずつ見る', exact: true }).click(); await selected('student');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole('button', { name: '3つ並べて見る', exact: true }).isVisible(), false);
  for (const name of ['LMS', '学生', '支援担当']) {
    await tab(name).click(); assert.equal(await page.locator('.demo-pane:visible').count(), 1);
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  }
  await tab('学生').click();
  await page.screenshot({ path: `${evidence}/one-screen-390.png`, fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/screen-flow.json`, JSON.stringify({ status: 'pass', checks: [
    'A: demo header navigation absent before and after login',
    'B: external LMS label/subtitle, separate ToDoku group, 3px LMS column divider',
    'C: selected student button below header at 1280x800, 1440x900, 390x844 after extension',
    'E: step 3 says LMSをもう一度開く',
    'F: step 2 names the teacher controls and mail samples',
    'default single pane, all three DOM panes retained', 'open: LMS then student after confirmation',
    'extend: detail then student then supporter after 2.5 seconds', 'tab cancels during read and during supporter delay',
    'automatic off: no switch, manual guides work', 'reduced motion: no switch or animation, manual guides work',
    'parallel toggle works at 1280, hidden at 390, no horizontal overflow',
  ], browserErrors: errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${evidence}/screen-failure.png`, fullPage: true });
  await writeFile(`${evidence}/screen-failure.json`, JSON.stringify(await page.evaluate(() => ({
    reduced: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
    checkbox: [...globalThis.document.querySelectorAll('input[type="checkbox"]')].map(input => ({ checked: input.checked, disabled: input.disabled })),
    controls: globalThis.document.querySelector('.demo-screen-controls')?.textContent,
    current: globalThis.document.querySelector('.demo-steps [aria-current]')?.textContent,
  })), null, 2));
  throw error;
} finally { await browser.close(); }
