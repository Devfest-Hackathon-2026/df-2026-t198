import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { observation } from './observation-fixture.js';

describe.skipIf(process.env['RUN_DEMO_EMULATOR_TESTS'] !== '1')('persisted demo calendar', () => {
  let fixture: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  let uid: string;
  let token: string;
  beforeAll(async () => {
    fixture = await sessionEmulatorFixture();
  });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!response.ok) throw new Error('emulator-signup-failed');
    const account = await response.json() as { localId: string; idToken: string };
    uid = account.localId; token = account.idToken;
    await fixture.db.doc(`demoAccounts/${uid}`).set({ role: 'student', studentId: uid });
  });
  afterAll(async () => { await fixture?.close(); });
  const sample = () => ({ ...observation(), observationId: randomUUID(), definitionId: 'demo-lms' });
  const target = () => fixture.db.doc(`students/${uid}/integrations/calendar`);
  const items = async () => (await fixture.db.collection(`students/${uid}/calendarItems`).get()).docs;
  const post = (body: ReturnType<typeof sample>) => fetch(`${fixture.base}/api/v1/observations`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  it('writes the mock destination and acknowledges its revision after an authenticated observation', async () => {
    expect((await post(sample())).status).toBe(200);
    expect((await target().get()).data()).toMatchObject({ mode: 'mock', executor: 'demo', connectionState: 'connected' });
    const item = (await items())[0]!.data();
    expect(Object.values((await target().get()).data()!['mockEvents'])).toEqual([{
      itemKey: item['itemKey'], generation: item['generation'], revision: item['desiredRevision'],
      event: expect.objectContaining({ summary: '架空の演習：架空のレポート', start: { date: '2026-11-12' } }),
    }]);
    expect(item['appliedRevision']).toBe(item['desiredRevision']);
    expect(item['appliedAt']).not.toBeNull();
  });
  it('moves the same event once across simultaneous observations and their replays', async () => {
    expect((await post(sample())).status).toBe(200);
    const original = (await items())[0]!.data();
    const changed = sample();
    changed.assignments[0]!.deadline = { kind: 'date', date: '2026-11-13', dueText: '11月13日', timeZone: 'Asia/Tokyo' };
    expect((await Promise.all([post(changed), post(changed)])).map(r => r.status)).toEqual([200, 200]);
    const destination = await target().get();
    const item = (await items())[0]!.data();
    expect(item['eventId']).toBe(original['eventId']);
    expect(item['generation']).toBe(original['generation']);
    expect(item['appliedRevision']).toBe(item['desiredRevision']);
    const events = destination.data()!['mockEvents'];
    expect(Object.keys(events)).toEqual([original['eventId']]);
    expect(events[original['eventId']].event.start).toEqual({ date: '2026-11-13' });
    expect((await post(changed)).status).toBe(200);
    expect((await target().get()).updateTime).toEqual(destination.updateTime);
  });
  it('does not remove a missing candidate; removes a cancelled event and restores with a new generation', async () => {
    await post(sample());
    const original = (await items())[0]!.data();
    const missing = () => ({ ...sample(), assignments: [], courseResults: [
      { courseId: 'fictional/course', listComplete: true, seenSourceIds: [] },
    ] });
    expect((await post(missing())).status).toBe(200);
    expect(Object.keys((await target().get()).data()!['mockEvents'])).toHaveLength(1);
    expect((await post(missing())).status).toBe(200);
    expect((await target().get()).data()!['mockEvents']).toEqual({});
    const cancelled = (await items())[0]!.data();
    expect(cancelled['appliedRevision']).toBe(cancelled['desiredRevision']);
    expect((await post(sample())).status).toBe(200);
    const restored = (await items())[0]!.data();
    expect(restored['generation']).toBe(original['generation'] + 1);
    expect(restored['eventId']).not.toBe(original['eventId']);
    expect(Object.keys((await target().get()).data()!['mockEvents'])).toEqual([restored['eventId']]);
  });
  it('keeps an unsuccessful destination pending and retries the already-received observation', async () => {
    await post(sample());
    const connection = (await target().get()).data()!;
    const original = (await items())[0]!.data();
    const eventId = original['eventId'];
    const conflict = structuredClone(connection);
    conflict['mockEvents'][eventId].itemKey = 'different-owner';
    await target().set(conflict);
    const changed = sample();
    changed.assignments[0]!.title = '架空の改訂レポート';
    expect((await post(changed)).status).toBe(500);
    const waiting = (await items())[0]!.data();
    expect(waiting['appliedRevision']).toBe(original['appliedRevision']);
    expect(waiting['desiredRevision']).toBeGreaterThan(waiting['appliedRevision']);
    expect((await target().get()).data()).toEqual(conflict);
    await target().set(connection);
    expect((await post(changed)).status).toBe(200);
    const done = (await items())[0]!.data();
    expect(done['appliedRevision']).toBe(done['desiredRevision']);
    expect((await target().get()).data()!['mockEvents'][eventId].event.summary).toContain('架空の改訂レポート');
  });
  it('finishes a pending deletion before recreating a task that has already returned', async () => {
    await post(sample());
    const original = (await items())[0]!.data();
    const connection = (await target().get()).data()!;
    const missing = () => ({ ...sample(), assignments: [], courseResults: [
      { courseId: 'fictional/course', listComplete: true, seenSourceIds: [] },
    ] });
    await post(missing());
    const conflict = structuredClone(connection);
    conflict['mockEvents'][original['eventId']].itemKey = 'different-owner';
    await target().set(conflict);
    expect((await post(missing())).status).toBe(500);
    expect((await items())[0]!.data()['desired']).toEqual({ state: 'deleted' });
    await target().set(connection);
    expect((await post(sample())).status).toBe(200);
    const restored = (await items())[0]!.data();
    expect(restored['generation']).toBe(original['generation'] + 1);
    expect(restored['appliedRevision']).toBe(restored['desiredRevision']);
    expect(Object.keys((await target().get()).data()!['mockEvents'])).toEqual([restored['eventId']]);
    expect(restored['eventId']).not.toBe(original['eventId']);
  });
  it('does not overwrite a Google connection or another student destination', async () => {
    const otherUid = randomUUID();
    const other = fixture.db.doc(`students/${otherUid}/integrations/calendar`);
    const untouched = { mode: 'mock', executor: 'demo', calendarId: 'demo-calendar', mockEvents: {} };
    await other.set(untouched);
    const real = { mode: 'google', executor: 'extension', calendarId: 'fictional@group.calendar.google.com', connectionState: 'connected' };
    await target().set(real);
    expect((await post(sample())).status).toBe(500);
    expect((await target().get()).data()).toEqual(real);
    expect((await other.get()).data()).toEqual(untouched);
    expect((await items())[0]!.data()['appliedRevision']).toBe(0);
  });
});
