import { describe, expect, it, vi } from 'vitest';
import type { Auth, User } from 'firebase/auth';
import type { Firestore, QuerySnapshot } from 'firebase/firestore';
import { watchAccount, type StudentState } from './data';

const mock = vi.hoisted(() => ({
  account: ((_user: User | null) => { void _user; }),
  listeners: [] as { path: string; next: (s: QuerySnapshot) => void; error: () => void; stop: ReturnType<typeof vi.fn> }[],
  stopAuth: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_a: Auth, next: typeof mock.account) => {
  mock.account = next;
  return mock.stopAuth;
} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: Firestore, ...path: string[]) => path.join('/'),
  onSnapshot: (path: string, _options: unknown, next: (s: QuerySnapshot) => void, error: () => void) => {
    const stop = vi.fn();
    mock.listeners.push({ path, next, error, stop });
    return stop;
  },
}));
const snapshot = (data: unknown[], fromCache = false) => ({
  docs: data.map(item => ({ data: () => item })), metadata: { fromCache },
}) as QuerySnapshot;

describe('本人の台帳の購読', () => {
  it('本人だけを読み、全一覧を待ち、本人変更・失敗・解除後に以前の情報を出さない', () => {
    mock.listeners.length = 0;
    const states: StudentState[] = [];
    const stop = watchAccount({} as Auth, {} as Firestore, state => states.push(state));
    mock.account({ uid: 'student-a' } as User);
    expect(mock.listeners.map(l => l.path)).toEqual([
      'students/student-a/courses', 'students/student-a/assignments', 'students/student-a/fetchStates', 'students/student-a/plans', 'students/student-a/manualAssignments',
    ]);
    const [courses, assignments, fetches, plans, manual] = mock.listeners;
    courses!.next(snapshot([{ name: '架空の授業' }]));
    assignments!.next(snapshot([]));
    expect(states.at(-1)?.status).toBe('loading');
    plans!.next(snapshot([]));
    manual!.next(snapshot([]));
    fetches!.next(snapshot([], true));
    expect(states.at(-1)).toMatchObject({ status: 'ready', online: false, courses: [{ name: '架空の授業' }] });
    fetches!.next(snapshot([]));
    expect(states.at(-1)).toMatchObject({ status: 'ready', online: true });
    mock.account({ uid: 'student-b' } as User);
    expect(states.at(-1)).toEqual({ status: 'loading' });
    expect(mock.listeners.slice(0, 5).every(l => l.stop.mock.calls.length === 1)).toBe(true);
    const count = states.length;
    courses!.next(snapshot([{ name: '前の学生の授業' }]));
    expect(states).toHaveLength(count);
    mock.listeners[5]!.error();
    expect(states.at(-1)).toEqual({ status: 'error' });
    expect(mock.listeners.slice(5).every(l => l.stop.mock.calls.length === 1)).toBe(true);
    mock.account(null);
    expect(states.at(-1)).toEqual({ status: 'signed-out' });
    stop();
    mock.account({ uid: 'student-c' } as User);
    expect(states.at(-1)).toEqual({ status: 'signed-out' });
    expect(mock.stopAuth).toHaveBeenCalledOnce();
  });
});
