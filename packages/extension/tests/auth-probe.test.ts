import { describe, expect, it, vi } from 'vitest';
import { createProbe, type ProbeDependencies, type ProbeState } from '../src/auth/probe.js';

const token = 'synthetic-secret-access-token';
const uid = 'synthetic-uid-never-send-in-full';

function fixture() {
  let state: ProbeState | undefined;
  const order: string[] = [];
  const events = new Map<string, unknown>();
  let calendarCount = 0;
  const deps: ProbeDependencies = {
    missing: [],
    workerId: 'worker-one',
    namespace: 'synthetic-project:synthetic-client',
    auth: {
      restore: vi.fn(async () => { order.push('restore'); return null; }),
      getToken: vi.fn(async () => { order.push('token'); return token; }),
      credential: vi.fn((idToken, accessToken) => {
        expect(idToken).toBe(null);
        expect(accessToken).toBe(token);
        order.push('credential');
        return { synthetic: true };
      }),
      signIn: vi.fn(async () => { order.push('signIn'); return uid; }),
    },
    read: vi.fn(async () => state && structuredClone(state)),
    write: vi.fn(async (value) => { state = structuredClone(value); }),
    newEventId: () => '0123456789abcdef0123456789abcdef',
    now: () => new Date('2026-11-06T00:00:00Z'),
    request: vi.fn(async (path, accessToken, body) => {
      expect(accessToken).toBe(token);
      if (path === '/calendars') {
        order.push('calendar');
        // The creation intent and the event ID must survive an interrupted worker.
        expect(state?.calendar.status).toBe('creating');
        expect(state?.event.id).toMatch(/^[a-v0-9]{5,1024}$/);
        calendarCount++;
        return { status: 200, data: { id: 'synthetic-calendar' } };
      }
      order.push(body ? 'insert' : 'lookup');
      if (!body) return { status: 200, data: events.values().next().value };
      const event = body as { id: string };
      if (events.has(event.id)) return { status: 409 };
      events.set(event.id, body);
      return { status: 200, data: body };
    }),
  };
  return { deps, order, events, calendarCount: () => calendarCount, state: () => state };
}

