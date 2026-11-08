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
  it('upgrades a synced YNU link once and keeps the event identity after acknowledgement and another observation', async () => {
    owner = await account();
    await send(301, body => {
      body.system = 'ynu-lms';
      body.definitionId = 'coursepower';
      body.assignments[0]!.url = 'https://example.invalid/lms/corsColl/linkKyozaiTitle';
    });
    const uid = (await getAuth(app).verifyIdToken(owner)).uid;
    const key = documentKey('ynu-lms', 'fictional/task');
    const student = db.doc(`students/${uid}`);
    const ref = student.collection('calendarItems').doc(key);
    const created = (await ref.get()).data() as CalendarItem;
    const description = '締切：11月12日\nLMSで開く：https://example.invalid/lms/homeHoml/doIndex\n道順：ホーム › 架空の演習 › 架空のレポート';
    expect(created.desired).toMatchObject({ state: 'present', event: { description } });
    await request('calendar-sync', { calendarId: 'synthetic3@group.calendar.google.com' });
    const synced = (await pending()).items[0]!;
    await request('calendar-sync', report(synced));
    // Represent a previously applied event from before the description fix.
    if (synced.desired.state !== 'present') throw new Error('present-event-required');
    await ref.update({ desired: { state: 'present', event: { ...synced.desired.event,
      description: '締切：11月12日\nLMSで開く：https://example.invalid/lms/corsColl/linkKyozaiTitle',
    } } });
    const updated = (await pending()).items;
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ eventId: synced.eventId, generation: synced.generation,
      desiredRevision: synced.desiredRevision + 1, appliedRevision: synced.desiredRevision,
      desired: { state: 'present', event: { description } } });
    const beforeRetry = (await ref.get()).updateTime;
    expect((await pending()).items).toEqual(updated);
    expect((await ref.get()).updateTime).toEqual(beforeRetry);
    await request('calendar-sync', report(updated[0]!));
    expect((await pending()).items).toHaveLength(0);
    const afterReport = (await ref.get()).updateTime;
    expect((await pending()).items).toHaveLength(0);
    expect((await ref.get()).updateTime).toEqual(afterReport);
    await send(302, body => {
      body.system = 'ynu-lms';
      body.definitionId = 'coursepower';
      body.assignments[0]!.url = 'https://example.invalid/lms/corsColl/linkKyozaiTitle';
    });
    expect((await pending()).items).toHaveLength(0);
    expect((await ref.get()).data()).toMatchObject({ eventId: synced.eventId, generation: synced.generation,
      desiredRevision: synced.desiredRevision + 1, appliedRevision: synced.desiredRevision + 1 });
    expect((await student.collection('calendarItems').get()).size).toBe(1);
  }, 20_000);
  it('upgrades the unreadable-deadline explanation once while retaining the last known date', async () => {
    owner = await account();
    await send(401);
    await request('calendar-sync', { calendarId: 'synthetic4@group.calendar.google.com' });
    await send(402, body => {
      body.assignments[0]!.deadline = { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' };
    });
    const uid = (await getAuth(app).verifyIdToken(owner)).uid;
    const student = db.doc(`students/${uid}`);
    const key = documentKey('demo-lms', 'fictional/task');
    const ref = student.collection('calendarItems').doc(key);
    const current = (await pending()).items[0]!;
    await request('calendar-sync', report(current));
    if (current.desired.state !== 'present') throw new Error('present-event-required');
    // Preserve the old title and date; only the missing explanation differs.
    await ref.update({ desired: { state: 'present', event: { ...current.desired.event,
      description: '締切：11月12日\nLMSで開く：https://example.invalid/tasks/1',
    } } });
    const updated = (await pending()).items[0]!;
    expect(updated).toMatchObject({ eventId: current.eventId, generation: current.generation,
      desiredRevision: current.desiredRevision + 1, appliedRevision: current.desiredRevision,
      desired: { state: 'present', event: { summary: '【要確認】架空の演習：架空のレポート',
        description: '締切：11月12日\nLMSで開く：https://example.invalid/tasks/1\n要確認：今回、締切を読めませんでした。前に確認できた締切があれば、そのまま出しています。',
        start: { date: '2026-11-12' }, end: { date: '2026-11-13' },
      } } });
    expect((await pending()).items).toEqual([updated]);
    await request('calendar-sync', report(updated));
    expect((await pending()).items).toHaveLength(0);
    expect((await student.collection('calendarItems').get()).size).toBe(1);
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
