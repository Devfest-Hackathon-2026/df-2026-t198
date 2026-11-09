import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i224-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', () => errors.push('browser-error'));
page.setDefaultTimeout(15000);
const noOverflow = async () => assert.equal(await page.evaluate(() =>
  globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
try {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
    await page.goto(base);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await page.getByLabel('パスワード').count(), 0);
    await page.locator('.td-splash').waitFor({ state: 'hidden' });
    await page.getByText('支援担当が見られるのは、共有を許可した学生の情報だけです', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '学生として試す', exact: true }).count(), 0);
    await page.getByRole('link', { name: '審査員の方', exact: true }).waitFor();
    assert.equal(await page.locator('main > section.chapter').count(), 6);
    assert.equal(await page.locator('.hero h1 span').count(), 3);
    if (width === 1280) {
      const title = await page.locator('.hero h1').evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(globalThis.getComputedStyle(el).lineHeight) }));
      assert(Math.abs(title.height - title.line * 3) < 2, 'approved sentence occupies three desktop lines from the restored hero');
    }
    assert.equal(await page.locator('html').evaluate(el => globalThis.getComputedStyle(el).scrollSnapType), 'y mandatory');
    assert.deepEqual(await page.locator('.chapter').evaluateAll(nodes => nodes.map(node => globalThis.getComputedStyle(node).scrollSnapAlign)), Array(6).fill('start'));
    await noOverflow();
    for (const reveal of await page.locator('.td-reveal').all()) {
      await reveal.scrollIntoViewIfNeeded();
      await page.waitForFunction(el => globalThis.getComputedStyle(el).opacity === '1', await reveal.elementHandle());
      assert.equal(await reveal.evaluate(el => globalThis.getComputedStyle(el).opacity), '1');
    }
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.waitForFunction(() => globalThis.document.querySelector('.chapter-nav [aria-current]')?.getAttribute('href') === '#home');
    assert.equal(await page.locator('.landing-home').isVisible(), true);
    assert.equal(await page.locator('.landing-home').evaluate(el => el.getBoundingClientRect().top >= 0), true, 'home logo remains in the opening viewport');
    await page.screenshot({ path: `${evidence}/hero-${width}.png` });
    await page.screenshot({ path: `${evidence}/after-${width}.png`, fullPage: true });
    // Native modal: no navigation, close button, Esc, backdrop, focus and scroll restoration.
    for (const trigger of await page.getByRole('button', { name: /を拡大する$/ }).all()) {
      await trigger.scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
      const before = await page.evaluate(() => globalThis.scrollY); const url = page.url();
      await trigger.click();
      const modal = page.getByRole('dialog'); await modal.waitFor();
      assert.equal(page.url(), url);
      assert.equal(await modal.locator('img').evaluate(el => el.complete && el.naturalWidth > 0), true);
      await page.getByRole('button', { name: '拡大表示を閉じる', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(el => el === globalThis.document.activeElement), true);
      assert(Math.abs(await page.evaluate(() => globalThis.scrollY) - before) < 2, 'closing restores scroll');
      await trigger.click(); await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
      await trigger.click(); await modal.click({ position: { x: 2, y: 2 } }); await modal.waitFor({ state: 'hidden' });
      await noOverflow();
    }
    await page.getByRole('link', { name: '体験版を開く', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#try');
    await page.waitForFunction(() => globalThis.document.querySelector('.chapter-nav [aria-current]')?.getAttribute('href') === '#try');
    assert.equal(await page.getByRole('region', { name: '動く見本', exact: true }).count(), 0);
    assert.equal(await page.locator('#try .trial-launch a:visible, #try .trial-launch button:visible').count(), 1);
    assert.equal(await page.locator('#try .judge-guide').count(), 1);
    await page.reload();
    assert.equal(await page.locator('.td-splash').count(), 0, 'splash is skipped on repeat visits');
    await page.getByRole('link', { name: '自分の大学で使う', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#start');
    for (const link of await page.locator('a[href^="#"]').all()) {
      assert.equal(await page.locator(await link.getAttribute('href')).count(), 1);
    }
    for (const img of await page.locator('.shot').all()) {
      assert.equal(await img.evaluate(node => node.complete && node.naturalWidth > 0), true);
    }
  }
  for (const path of ['/student', '/student/plan', '/session', '/session/example', '/session/example/plan', '/demo-lms']) {
    await page.goto(`${base}${path}`);
    await page.locator('.app-header').waitFor();
    assert.equal(await page.locator('.landing').count(), 0);
    assert.deepEqual(await page.locator('.app-header nav a').allTextContents(), ['体験用LMS', '学生', '面談']);
    assert.equal(await page.locator('.todoku-logo svg').count(), 1);
    assert.equal(await page.locator('.app-home').getAttribute('href'), '/student');
    assert.equal(await page.getByRole('link', { name: 'ToDokuの紹介ページ', exact: true }).getAttribute('href'), '/');
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.classList.contains('landing-scroll')), false);
    if (path.startsWith('/session')) {
      await page.getByRole('heading', { name: '面談にログイン', exact: true }).waitFor();
    } else if (path.startsWith('/student')) {
      await page.getByRole('heading', { name: '時間割と課題', exact: true }).waitFor();
    } else {
      await openJudgeLogin(page);
      await page.getByLabel('メールアドレス').waitFor();
    }
  }
  await page.goto(`${base}/does-not-exist`);
  await page.getByRole('heading', { name: 'ページが見つかりません', exact: true }).waitFor();
  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  await reduced.goto(base);
  assert.equal(await reduced.locator('.td-splash').count(), 0);
  assert.equal(await reduced.locator('html').evaluate(el => globalThis.getComputedStyle(el).scrollSnapType), 'none');
  for (const reveal of await reduced.locator('.td-reveal').all()) assert.equal(await reveal.evaluate(el => globalThis.getComputedStyle(el).opacity), '1');
  await reduced.close();
  const firstVisit = await browser.newPage();
  await firstVisit.goto(base); await firstVisit.getByRole('button', { name: '紹介を開く', exact: true }).click();
  assert.equal(await firstVisit.locator('.td-splash').count(), 0);
  await firstVisit.reload(); assert.equal(await firstVisit.locator('.td-splash').count(), 0);
  await firstVisit.close();
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/verification.json`, JSON.stringify({ widths: [1280, 390], dialogs: 2, primaryEntries: 1, reducedMotion: true, splash: true, existingRoutes: 6, errors }, null, 2));
  log('Landing: single trial entry, 1280/390px, anchors, two image dialogs and existing routes passed.');
} finally { await browser.close(); }
