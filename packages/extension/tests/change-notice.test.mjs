import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const { parseHTML } = createRequire(new URL('../../core/package.json', import.meta.url))('linkedom');
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
  const context = createContext({ URL, document, window: { location: { href: 'https://lms.ynu.ac.jp/lms/home;SID=synthetic-session' } },
    chrome: { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } } },
  { codeGeneration: { strings: false, wasm: false } });
  runInContext(source, context);
  await sendMessage.mock.results[0].value;
  await Promise.resolve();
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
  runInContext(popup, createContext({ document, chrome: { tabs: { create } } }));
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
  runInContext(await bundle('popup', projectId), createContext({ document, chrome: { tabs: { create } } }));
  expect(document.querySelector('button').disabled).toBe(true);
  document.querySelector('button').dispatchEvent(new Event('click'));
  expect(create).not.toHaveBeenCalled();
});
