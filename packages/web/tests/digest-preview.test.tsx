import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { User } from 'firebase/auth';
import { afterEach, expect, it, vi } from 'vitest';
import { DigestPreview } from '../src/features/digest/preview';

vi.mock('../src/shared/firebase', () => ({ firebase: { db: {} } }));
const snapshots = vi.hoisted(() => ({ notify: false }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: (_: unknown, next: (snapshot: { docs: [] }) => void) => {
  if (snapshots.notify) next({ docs: [] });
  return () => {};
} }));
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['plan-after-deadline', '今日の空いたコマは課題の締切より後になるため、見本を用意できませんでした。締切を確かめてください。'],
  ['plan-assignment-unavailable', 'この課題は提出済み、取り消し済み、または課題の一覧にないため、予定を入れられません。'],
])('explains %s when preparing the demo sample', async (code, message) => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchSample = vi.fn(async () => new Response(JSON.stringify({ error: code }), { status: 409 }));
  vi.stubGlobal('fetch', fetchSample);
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DigestPreview user={{ uid: 'fictional', getIdToken: async () => 'synthetic' } as User} />));
    await act(async () => host.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true })));
    expect(fetchSample).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
    expect(host.textContent).not.toContain('先に「LMSを開く」');
  } finally { await act(async () => root.unmount()); }
});

it('shows the confirmation on its own and returns to the mail without recording an action', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.location = { href: 'https://example.invalid/demo-lms' };
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn<(url: unknown) => Promise<Response>>(async () => new Response(JSON.stringify({ subject: '架空のメール', empty: false,
    html: '<div lang="ja"><article><a href="https://example.invalid/student/plan?id=12345678-1234-4234-8234-123456789abc&amp;do=done&amp;rev=1">終わった</a></article></div>' })));
  vi.stubGlobal('fetch', request); snapshots.notify = true;
  const host = document.getElementById('root')!; const root = createRoot(host);
  try {
    await act(async () => root.render(<DigestPreview user={{ uid: 'fictional', getIdToken: async () => 'synthetic' } as User} initiallyOpened />));
    expect(host.querySelector('.digest-open-mail')).toBeTruthy();
    await act(async () => host.querySelector('a')!.click());
    expect(host.querySelector('.plan-confirmation')).toBeTruthy();
    expect(host.querySelector('.digest-open-mail')).toBeNull();
    const back = [...host.querySelectorAll('button')].find(button => button.textContent === 'メールの見本に戻る')!;
    await act(async () => back.click());
    expect(host.querySelector('.digest-open-mail')).toBeTruthy();
    expect(host.querySelector('.plan-confirmation')).toBeNull();
    expect(request.mock.calls.every(call => String(call[0]).endsWith('/digest/demo-preview'))).toBe(true);
  } finally { snapshots.notify = false; await act(async () => root.unmount()); }
});
