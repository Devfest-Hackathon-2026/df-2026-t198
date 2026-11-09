import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5182';
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-mechanism-simple';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const observations = [];
const titles = ['先生の締切変更', '学生のLMS閲覧', 'ToDokuへの取り込み', '予定の更新', '面談画面の変化', '翌朝のメール'];
const targets = ['T', 'S', 'H', 'M', 'P', 'M'];
const playing = (page, value) => page.waitForFunction(expected => globalThis.document.querySelector('.mechanism')?.dataset.playing === String(expected), value);
const stageIs = (page, value) => page.waitForFunction(expected => globalThis.document.querySelector('.mechanism')?.dataset.stage === String(expected), value);
const snapshot = flow => flow.evaluate(el => ({ stage: el.dataset.stage, camera: el.querySelector('svg').getAttribute('viewBox'), bars: [...el.querySelectorAll('.flow-progress i')].map(bar => bar.style.transform) }));
async function fits(page, standalone) {
  return page.locator(standalone ? '.mechanism-slide-frame' : '#how').evaluate(el => {
    const chapter = el.getBoundingClientRect(); const board = el.querySelector('.flow-board').getBoundingClientRect();
    const content = [...el.querySelectorAll('h2, h3, p, a, button, .flow-number, .flow-board, .flow-progress')].map(node => node.getBoundingClientRect());
    const lines = [...el.querySelectorAll('.flow-description span')].map(node => ({ box: node.getBoundingClientRect(), lineHeight: Number.parseFloat(globalThis.getComputedStyle(node).lineHeight) }));
    return { height: chapter.height, viewport: globalThis.innerHeight,
      contentFits: content.every(box => box.top >= chapter.top - 1 && box.bottom <= chapter.bottom + 1 && box.left >= -1 && box.right <= globalThis.innerWidth + 1),
      twoLines: lines.length === 2 && lines.every(({ box, lineHeight }) => Math.abs(box.height - lineHeight) < 1),
      squareBoard: Math.abs(board.width - board.height) < 1,
      noHorizontalOverflow: globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth };
  });
}
async function checkStage(flow, stage) {
  const key = targets[stage - 1];
  const visible = async name => flow.locator(`[data-k="${name}"]`).evaluate(node => globalThis.getComputedStyle(node).opacity);
  assert.match(await flow.getByRole('status').textContent(), new RegExp(titles[stage - 1]));
  assert.equal(await visible('tNew'), '1');
  assert.equal(await flow.locator('[data-k="tMark"]').getAttribute('width'), '74', 'deadline marker survives layout binding');
  assert.equal(await visible('sNew'), stage >= 2 ? '1' : '0');
  assert.equal(await visible('hNew'), stage >= 3 ? '1' : '0');
  for (const [name, firstStage, width] of [['sMark', 2, 74], ['hMark', 3, 74], ['mMark', 4, 48], ['pMark', 5, 98], ['mMailMark', 6, 80]]) {
    assert.equal(await flow.locator(`[data-k="${name}"]`).getAttribute('width'), String(stage >= firstStage ? width : 0));
  }
  assert.equal(await flow.locator('[data-k="mChip"]').getAttribute('transform'), stage >= 4 ? 'translate(58 0)' : 'translate(0 0)');
  assert.equal(await visible('pBefore'), stage >= 5 ? '0' : '1');
  assert.equal(await visible('pAfter'), stage >= 5 ? '1' : '0');
  assert.equal(await visible('mMail'), stage === 6 ? '1' : '0');
  assert.equal(await visible(`ring${key}`), '1', 'destination is highlighted');
  assert(await flow.locator(`[data-node="${key}"] .node-body`).evaluate(node => {
    const box = node.getBoundingClientRect(); const board = node.closest('.flow-board').getBoundingClientRect();
    return box.top >= board.top && box.bottom <= board.bottom && box.left >= board.left && box.right <= board.right;
  }), 'destination card remains inside the camera');
  for (let route = 1; route <= Math.min(4, stage - 1); route++) {
    assert.equal(await visible(`r${route}`), '1', 'delivered lines stay lit');
    assert.equal(await flow.locator(`[data-k="r${route}"]`).evaluate(node => node.style.strokeDashoffset), '0');
  }
}
try {
  const configurations = [
    { viewport: { width: 1280, height: 800 }, name: '1280', standalone: false },
    { viewport: { width: 390, height: 844 }, name: '390', standalone: false },
    { viewport: { width: 1280, height: 720 }, name: '1280x720', standalone: true },
  ];
  const requestedWidth = process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1];
  if (requestedWidth && !['1280', '390'].includes(requestedWidth)) throw new Error('unknown viewport');
  for (const { viewport, name, standalone } of configurations.filter(item => !requestedWidth || String(item.viewport.width) === requestedWidth)) {
    const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${standalone ? '/slides/mechanism?autoplay=1' : ''}`);
    await page.locator('.td-splash').waitFor({ state: 'hidden' });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const flow = page.getByRole('group', { name: '締切変更の流れ' });
    const board = flow.locator('.flow-board');
    const svg = await flow.locator('svg').elementHandle();
    const nodes = await flow.locator('.node').elementHandles();
    const storage = () => page.evaluate(() => ({ local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage } }));
    const initialStorage = await storage();
    const requests = [];
    page.on('request', request => {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url()).hostname)) requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    });
    if (!standalone) {
      assert.equal(await flow.getAttribute('data-playing'), 'false', 'offscreen waits');
      await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    }
    await playing(page, true);
    await board.hover();
    await page.waitForTimeout(80);
    assert.equal(await flow.getAttribute('data-playing'), 'true', 'hover must not pause autoplay');
    const started = await page.evaluate(() => globalThis.performance.now());
    const stages = [];
    for (let stage = 1; stage <= 6; stage++) {
      await stageIs(page, stage);
      const elapsedMs = await page.evaluate(() => globalThis.performance.now()) - started;
      assert.equal(await flow.getByRole('status').getAttribute('aria-live'), 'off', 'autoplay never announces each stage');
      assert.equal(await flow.locator('.flow-board').count(), 1);
      assert.equal(await svg.evaluate(node => node === globalThis.document.querySelector('.flow-scene')), true, 'persistent SVG');
      assert.equal(nodes.length, 5, 'same five cards');
      for (const node of nodes) assert.equal(await node.evaluate(node => node.isConnected), true);
      assert.equal(await flow.locator('img, .flow-task, .scene-card, .scene-tag').count(), 0, 'no screenshots or carried cards');
      await page.waitForTimeout(2100);
      await checkStage(flow, stage);
      const dimensions = await fits(page, standalone);
      assert(dimensions.height <= dimensions.viewport + 1 && dimensions.contentFits, 'all chapter content fits one screen');
      assert(dimensions.twoLines && dimensions.noHorizontalOverflow, 'two readable lines without overflow');
      if (viewport.width === 390) assert(dimensions.squareBoard, 'compact board is square');
      stages.push({ stage, elapsedMs, camera: await flow.locator('svg').getAttribute('viewBox'), dimensions });
      await page.screenshot({ path: `${output}/flow-stage-${stage}-${name}.png` });
    }
    // Loading/fonts/hover can consume part of stage 1 before this observer starts.
    for (let index = 2; index < stages.length; index++) {
      const duration = stages[index].elapsedMs - stages[index - 1].elapsedMs;
      assert(duration >= 2650 && duration <= 3350, `stage lasts about three seconds: ${duration}`);
    }
    assert(new Set(stages.slice(0, 5).map(stage => stage.camera)).size === 5, 'camera follows each destination');
    await page.waitForFunction(() => Number(globalThis.document.querySelector('.mechanism')?.dataset.cycle) >= 1);
    await stageIs(page, 2);
    // Measure stage 2 to stage 2, excluding the partial first stage during load.
    const loopMs = await page.evaluate(() => globalThis.performance.now()) - started - stages[1].elapsedMs;
    assert(loopMs >= 17000 && loopMs <= 18500, `six stages loop in about 18 seconds: ${loopMs}`);
    assert.equal(await flow.getAttribute('data-stage'), '2');
    assert.equal(await flow.getAttribute('data-playing'), 'true', 'last stage loops with cursor still over the board');
    await flow.getByRole('button', { name: '前の段へ' }).click(); await stageIs(page, 1);
    await flow.getByRole('button', { name: '一時停止する' }).click();
    await playing(page, false);
    await page.clock.install();
    const paused = await snapshot(flow);
    await page.clock.runFor(6200);
    assert.deepEqual(await snapshot(flow), paused, 'pause freezes camera and progress without resetting');
    assert.equal(await flow.getByRole('status').getAttribute('aria-live'), 'polite');
    await flow.focus();
    await page.keyboard.press('ArrowRight'); await stageIs(page, 2);
    await page.keyboard.press('ArrowLeft'); await stageIs(page, 1);
    await page.keyboard.press('Shift+ArrowRight'); await stageIs(page, 1);
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 250, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await stageIs(page, 2);
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 250, clientY: 250 }] });
    await stageIs(page, 1);
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 150, clientY: 400 }] });
    await stageIs(page, 1);
    await flow.getByRole('button', { name: '次の段へ' }).click(); await stageIs(page, 2);
    await checkStage(flow, 2);
    await flow.getByRole('button', { name: '前の段へ' }).click(); await stageIs(page, 1);
    assert.equal(await flow.getByRole('button', { name: '前の段へ' }).isDisabled(), true);
    if (!standalone) {
      await page.locator('#how h2').click();
      await page.keyboard.press('ArrowRight'); await stageIs(page, 1);
    }
    await page.clock.runFor(6200); await stageIs(page, 1);
    await flow.getByRole('button', { name: '再生する', exact: true }).click(); await playing(page, true);
    await flow.focus();
    await page.clock.runFor(1200); await stageIs(page, 2);
    await page.keyboard.press('ArrowRight'); await stageIs(page, 3);
    assert.equal(await flow.getAttribute('data-playing'), 'true', 'focus and navigation keep autoplay running');
    const cameraBefore = await flow.locator('svg').getAttribute('viewBox');
    const cardPositions = await flow.locator('.node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
    await page.clock.runFor(500);
    const inFlight = await flow.locator('[data-k="r2"]').evaluate(node => ({ offset: Number(node.style.strokeDashoffset), length: node.getTotalLength() }));
    assert(inFlight.offset > 0 && inFlight.offset < inFlight.length, 'line lights progressively toward its destination');
    assert.notEqual(await flow.locator('svg').getAttribute('viewBox'), cameraBefore, 'camera follows the delivery');
    assert.deepEqual(await flow.locator('.node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform'))), cardPositions, 'cards stay at fixed positions');
    if (!standalone) {
      await page.locator('#people').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
      await playing(page, false); const offscreen = await snapshot(flow);
      await page.clock.runFor(6200); assert.deepEqual(await snapshot(flow), offscreen, 'offscreen freezes timeline');
      await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
      await playing(page, true);
    }
    // Dispatch the browser visibility event deterministically in headless Chromium.
    await page.evaluate(() => { Object.defineProperty(globalThis.document, 'hidden', { configurable: true, value: true }); globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); });
    await playing(page, false); const hidden = await snapshot(flow);
    await page.clock.runFor(6200); assert.deepEqual(await snapshot(flow), hidden, 'hidden tab freezes timeline');
    await page.evaluate(() => { delete globalThis.document.hidden; globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); });
    await playing(page, true);
    await page.clock.runFor(1000); await stageIs(page, 3);
    await page.clock.runFor(2200); await stageIs(page, 4);
    assert.deepEqual(await storage(), initialStorage);
    assert.deepEqual(requests, [], 'illustration makes no requests');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await flow.locator('.flow-static-item').first().waitFor({ state: 'visible' });
    assert.equal(await flow.locator('.flow-static-item').count(), 6);
    assert.equal(await flow.getByRole('button').count(), 0);
    assert.deepEqual(await flow.locator('h3').allTextContents(), titles);
    assert.equal(await flow.getAttribute('data-playing'), 'false');
    assert.equal(await flow.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    await page.screenshot({ path: `${output}/flow-reduced-${name}.png` });
    const reducedFits = await flow.evaluate(el => {
      const parent = el.closest('#how, .mechanism-slide-frame').getBoundingClientRect();
      return [...el.querySelectorAll('.flow-static-item')].every(item => { const box = item.getBoundingClientRect(); return box.top >= parent.top && box.bottom <= parent.bottom; });
    });
    assert(reducedFits, 'six static stages fit the chapter');
    for (let index = 0; index < 6; index++) await flow.locator('.flow-static-item').nth(index).screenshot({ path: `${output}/flow-reduced-stage-${index + 1}-${name}.png` });
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await playing(page, true);
    assert.equal(await flow.locator('.flow-board').count(), 1, 'leaving reduced motion restores the player');
    assert.deepEqual(errors, []);
    observations.push({ viewport, standalone, stages, loopMs, controls: 'buttons, scoped arrows, horizontal swipes, vertical scroll, pause/resume, hover, focus, exit, visibility event, reduced motion', reducedDiagrams: 6, requests: 0, storageUnchanged: true });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/slides/mechanism`);
  assert.equal(await page.locator('.mechanism').getAttribute('data-playing'), 'false', 'standalone starts paused without query');
  const frame = await page.locator('.mechanism-slide-frame').boundingBox();
  assert(Math.abs(frame.width / frame.height - 16 / 9) < .001);
  assert.equal(await page.locator('.chapter-nav, .app-header, .landing-header').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const frame = globalThis.document.querySelector('.mechanism-slide-frame').getBoundingClientRect();
    const canvas = globalThis.document.querySelector('.mechanism-slide-canvas').getBoundingClientRect();
    return Math.abs(frame.width - canvas.width) < 1;
  });
  const narrowFrame = await page.locator('.mechanism-slide-frame').boundingBox();
  assert(Math.abs(narrowFrame.width / narrowFrame.height - 16 / 9) < .001, 'standalone keeps 16:9 on narrow screens');
  await page.screenshot({ path: `${output}/flow-standalone-390.png` });
  await page.close();
  await writeFile(`${output}/flow-verification.json`, JSON.stringify(observations, null, 2));
  if (process.argv.includes('--artifact')) log(JSON.stringify({ observations: [{ requirement_id: 'player', status: 'pass',
    observed: observations,
    evidence_files: ['flow-verification.json', ...observations.flatMap(item => item.stages.map(stage => `flow-stage-${stage.stage}-${item.standalone ? '1280x720' : item.viewport.width}.png`))],
  }] }));
  else log('PASS: six three-second stages, line delivery and following camera, 18-second loop, hover/focus continue, stop/resume conditions, controls, three viewports, six static diagrams, no requests/storage changes.');
} finally { await browser.close(); }
