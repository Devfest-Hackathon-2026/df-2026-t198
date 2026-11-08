import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i240-flow';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const observations = [];
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(base);
    await page.locator('.td-splash').waitFor({ state: 'hidden' });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const flow = page.getByRole('group', { name: '締切変更の流れ' });
    const status = flow.getByRole('status');
    const schedules = flow.locator('.flow-schedule');
    const events = flow.locator('.flow-event');
    const lms = flow.locator('.flow-lms');
    const supporter = flow.locator('.flow-supporter');
    const replay = flow.getByRole('button', { name: 'もう一度見る', exact: true });
    const storage = () => page.evaluate(() => ({ local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage } }));
    const initialStorage = await storage();
    const requests = [];
    page.on('request', request => {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url()).hostname)) {
        requests.push({ method: request.method(), path: new URL(request.url()).pathname });
      }
    });
    assert.equal(await status.innerText(), '先生のお知らせ', 'offscreen flow waits');
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    const observed = [];
    const started = Date.now();
    async function at(text) {
      await page.waitForFunction(expected => globalThis.document.querySelector('.flow-status')?.textContent === expected, text);
      observed.push({ status: text, elapsedMs: Date.now() - started });
    }
    await at('先生がお知らせを出しました');
    assert.match(await flow.locator('.flow-notice').innerText(), /11\/13/);
    assert.equal(await lms.locator('s').count(), 0);
    await at('LMSの締切が変わりました');
    assert.match(await lms.innerText(), /お知らせ 1件/);
    assert.equal(await lms.locator('s').innerText(), '11/12');
    assert.equal(await events.locator('s').count(), 0, 'outputs wait for student');
    assert.match(await supporter.innerText(), /変化なし/);
    await at('学生がLMSを開きました');
    assert.equal(await events.locator('s').count(), 0);
    await at('課題の読み取り中');
    const before = await events.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
    await at('時間割とカレンダーの締切を更新しました');
    await page.waitForTimeout(500);
    const during = await events.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
    await page.screenshot({ path: `${output}/flow-moving-${viewport.width}.png` });
    await at('支援担当の画面も更新しました');
    const after = await events.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
    for (let index = 0; index < 2; index++) {
      assert(before[index] < during[index] && during[index] < after[index], 'the same event visibly moves between dates');
      assert.equal(await schedules.nth(index).locator('.flow-event').count(), 1, 'one event remains');
      assert.equal(await events.nth(index).locator('s').innerText(), '11/12');
      assert.match(await events.nth(index).locator('strong').innerText(), /11\/13 17:00/);
    }
    assert.equal(await supporter.locator('s').innerText(), '11/12');
    assert.match(await supporter.locator('.flow-deadline strong').innerText(), /11\/13 17:00/);
    for (let index = 1; index < observed.length; index++) {
      assert(observed[index].elapsedMs - observed[index - 1].elapsedMs >= 950, 'each step remains readable for about a second');
    }
    await page.screenshot({ path: `${output}/flow-final-${viewport.width}.png` });
    await page.waitForTimeout(1800);
    assert.equal(await status.innerText(), '支援担当の画面も更新しました', 'stays at final state');
    await page.locator('#people').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.waitForTimeout(1500);
    assert.equal(await status.innerText(), '支援担当の画面も更新しました', 'does not replay on re-entry');
    await replay.click();
    assert.equal(await status.innerText(), '先生のお知らせ');
    assert.equal(await lms.locator('s').count(), 0, 'replay resets the source');
    await at('支援担当の画面も更新しました');
    assert.deepEqual(await storage(), initialStorage);
    assert.deepEqual(requests, [], 'illustration makes no requests');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await replay.waitFor({ state: 'hidden' });
    assert.equal(await replay.isVisible(), false);
    assert.equal(await flow.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    observations.push({ viewport, observed, positions: { before, during, after }, requests: 0, storageUnchanged: true });
    await page.close();
  }
  await writeFile(`${output}/flow-verification.json`, JSON.stringify(observations, null, 2));
  log('PASS: automatic one-shot flow, source-before-import ordering, visible event movement, replay, final stop, reduced motion, no requests or storage changes.');
} finally { await browser.close(); }
