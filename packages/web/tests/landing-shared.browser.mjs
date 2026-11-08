import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i240-shared';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(`${base}/#try`);
    const entry = page.locator('#try .trial-launch');
    const button = entry.getByRole('button', { name: '学生として試す', exact: true });
    await button.waitFor();
    assert.equal(await entry.locator('button:visible, a:visible').count(), 1);
    assert.equal(await entry.getByRole('button', { name: '支援担当として試す', exact: true }).count(), 0);
    assert.equal(await entry.locator('.shared-fallback').isVisible(), false);
    assert(await page.locator('#try').evaluate(el => el.getBoundingClientRect().height <= globalThis.innerHeight));
    await page.screenshot({ path: `${output}/shared-entry-${viewport.width}.png` });
    for (let attempt = 0; attempt < 2; attempt++) {
      await button.click();
      await page.waitForURL(`${base}/demo-lms`);
      await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/demo-lms');
      if (attempt === 0) {
        await page.goBack();
        await button.waitFor();
        assert.equal(await button.isEnabled(), true, 'shared entry remains usable after returning');
      }
    }
    await page.close();
  }
  await writeFile(`${output}/shared-entry.json`, JSON.stringify({ widths: [1280, 390], primaryEntries: 1, navigationsPerWidth: 2, returnedEntryEnabled: true }, null, 2));
  log('PASS shared entry: one visible action, local login, back and re-entry at 1280/390px.');
} finally { await browser.close(); }
