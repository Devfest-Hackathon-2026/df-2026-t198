import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, DeadlineText, FetchState, Field, LongWait, NextAction, TaskRow, TaskTable } from '../src/shared/ui';
import { pendingRequests, serverFetch, subscribeRequests } from '../src/shared/network';

const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const html = renderToStaticMarkup;
it('busy buttons preserve form submission, expose progress, and block a second click', () => {
  const text = html(<Button type="submit" busy busyLabel="保存中…">保存する</Button>);
  expect(text).toContain('disabled'); expect(text).toContain('aria-busy="true"');
  expect(text).toContain('保存中…'); expect(text).toContain('type="submit"');
});
it('keeps unknown, date-only, imminent, overdue and submitted deadlines distinct', () => {
  const now = '2030-11-11T00:00:00Z';
  expect(html(<DeadlineText due="invalid" now={now} />)).toContain('締切を読み取れませんでした');
  const date = html(<DeadlineText due="2030-11-12" now={now} />);
  expect(date).toContain('2030/11/12'); expect(date).not.toContain('23:59'); expect(date).not.toContain('期限');
  expect(html(<DeadlineText due="2030-11-11T00:30:00Z" now={now} />)).toContain('あと1時間未満');
  expect(html(<DeadlineText due="2030-11-10T00:00:00Z" now={now} />)).toContain('締切を過ぎています');
  const done = html(<TaskRow course="架空の授業" title="レポート" due="2030-11-10T00:00:00Z" now={now} status="done" />);
  expect(done).toContain('出せました'); expect(done).not.toContain('<time');
  expect(html(<TaskRow course="架空" title="課題" />)).not.toContain('まだ');
});
it('distinguishes an empty result from idle, loading and a failed request', () => {
  for (const state of ['idle', 'loading', 'error'] as const) expect(html(<FetchState state={state} />)).not.toContain('課題はありません');
  expect(html(<FetchState state="empty" />)).toContain('課題はありません');
  expect(html(<FetchState state="error" />)).not.toContain('<button');
  expect(html(<FetchState state="error" onRetry={() => {}} />)).toContain('もう一度試す');
});
it('creates unique input and heading associations and preserves caller descriptions', () => {
  const text = html(<><Field label="課題名" hint="補足" aria-describedby="outside" /><Field label="授業名" error="入力してください。" />
    <NextAction course="架空" title="問1" /><NextAction course="架空" title="問2" /></>);
  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  expect(new Set(ids).size).toBe(ids.length); expect(text).toContain('aria-describedby="outside ');
  expect(text).toContain('aria-invalid="true"');
});
it('uses actual buttons for keyboard selection and respects the controlled selected row', () => {
  const text = html(<TaskTable rows={[{ id: 'task', course: '架空', title: '課題', status: 'doing' }]} selected="task" onSelect={() => {}} />);
  expect(text).toContain('aria-pressed="true"'); expect(text).toContain('type="button"'); expect(text).toContain('data-selected="true"');
});
it('counts concurrent API calls and releases both failed and successful calls without retaining requests', async () => {
  let resolve!: (value: Response) => void; let reject!: (error: Error) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
    .mockImplementationOnce(() => new Promise<Response>((_, fail) => { reject = fail; })));
  const updates: number[] = []; const stop = subscribeRequests(() => updates.push(pendingRequests()));
  try {
    const first = serverFetch('/api/synthetic-one'); const second = serverFetch('/api/synthetic-two');
    const failure = expect(second).rejects.toThrow('offline');
    expect(pendingRequests()).toBe(2); reject(new Error('offline')); await failure;
    expect(pendingRequests()).toBe(1); resolve(new Response()); await first;
    expect(pendingRequests()).toBe(0); expect(updates).toEqual([1, 2, 1, 0]);
  } finally { stop(); }
});
it('shows operation-specific waiting text at 3 and 10 seconds and resets for the next operation', async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.getElementById('root')!; const root = createRoot(host);
  const render = async (busy: boolean) => act(async () => root.render(<LongWait busy={busy} afterThree="課題を確認しています…" afterTen="応答を待っています…" />));
  try {
    await render(true); expect(host.textContent).toBe('');
    await act(async () => vi.advanceTimersByTime(2999)); expect(host.textContent).toBe('');
    await act(async () => vi.advanceTimersByTime(1)); expect(host.textContent).toBe('課題を確認しています…');
    await act(async () => vi.advanceTimersByTime(7000)); expect(host.textContent).toBe('応答を待っています…');
    await render(false); expect(host.textContent).toBe(''); await render(true); expect(host.textContent).toBe('');
  } finally { await act(async () => root.unmount()); }
});
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
it('keeps literal colours in the one token file and product API calls behind the shared wrapper', () => {
  const source = fileURLToPath(new URL('../src', import.meta.url));
  for (const file of files(source)) {
    const text = readFileSync(file, 'utf8');
    if (/\.(css|tsx)$/.test(file) && !file.endsWith('/styles/tokens.css')) expect(text, file).not.toMatch(/#[\da-f]{3,8}\b|rgba?\s*\(/i);
    if (/\.(tsx?|mjs)$/.test(file) && !file.endsWith('/network.ts') && !file.includes('.test.')) expect(text, file).not.toMatch(/\bfetch\s*\(/);
  }
});
