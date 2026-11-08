import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { CalendarItem, CalendarIntegration } from '@kadai-hisho/core/calendar';
import { createHttpServer } from '../src/http.js';
import { createObservationStore, documentKey } from '../src/observations/store.js';
import { createCalendarStore } from '../src/calendar/store.js';
import { observation } from './observation-fixture.js';

describe.skipIf(process.env['RUN_OBSERVATION_EMULATOR_TESTS'] !== '1')('calendar sync with Auth and Firestore emulators', () => {
  let app: ReturnType<typeof initializeApp>;
  let db: ReturnType<typeof getFirestore>;
  let server: ReturnType<typeof createHttpServer>;
  let base: string;
  let owner: string; let other: string;
  async function account() {
    const response = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    if (!response.ok) throw new Error('emulator-signup');
    return (await response.json() as { idToken: string }).idToken;
  }
  beforeAll(async () => {
    if (process.env['GCLOUD_PROJECT'] !== 'demo-kadai-hisho') throw new Error('demo-project-required');
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] ?? '')) throw new Error('local-emulators-required');
    }
    app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'calendar-tests'); db = getFirestore(app);
    server = createHttpServer({ verifyToken: async token => (await getAuth(app).verifyIdToken(token, true)).uid,
      saveObservation: createObservationStore(db), calendar: createCalendarStore(db) });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    base = `http://127.0.0.1:${address.port}/api/v1`;
    owner = await account(); other = await account();
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (db) await db.terminate(); if (app) await deleteApp(app);
  });
  async function request(path: string, body?: unknown, token = owner) {
    return fetch(`${base}/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function pending(token = owner) {
    const result = await request('calendar-sync', undefined, token); expect(result.status).toBe(200);
    return await result.json() as { items: CalendarItem[]; integration: CalendarIntegration | null };
  }
  async function send(n: number, mutate?: (body: ReturnType<typeof observation>) => void) {
    const body = observation(n); mutate?.(body);
    expect((await request('observations', body)).status).toBe(200);
  }
  const report = (item: CalendarItem) => ({ itemKey: item.itemKey, generation: item.generation, eventId: item.eventId, revision: item.desiredRevision, errorCode: null });
  it('persists desired state atomically, binds a dedicated calendar and isolates owners', async () => {
    await send(101);
    const uid = (await getAuth(app).verifyIdToken(owner)).uid;
    const ref = db.doc(`students/${uid}/calendarItems/${documentKey('demo-lms', 'fictional/task')}`);
    expect((await ref.get()).data()).toMatchObject({ desiredRevision: 1, calendarId: null, desired: { state: 'present' } });
    expect((await pending()).items).toHaveLength(0);
    expect((await request('calendar-sync', { calendarId: 'synthetic@group.calendar.google.com' })).status).toBe(200);
    const [first] = (await pending()).items; expect(first).toBeDefined();
    expect((await pending(other)).items).toHaveLength(0);
    await request('calendar-sync', report(first!), other);
    expect((await pending()).items).toHaveLength(1);
    const before = (await ref.get()).updateTime;
    await send(101); expect((await ref.get()).updateTime).toEqual(before);
    expect((await request('calendar-sync', { calendarId: 'different@group.calendar.google.com' })).status).toBe(409);
  }, 20_000);
  it('ignores stale successes and duplicate reports, retains deletion until acknowledged, then regenerates', async () => {
    owner = await account();
    await send(201);
    expect((await request('calendar-sync', { calendarId: 'synthetic2@group.calendar.google.com' })).status).toBe(200);
    const old = (await pending()).items[0]!;
    await send(102, body => { body.assignments[0]!.deadline = { kind: 'date', date: '2026-11-15', dueText: '11月15日', timeZone: 'Asia/Tokyo' }; });
    await request('calendar-sync', report(old));
    const updated = (await pending()).items[0]!;
    expect(updated.desiredRevision).toBeGreaterThan(old.desiredRevision); expect(updated.appliedRevision).toBe(0);
    await request('calendar-sync', report(updated)); await request('calendar-sync', report(updated));
    expect((await pending()).items).toHaveLength(0);
    const remove = (body: ReturnType<typeof observation>) => { body.assignments = []; body.courseResults[0]!.seenSourceIds = []; };
    await send(103, remove); await send(104, remove);
    const deleted = (await pending()).items[0]!; expect(deleted.desired.state).toBe('deleted');
    await send(105); expect((await pending()).items[0]!.desired.state).toBe('deleted');
    await request('calendar-sync', report(deleted));
    const restored = (await pending()).items[0]!;
    expect(restored.generation).toBe(deleted.generation + 1); expect(restored.eventId).not.toBe(deleted.eventId);
    await request('calendar-sync', report(deleted)); expect((await pending()).items[0]!.desiredRevision).toBe(restored.desiredRevision);
    await request('calendar-sync', report(restored)); expect((await pending()).items).toHaveLength(0);
  }, 20_000);
});
