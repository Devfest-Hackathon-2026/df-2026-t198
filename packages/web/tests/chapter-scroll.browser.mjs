import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i236';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base);
  await page.locator('.td-splash').waitFor({ state: 'hidden' });
  await page.evaluate(() => globalThis.document.fonts.ready);
  const next = await page.locator('#how').evaluate(el => el.getBoundingClientRect().top + globalThis.scrollY);
  await page.evaluate(() => {
    globalThis.scrollTo({ top: 0, behavior: 'instant' });
    globalThis.chapterFrames = [];
    const original = globalThis.scrollTo.bind(globalThis);
    globalThis.scrollTo = options => {
      original(options);
      globalThis.chapterFrames.push({ time: globalThis.performance.now(), y: globalThis.scrollY, behavior: options.behavior });
    };
  });
  await page.mouse.move(1100, 500);
  await page.mouse.wheel(0, 150);
  await page.waitForFunction(top => Math.abs(globalThis.scrollY - top) < 1, next);
  await page.waitForTimeout(100);
  const frames = await page.evaluate(() => globalThis.chapterFrames);
  assert(frames.length > 25, 'many separate RAF frames rather than one native smooth request');
  assert(frames.every(frame => frame.behavior === 'instant'));
  const duration = frames.at(-1).time - frames[0].time;
  assert(duration >= 600 && duration <= 1000, `wheel animation took ${duration}ms`);
  assert(Math.abs(frames.at(-1).y - next) <= 1);
  assert(frames[0].y >= 150 && frames[0].y < 160, 'the real wheel moved 150px before the chapter animation');
  const measured = { viewport: { width: 1280, height: 900 }, wheel: 150, target: next,
    durationMs: duration, frames: frames.map(frame => ({ ms: +(frame.time - frames[0].time).toFixed(2), y: frame.y })) };

  // Another real wheel gesture must stop the running animation without a delayed restart.
  await page.evaluate(() => globalThis.scrollTo({ top: 0, behavior: 'instant' }));
  await page.mouse.wheel(0, 150);
  await page.waitForFunction(() => globalThis.scrollY > 180);
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(100);
  const interrupted = await page.evaluate(() => globalThis.scrollY);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => globalThis.scrollY), interrupted, 'interruption leaves control with the reader');

  // Chapter links retain hash and focus; browser Back still restores the previous URL.
  await page.locator('.landing-header a[href="#try"]').click();
  assert.equal(new URL(page.url()).hash, '#try');
  assert.equal(await page.evaluate(() => globalThis.document.activeElement.id), 'try');
  await page.waitForFunction(() => Math.abs(globalThis.document.getElementById('try').getBoundingClientRect().top) <= 1);
  await page.goBack();
  await page.waitForTimeout(1100);
  assert.equal(new URL(page.url()).hash, '');

  // Live settings change: wheel scroll remains native, with no chapter finishing animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { globalThis.scrollTo({ top: 0, behavior: 'instant' }); globalThis.chapterFrames = []; });
  await page.mouse.wheel(0, 150); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => globalThis.scrollY), 150);
  assert.equal(await page.evaluate(() => globalThis.chapterFrames.length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // A modal wheel must not leave an intent behind for subsequent scripted focus scrolling.
  const trigger = page.getByRole('button', { name: '体験用LMSの授業一覧を拡大する', exact: true });
  await trigger.click();
  await page.getByRole('dialog').waitFor();
  await page.mouse.wheel(0, 150); await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(() => globalThis.scrollTo({ top: 150, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => globalThis.scrollY), 150);
  assert.deepEqual(errors, []);
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/chapter-scroll.json`, JSON.stringify({ measured, interruption: true, hashAndFocus: true,
    back: true, liveReducedMotion: true, dialog: true, errors }, null, 2));
  log(`Chapter scroll: real wheel 150px -> ${next}px, ${duration.toFixed(1)}ms, ${frames.length} RAF frames; interruption, links, Back, reduced motion and dialog passed.`);
} finally { await browser.close(); }
