import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i240-chapters';
const baseline = process.argv.includes('--before');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const measurements = [];
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(base);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.deepEqual(await page.locator('main > .chapter').evaluateAll(nodes => nodes.map(node => node.id)), ['home', 'people', 'how', 'start', 'privacy', 'try']);
    assert.deepEqual(await page.locator('.next-chapter').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), ['#people', '#how', '#start', '#privacy', '#try', '#home']);
    for (const chapter of await page.locator('main > .chapter').all()) {
      await chapter.evaluate(el => globalThis.scrollTo(0, el.offsetTop));
      await page.waitForFunction(id => globalThis.document.querySelector('.chapter-nav [aria-current]')?.getAttribute('href') === `#${id}`, await chapter.getAttribute('id'));
      const result = await chapter.evaluate(el => {
        const box = el.getBoundingClientRect();
        const content = [...el.querySelectorAll('h1, h2, h3, p, a, button, .shot, li')]
          .filter(node => !node.closest('dialog') && node.getBoundingClientRect().height > 0)
          .map(node => node.getBoundingClientRect());
        return { id: el.id, height: box.height, viewport: globalThis.innerHeight,
          contentFits: content.every(rect => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= -1 && rect.right <= globalThis.innerWidth + 1),
          horizontalOverflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth };
      });
      measurements.push({ width: viewport.width, ...result });
      await page.screenshot({ path: `${output}/${baseline ? 'before' : 'after'}-${result.id}-${viewport.width}.png` });
    }
    if (!baseline) {
      assert.equal(await page.locator('#privacy .privacy-list li').count(), 4);
      assert.equal(await page.locator('#start .supported-lms li').count(), 1);
      assert.equal(await page.locator('#try .trial-entry').count(), 1);
      assert.equal(await page.locator('#try a.judge-link').count(), 1);
      assert.equal(await page.locator('#try .local-demo, #try .entry-grid, #try .trial-route').count(), 0);
      assert.equal(await page.locator('#try .trial-launch a:visible, #try .trial-launch button:visible').count(), 1);
      assert.equal(await page.locator('.flow-static-item').count(), 7);
      assert.deepEqual(await page.locator('.flow-static-item h3').allTextContents(), ['先生がLMSの締切を延ばす', '学生がいつもどおりLMSを開く', '支援担当が締切の変化を確かめる', '2人で準備の予定を決める', '朝のメールで今日の予定を知る', '変更と準備の予定がつながる', 'ToDoku']);
      assert.equal(await page.locator('.flow-static-item .flow-description span').count(), 14);
      assert.equal(await page.locator('html').evaluate(el => globalThis.getComputedStyle(el).scrollBehavior), 'auto');
      assert.equal(await page.locator('.landing').evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    }
    await page.close();
  }
  await writeFile(`${output}/chapter-measurements.json`, JSON.stringify(measurements, null, 2));
  for (const result of measurements) {
    assert(result.height <= result.viewport + 1, `${result.width} ${result.id}: ${result.height}px exceeds ${result.viewport}px`);
    assert(result.contentFits, `${result.width} ${result.id}: all chapter content remains visible`);
    assert.equal(result.horizontalOverflow, false);
  }
  log('PASS: six chapters fit 1280x800 / 390x844, no overflow, one trial entry, four privacy items, reduced motion.');
} finally { await browser.close(); }