describe('auth and Calendar probe contract', () => {
  it('accepts second-precision API timestamps for a previously saved fractional timestamp', async () => {
    const f = fixture();
    f.deps.now = () => new Date('2026-11-06T00:00:00.537Z');
    await createProbe(f.deps).run();
    const saved = f.state()!;
    // A previous build may already have persisted milliseconds before creating the event.
    saved.event.start = '2026-11-07T00:00:00.537Z';
    saved.event.end = '2026-11-07T00:05:00.537Z';
    const event = f.events.get(saved.event.id) as Record<string, unknown>;
    f.events.set(saved.event.id, {
      ...event,
      start: { dateTime: '2026-11-07T09:00:00+09:00' },
      end: { dateTime: '2026-11-07T09:05:00+09:00' },
    });
    const result = await createProbe(f.deps).run();
    expect(result.steps.at(-1)).toMatchObject({ status: 'ok', code: 'already-exists' });
    expect(f.events.size).toBe(1);
    expect(f.calendarCount()).toBe(1);
  });

  it('persists new event times at second precision', async () => {
    const f = fixture();
    f.deps.now = () => new Date('2026-11-06T00:00:00.537Z');
    await createProbe(f.deps).run();
    expect(f.state()?.event.start).toBe('2026-11-07T00:00:00.000Z');
    expect(f.state()?.event.end).toBe('2026-11-07T00:05:00.000Z');
  });

  it('treats a one-minute change to the saved event as a mismatch (deadlines move by minutes)', async () => {
    const f = fixture();
    await createProbe(f.deps).run();
    const saved = f.state()!;
    const event = f.events.get(saved.event.id) as Record<string, unknown>;
    f.events.set(saved.event.id, { ...event, start: { dateTime: '2026-11-07T00:01:00Z' } });
    const result = await createProbe(f.deps).run();
    expect(result.steps.at(-1)).toMatchObject({ status: 'error', code: 'event-mismatch' });
  });

  it('signs in before creating, persists the ID first, and confirms a duplicate on the second click', async () => {
    const f = fixture();
    const first = await createProbe(f.deps).run();
    expect(f.order).toEqual(['restore', 'token', 'credential', 'signIn', 'calendar', 'insert']);
    expect(first.steps.map((step) => step.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(first.uidPrefix).toBe(uid.slice(0, 8));
    expect(first.eventId).toBe(f.state()?.event.id);
    const second = await createProbe({ ...f.deps, workerId: 'worker-two' }).run();
    expect(second.steps.at(-1)).toMatchObject({ status: 'ok', code: 'already-exists' });
    expect(f.events.size).toBe(1);
    expect(f.calendarCount()).toBe(1);
    expect(f.order.slice(-2)).toEqual(['insert', 'lookup']);
    expect(JSON.stringify([first, second])).not.toContain(token);
    expect(JSON.stringify([first, second])).not.toContain(uid);
    expect(JSON.stringify(f.state())).not.toContain(token);
  });

  it('checks the restored full UID without another OAuth request or Calendar write', async () => {
    const f = fixture();
    await createProbe(f.deps).run();
    f.deps.auth.restore = vi.fn(async () => uid);
    const restored = await createProbe({ ...f.deps, workerId: 'worker-two' }).status();
    expect(restored).toMatchObject({ uidPrefix: uid.slice(0, 8), sameUid: true, workerChanged: true });
    expect(f.deps.auth.getToken).toHaveBeenCalledTimes(1);
    expect(f.events.size).toBe(1);
  });

  it('reports every missing setting without starting authentication', async () => {
    const f = fixture();
    const result = await createProbe({ ...f.deps, missing: ['oauthClientId', 'firebase.apiKey'] }).run();
    expect(result.steps[0]).toMatchObject({ status: 'error', code: 'missing-config' });
    expect(result.steps[0]?.message).toContain('oauthClientId');
    expect(result.steps[0]?.message).toContain('firebase.apiKey');
    expect(f.order).toEqual([]);
  });

  it.each(['getToken', 'credential', 'signIn'] as const)('sanitizes %s errors and stops before Calendar', async (method) => {
    const f = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(f.deps.auth[method]).mockImplementation(() => { throw new Error(token); });
    const result = await createProbe(f.deps).run();
    expect(result.steps.at(-1)?.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(f.deps.request).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it.each([400, 401, 403])('allows a later retry when calendar creation is rejected with HTTP %s', async (status) => {
    const f = fixture();
    vi.mocked(f.deps.request).mockResolvedValueOnce({ status });
    const first = await createProbe(f.deps).run();
    expect(first.steps.at(-1)).toMatchObject({ status: 'error', code: 'calendar-http' });
    expect(f.state()).toBeUndefined();
    const second = await createProbe(f.deps).run();
    expect(second.steps.at(-1)).toMatchObject({ status: 'ok', code: 'created' });
    expect(f.calendarCount()).toBe(1);
  });

  it('does not create another calendar after an ambiguous network failure', async () => {
    const f = fixture();
    vi.mocked(f.deps.request).mockRejectedValueOnce(new Error(token));
    const first = await createProbe(f.deps).run();
    const second = await createProbe(f.deps).run();
    expect(first.steps.at(-1)?.status).toBe('error');
    expect(second.steps.at(-1)?.code).toBe('calendar-recovery-required');
    expect(f.deps.request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([first, second])).not.toContain(token);
  });

  it.each([408, 500, 503])('keeps the recovery stop after an uncertain HTTP %s', async (status) => {
    const f = fixture();
    vi.mocked(f.deps.request).mockResolvedValueOnce({ status });
    await createProbe(f.deps).run();
    expect(f.state()?.calendar.status).toBe('creating');
    expect((await createProbe(f.deps).run()).steps.at(-1)?.code).toBe('calendar-recovery-required');
    expect(f.deps.request).toHaveBeenCalledTimes(1);
  });

  it('keeps the recovery stop when a successful calendar response has no ID', async () => {
    const f = fixture();
    vi.mocked(f.deps.request).mockResolvedValueOnce({ status: 200, data: {} });
    expect((await createProbe(f.deps).run()).steps.at(-1)?.code).toBe('calendar-response');
    expect((await createProbe(f.deps).run()).steps.at(-1)?.code).toBe('calendar-recovery-required');
    expect(f.deps.request).toHaveBeenCalledTimes(1);
  });

  it('retains a ready calendar after an event request is rejected', async () => {
    const f = fixture();
    await createProbe(f.deps).run();
    const saved = structuredClone(f.state());
    vi.mocked(f.deps.request).mockResolvedValueOnce({ status: 403 });
    expect((await createProbe(f.deps).run()).steps.at(-1)?.code).toBe('calendar-http');
    expect(f.state()).toEqual(saved);
    expect((await createProbe(f.deps).run()).steps.at(-1)?.code).toBe('already-exists');
    expect(f.calendarCount()).toBe(1);
  });

  it('does not accept a 409 without a matching live event', async () => {
    const f = fixture();
    await createProbe(f.deps).run();
    vi.mocked(f.deps.request).mockImplementation(async (_path, _token, body) => (
      body ? { status: 409 } : { status: 200, data: { id: f.state()?.event.id, summary: 'different' } }
    ));
    const result = await createProbe(f.deps).run();
    expect(result.steps.at(-1)).toMatchObject({ status: 'error', code: 'event-mismatch' });
  });

  it('keeps Calendar state separate when the Google account changes', async () => {
    const f = fixture();
    await createProbe(f.deps).run();
    f.deps.auth.signIn = vi.fn(async () => 'other-synthetic-uid');
    await createProbe(f.deps).run();
    expect(f.calendarCount()).toBe(2);
  });
});
