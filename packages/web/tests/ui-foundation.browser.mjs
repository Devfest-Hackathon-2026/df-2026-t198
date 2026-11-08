import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';
import { localProcesses } from './helpers/local-processes.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i223-evidence';
const port = process.env.KADAI_UI_PORT || '5193';
const base = `http://127.0.0.1:${port}`;
const { start, ready, checkPorts, stop } = localProcesses(process.env, 'ui-foundation');
const results = []; const errors = [];
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  await checkPorts([port]);
  const web = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', port, '--strictPort'], true);
  await ready(base, web);
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/dev/ui`);
    await page.getByRole('heading', { name: '共通UIの見本', exact: true }).waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready);
    // Scroll reveals into view before the full-page evidence capture.
    await page.locator('.td-reveal').first().scrollIntoViewIfNeeded();
    await page.locator('.td-reveal').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `no page overflow at ${width}`);
    const primary = page.getByRole('region', { name: 'ボタン' }).getByRole('button', { name: '課題を確認する', exact: true });
    assert.equal(await primary.evaluate(element => globalThis.getComputedStyle(element).backgroundColor), 'rgb(24, 32, 46)', 'primary button uses the app ink token');
    assert.equal(await page.getByRole('button', { name: '閉じる', exact: true }).evaluate(element => globalThis.getComputedStyle(element).borderTopColor), 'rgba(0, 0, 0, 0)', 'quiet buttons have no visible border');
    const themes = await page.locator('.td-theme-sample').evaluateAll(elements => elements.map(element => globalThis.getComputedStyle(element).backgroundColor));
    assert.equal(new Set(themes).size, 3, 'three distinct scoped themes');
    await page.screenshot({ path: `${evidence}/ui-${width}.png`, fullPage: true });
    const tab = page.getByRole('tab', { name: '今週', exact: true });
    await tab.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'すべての課題', exact: true }).getAttribute('aria-selected'), 'true');
    const row = page.getByRole('button', { name: '演習シート', exact: true });
    await row.focus(); await page.keyboard.press('Enter');
    assert.equal(await row.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#details').innerText(), /演習シート/);
    // A real DOM observer measures from the click event, not from Playwright's completion time.
    await page.clock.install();
    let finishRequest;
    const held = new Promise(resolve => { finishRequest = resolve; });
    await page.route('**/api/health?ui-preview=1', async route => { await held; await route.fulfill({ json: { ok: true } }); });
    const button = page.getByRole('button', { name: '課題を確認する', exact: true });
    await button.evaluate(element => {
      let started;
      element.addEventListener('click', () => { started = globalThis.performance.now(); }, { once: true });
      const observer = new globalThis.MutationObserver(() => {
        if (element.getAttribute('aria-busy') === 'true') {
          element.dataset.busyMilliseconds = String(globalThis.performance.now() - started); observer.disconnect();
        }
      });
      observer.observe(element, { attributes: true, childList: true, subtree: true });
    });
    await button.click();
    const pending = page.getByRole('region', { name: 'ボタン' }).getByRole('button', { name: '確認中…', exact: true });
    await pending.waitFor(); assert.equal(await pending.isDisabled(), true);
    const latency = Number(await pending.getAttribute('data-busy-milliseconds'));
    assert(Number.isFinite(latency) && latency >= 0 && latency <= 100, `busy within 100ms: ${latency}`);
    await page.getByRole('status', { name: '通信中', exact: true }).waitFor();
    await page.clock.fastForward(3001);
    await page.getByText('課題の更新を確かめています…', { exact: true }).waitFor();
    await page.clock.fastForward(7000);
    await page.getByText('サーバーの応答を待っています。操作が終わるまで、この画面でお待ちください。', { exact: true }).waitFor();
    finishRequest();
    await page.getByRole('button', { name: '課題を確認する', exact: true }).waitFor();
    assert.equal(await page.getByRole('status', { name: '通信中', exact: true }).count(), 0);
    results.push({ width, busyMilliseconds: latency, waitThree: true, waitTen: true, noOverflow: true });
    await page.close();
  }
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('button', { name: '紹介を開く', exact: true }).waitFor();
  await page.getByRole('button', { name: '紹介を開く', exact: true }).click();
  await page.reload(); assert.equal(await page.locator('.td-splash').count(), 0);
  // Trace the browser API to establish that navigation uses its callback to update the view.
  await page.goto(`${base}/dev/ui`);
  await page.getByRole('heading', { name: '共通UIの見本' }).waitFor();
  await page.evaluate(() => {
    const native = globalThis.document.startViewTransition.bind(globalThis.document);
    globalThis.document.startViewTransition = callback => { globalThis.document.documentElement.dataset.transitions = String(Number(globalThis.document.documentElement.dataset.transitions || 0) + 1); return native(callback); };
    globalThis.history.pushState(null, '', '/student');
    globalThis.dispatchEvent(new globalThis.PopStateEvent('popstate'));
  });
  await page.getByRole('heading', { name: '時間割と課題', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-transitions'), '1');
  await page.evaluate(() => globalThis.history.back());
  await page.getByRole('heading', { name: '共通UIの見本' }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await page.getByRole('heading', { name: '共通UIの見本' }).waitFor();
  assert.equal(await page.locator('.td-stage').first().evaluate(element => globalThis.getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('.td-skeleton span').first().evaluate(element => globalThis.getComputedStyle(element).animationName), 'none');
  await page.evaluate(() => globalThis.sessionStorage.clear());
  await page.goto(base); assert.equal(await page.locator('.td-splash').count(), 0);
  await page.goto(`${base}/dev/ui`); await page.getByRole('heading', { name: '共通UIの見本' }).waitFor();
  await page.evaluate(() => { globalThis.document.startViewTransition = () => { throw new Error('reduced-motion-transition'); }; globalThis.history.pushState(null, '', '/student'); globalThis.dispatchEvent(new globalThis.PopStateEvent('popstate')); });
  await page.getByRole('heading', { name: '時間割と課題', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, splashOnceAndSkip: true, viewTransitionAndBack: true, reducedMotion: true, errors }, null, 2));
  log(JSON.stringify({ results, splashOnceAndSkip: true, viewTransitionAndBack: true, reducedMotion: true, errors }));
} finally { await browser.close(); stop(); }
