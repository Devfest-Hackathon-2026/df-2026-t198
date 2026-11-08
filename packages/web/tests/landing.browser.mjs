import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5182';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i224-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', () => errors.push('browser-error'));
page.setDefaultTimeout(15000);
const storage = () => page.evaluate(async () => ({
  local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage },
  databases: (await globalThis.indexedDB.databases()).map(({ name, version }) => ({ name, version })),
}));
const noOverflow = async () => assert.equal(await page.evaluate(() =>
  globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
try {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await page.getByLabel('パスワード').count(), 0);
    await page.locator('.td-splash').waitFor({ state: 'hidden' });
    await page.getByText('支援担当が見られるのは、共有の許可がある学生だけです', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '学生として試す', exact: true }).count(), 0);
    await page.getByText('審査の方', { exact: true }).waitFor();
    assert.equal(await page.locator('main > section.chapter').count(), 6);
    assert.equal(await page.locator('.hero h1 span').count(), 2);
    if (width === 1280) {
      const title = await page.locator('.hero h1').evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(globalThis.getComputedStyle(el).lineHeight) }));
      assert(Math.abs(title.height - title.line * 2) < 2, 'approved sentence occupies two desktop lines');
    }
    await noOverflow();
    for (const reveal of await page.locator('.td-reveal').all()) {
      await reveal.scrollIntoViewIfNeeded();
      await page.waitForFunction(el => globalThis.getComputedStyle(el).opacity === '1', await reveal.elementHandle());
      assert.equal(await reveal.evaluate(el => globalThis.getComputedStyle(el).opacity), '1');
    }
    const panels = page.locator('.entry-panel');
    const left = await panels.nth(0).boundingBox(); const right = await panels.nth(1).boundingBox();
    assert(Math.abs(left.width - right.width) < 1, 'judge/shared entries have the same width');
    if (width === 1280) assert(Math.abs(left.height - right.height) < 1, 'desktop entries have the same height');
    else assert(right.y >= left.y + left.height, 'mobile entries retain reading order');
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
    const demo = page.getByRole('region', { name: '動く見本', exact: true });
    const extend = demo.getByRole('button', { name: '① 先生が締切を延ばす', exact: true });
    const open = demo.getByRole('button', { name: '② 学生が LMS を開く', exact: true });
    const reset = demo.getByRole('button', { name: '戻す', exact: true });
    const initialStorage = await storage();
    const requests = [];
    const record = request => requests.push(request.method());
    page.on('request', record);
    async function initial() {
      assert.equal(await demo.locator('.hot').count(), 0);
      assert.equal(await demo.locator('s').count(), 0);
      assert.match(await demo.locator('.mc').innerText(), /締切 11\/11/);
      assert.equal(await open.isDisabled(), true);
      assert.equal(await extend.isEnabled(), true);
    }
    await initial();
    await extend.click();
    assert.equal(await demo.getByRole('status').innerText(), 'LMS の締切が変わりました。まだ時間割は変わりません');
    assert.equal(await demo.locator('.hot, s').count(), 0);
    assert.match(await demo.locator('.mc').innerText(), /締切 11\/11/);
    assert.doesNotMatch(await demo.locator('.mm').innerText(), /に変わりました/);
    assert.equal(await extend.isDisabled(), true);
    await noOverflow();
    await page.screenshot({ path: `${evidence}/extended-${width}.png`, fullPage: true });
    // Reset also works before opening the LMS.
    await reset.click();
    await initial();
    await extend.click();
    await open.click();
    assert.equal(await demo.locator('.hot').count(), 1);
    assert.equal(await demo.locator('s').innerText(), '11/11');
    assert.match(await demo.locator('.mc').innerText(), /締切 11\/12/);
    assert.match(await demo.locator('.mm').innerText(), /締切が 11\/11 から 11\/12 に変わりました/);
    assert.equal(await demo.locator('.hot').evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgb(217, 64, 43)');
    await noOverflow();
    await page.screenshot({ path: `${evidence}/opened-${width}.png`, fullPage: true });
    await reset.click();
    await initial();
    assert.equal(await demo.getByRole('status').innerText(), '');
    assert.doesNotMatch(await demo.locator('.mm').innerText(), /に変わりました/);
    await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
    page.off('request', record);
    assert.deepEqual(requests, []);
    assert.deepEqual(await storage(), initialStorage);
    await page.reload();
    await initial();
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
      await page.getByRole('status').filter({ hasText: '面談画面の準備がまだできていません' }).waitFor();
    } else if (path.startsWith('/student')) {
      await page.getByRole('heading', { name: '時間割と課題', exact: true }).waitFor();
    } else {
      await page.getByText('体験画面の準備中です。担当者に確認してください。', { exact: true }).waitFor();
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
  await writeFile(`${evidence}/verification.json`, JSON.stringify({ widths: [1280, 390], dialogs: 4, entryRoles: 2, localDemoStates: 4, reducedMotion: true, splash: true, existingRoutes: 6, errors }, null, 2));
  log('Landing: anonymous entry, four local states, no requests/storage changes, 1280/390px, anchors, images and existing routes passed.');
} finally { await browser.close(); }
