import { afterEach, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { watchSessionAccess } from './session-access';

const mock = vi.hoisted(() => ({ auth: (_user: User | null) => { void _user; },
  listeners: [] as { path: string; next: (s: unknown) => void; fail: () => void; stop: ReturnType<typeof vi.fn> }[],
  students: vi.fn(),
}));
vi.mock('../firebase', () => ({ firebase: { auth: {}, db: {} } }));
vi.mock('../network', () => ({ serverFetch: mock.students }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, next: typeof mock.auth) => { mock.auth = next; return vi.fn(); } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'), collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (path: string, _options: unknown, next: (s: unknown) => void, fail: () => void) => {
    const stop = vi.fn(); mock.listeners.push({ path, next, fail, stop }); return stop;
  },
}));
const profile = (data: unknown, cached = false) => ({ data: () => data, metadata: { fromCache: cached } });
const grants = (data: unknown[], cached = false) => ({ docs: data.map(value => ({ data: () => value })), metadata: { fromCache: cached } });
afterEach(() => { mock.listeners.length = 0; vi.clearAllMocks(); });
it('通常学生には出さず、有効な共有・体験学生・担当学生がある支援担当には面談を出す', async () => {
  mock.students.mockResolvedValue({ ok: true, json: async () => ({ students: [] }) });
  const states: { own: boolean; visible: boolean }[] = [];
  const stop = watchSessionAccess(state => states.push(state));
  mock.auth({ uid: 'student', getIdToken: async () => 'unit-test-only' } as User);
  await vi.waitFor(() => expect(mock.students).toHaveBeenCalled());
  const [account, sharing] = mock.listeners;
  account!.next(profile(undefined)); sharing!.next(grants([]));
  expect(states.at(-1)).toEqual({ own: false, visible: false });
  sharing!.next(grants([{ scopes: ['all'], revokedAt: null }], true));
  expect(states.at(-1)?.visible).toBe(false);
  sharing!.next(grants([{ scopes: ['all'], revokedAt: null }]));
  expect(states.at(-1)).toEqual({ own: true, visible: true });
  for (const grant of [{ scopes: ['all'], revokedAt: 'revoked' }, { scopes: 'all', revokedAt: null }, { scopes: ['all'] }]) {
    sharing!.next(grants([grant])); expect(states.at(-1)?.visible).toBe(false);
  }
  account!.next(profile({ role: 'student', studentId: 'student' }));
  expect(states.at(-1)).toEqual({ own: true, visible: true });
  account!.next(profile({ role: 'student', studentId: 'other' }));
  expect(states.at(-1)?.visible).toBe(false);
  account!.next(profile({ role: 'supporter', studentId: 'other' }));
  expect(states.at(-1)).toEqual({ own: false, visible: true });
  mock.students.mockResolvedValue({ ok: true, json: async () => ({ students: [{ uid: 'other' }] }) });
  mock.auth({ uid: 'supporter', getIdToken: async () => 'unit-test-only' } as User);
  expect(states.at(-1)?.visible).toBe(false);
  await vi.waitFor(() => expect(states.at(-1)).toEqual({ own: false, visible: true }));
  mock.auth(null); expect(states.at(-1)?.visible).toBe(false);
  account!.next(profile({ role: 'student', studentId: 'student' }));
  expect(states.at(-1)?.visible).toBe(false);
  expect(mock.listeners.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
  stop();
});
it('購読失敗と利用者変更で古い通知・遅いAPI応答を出さない', async () => {
  let finish!: (value: unknown) => void;
  mock.students.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const states: { own: boolean; visible: boolean }[] = [];
  const stop = watchSessionAccess(state => states.push(state));
  mock.auth({ uid: 'student', getIdToken: async () => 'unit-test-only' } as User);
  await vi.waitFor(() => expect(mock.students).toHaveBeenCalled());
  mock.listeners[1]!.next(grants([{ scopes: ['all'], revokedAt: null }]));
  mock.listeners[1]!.fail(); expect(states.at(-1)?.visible).toBe(false);
  mock.auth(null);
  finish({ ok: true, json: async () => ({ students: [{ uid: 'other' }] }) });
  await Promise.resolve(); await Promise.resolve();
  expect(states.at(-1)?.visible).toBe(false); stop();
});
