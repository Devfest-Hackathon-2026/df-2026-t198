import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { readFile, readdir } from 'node:fs/promises';
import { log } from 'node:console';
import { localProcesses } from './helpers/local-processes.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assets = new URL('../dist/assets/', import.meta.url);
const names = await readdir(assets);
assert(!names.some(name => /gallery/i.test(name)), 'the development gallery has no production chunk');
for (const name of names.filter(name => name.endsWith('.js'))) {
  assert(!(await readFile(new URL(name, assets), 'utf8')).includes('共通UIの見本'), 'fictional gallery content is absent from production');
}
const port = process.env.KADAI_UI_PREVIEW_PORT || '5194';
const { start, ready, checkPorts, stop } = localProcesses(process.env, 'ui-production');
const browser = await chromium.launch({ headless: true });
try {
  await checkPorts([port]);
  const preview = start('pnpm', ['--filter', 'web', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort'], true);
  await ready(`http://127.0.0.1:${port}`, preview);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/dev/ui`);
  await page.getByRole('heading', { name: 'ページが見つかりません', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '共通UIの見本' }).count(), 0);
  log('PASS: production excludes the gallery route and its JavaScript content');
} finally { await browser.close(); stop(); }
