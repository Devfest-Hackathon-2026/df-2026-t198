import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = { firebase: { projectId: 'synthetic-project' } };
async function bundle(name) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
    define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) } });
  return result.outputFiles[0].text;
}
const content = await bundle('content');
const popup = await bundle('popup');
const popupHtml = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const popupCss = await readFile(new URL('../popup.css', import.meta.url), 'utf8');
const evidenceDir = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i44-evidence';
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  context.on('weberror', () => errors.push('browser-error'));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://lms.ynu.ac.jp') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html lang="ja"><head><style>body {margin:20px} a {color:red;font-size:50px} main {padding:20px}</style></head><body><main><h1>架空のLMS</h1><input aria-label="入力途中"><button>授業を開く</button></main></body></html>' });
    }
    if (url.origin === 'https://synthetic-project.web.app') {
      assert.equal(route.request().headers()['referer'], undefined);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>架空の学生画面</h1>' });
    }
    if (url.origin === 'https://extension.example.test') {
      return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html',
        body: url.pathname.endsWith('.js') ? popup : url.pathname.endsWith('.css') ? popupCss : popupHtml });
    }
    throw new Error('unexpected-network-request');
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.chrome = { runtime: { onMessage: { addListener: () => {} },
      sendMessage: () => new Promise(resolve => { globalThis.finishCollection = resolve; }) } };
  });
  const openLms = async () => {
    await page.goto('https://lms.ynu.ac.jp/lms/home;SID=synthetic-session');
    await page.addScriptTag({ content });
    await page.getByRole('textbox').fill('入力途中の文字');
  };
  for (const response of [{ ok: true, changed: false, changeCount: 0 }, { ok: false, code: 'not-logged-in' }]) {
    await openLms();
    await page.evaluate(result => globalThis.finishCollection(result), response);
    assert.equal(await page.getByRole('link').count(), 0);
    assert.equal(await page.getByRole('textbox').inputValue(), '入力途中の文字');
  }
  await openLms();
  const before = await page.locator('main').boundingBox();
  await page.evaluate(() => globalThis.finishCollection({ ok: true, changed: true, changeCount: 2 }));
  const link = page.getByRole('link', { name: '課題の変更が2件あります。学生の画面を開く' });
  await link.waitFor();
  assert.equal(await page.getByRole('link').count(), 1);
  assert.deepEqual(await page.locator('main').boundingBox(), before);
  assert.equal(await page.getByRole('textbox').inputValue(), '入力途中の文字');
  assert.equal(await page.getByRole('textbox').evaluate(node => node === globalThis.document.activeElement), true);
  const style = await link.evaluate(node => ({ size: globalThis.getComputedStyle(node).fontSize, wrap: globalThis.getComputedStyle(node).whiteSpace }));
  assert.deepEqual(style, { size: '14px', wrap: 'nowrap' });
  await page.screenshot({ path: `${evidenceDir}/notice-wide.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  const bounds = await link.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height < 50);
  await page.screenshot({ path: `${evidenceDir}/notice-narrow.png` });
  const opened = page.waitForEvent('popup');
  await link.click();
  const student = await opened;
  await student.waitForURL('https://synthetic-project.web.app/student');
  assert.equal(page.url(), 'https://lms.ynu.ac.jp/lms/home;SID=synthetic-session');
  await student.close();

  const popupPage = await context.newPage();
  await popupPage.addInitScript(() => {
    globalThis.chrome = { tabs: { create: async ({ url }) => { globalThis.open(url, '_blank', 'noreferrer'); return {}; } } };
  });
  await popupPage.goto('https://extension.example.test/popup.html');
  assert.equal(await popupPage.getByRole('button').count(), 1);
  assert.equal(await popupPage.getByRole('link').count(), 0);
  await popupPage.setViewportSize({ width: 260, height: 90 });
  await popupPage.screenshot({ path: `${evidenceDir}/popup.png` });
  const openedFromPopup = context.waitForEvent('page');
  await popupPage.getByRole('button', { name: '学生の画面を開く' }).click();
  await (await openedFromPopup).waitForURL('https://synthetic-project.web.app/student');
  assert.deepEqual(errors, []);
  console.log('PASS: changed/unchanged/failed, student links, one-button popup, input/focus/layout, CSS isolation, 390px, no referrer');
} finally {
  await browser.close();
}
