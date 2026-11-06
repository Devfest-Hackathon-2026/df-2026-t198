import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i37/gallery-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const observations = [];
const files = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    page.on('pageerror', () => errors.push('browser-error'));
    await page.route('https://**', route => { errors.push('external-request'); return route.abort(); });
    await page.goto(new URL('index.html', import.meta.url).href);
    await page.waitForFunction(() => [...document.images].length === 4 &&
      [...document.images].every(image => image.complete && image.naturalWidth === 1600));
    assert.equal(await page.locator('#purpose table tr').count(), 65); // 62要素と3つの表見出し
    assert.equal(await page.locator('#purpose p').filter({ hasText: /^- .*：/ }).count(), 4);
    for (const item of await page.locator('article').all()) {
      await item.locator('summary').click();
      assert.ok(await item.locator('pre').isVisible());
      assert.match(await item.locator('pre').innerText(), /画面の目的:/);
      await item.locator('summary').click();
      const opened = page.waitForEvent('popup');
      await item.locator('.image-link').click();
      const imagePage = await opened;
      await imagePage.waitForLoadState();
      assert.equal(await imagePage.locator('img').evaluate(image => image.naturalWidth), 1600);
      await imagePage.close();
    }
    for (const section of ['purpose', 'student', 'session']) {
      await page.locator(`nav a[href="#${section}"]`).click();
      assert.equal(await page.evaluate(() => location.hash), `#${section}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const name = `gallery-${width}-${section}.png`;
      await page.screenshot({ path: `${evidence}/${name}` });
      files.push(name);
    }
    assert.deepEqual(errors, []);
    observations.push({ width, assessmentRows: 62, images: 4, promptsOpened: 4, imagesOpened: 4, pageErrors: 0 });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/browser.json`, JSON.stringify(observations, null, 2));
console.log(JSON.stringify({ observations: [{ requirement_id: 'browser', status: 'pass', observed: observations,
  evidence_files: ['browser.json', ...files] }] }));
