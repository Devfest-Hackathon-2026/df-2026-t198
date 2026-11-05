import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

// Reuse core's existing HTML parser for a real DOM; no test dependency is added.
const coreRequire = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = coreRequire('linkedom');
const html = await readFile(new URL('../options.html', import.meta.url), 'utf8');
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/options.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
});

it('renders missing settings, success and duplicate results, and hides transport error details', async () => {
  const { document, Event } = parseHTML(html);
  const token = 'synthetic-secret-token';
  const fullUid = 'abcdefgh-private-uid';
  const response = {
    steps: [{ stage: 'テストの予定', status: 'ok', code: 'created', message: 'テストの予定を1つ作りました。' }],
    uidPrefix: fullUid.slice(0, 8), calendarName: '課題の秘書・接続テスト', eventId: '0123456789abcdef',
  };
  const sendMessage = vi.fn()
    .mockResolvedValueOnce({ steps: [{ stage: '設定', status: 'error', message: '設定が足りません：oauthClientId、firebase.apiKey。' }] })
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce({ ...response, steps: [{ stage: 'テストの予定', status: 'ok', message: '同じ予定IDが既にあります（HTTP 409、内容も一致）。' }] })
    .mockRejectedValueOnce(new Error(token));
  const context = createContext({ document, chrome: { runtime: { sendMessage } } }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(outputFiles[0].text, context);
  const run = document.querySelector('#run');
  const restore = document.querySelector('#restore');
  const steps = document.querySelector('#steps');
  const details = document.querySelector('#details');
  const status = document.querySelector('#status');
  await vi.waitFor(() => expect(status.textContent).toContain('確認が必要'));
  expect(steps.textContent).toContain('oauthClientId');
  expect(steps.textContent).toContain('firebase.apiKey');
  expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'auth-probe-status' });

  run.dispatchEvent(new Event('click'));
  expect(run.disabled).toBe(true);
  expect(restore.disabled).toBe(true);
  await vi.waitFor(() => expect(run.disabled).toBe(false));
  expect(sendMessage).toHaveBeenNthCalledWith(2, { type: 'auth-probe-run' });
  expect(steps.textContent).toContain('成功');
  expect(details.textContent).toContain(fullUid.slice(0, 8));
  expect(details.textContent).toContain(response.calendarName);
  expect(details.textContent).toContain(response.eventId);
  expect(document.body.textContent).not.toContain(fullUid);

  run.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(run.disabled).toBe(false));
  expect(steps.textContent).toContain('HTTP 409');
  expect(details.textContent).toContain(response.eventId);

  restore.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(run.disabled).toBe(false));
  expect(status.textContent).toContain('結果が届きませんでした');
  expect(details.textContent).toBe('');
  expect(document.body.textContent).not.toContain(token);
});
