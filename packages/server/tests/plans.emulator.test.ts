import type { CalendarItem, PreparationPlanInput } from '@kadai-hisho/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { createPlanStore } from '../src/plan-store.js';
import { createDemoCalendarSync } from '../src/demo-calendar.js';
import { observation } from './observation-fixture.js';

/** The acceptance contract uses invented users, assignments and times only. */
describe.skipIf(process.env['RUN_PLAN_EMULATOR_TESTS'] !== '1')('option A preparation plans', () => {
  let fixture: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  const tokens = new Map<string, string>();
  const student = 'plan-student'; const supporter = 'plan-supporter'; const outsider = 'plan-outsider';
  const input: PreparationPlanInput = { assignment: { system: 'demo-lms', sourceId: 'fictional/task' }, date: '2030-11-11', period: 3,
    startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00' };
  async function request(actor: string, uid: string, id: string, method = 'PUT', body: unknown = input) {
    return fetch(`${fixture.base}/api/v1/students/${uid}/plans/${id}`, { method,
      headers: { Authorization: `Bearer ${tokens.get(actor)}`, 'Content-Type': 'application/json' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) });
  }
  const plans = (uid = student) => fixture.db.collection(`students/${uid}/plans`);
  const items = (uid = student) => fixture.db.collection(`students/${uid}/calendarItems`);
  const grant = () => fixture.db.doc(`students/${student}/supporters/${supporter}`);
  beforeAll(async () => {
    fixture = await sessionEmulatorFixture();
    for (const uid of [student, supporter, outsider, 'plan-real']) {
      await fixture.auth.createUser({ uid });
      const result = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-only`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          token: await fixture.auth.createCustomToken(uid), returnSecureToken: true,
        }),
      });
      tokens.set(uid, (await result.json() as { idToken: string }).idToken);
    }
    await fixture.db.doc(`demoAccounts/${student}`).set({ role: 'student', studentId: student });
    await fixture.db.doc(`demoAccounts/${supporter}`).set({ role: 'supporter', studentId: student });
    await grant().set({ scopes: ['all'], revokedAt: null });
    for (const uid of [student, 'plan-real']) {
      const sample = observation(701); sample.definitionId = 'demo-lms';
      sample.assignments[0]!.deadline = { kind: 'date', date: '2030-11-15', dueText: '架空の日付', timeZone: 'Asia/Tokyo' };
      const result = await fetch(`${fixture.base}/api/v1/observations`, { method: 'POST', headers: {
        Authorization: `Bearer ${tokens.get(uid)}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify(sample) });
      expect(result.status).toBe(200);
    }
  });
  afterAll(async () => { await fixture?.close(); });
  it('allows the supporter to add once, shows the author, and lets the student remove it from the mock destination', async () => {
    const id = randomUUID();
    const response = await request(supporter, student, id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const saved = (await plans().doc(id).get()).data()!;
    expect(saved).toMatchObject({ ...input, planId: id, status: 'active', confirmedBy: supporter, createdByRole: 'supporter', revision: 1 });
    const calendar = (await items().doc(saved['calendarItemKey']).get()).data()!;
    expect(calendar).toMatchObject({ kind: 'preparation', desired: { state: 'present' }, appliedRevision: calendar['desiredRevision'] });
    const target = () => fixture.db.doc(`students/${student}/integrations/calendar`).get();
    const event = (await target()).data()!['mockEvents'][calendar['eventId']];
    expect(event.event.start.dateTime).toBe(input.startsAt);
    expect(event.event.end.dateTime).toBe(input.endsAt);
    const before = (await plans().doc(id).get()).updateTime;
    expect((await request(supporter, student, id)).status).toBe(200);
    expect((await plans().doc(id).get()).updateTime).toEqual(before);
    expect((await request(supporter, student, id, 'PUT', { ...input, period: 4 })).status).toBe(409);
    expect((await request(student, student, id, 'DELETE')).status).toBe(200);
    expect((await plans().doc(id).get()).data()).toMatchObject({ status: 'cancelled', revision: 2 });
    expect((await target()).data()!['mockEvents'][calendar['eventId']]).toBeUndefined();
    expect((await request(student, student, id, 'DELETE')).status).toBe(200);
    expect((await request(supporter, student, id)).status).toBe(409); // Delayed create cannot undo removal.
    expect((await plans().doc(id).get()).data()!['status']).toBe('cancelled');
  });
  it('allows self-created plans, rejects outsiders and revoked supporters without partial writes', async () => {
    const id = randomUUID();
    expect((await request(outsider, student, id)).status).toBe(403);
    expect((await plans().doc(id).get()).exists).toBe(false);
    expect((await request(student, student, id)).status).toBe(200);
    expect((await plans().doc(id).get()).data()!['createdByRole']).toBe('student');
    expect((await request(supporter, student, id, 'DELETE')).status).toBe(403);
    await grant().update({ revokedAt: '2030-11-01T00:00:00Z' });
    expect((await request(supporter, student, randomUUID())).status).toBe(403);
    expect((await request(student, student, id, 'DELETE')).status).toBe(200);
    await grant().update({ revokedAt: null });
  });
  it('rejects malformed/forged inputs, occupied class slots and missing assignments', async () => {
    for (const bad of [{ ...input, confirmedBy: student }, { ...input, date: '2030-02-30' },
      { ...input, endsAt: input.startsAt }, { ...input, period: 25 },
      { ...input, assignment: { ...input.assignment, extra: 'no' } }]) {
      const id = randomUUID();
      expect((await request(student, student, id, 'PUT', bad)).status).toBe(400);
      expect((await plans().doc(id).get()).exists).toBe(false);
    }
    expect((await request(student, student, randomUUID(), 'PUT', { ...input, period: 2 })).status).toBe(409);
    expect((await request(student, student, randomUUID(), 'PUT', { ...input,
      assignment: { ...input.assignment, sourceId: 'missing' } })).status).toBe(409);
  });
  it('queues real-account plans for the existing extension executor and preserves deletion until acknowledged', async () => {
    const uid = 'plan-real'; const id = randomUUID();
    expect((await request(uid, uid, id)).status).toBe(200);
    const saved = (await plans(uid).doc(id).get()).data()!;
    const ref = items(uid).doc(saved['calendarItemKey']);
    expect((await ref.get()).data()).toMatchObject({ calendarId: null, appliedRevision: 0 });
    const api = async (body?: unknown) => fetch(`${fixture.base}/api/v1/calendar-sync`, { method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${tokens.get(uid)}`, 'Content-Type': 'application/json',
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await api({ calendarId: 'plans@group.calendar.google.com' })).status).toBe(200);
    const queued = (await (await api()).json() as { items: CalendarItem[] }).items.find(item => item.kind === 'preparation')!;
    expect(queued!.desired).toMatchObject({ state: 'present', event: { start: { dateTime: input.startsAt } } });
    expect((await fixture.db.doc(`students/${uid}/integrations/calendar`).get()).data()!['mode']).toBe('google');
    expect((await request(uid, uid, id, 'DELETE')).status).toBe(200);
    expect((await ref.get()).data()!['desired'].state).toBe('deleted');
    await api({ itemKey: queued.itemKey, generation: queued.generation, eventId: queued.eventId, revision: queued.desiredRevision, errorCode: null });
    expect((await ref.get()).data()!['appliedRevision']).toBe(0); // Stale create success cannot acknowledge removal.
    const removed = (await ref.get()).data()!;
    await api({ itemKey: queued.itemKey, generation: queued.generation, eventId: queued.eventId, revision: removed['desiredRevision'], errorCode: null });
    expect((await ref.get()).data()!['appliedRevision']).toBe(removed['desiredRevision']);
    expect((await (await api()).json() as { items: CalendarItem[] }).items.some((item: { itemKey: string }) => item.itemKey === queued.itemKey)).toBe(false);
  });
  it('allows the student and authorized supporter to set session dates but rejects outsiders', async () => {
    const context = { lastSessionAt: null, nextSessionAt: '2030-11-12T10:00:00+09:00' };
    for (const [uid, status] of [[student, 200], [supporter, 200], [outsider, 403]] as const) {
      const response = await fetch(`${fixture.base}/api/v1/students/${student}/session-context`, {
        method: 'PUT', headers: { Authorization: `Bearer ${tokens.get(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(context),
      });
      expect(response.status).toBe(status);
    }
  });
  it('rejects unauthenticated, oversized and non-JSON requests without leaking input', async () => {
    const url = `${fixture.base}/api/v1/students/${student}/plans/${randomUUID()}`;
    expect((await fetch(url, { method: 'PUT' })).status).toBe(401);
    const headers = { Authorization: `Bearer ${tokens.get(student)}` };
    expect((await fetch(url, { method: 'PUT', headers, body: '{}' })).status).toBe(415);
    const response = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'body-too-large' });
  });
  it('keeps queued work after a mock destination failure, and concurrent retries still save one plan', async () => {
    const id = randomUUID(); let fail = true;
    const sync = createDemoCalendarSync(fixture.db);
    const store = createPlanStore(fixture.db, async uid => { if (fail) throw new Error('synthetic-failure'); await sync(uid); });
    await expect(store.save(student, student, id, input)).rejects.toThrow('synthetic-failure');
    const saved = (await plans().doc(id).get()).data()!;
    const pending = (await items().doc(saved['calendarItemKey']).get()).data()!;
    expect(pending['appliedRevision']).toBe(0);
    expect((await fixture.db.doc(`students/${student}/integrations/calendar`).get()).data()!['mockEvents'][pending['eventId']]).toBeUndefined();
    fail = false;
    await Promise.all([store.save(student, student, id, input), store.save(student, student, id, input)]);
    expect((await plans().doc(id).get()).data()!['revision']).toBe(1);
    const applied = (await items().doc(saved['calendarItemKey']).get()).data()!;
    expect(applied['appliedRevision']).toBe(applied['desiredRevision']);
    const events = (await fixture.db.doc(`students/${student}/integrations/calendar`).get()).data()!['mockEvents'];
    expect(Object.values(events).filter(event => (event as { itemKey: string }).itemKey === saved['calendarItemKey'])).toHaveLength(1);
    expect((await request(student, student, id, 'DELETE')).status).toBe(200);
  });
  it('prevents demo accounts from planning for another pair or choosing a real LMS', async () => {
    await fixture.db.doc(`students/plan-real/supporters/${supporter}`).set({ scopes: ['all'], revokedAt: null });
    expect((await request(supporter, 'plan-real', randomUUID())).status).toBe(403);
    expect((await request(student, student, randomUUID(), 'PUT', { ...input,
      assignment: { system: 'ynu-lms', sourceId: 'fictional/task' } })).status).toBe(403);
  });

});
