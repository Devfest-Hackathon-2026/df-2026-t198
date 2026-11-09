import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i256-flow';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const observations = [];
const titles = ['先生の締切変更', '学生のLMS閲覧', 'ToDokuへの取り込み', '予定の更新', '面談画面の変化', '翌朝のメール'];
try {
  const viewports = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
  const requestedWidth = process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1];
  if (requestedWidth && !['1280', '390'].includes(requestedWidth)) throw new Error('unknown viewport');
  for (const viewport of viewports.filter(item => !requestedWidth || String(item.width) === requestedWidth)) {
    const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
    await page.goto(base);
    await page.locator('.td-splash').waitFor({ state: 'hidden' });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const flow = page.getByRole('group', { name: '締切変更の流れ' });
    const status = flow.getByRole('status');
    const task = await flow.locator('.flow-task').elementHandle();
    const events = await flow.locator('.scene-event').elementHandles();
    const storage = () => page.evaluate(() => ({ local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage } }));
    const initialStorage = await storage();
    const requests = [];
    page.on('request', request => {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url()).hostname)) requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    });
    assert.equal(await flow.getAttribute('data-playing'), 'false', 'offscreen waits');
    await page.mouse.move(0, 0);
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.playing === 'true');
    const started = await page.evaluate(() => globalThis.performance.now());
    const stages = [];
    for (let stage = 1; stage <= 6; stage++) {
      await page.waitForFunction(expected => globalThis.document.querySelector('.mechanism')?.dataset.stage === String(expected), stage);
      const elapsedMs = await page.evaluate(() => globalThis.performance.now()) - started;
      assert.match(await status.textContent(), new RegExp(titles[stage - 1]));
      assert.equal(await status.getAttribute('aria-live'), 'polite');
      assert.equal(await flow.locator('.flow-board').count(), 1, 'one persistent scene');
      assert.equal(await flow.locator('img').count(), 0, 'no screenshot illustration');
      assert.equal(await task.evaluate(node => node === globalThis.document.querySelector('.flow-task')), true, 'one persistent task card');
      if (stage === 4) {
        await page.waitForTimeout(350);
        const during = await events[0].evaluate(node => Number.parseFloat(globalThis.getComputedStyle(node).translate));
        assert(during > 0 && during < 72, 'calendar moves slowly between the dates');
      }
      await page.waitForTimeout(stage === 4 ? 800 : 1150);
      const dimensions = await page.locator('#how').evaluate(el => {
        const chapter = el.getBoundingClientRect(); const board = el.querySelector('.flow-board').getBoundingClientRect();
        const task = el.querySelector('.flow-task').getBoundingClientRect();
        const content = [...el.querySelectorAll('h2, h3, p, a, button, .flow-number, .flow-task, .flow-progress')].map(node => node.getBoundingClientRect());
        const lines = [...el.querySelectorAll('.flow-description span')].map(node => ({ box: node.getBoundingClientRect(), lineHeight: Number.parseFloat(globalThis.getComputedStyle(node).lineHeight) }));
        return { height: chapter.height, viewport: globalThis.innerHeight,
          contentFits: content.every(box => box.top >= chapter.top - 1 && box.bottom <= chapter.bottom + 1 && box.left >= 0 && box.right <= globalThis.innerWidth),
          taskFits: task.top >= board.top && task.bottom <= board.bottom && task.left >= board.left && task.right <= board.right,
          twoLines: lines.length === 2 && lines.every(({ box, lineHeight }) => Math.abs(box.height - lineHeight) < 1),
          noHorizontalOverflow: globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth };
      });
      assert(dimensions.height <= dimensions.viewport + 1, 'chapter fits each stage');
      assert(dimensions.contentFits && dimensions.taskFits, 'all content including the moving task stays visible');
      assert(dimensions.twoLines, 'explanation remains two unclipped lines');
      assert(dimensions.noHorizontalOverflow);
      if (stage === 1) assert.match(await flow.locator('.scene-device').first().textContent(), /11\/12 17:0011\/13 17:00/);
      if (stage === 2) assert.equal(await flow.locator('.scene-extension').count(), 1);
      if (stage === 3) assert.equal(await flow.locator('.scene-todoku.is-focus').count(), 1);
      if (stage >= 4 && stage < 6) {
        for (const event of events) {
          assert.equal(await event.evaluate(node => node.isConnected), true, 'original schedule event remains');
          assert.equal(await event.evaluate(node => Number.parseFloat(globalThis.getComputedStyle(node).translate)), 72);
        }
      }
      if (stage < 5) assert.match(await flow.locator('.scene-device').nth(2).textContent(), /変化なし/);
      if (stage === 5) assert.match(await flow.locator('.scene-device').nth(2).textContent(), /締切が変わった.*11\/12 → 11\/13/);
      if (stage === 6) assert.match(await flow.locator('.scene-mail').textContent(), /翌朝 7:30今日やること/);
      stages.push({ stage, elapsedMs, dimensions });
      await page.screenshot({ path: `${output}/flow-stage-${stage}-${viewport.width}.png` });
    }
    for (let index = 1; index < stages.length; index++) {
      const duration = stages[index].elapsedMs - stages[index - 1].elapsedMs;
      assert(duration >= 4750 && duration <= 5400, `each stage lasts about five seconds: ${duration}`);
    }
    await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.finished === 'true');
    await page.clock.install();
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-stage'), '6', 'stays at the end');
    assert.equal(await flow.getByRole('progressbar').getAttribute('aria-valuenow'), '6');
    await flow.getByRole('button', { name: '最初から再生する' }).click();
    assert.equal(await flow.getAttribute('data-stage'), '1');
    assert.equal(await flow.getAttribute('data-playing'), 'false', 'hover stops playback');
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-stage'), '1');
    await page.mouse.move(0, 0);
    await page.clock.runFor(5100);
    assert.equal(await flow.getAttribute('data-stage'), '2', 'leaving hover resumes untouched autoplay');
    await flow.getByRole('button', { name: '一時停止する' }).click();
    await page.mouse.move(0, 0);
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-stage'), '2', 'pause persists');
    await flow.getByRole('button', { name: '再生する', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.locator('#people').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.playing === 'false');
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-stage'), '2', 'leaving chapter stops playback');
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await flow.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await flow.getAttribute('data-stage'), '3');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await flow.getAttribute('data-stage'), '2');
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-stage'), '2', 'manual controls stop autoplay');
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 250, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    assert.equal(await flow.getAttribute('data-stage'), '3', 'left swipe advances');
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 250, clientY: 250 }] });
    assert.equal(await flow.getAttribute('data-stage'), '2', 'right swipe goes back');
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 150, clientY: 400 }] });
    assert.equal(await flow.getAttribute('data-stage'), '2', 'vertical scrolling does not advance');
    await page.locator('#how h2').click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await flow.getAttribute('data-stage'), '2', 'arrows outside chapter controls do not advance');
    await flow.getByRole('button', { name: '次の段へ' }).click();
    assert.equal(await flow.getAttribute('data-stage'), '3');
    await flow.getByRole('button', { name: '前の段へ' }).click();
    assert.equal(await flow.getAttribute('data-stage'), '2');
    assert.deepEqual(await storage(), initialStorage);
    assert.deepEqual(requests, [], 'illustration makes no requests');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await flow.locator('.flow-static-item').first().waitFor({ state: 'visible' });
    assert.equal(await flow.locator('.flow-static-item').count(), 6);
    assert.equal(await flow.getByRole('button').count(), 0);
    assert.deepEqual(await flow.locator('h3').allTextContents(), titles);
    assert.equal(await flow.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    await page.screenshot({ path: `${output}/flow-reduced-${viewport.width}.png` });
    for (let index = 0; index < 6; index++) await flow.locator('.flow-static-item').nth(index).screenshot({ path: `${output}/flow-reduced-stage-${index + 1}-${viewport.width}.png` });
    observations.push({ viewport, stages, controls: 'buttons, scoped arrows, horizontal swipes, vertical scroll, pause, replay, hover, exit', reducedDiagrams: 6, requests: 0, storageUnchanged: true });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/slides/mechanism`);
  assert.equal(await page.locator('.mechanism').getAttribute('data-playing'), 'false', 'standalone starts paused without query');
  const frame = await page.locator('.mechanism-slide-frame').boundingBox();
  assert(Math.abs(frame.width / frame.height - 16 / 9) < .001, 'standalone is 16:9');
  assert.equal(await page.locator('.chapter-nav, .app-header, .landing-header').count(), 0);
  await page.screenshot({ path: `${output}/flow-standalone-1280.png` });
  for (let index = 0; index < 5; index++) await page.getByRole('button', { name: '次の段へ' }).click();
  assert.equal(await page.getByRole('button', { name: '最初から再生する' }).count(), 1, 'manual navigation also offers replay at the last stage');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const frame = globalThis.document.querySelector('.mechanism-slide-frame').getBoundingClientRect();
    const canvas = globalThis.document.querySelector('.mechanism-slide-canvas').getBoundingClientRect();
    return Math.abs(frame.width - canvas.width) < 1;
  });
  const narrowFrame = await page.locator('.mechanism-slide-frame').boundingBox();
  assert(Math.abs(narrowFrame.width / narrowFrame.height - 16 / 9) < .001, 'standalone also keeps 16:9 on narrow screens');
  await page.waitForFunction(() => globalThis.getComputedStyle(globalThis.document.querySelector('.scene-mail')).opacity === '1');
  await page.screenshot({ path: `${output}/flow-standalone-390.png` });
  await page.close();
  await writeFile(`${output}/flow-verification.json`, JSON.stringify(observations, null, 2));
  log('PASS: six five-second stages, persistent task and moving events, all controls and stop conditions, both sizes, six static diagrams, standalone 16:9, no requests/storage changes.');
} finally { await browser.close(); }
