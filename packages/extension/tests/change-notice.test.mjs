import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const { parseHTML } = createRequire(new URL('../../core/package.json', import.meta.url))('linkedom');
const popupStorage = () => ({ session: { get: async () => ({}) }, onChanged: { addListener: vi.fn() } });
const studentUrl = 'https://synthetic-project.web.app/student';
async function bundle(entry, projectId = 'synthetic-project') {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
    define: { __AUTH_PROBE_CONFIG__: JSON.stringify({ firebase: { projectId } }) },
  });
  return outputFiles[0].text;
}
const content = await bundle('content');
const popup = await bundle('popup');
const popupHtml = await readFile(new URL('../popup.html', import.meta.url), 'utf8');

async function openLms(response, source = content) {
  const { document } = parseHTML('<html><body><main><input value="入力途中"><button>授業を開く</button></main></body></html>');
  const main = document.querySelector('main');
  const before = main.outerHTML;
  const sendMessage = vi.fn().mockResolvedValue(response);
  let elapsed = 0, idle;
  const context = createContext({ URL, document, Date: class extends Date { static now() { return Date.now() + elapsed; } },
    setTimeout: fn => { idle = fn; return 0; }, AbortController: globalThis.AbortController, clearTimeout: globalThis.clearTimeout, window: { addEventListener: () => {}, location: { href: 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session' } },
    chrome: { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } } },
  { codeGeneration: { strings: false, wasm: false } });
  runInContext(source, context);
  elapsed += 2000; idle();
  await sendMessage.mock.results[0].value;
  await new Promise(resolve => setImmediate(resolve));
  expect(main.outerHTML).toBe(before);
  return { document, notice: [...document.body.children].find(node => node.shadowRoot)?.shadowRoot };
}

it('shows one line for confirmed changes and links to the student page without session data', async () => {
  const { notice } = await openLms({ ok: true, changed: true, changeCount: 2 });
  const link = notice.querySelector('a');
  expect(notice.querySelectorAll('a')).toHaveLength(1);
  expect(link.textContent).toBe('課題の変更が2件あります。学生の画面を開く');
  expect(link.href).toBe(studentUrl);
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  expect(link.href).not.toMatch(/sid|token|cookie/i);
  expect(link.textContent).not.toMatch(/カレンダー|ログイン|synthetic-session/);
});

it.each([
  { ok: true, changed: false, changeCount: 0 }, { ok: false, code: 'sign-in-required' },
  { ok: false, changed: true, changeCount: 1 }, { ok: true }, null,
  { ok: true, changed: true, changeCount: 0 }, { ok: true, changed: true, changeCount: -1 },
  { ok: true, changed: true, changeCount: 1.5 }, { ok: true, changed: true, changeCount: '2' },
  { ok: true, changed: true, changeCount: Number.MAX_SAFE_INTEGER + 1 },
])('does not add any UI for unchanged, failed or malformed replies: %j', async response => {
  const { document, notice } = await openLms(response);
  expect(notice).toBeUndefined();
  expect(document.body.children).toHaveLength(1);
});

it('has exactly one popup button and opens the same student URL', async () => {
  const { document, Event } = parseHTML(popupHtml);
  const create = vi.fn().mockResolvedValue({});
  runInContext(popup, createContext({ document, chrome: { tabs: { create }, storage: popupStorage() } }));
  expect(document.querySelectorAll('button')).toHaveLength(1);
  expect(document.querySelectorAll('a, input, select, textarea')).toHaveLength(0);
  const button = document.querySelector('button');
  expect(button.textContent).toBe('学生の画面を開く');
  expect(button.disabled).toBe(false);
  expect(create).not.toHaveBeenCalled();
  button.dispatchEvent(new Event('click'));
  expect(create).toHaveBeenCalledExactlyOnceWith({ url: studentUrl });
});

it.each(['', '../other-host', 'project.example/;SID=synthetic-session'])('does not open or display a link with missing or unsafe config: %s', async projectId => {
  const { notice } = await openLms({ ok: true, changed: true, changeCount: 2 }, await bundle('content', projectId));
  expect(notice).toBeUndefined();
  const { document, Event } = parseHTML(popupHtml);
  const create = vi.fn();
  runInContext(await bundle('popup', projectId), createContext({ document, chrome: { tabs: { create }, storage: popupStorage() } }));
  expect(document.querySelector('button').disabled).toBe(true);
  document.querySelector('button').dispatchEvent(new Event('click'));
  expect(create).not.toHaveBeenCalled();
});

it('keeps an open popup in step with session status and ignores other storage areas', async () => {
  const { document } = parseHTML(popupHtml);
  let saved = {};
  let change;
  const storage = { session: { get: async () => saved }, onChanged: { addListener: fn => { change = fn; } } };
  runInContext(popup, createContext({ document, chrome: { storage, tabs: { create: vi.fn() } } }));
  await vi.waitFor(() => expect(document.querySelector('#collection-status').hidden).toBe(true));
  const finishedAt = new Date(2098, 10, 7, 4, 12).getTime();
  for (const [status, text] of [
    ['running', 'LMSの課題を確かめています'],
    ['yielded', '11/7 04:12 にLMSの操作を優先して確認を中断しました'],
    ['success', '11/7 04:12 にLMSの課題を確かめました'],
    ['partial', '11/7 04:12 に一部の課題を確かめられませんでした。LMSを開き直してください'],
    ['collection-unavailable', '11/7 04:12 に一部の課題を確かめられませんでした。LMSを開き直してください'],
    ['sign-in-required', '11/7 04:12 に課題を確かめられませんでした。拡張機能の設定からGoogleにログインしてください'],
    ['api-not-configured', '11/7 04:12 に課題を確かめられませんでした。拡張機能の接続先の設定が必要です'],
  ]) {
    saved = { ynuCollectionDisplay: { status, finishedAt } };
    change({ ynuCollectionDisplay: {} }, 'session');
    await vi.waitFor(() => expect(document.querySelector('#collection-status').textContent).toBe(text));
    expect(document.querySelector('#collection-status').hidden).toBe(false);
    expect(document.querySelectorAll('button')).toHaveLength(1);
  }
  saved = {};
  change({ ynuCollectionDisplay: {} }, 'local');
  await Promise.resolve();
  expect(document.querySelector('#collection-status').textContent).toContain('接続先の設定');
  change({ ynuCollectionDisplay: {} }, 'session');
  await vi.waitFor(() => expect(document.querySelector('#collection-status').hidden).toBe(true));
});

it('shows the last completed status when reopening the popup', async () => {
  const { document } = parseHTML(popupHtml);
  const storage = popupStorage();
  storage.session.get = async () => ({ ynuCollectionDisplay: { status: 'success', finishedAt: new Date(2098, 10, 7, 4, 12).getTime() } });
  runInContext(popup, createContext({ document, chrome: { storage, tabs: { create: vi.fn() } } }));
  await vi.waitFor(() => expect(document.querySelector('#collection-status').textContent).toBe('11/7 04:12 にLMSの課題を確かめました'));
});
