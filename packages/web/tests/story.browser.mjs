import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5263';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('local-preview-required');
const output = process.env.ARTIFACT_EVIDENCE_DIR || 'out/issue-262/story-browser';
await mkdir(output, { recursive: true });
const scenes = ['office', 'bedroom', 'consultation', 'meeting', 'morning', 'summary', 'eyecatch'];
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const observations = [];
const evidence = [];
try {
  for (const short of [false, true]) {
    const edition = short ? 'short' : 'full';
    const durations = short ? [4800, 6000, 4000, 6400, 3800] : [4800, 6000, 4000, 6400, 4300, 4300, 2600];
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      globalThis.__storyNotes = [];
      const NativeAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends NativeAudioContext {
        createOscillator() {
          const oscillator = super.createOscillator();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = time => { globalThis.__storyNotes.push(oscillator.frequency.value); start(time); };
          return oscillator;
        }
      };
    });
    await page.clock.install();
    await page.goto(`${base}/slides/story?autoplay=1&sound=1${short ? '&short=1' : ''}`);
    const flow = page.locator('.story-player');
    await page.waitForFunction(() => globalThis.document.querySelector('.story-player')?.dataset.playing === 'true');
    await page.waitForFunction(() => globalThis.document.querySelector('.story-player')?.dataset.sound === 'true');
    await page.evaluate(() => globalThis.document.fonts.ready);
    const frame = await page.locator('.story-slide-frame').boundingBox();
    assert.deepEqual(frame, { x: 0, y: 0, width: 1280, height: 720 });
    assert.equal(await page.locator('.mechanism, .landing, .app-header, .chapter-nav').count(), 0);
    const storage = () => page.evaluate(() => ({ local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage } }));
    const before = await storage();
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.method()); });
    const stages = [];
    for (let index = 0; index < durations.length; index++) {
      assert.equal(await flow.getAttribute('data-stage'), String(index + 1));
      assert.equal(await flow.locator('.story-film').getAttribute('data-scene'), scenes[index]);
      assert.equal(await flow.locator('img, image, foreignObject').count(), 0);
      if (index === 0) {
        await page.clock.runFor(1400);
        assert.match(await flow.locator('[data-screen]').textContent(), /11\/13 17:00.*送信しました/);
      }
      if (index === 1) {
        await page.clock.runFor(1900);
        assert.match(await flow.locator('[data-screen]').textContent(), /ToDokuへ送る/);
        await page.clock.runFor(1100);
        assert.match(await flow.locator('[data-screen]').textContent(), /ToDokuに記録.*11\/13 17:00/);
      }
      if (index === 3) {
        await page.clock.runFor(700);
        assert.equal(await flow.locator('[data-action="enter"]').count(), 1);
        await page.clock.runFor(1100);
        assert.equal(await flow.locator('[data-action="seated"]').count(), 1);
        await page.clock.runFor(1600);
        assert.match(await flow.locator('[data-screen]').textContent(), /スマホにも予定/);
      }
      const elapsed = Number(await flow.getAttribute('data-elapsed'));
      if (index < 4) {
        await page.clock.runFor(durations[index] - 550 - elapsed);
        assert(Number(await flow.locator('[data-camera-scale]').getAttribute('data-camera-scale')) > 5);
      }
      const remaining = durations[index] - Number(await flow.getAttribute('data-elapsed'));
      // Allow the next animation frame to commit the scene boundary.
      await page.clock.runFor(remaining + 24);
      stages.push(scenes[index]);
    }
    assert.equal(await flow.getAttribute('data-finished'), 'true');
    assert.equal(await flow.getAttribute('data-playing'), 'false');
    assert.equal(await flow.getAttribute('data-stage'), String(durations.length));
    assert((await page.evaluate(() => globalThis.__storyNotes.length)) > 0, 'sound=1 plays the Web Audio cues');
    const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
    assert.equal(totalMs, short ? 25000 : 32400);
    // Manual navigation shows a completed state that can be captured consistently.
    for (let index = durations.length - 2; index >= 0; index--) await flow.getByRole('button', { name: '前の段へ' }).click();
    for (let index = 0; index < durations.length; index++) {
      if (index) await flow.getByRole('button', { name: '次の段へ' }).click();
      const overflow = await flow.evaluate(el => [...el.querySelectorAll('h3, p, button, .story-flow-number, .story-film text')].filter(node => {
        const box = node.getBoundingClientRect();
        return box.left < -1 || box.top < -1 || box.right > 1281 || box.bottom > 721;
      }).map(node => node.textContent));
      assert.deepEqual(overflow, [], `${edition}/${scenes[index]}: text and controls fit 1280x720`);
      if (index < 5) assert.equal(await flow.locator('[data-screen]').getAttribute('data-updated'), 'true');
      const file = `${edition}-scene-${index + 1}-${scenes[index]}.png`;
      await page.screenshot({ path: `${output}/${file}` });
      evidence.push(file);
    }
    await flow.getByRole('button', { name: '最初から再生する' }).click();
    await page.clock.runFor(1000);
    assert.equal(await flow.getAttribute('data-stage'), '1');
    await flow.getByRole('button', { name: '一時停止する' }).click();
    const paused = await flow.getAttribute('data-elapsed');
    await page.clock.runFor(2000);
    assert.equal(await flow.getAttribute('data-elapsed'), paused);
    await page.keyboard.press('ArrowRight');
    assert.equal(await flow.getAttribute('data-stage'), '2');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await flow.getAttribute('data-stage'), '1');
    await flow.getByRole('button', { name: '音を消す' }).click();
    assert.equal(await flow.getAttribute('data-sound'), 'false');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await flow.locator('.story-flow-static-item').first().waitFor({ state: 'visible' });
    assert.equal(await flow.locator('.story-flow-static-item').count(), durations.length);
    assert.equal(await flow.getByRole('button').count(), 0);
    assert.equal(await flow.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    assert.deepEqual(await storage(), before);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    observations.push({ edition, viewport: { width: 1280, height: 720 }, stages, totalMs, autoplayFinished: true, soundPlayed: true, pauseReplayKeys: true, reducedFrames: durations.length, apiRequests: 0, storageUnchanged: true });
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(base);
  assert.equal(await page.locator('a[href*="/slides/story"]').count(), 0);
  assert.equal(await page.locator('.story-player, .story-film').count(), 0);
  await page.goto(`${base}/slides/story`);
  assert.equal(await page.locator('.story-player').getAttribute('data-playing'), 'false');
  assert.equal(await page.locator('.story-player').getAttribute('data-sound'), 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const frame = globalThis.document.querySelector('.story-slide-frame').getBoundingClientRect();
    const canvas = globalThis.document.querySelector('.story-slide-canvas').getBoundingClientRect();
    return Math.abs(frame.width - canvas.width) < 1 && Math.abs(frame.width / frame.height - 16 / 9) < .001;
  });
  await writeFile(`${output}/story-verification.json`, JSON.stringify({ observations, landingSeparate: true, defaultPausedMuted: true, narrowAspectRatio: '16:9' }, null, 2));
  log(JSON.stringify({ observations: [{ requirement_id: 'story', status: 'pass', observed: { editions: observations, landingSeparate: true, defaultPausedMuted: true }, evidence_files: [...evidence, 'story-verification.json'] }] }));
} finally { await browser.close(); }
