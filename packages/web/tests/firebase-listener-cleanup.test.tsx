import { createRequire } from 'node:module';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoCalendar } from '../src/features/calendar/calendar';
import { DigestPreview } from '../src/features/digest/preview';

type Snapshot = { metadata: { fromCache: boolean }; data: () => unknown; docs: { data: () => unknown }[] };
const mock = vi.hoisted(() => ({
  auth: (_user: { uid: string } | null) => { void _user; }, stopAuth: vi.fn(), failOnAttach: false,
  listeners: [] as { path: string; next: (snapshot: Snapshot) => void; fail: () => void; stop: ReturnType<typeof vi.fn> }[],
}));
vi.mock('../src/shared/firebase', () => ({ firebase: { db: {}, auth: {} } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, next: typeof mock.auth) => {
  mock.auth = next; return mock.stopAuth;
} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  onSnapshot: (path: string, options: unknown, nextOrFail: unknown, error?: () => void) => {
    const listener = { path, next: (typeof options === 'function' ? options : nextOrFail) as (snapshot: Snapshot) => void,
      fail: (typeof options === 'function' ? nextOrFail : error) as () => void, stop: vi.fn() };
    mock.listeners.push(listener);
    if (mock.failOnAttach) listener.fail();
    return listener.stop;
  },
}));
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
const snapshot = (value: unknown = []): Snapshot => ({
  metadata: { fromCache: false }, data: () => value, docs: (Array.isArray(value) ? value : []).map(row => ({ data: () => row })),
});
const user = (uid: string) => ({ uid, getIdToken: async () => 'synthetic-token' }) as User;
beforeEach(() => { mock.listeners.length = 0; mock.failOnAttach = false; mock.stopAuth.mockClear(); });
afterEach(() => vi.unstubAllGlobals());
async function mount(content: ReactNode) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.getElementById('root')!; const root = createRoot(host);
  await act(async () => root.render(content));
  return { host, render: async (next: ReactNode) => act(async () => root.render(next)), close: async () => act(async () => root.unmount()) };
}

it('stops both calendar listeners on failure, ignores queued snapshots and cleans up account changes', async () => {
  const view = await mount(<DemoCalendar fallback={<p>待機中</p>} courses={[]} />);
  try {
    await act(async () => mock.auth({ uid: 'student-a' }));
    const first = mock.listeners.slice();
    const integration = { mode: 'google', executor: 'extension', calendarId: 'synthetic', connectionState: 'connected' };
    await act(async () => { first[0]!.next(snapshot(integration)); first[1]!.next(snapshot()); });
    expect(view.host.textContent).toContain('カレンダーへの変更が済んでいます。');
    await act(async () => first[0]!.fail());
    expect(first.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
    const failed = view.host.textContent;
    expect(failed).toContain('カレンダーを開けませんでした。');
    await act(async () => { first[0]!.next(snapshot(integration)); first[1]!.next(snapshot()); });
    expect(view.host.textContent).toBe(failed);
    await act(async () => mock.auth({ uid: 'student-b' }));
    expect(mock.listeners.slice(2).every(listener => listener.path.includes('/student-b/'))).toBe(true);
    await act(async () => { first[0]!.next(snapshot(integration)); first[1]!.next(snapshot()); });
    expect(view.host.textContent).toBe('待機中');
    await view.close();
    expect(mock.listeners.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
    expect(mock.stopAuth).toHaveBeenCalledOnce();
    await act(async () => mock.auth({ uid: 'student-c' }));
    expect(mock.listeners).toHaveLength(4);
  } catch (error) { await view.close(); throw error; }
});

it('does not leave a calendar listener subscribed when setup reports an immediate failure', async () => {
  mock.failOnAttach = true;
  const view = await mount(<DemoCalendar courses={[]} />);
  try {
    await act(async () => mock.auth({ uid: 'student-a' }));
    expect(mock.listeners).toHaveLength(1);
    expect(mock.listeners[0]!.stop).toHaveBeenCalledOnce();
    expect(view.host.textContent).toContain('カレンダーを開けませんでした。');
  } finally { await view.close(); }
});

it('stops every preview listener and ignores queued snapshots and an in-flight response after failure', async () => {
  let respond!: (response: Response) => void;
  const request = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; }));
  vi.stubGlobal('fetch', request);
  const view = await mount(<DigestPreview user={user('student-a')} />);
  try {
    expect(mock.listeners).toHaveLength(3);
    await act(async () => mock.listeners[0]!.next(snapshot()));
    expect(request).toHaveBeenCalledOnce();
    await act(async () => mock.listeners[1]!.fail());
    expect(mock.listeners.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
    const failed = view.host.textContent;
    await act(async () => {
      mock.listeners[2]!.next(snapshot());
      respond(new Response(JSON.stringify({ subject: '遅れて届いた見本', html: '<p>復活させない</p>', empty: false })));
    });
    expect(request).toHaveBeenCalledOnce();
    expect(view.host.textContent).toBe(failed);
    expect(view.host.textContent).not.toContain('遅れて届いた見本');
  } finally { await view.close(); }
  expect(mock.listeners.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
});

it('detaches the old preview account on a user change and ignores callbacks after unmount', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ subject: '現在の見本', html: '<p>架空の本文</p>', empty: false })));
  vi.stubGlobal('fetch', request);
  const view = await mount(<DigestPreview user={user('student-a')} />);
  const first = mock.listeners.slice();
  try {
    await view.render(<DigestPreview user={user('student-b')} />);
    expect(first.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
    expect(mock.listeners.slice(3).every(listener => listener.path.includes('/student-b/'))).toBe(true);
    await act(async () => first.forEach(listener => { listener.next(snapshot()); listener.fail(); }));
    expect(request).not.toHaveBeenCalled();
    await act(async () => mock.listeners[3]!.next(snapshot()));
    expect(view.host.textContent).toContain('現在の見本');
    await view.close();
    const count = request.mock.calls.length;
    await act(async () => mock.listeners.forEach(listener => { listener.next(snapshot()); listener.fail(); }));
    expect(request).toHaveBeenCalledTimes(count);
    expect(mock.listeners.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
  } catch (error) { await view.close(); throw error; }
});

it('stops preview subscription setup when its first listener fails immediately', async () => {
  mock.failOnAttach = true;
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const view = await mount(<DigestPreview user={user('student-a')} />);
  try {
    expect(mock.listeners).toHaveLength(1);
    expect(mock.listeners[0]!.stop).toHaveBeenCalledOnce();
    expect(view.host.textContent).toContain('メールの見本を開けませんでした。');
    expect(request).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
