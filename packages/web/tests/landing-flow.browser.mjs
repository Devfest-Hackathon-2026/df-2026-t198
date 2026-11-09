import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5262';
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i262-flow';
await mkdir(output, { recursive: true });
const titles = ['先生がLMSの締切を延ばす', '学生がいつもどおりLMSを開く', '支援担当が締切の変化を確かめる', '2人で準備の予定を決める', '朝のメールで今日の予定を知る', '変更と準備の予定がつながる', 'ToDoku'];
const durations = [4800, 6000, 4000, 6400, 4300, 4300, 2600];
const scenes = ['office', 'bedroom', 'consultation', 'meeting', 'morning', 'summary', 'eyecatch'];
const browser = await chromium.launch({ headless: true });
const observations = [];
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const requested = process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1];
    if (requested && requested !== String(viewport.width)) continue;
    const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('.td-splash').waitFor({ state: 'hidden' });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.clock.install();
    const flow = page.getByRole('group', { name: '締切変更の流れ' });
    const storage = () => page.evaluate(() => ({ local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage } }));
    const initialStorage = await storage();
    const requests = [];
    page.on('request', request => {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url()).hostname)) requests.push(new URL(request.url()).pathname);
    });
    assert.equal(await flow.getAttribute('data-playing'), 'false', 'offscreen waits');
    assert.equal(await flow.getAttribute('data-sound'), 'false', 'introduction starts muted');
    await page.mouse.move(0, 0);
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.playing === 'true');
    const stages = [];
    for (let index = 0; index < 7; index++) {
      assert.equal(await flow.getAttribute('data-stage'), String(index + 1));
      assert.match(await flow.getByRole('status').textContent(), new RegExp(titles[index]));
      assert.equal(await flow.getByRole('status').getAttribute('aria-live'), 'polite');
      assert.equal(await flow.locator('img, image, foreignObject').count(), 0, 'all artwork is SVG');
      if (index < 5) {
        assert.equal(await flow.locator('[data-room]').count(), 1, 'only this scene appears');
        const roles = await flow.locator('[data-role]').evaluateAll(people => people.map(person => person.dataset.role));
        assert.deepEqual(roles, index === 0 ? ['teacher'] : index === 2 ? ['supporter'] : index === 3 ? ['student', 'supporter'] : ['student']);
      }
      if (index === 0) {
        assert.match(await flow.locator('[data-screen]').textContent(), /11\/12 17:00/);
        await page.clock.runFor(1450);
        assert.match(await flow.locator('[data-screen]').textContent(), /11\/13 17:00.*送信しました/);
      } else if (index === 1) {
        await page.clock.runFor(900);
        assert.match(await flow.locator('[data-screen]').textContent(), /拡張機能が締切を読む/);
        await page.clock.runFor(1000);
        assert.match(await flow.locator('[data-screen]').textContent(), /ToDokuへ送る/);
        await page.clock.runFor(1100);
        assert.match(await flow.locator('[data-screen]').textContent(), /ToDokuに記録.*11\/13 17:00/);
      } else if (index === 3) {
        await page.clock.runFor(700);
        assert.equal(await flow.locator('[data-action="enter"]').count(), 1);
        await page.screenshot({ path: `${output}/meeting-enter-${viewport.width}.png` });
        await page.clock.runFor(1100);
        assert.equal(await flow.locator('[data-action="enter"]').count(), 0);
        assert.equal(await flow.locator('[data-action="seated"]').count(), 1);
        assert.equal(await flow.getByRole('img', { name: '準備を入れる前の時間割', exact: true }).count(), 1);
        await page.clock.runFor(1250);
        assert.equal(await flow.getByRole('img', { name: '準備を入れた後の時間割', exact: true }).count(), 1);
        await page.clock.runFor(350);
        assert.equal(await flow.locator('[data-vibrating="true"]').count(), 1);
      } else if (index === 4) {
        assert.equal(await flow.locator('[data-screen]').getAttribute('data-updated'), 'false');
        await page.clock.runFor(1200);
        assert.match(await flow.locator('[data-screen]').textContent(), /今日やること.*13:00–14:00/);
      }
      const elapsed = Number(await flow.getAttribute('data-elapsed'));
      if (index < 4) {
        await page.clock.runFor(durations[index] - 550 - elapsed);
        assert(Number(await flow.locator('[data-camera-scale]').getAttribute('data-camera-scale')) > 5, 'zooms into this scene clock');
        const filmBox = await flow.locator('.story-film').boundingBox();
        const cameraBox = await flow.locator('.story-room-shot').boundingBox();
        assert(viewport.width === 390 ? cameraBox.height > filmBox.height * .95 : cameraBox.width > filmBox.width * .95, 'clock zoom fills the film frame');
        if (index === 2) {
          await page.screenshot({ path: `${output}/clock-transition-${viewport.width}.png` });
          await flow.getByRole('button', { name: '一時停止する' }).click();
          const paused = await flow.getAttribute('data-elapsed');
          const camera = await flow.locator('[data-camera-scale]').getAttribute('transform');
          await page.clock.runFor(2000);
          assert.equal(await flow.getAttribute('data-elapsed'), paused, 'pause preserves the timeline');
          assert.equal(await flow.locator('[data-camera-scale]').getAttribute('transform'), camera, 'pause also freezes the camera');
          await flow.getByRole('button', { name: '再生する', exact: true }).click();
          await page.mouse.move(0, 0);
        }
      }
      await page.clock.runFor(durations[index] - Number(await flow.getAttribute('data-elapsed')) + 20);
      stages.push({ stage: index + 1, duration: durations[index] });
    }
    assert.equal(await flow.getAttribute('data-finished'), 'true');
    assert.equal(await flow.getByRole('progressbar').getAttribute('aria-valuenow'), '7');
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-stage'), '7', 'stays at the end');
    await flow.getByRole('button', { name: '最初から再生する' }).click();
    assert.equal(await flow.getAttribute('data-stage'), '1');
    assert.equal(await flow.getAttribute('data-playing'), 'false', 'hover stops playback');
    await page.clock.runFor(1500);
    assert.equal(await flow.getAttribute('data-elapsed'), '0');
    await page.mouse.move(0, 0);
    await page.clock.runFor(600);
    await flow.getByRole('button', { name: '一時停止する' }).click();
    await page.mouse.move(0, 0);
    const paused = await flow.getAttribute('data-elapsed');
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-elapsed'), paused, 'pause persists');
    await flow.getByRole('button', { name: '再生する', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.locator('#people').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.playing === 'false');
    const offscreen = await flow.getAttribute('data-elapsed');
    await page.clock.runFor(6000);
    assert.equal(await flow.getAttribute('data-elapsed'), offscreen, 'offscreen pauses');
    await page.locator('#how').evaluate(el => globalThis.scrollTo({ top: el.offsetTop, behavior: 'instant' }));
    await flow.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await flow.getAttribute('data-stage'), '2');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await flow.getAttribute('data-stage'), '1');
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 250, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    assert.equal(await flow.getAttribute('data-stage'), '2');
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 250, clientY: 250 }] });
    assert.equal(await flow.getAttribute('data-stage'), '1');
    await flow.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 140, clientY: 250 }] });
    await flow.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 150, clientY: 400 }] });
    assert.equal(await flow.getAttribute('data-stage'), '1', 'vertical scroll does not advance');
    await page.locator('#how h2').click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await flow.getAttribute('data-stage'), '1', 'keys outside controls do not advance');
    // Every manually selected frame is complete, including after navigating backwards.
    await flow.getByRole('button', { name: '次の段へ' }).click();
    await flow.getByRole('button', { name: '前の段へ' }).click();
    const captures = [];
    for (let index = 0; index < 7; index++) {
      if (index) await flow.getByRole('button', { name: '次の段へ' }).click();
      assert.equal(await flow.locator('.story-film').getAttribute('data-scene'), scenes[index]);
      if (index < 5) assert.equal(await flow.locator('[data-screen]').getAttribute('data-updated'), 'true');
      const dimensions = await page.locator('#how').evaluate(el => {
        const chapter = el.getBoundingClientRect();
        const content = [...el.querySelectorAll('h2, h3, p, a, button, .flow-number, .story-film, .flow-progress, .story-film text')].map(node => node.getBoundingClientRect());
        return { height: chapter.height, viewport: globalThis.innerHeight,
          contentFits: content.every(box => box.top >= chapter.top - 1 && box.bottom <= chapter.bottom + 1 && box.left >= 0 && box.right <= globalThis.innerWidth),
          noHorizontalOverflow: globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth };
      });
      assert(dimensions.height <= dimensions.viewport + 1, 'chapter fits one screen');
      assert(dimensions.contentFits && dimensions.noHorizontalOverflow);
      await page.screenshot({ path: `${output}/scene-${index + 1}-${scenes[index]}-landing-${viewport.width}.png` });
      captures.push({ scene: scenes[index], dimensions });
    }
    for (let index = 5; index >= 0; index--) {
      await flow.getByRole('button', { name: '前の段へ' }).click();
      assert.equal(await flow.locator('.story-film').getAttribute('data-scene'), scenes[index]);
      if (index < 5) assert.equal(await flow.locator('[data-screen]').getAttribute('data-updated'), 'true');
    }
    await flow.getByRole('button', { name: '音を出す' }).click();
    assert.equal(await flow.getByRole('button', { name: '音を消す' }).getAttribute('aria-pressed'), 'true');
    await flow.getByRole('button', { name: '音を消す' }).click();
    assert.equal(await flow.getAttribute('data-sound'), 'false');
    assert.deepEqual(await storage(), initialStorage);
    assert.deepEqual(requests, [], 'illustration makes no requests');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await flow.locator('.flow-static-item').first().waitFor({ state: 'visible' });
    assert.equal(await flow.locator('.flow-static-item').count(), 7);
    assert.equal(await flow.getByRole('button').count(), 0);
    assert.deepEqual(await flow.locator('h3').allTextContents(), titles);
    assert.equal(await flow.locator('.story-film').count(), 7);
    assert.equal(await flow.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    await page.screenshot({ path: `${output}/flow-reduced-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    observations.push({ viewport, stages, captures, reducedDiagrams: 7, requests: 0, storageUnchanged: true, pageErrors: errors });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/slides/mechanism`);
  await page.evaluate(() => globalThis.document.fonts.ready);
  const flow = page.locator('.mechanism');
  assert.equal(await flow.getAttribute('data-playing'), 'false');
  const frame = await page.locator('.mechanism-slide-frame').boundingBox();
  assert.deepEqual({ width: frame.width, height: frame.height }, { width: 1280, height: 720 });
  assert.equal(await page.locator('.chapter-nav, .app-header, .landing-header').count(), 0);
  await flow.getByRole('button', { name: '次の段へ' }).click();
  await flow.getByRole('button', { name: '前の段へ' }).click();
  for (let index = 0; index < 7; index++) {
    if (index) await flow.getByRole('button', { name: '次の段へ' }).click();
    await page.screenshot({ path: `${output}/scene-${index + 1}-${scenes[index]}-slide-1280.png` });
    if (index === 2) {
      await flow.locator('[data-clock="table"]').screenshot({ path: `${output}/consultation-clock.png`, scale: 'css' });

    }
  }
  const closeup = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 4 });
  await closeup.goto(`${base}/slides/mechanism`);
  await closeup.getByRole('button', { name: '次の段へ' }).click();
  await closeup.getByRole('button', { name: '次の段へ' }).click();
  await closeup.evaluate(() => globalThis.document.fonts.ready);
  await closeup.locator('[data-clock="table"]').screenshot({ path: `${output}/consultation-clock-closeup.png` });
  await closeup.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const frame = globalThis.document.querySelector('.mechanism-slide-frame').getBoundingClientRect();
    const canvas = globalThis.document.querySelector('.mechanism-slide-canvas').getBoundingClientRect();
    return Math.abs(frame.width - canvas.width) < 1;
  });
  const narrow = await page.locator('.mechanism-slide-frame').boundingBox();
  assert(Math.abs(narrow.width / narrow.height - 16 / 9) < .001);
  await page.close();
  await writeFile(`${output}/flow-verification.json`, JSON.stringify(observations, null, 2));
  log('PASS: seven scenes, timed screen changes, clock zooms, arrival/seating/preparation/phone, pause/replay/navigation, sound controls, 1280/390, seven static frames, standalone 16:9, no requests or storage changes.');
} finally { await browser.close(); }
