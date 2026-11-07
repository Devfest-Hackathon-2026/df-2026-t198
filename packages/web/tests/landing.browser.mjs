import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5182';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i182-evidence';
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
    await page.getByText('共有の許可がある学生の授業と課題が、面談画面に出ます。面談の前に、何が変わったかを確かめられます。', { exact: true }).waitFor();
    await page.getByText('支援担当が見られるのは、共有の許可がある学生だけです', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '学生として試す', exact: true }).count(), 0);
    await page.getByText('審査の方へ', { exact: true }).waitFor();
    assert.equal(await page.locator('main section.sec > h2').count(), 5);
    assert.equal(await page.locator('.vis[aria-hidden="true"] .cell').count(), 6);
    await noOverflow();
    const hero = await page.locator('.hero').boundingBox();
    const mail = await page.locator('.hero .mail').boundingBox();
    assert(mail.y + mail.height < hero.y + hero.height, `Mail card must fit inside the hero at ${width}px`);
    if (width === 390) {
      const visual = await page.locator('.hero .vis').boundingBox();
      assert(mail.y + mail.height <= visual.y + visual.height, 'Mail card must contribute to the mobile illustration height');
    }
    await page.screenshot({ path: `${evidence}/after-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: '体験版を開く', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#try');
    if (width === 390) {
      const buttons = page.locator('.hero .btn');
      const first = await buttons.nth(0).boundingBox();
      const second = await buttons.nth(1).boundingBox();
      assert(second.y >= first.y + first.height);
      assert.equal(await page.locator('.grid .gh:visible').allTextContents().then(text => text.join(',')), ',月,火,水');
      await page.getByRole('link', { name: '目次', exact: true }).click();
      await page.getByRole('navigation', { name: '目次' }).getByRole('link', { name: 'しくみ', exact: true }).click();
      assert.equal(new URL(page.url()).hash, '#how');
    }
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
  assert.deepEqual(errors, []);
  log('Landing: anonymous entry, four local states, no requests/storage changes, 1280/390px, anchors, images and existing routes passed.');
} finally { await browser.close(); }
