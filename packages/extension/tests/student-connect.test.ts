import { expect, it, vi } from 'vitest';
import { createConnect, type ConnectDependencies, type ProbeState } from '../src/auth/probe.js';

const token = 'synthetic-secret-access-token';
const uid = 'synthetic-student';
const namespace = 'synthetic-project:synthetic-client';
const ready = (id: string): ProbeState => ({ namespace, uid, workerId: 'earlier-worker', calendar: { status: 'ready', id },
  event: { id: 'abcde', start: '2026-11-07T00:00:00.000Z', end: '2026-11-07T00:05:00.000Z' } });

function fixture(options: { extensionUid?: string | null; googleUid?: string; registered?: string | null;
  saved?: ProbeState; refuse?: boolean; calendarStatus?: number } = {}) {
  let state = options.saved;
  const requests: { path: string; body?: object | undefined }[] = [];
  const deps: ConnectDependencies = {
    missing: [], workerId: 'worker-one', namespace,
    auth: {
      restore: vi.fn(async () => options.extensionUid ?? null),
      getToken: vi.fn(async () => { if (options.refuse) throw new Error('synthetic refusal with private detail'); return token; }),
      credential: vi.fn(() => ({ synthetic: true })),
      signIn: vi.fn(async () => options.googleUid ?? uid),
    },
    sameAccount: vi.fn(async (_token, expected) => (options.googleUid ?? uid) === expected),
    registeredCalendar: vi.fn(async () => options.registered ?? null),
    read: vi.fn(async () => state && structuredClone(state)),
    write: vi.fn(async value => { state = structuredClone(value); }),
    newEventId: () => '0123456789abcdef0123456789abcdef',
    now: () => new Date('2026-11-06T00:00:00Z'),
    request: vi.fn(async (path, accessToken, body) => {
      expect(accessToken).toBe(token);
      requests.push({ path, body });
      if (path === '/calendars') return { status: 200, data: { id: 'created@group.calendar.google.com' } };
      return { status: options.calendarStatus ?? 200, data: {} };
    }),
  };
  const created = () => requests.filter(request => request.path === '/calendars');
  return { connect: createConnect(deps), deps, requests, created, state: () => state };
}

it('creates one dedicated calendar after the student passes the Google dialog, and reuses it on every later connection', async () => {
  const f = fixture();
  expect(await f.connect(uid)).toEqual({ ok: true });
  expect(f.deps.auth.getToken).toHaveBeenCalledOnce();
  expect(f.deps.auth.signIn).toHaveBeenCalledOnce();
  expect(f.created()).toEqual([{ path: '/calendars', body: { summary: 'ToDoku', timeZone: 'Asia/Tokyo' } }]);
  expect(f.state()?.calendar).toEqual({ status: 'ready', id: 'created@group.calendar.google.com' });
  // Reconnecting and repeated clicks reach the same saved calendar and add no test event.
  expect(await f.connect(uid)).toEqual({ ok: true });
  expect(await f.connect(uid)).toEqual({ ok: true });
  expect(f.created()).toHaveLength(1);
  expect(f.requests.filter(request => request.path.includes('/events'))).toEqual([]);
});

it('keeps an existing user on the calendar saved by the earlier connection', async () => {
  const f = fixture({ extensionUid: uid, saved: ready('earlier@group.calendar.google.com') });
  expect(await f.connect(uid)).toEqual({ ok: true });
  expect(f.requests).toEqual([]);
  expect(f.deps.auth.signIn).not.toHaveBeenCalled();
  expect(f.state()?.calendar).toEqual({ status: 'ready', id: 'earlier@group.calendar.google.com' });
});

it('adopts the calendar the server already holds when the extension was reinstalled', async () => {
  const f = fixture({ registered: 'registered@group.calendar.google.com' });
  expect(await f.connect(uid)).toEqual({ ok: true });
  expect(f.requests).toEqual([{ path: '/calendars/registered%40group.calendar.google.com', body: undefined }]);
  expect(f.state()?.calendar).toEqual({ status: 'ready', id: 'registered@group.calendar.google.com' });
});

it('stops instead of creating a second calendar when the registered one is gone or cannot be checked', async () => {
  const gone = fixture({ registered: 'registered@group.calendar.google.com', calendarStatus: 404 });
  expect(await gone.connect(uid)).toEqual({ ok: false, code: 'recovery-required' });
  const unknown = fixture({ registered: 'registered@group.calendar.google.com', calendarStatus: 503 });
  expect(await unknown.connect(uid)).toEqual({ ok: false, code: 'calendar-unavailable' });
  for (const f of [gone, unknown]) { expect(f.created()).toEqual([]); expect(f.state()).toBeUndefined(); }
});

it('stops before the Google dialog when the extension is used by another account', async () => {
  const f = fixture({ extensionUid: 'another-student' });
  expect(await f.connect(uid)).toEqual({ ok: false, code: 'account-mismatch' });
  expect(f.deps.auth.getToken).not.toHaveBeenCalled();
  expect(f.deps.write).not.toHaveBeenCalled();
});

it('never signs the extension in or creates a calendar for a different Google account', async () => {
  for (const extensionUid of [null, uid]) {
    const f = fixture({ extensionUid, googleUid: 'another-student' });
    expect(await f.connect(uid)).toEqual({ ok: false, code: 'account-mismatch' });
    expect(f.deps.auth.signIn).not.toHaveBeenCalled();
    expect(f.requests).toEqual([]);
    expect(f.deps.write).not.toHaveBeenCalled();
  }
});

it('reports a refused or closed Google dialog without changing anything, and without leaking the error', async () => {
  const f = fixture({ refuse: true });
  const result = await f.connect(uid);
  expect(result).toEqual({ ok: false, code: 'authorization-denied' });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(f.deps.auth.signIn).not.toHaveBeenCalled();
  expect(f.deps.write).not.toHaveBeenCalled();
  // The student can press the button again and continue.
  const retry = fixture();
  expect(await retry.connect(uid)).toEqual({ ok: true });
});

it('does not repeat a calendar creation whose outcome is unknown', async () => {
  const f = fixture({ extensionUid: uid, saved: { ...ready('unused'), calendar: { status: 'creating' } } });
  expect(await f.connect(uid)).toEqual({ ok: false, code: 'recovery-required' });
  expect(f.created()).toEqual([]);
});

it('does nothing in a build without Google and Firebase settings', async () => {
  const f = fixture();
  f.deps.missing = ['oauthClientId'];
  expect(await f.connect(uid)).toEqual({ ok: false, code: 'unconfigured' });
  expect(f.deps.auth.restore).not.toHaveBeenCalled();
});
