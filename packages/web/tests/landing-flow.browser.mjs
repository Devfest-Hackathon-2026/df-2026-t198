import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i250-flow';
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
    const eventHandles = await events.elementHandles();
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
    assert.equal(await status.textContent(), '先生のお知らせ', 'offscreen flow waits');
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    const observed = [];
    const started = Date.now();
    async function at(stage, text) {
      await page.waitForFunction(expected => globalThis.document.querySelector('.flow-status')?.textContent === expected, text);
      observed.push({ stage, status: text, elapsedMs: Date.now() - started });
      assert(await page.locator('#how').evaluate(el => el.getBoundingClientRect().height <= globalThis.innerHeight + 1), 'animated chapter fits every stage');
    }
    async function capture(stage) {
      await page.waitForTimeout(650);
      const dimensions = await flow.evaluate(el => {
        const board = el.querySelector('.flow-board').getBoundingClientRect();
        const active = el.querySelector('.is-active').getBoundingClientRect();
        const card = el.querySelector('.is-active');
        const content = [...card.querySelectorAll('h3, h4, p, span, strong, .flow-event')].filter(node => node.checkVisibility({ visibilityProperty: true }));
        return { board: { width: board.width, height: board.height }, active: { width: active.width, height: active.height },
          visibleCards: [...el.querySelectorAll('.flow-card')].filter(node => node.checkVisibility({ visibilityProperty: true })).length,
          contentFits: content.every(node => { const box = node.getBoundingClientRect(); return box.top >= active.top && box.bottom <= active.bottom && box.left >= active.left && box.right <= active.right; }) };
      });
      assert.equal(dimensions.visibleCards, 1, 'one card is the protagonist');
      assert(Math.abs(dimensions.active.width - dimensions.board.width) < 1, 'card fills the former diagram width');
      assert(Math.abs(dimensions.active.height - dimensions.board.height) < 1, 'card fills the former diagram height');
      assert(dimensions.contentFits, 'all focused card content fits');
      observed.at(-1).dimensions = dimensions;
      await page.screenshot({ path: `${output}/flow-stage-${stage}-${viewport.width}.png` });
    }
    // Relative position remains meaningful while the containing card scales.
    const positions = () => events.evaluateAll(nodes => nodes.map(node => {
      const event = node.getBoundingClientRect(); const track = node.parentElement.getBoundingClientRect();
      return (event.left - track.left) / track.width;
    }));
    await at(1, '先生がお知らせを出しました');
    assert.match(await flow.locator('.flow-notice').textContent(), /11\/13/);
    assert.equal(await lms.locator('s').count(), 0);
    await capture(1);
    await at(2, 'LMSで課題の締切が変わりました');
    assert.match(await lms.textContent(), /お知らせ 1件/);
    assert.equal(await lms.locator('s').textContent(), '11/12');
    assert.equal(await events.locator('s').count(), 0, 'outputs wait for student');
    assert.match(await supporter.textContent(), /変化なし/);
    await capture(2);
    await at(3, '学生がLMSを開き、課題を取り込んでいます');
    assert.equal(await events.locator('s').count(), 0);
    const before = await positions();
    await capture(3);
    await at(4, '時間割とカレンダーの締切が更新されました');
    await page.waitForTimeout(400);
    const during = await positions();
    await page.screenshot({ path: `${output}/flow-moving-${viewport.width}.png` });
    await capture(4);
    assert.match(await supporter.textContent(), /変化なし/, 'supporter waits for its turn');
    await at(5, '支援担当の画面も更新されました');
    const after = await positions();
    for (let index = 0; index < 2; index++) {
      assert(before[index] < during[index] && during[index] < after[index], 'the same event visibly moves between dates');
      assert.equal(await schedules.nth(index).locator('.flow-event').count(), 1, 'one event remains');
      assert.equal(await eventHandles[index].evaluate((node, i) => node === globalThis.document.querySelectorAll('.flow-event')[i], index), true, 'the original event node remains');
      assert.equal(await events.nth(index).locator('s').textContent(), '11/12');
      assert.match(await events.nth(index).locator('strong').textContent(), /11\/13 17:00/);
    }
    assert.equal(await supporter.locator('s').textContent(), '11/12');
    assert.match(await supporter.locator('.flow-deadline strong').textContent(), /11\/13 17:00/);
    await capture(5);
    await at(6, '同じ締切になりました');
    await page.waitForTimeout(650);
    assert.equal(await flow.locator('.flow-card:visible').count(), 5);
    const finalWidths = await flow.locator('.flow-card').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    assert(finalWidths.every(width => width < viewport.width), 'cards shrink into the final overview');
    assert(await flow.locator('.flow-card').evaluateAll(cards => cards.every(card => {
      const bounds = card.getBoundingClientRect();
      return [...card.querySelectorAll('h3, h4, p, span, strong, .flow-event')]
        .filter(node => node.checkVisibility({ visibilityProperty: true })).every(node => {
          const box = node.getBoundingClientRect();
          return box.top >= bounds.top && box.bottom <= bounds.bottom && box.left >= bounds.left && box.right <= bounds.right;
        });
    })), 'all overview content fits inside its card');
    for (let index = 1; index < observed.length; index++) {
      const duration = observed[index].elapsedMs - observed[index - 1].elapsedMs;
      assert(duration >= 1600 && duration <= 2000, `each slide lasts 1.6–2 seconds: ${duration}`);
    }
    await page.screenshot({ path: `${output}/flow-final-${viewport.width}.png` });
    await page.waitForTimeout(1800);
    assert.equal(await status.textContent(), '同じ締切になりました', 'stays at final state');
    await page.locator('#people').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.waitForTimeout(1500);
    assert.equal(await status.textContent(), '同じ締切になりました', 'does not replay on re-entry');
    await replay.click();
    await at(1, '先生がお知らせを出しました');
    assert.equal(await lms.locator('s').count(), 0, 'replay resets the source');
    assert.equal(await events.locator('s').count(), 0, 'replay resets the outputs');
    await at(6, '同じ締切になりました');
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
  log('PASS: five full-size slides at 1.6–2s each, source-before-import ordering, same moving events, final overview, replay, reduced motion, no requests or storage changes.');
} finally { await browser.close(); }
