import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/options.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105' });
const html = await readFile(new URL('../options.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../options.css', import.meta.url), 'utf8');
const dir = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i113-evidence';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(); const errors = [];
  context.on('weberror', () => errors.push('browser-error'));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'https://extension.example.test');
    return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html',
      body: url.pathname.endsWith('.js') ? outputFiles[0].text : url.pathname.endsWith('.css') ? css : html });
  });
  for (const [name, width] of [['wide', 1280], ['narrow', 390]]) {
    const page = await context.newPage(); await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      globalThis.preference = false; globalThis.messages = []; globalThis.deny = false; globalThis.drop = false;
      globalThis.chrome = { runtime: { sendMessage: async message => {
        globalThis.messages.push(message);
        if (!message.type.startsWith('digest-')) return { steps: [] };
        if (globalThis.drop) throw new Error('synthetic-private-transport-error');
        if (message.type === 'digest-setting') {
          if (globalThis.deny) return { ok: false, enabled: globalThis.preference, problem: globalThis.problem };
          globalThis.preference = globalThis.cloudOwned ? false : message.enabled;
        }
        return { ok: true, enabled: globalThis.preference, problem: globalThis.problem, cloudOwned: globalThis.cloudOwned };
      } } };
    });
    await page.goto('https://extension.example.test/options.html');
    const toggle = page.getByRole('checkbox', { name: '毎朝、今日やることをGmailで受け取る' });
    const status = page.locator('#digest-status');
    await toggle.waitFor();
    await page.waitForFunction(() => !globalThis.document.querySelector('#digest-enabled').disabled);
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await status.textContent(), 'メールは送りません。');
    assert.deepEqual(await page.evaluate(() => globalThis.messages.filter(m => m.type.startsWith('digest-'))), [{ type: 'digest-status' }]);
    await toggle.check(); await page.waitForFunction(() => globalThis.document.querySelector('#digest-status').textContent.includes('受け取ります'));
    assert.equal(await toggle.isChecked(), true);
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    await page.screenshot({ path: `${dir}/options-${name}.png`, fullPage: true });
    await toggle.uncheck(); await page.waitForFunction(() => globalThis.document.querySelector('#digest-status').textContent === 'メールは送りません。');
    await page.evaluate(() => { globalThis.deny = true; }); await toggle.click();
    await page.waitForFunction(() => !globalThis.document.querySelector('#digest-enabled').checked);
    assert.match(await status.textContent(), /もう一度操作/);
    await page.evaluate(() => { globalThis.deny = false; globalThis.problem = 'authorization-required'; });
    await toggle.click();
    await status.getByText('メール送信の許可を確認できません。「毎朝、今日やることをGmailで受け取る」を入れ直してください。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    await page.screenshot({ path: `${dir}/options-authorization-${name}.png`, fullPage: true });
    await page.evaluate(() => { globalThis.cloudOwned = true; });
    await toggle.click();
    await status.getByText('メール通知は学生画面で設定します。この拡張機能からは送りません。', { exact: true }).waitFor();
    assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => { globalThis.drop = true; }); await toggle.click();
    await page.waitForFunction(() => globalThis.document.querySelector('#digest-status').textContent.includes('開き直して'));
    assert.equal((await page.locator('body').textContent()).includes('synthetic-private'), false);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 1280px/390px, default OFF, explicit ON/OFF, permission denial, transport failure, no private error, no horizontal overflow');
} finally { await browser.close(); }
