import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarItem, PreparationPlan } from '@kadai-hisho/core';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { createPlanStore } from '../src/plan-store.js';
import { createDigestStore } from '../src/digest-store.js';
import { createDemoCalendarSync } from '../src/demo-calendar.js';
import { createHttpServer } from '../src/http.js';
import { firebaseDependencies } from '../src/firebase.js';
import { observation } from './observation-fixture.js';
import { createObservationStore, documentKey } from '../src/observation-store.js';

// All users and tasks are invented; the clock is injected only into this new behavior's store.
describe.skipIf(process.env['RUN_DIGEST_EMULATOR_TESTS'] !== '1')('digest and actions with Auth/Firestore', () => {
  let fixture: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  let store: ReturnType<typeof createDigestStore>;
  let server: ReturnType<typeof createHttpServer>; let base: string;
  const owner = 'digest-student', supporter = 'digest-supporter', stranger = 'digest-stranger', real = 'digest-real';
  const tokens = new Map<string, string>(); let now = new Date('2030-11-11T00:00:00Z');
  let id: string;
  const student = (uid = owner) => fixture.db.collection('students').doc(uid);
  const plans = (uid = owner) => student(uid).collection('plans');
  const assignmentRef = (uid = owner) => student(uid).collection('assignments').doc(documentKey('demo-lms', 'fictional/task'));
  const request = (path: string, uid = owner, method = 'POST') => fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens.get(uid)}` } });
  const act = (action: string, uid = owner, revision = 1) => request(`/api/v1/plans/${id}/${action}?rev=${revision}`, uid);
  beforeAll(async () => {
    fixture = await sessionEmulatorFixture();
    store = createDigestStore(fixture.db, createDemoCalendarSync(fixture.db), 'https://study.example.invalid', () => now);
    server = createHttpServer({ ...firebaseDependencies(), digest: store });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
    base = `http://127.0.0.1:${address.port}`;
    for (const uid of [owner, supporter, stranger, real]) {
      await fixture.auth.createUser({ uid, email: `${uid}@example.invalid` });
      const response = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-only`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await fixture.auth.createCustomToken(uid), returnSecureToken: true }),
      });
      tokens.set(uid, (await response.json() as { idToken: string }).idToken);
    }
    await fixture.db.doc(`demoAccounts/${owner}`).set({ role: 'student', studentId: owner });
    await fixture.db.doc(`demoAccounts/${supporter}`).set({ role: 'supporter', studentId: owner });
    await student().collection('supporters').doc(supporter).set({ scopes: ['all'], revokedAt: null });
    await student().collection('demo').doc('current').set({ courses: [] });
  });
  beforeEach(async () => {
    now = new Date('2030-11-11T00:00:00Z');
    for (const uid of [owner, real]) {
      for (const name of ['plans', 'calendarItems', 'planActionReceipts']) for (const doc of (await student(uid).collection(name).get()).docs) await doc.ref.delete();
      const sample = observation(); sample.definitionId = 'demo-lms'; sample.observationId = randomUUID();
      sample.catalogCourses[0]!.slots = [{ weekday: 2, period: 1 }];
      sample.assignments[0]!.deadline = { kind: 'datetime', dueAt: '2030-11-15T17:00:00+09:00', dueText: 'do not copy source', timeZone: 'Asia/Tokyo' };
      await createObservationStore(fixture.db)(uid, sample);
      if (uid === owner) await createDemoCalendarSync(fixture.db)(uid);
    }
    id = randomUUID();
    const plan: PreparationPlan = { planId: id, assignment: { system: 'demo-lms', sourceId: 'fictional/task' }, title: '架空のレポート',
      date: '2030-11-11', period: 3, startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00',
      decidedOn: '2030-11-11', confirmedBy: supporter, createdByRole: 'supporter', confirmedAt: now.toISOString(), timeZone: 'Asia/Tokyo',
      status: 'active', revision: 1, calendarItemKey: `preparation-${id}` };
    for (const uid of [owner, real]) {
      await createPlanStore(fixture.db, createDemoCalendarSync(fixture.db)).save(uid === owner ? supporter : uid, uid, id, { assignment: plan.assignment, date: plan.date, period: plan.period, startsAt: plan.startsAt, endsAt: plan.endsAt });
    }
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await fixture?.close(); });
  it('returns only the verified recipient and owner data, never a requested uid or recipient', async () => {
    const response = await request(`/api/v1/digest?uid=${owner}&to=other@example.invalid`, owner, 'GET');
    expect(response.status).toBe(200); const digest = await response.json() as { plans: unknown[] };
    expect(digest).toMatchObject({ date: '2030-11-11', to: `${owner}@example.invalid`, empty: false });
    expect(digest.plans).toHaveLength(1); expect(JSON.stringify(digest)).not.toContain('do not copy source');
    expect((await request('/api/v1/digest', supporter, 'GET')).status).toBe(403);
    const other = await (await request(`/api/v1/digest?uid=${owner}`, stranger, 'GET')).json();
    expect(other).toMatchObject({ to: `${stranger}@example.invalid`, empty: true, plans: [] });
  });
  it('rejects outsiders and even shared supporters; no GET can mutate a plan', async () => {
    for (const uid of [stranger, supporter]) expect((await act('done', uid)).status).toBe(403);
    expect((await request(`/api/v1/plans/${id}/done`, owner, 'GET')).status).toBe(404);
    expect((await plans().doc(id).get()).data()!['status']).toBe('active');
  });
  it('excludes ended assignments from the digest and rejects new actions without changing the plan', async () => {
    await assignmentRef().update({ presenceState: 'ended' });
    expect(await (await request('/api/v1/digest', owner, 'GET')).json()).toMatchObject({ empty: true, plans: [], assignments: [] });
    for (const action of ['done', 'later']) expect((await act(action)).status).toBe(409);
    expect((await plans().doc(id).get()).data()).toMatchObject({ status: 'active', revision: 1 });
  });
  it('done is concurrent/replay safe, records actor/time, and never marks the LMS task submitted', async () => {
    const responses = await Promise.all([act('done'), act('done')]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const next = (await plans().doc(id).get()).data()!;
    expect(next).toMatchObject({ status: 'done', changedBy: owner, changedAt: now.toISOString(), revision: 2 });
    const before = (await plans().doc(id).get()).updateTime;
    expect((await act('done')).status).toBe(200); expect((await plans().doc(id).get()).updateTime).toEqual(before);
    expect((await assignmentRef().get()).data()!['submission']).toBe('not-submitted');
    const item = (await student().collection('calendarItems').doc(next['calendarItemKey']).get()).data()!;
    expect(item['desired']).toEqual({ state: 'deleted' });
    expect((await student().collection('integrations').doc('calendar').get()).data()!['mockEvents'][item['eventId']]).toBeUndefined();
  });
  it('moves once to the next candidate excluding classes and other preparations, with the same durable mock event id', async () => {
    await plans().doc('blocker').set({ ...(await plans().doc(id).get()).data(), date: '2030-11-12', period: 2, startsAt: '2030-11-12T10:30:00+09:00', endsAt: '2030-11-12T12:00:00+09:00', calendarItemKey: 'blocker' });
    const results = await Promise.all([act('later'), act('later')]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const next = (await plans().doc(id).get()).data()!;
    expect(next).toMatchObject({ date: '2030-11-12', period: 3, startsAt: '2030-11-12T13:00:00+09:00', laterResult: 'moved', revision: 2, changedBy: owner });
    const item = (await student().collection('calendarItems').doc(next['calendarItemKey']).get()).data() as CalendarItem;
    const event = (await student().collection('integrations').doc('calendar').get()).data()!['mockEvents'][item.eventId];
    expect(event.event.start.dateTime).toBe(next['startsAt']); expect(item.appliedRevision).toBe(item.desiredRevision);
    const updateTime = (await plans().doc(id).get()).updateTime;
    await act('later'); expect((await plans().doc(id).get()).updateTime).toEqual(updateTime);
    expect((await student().collection('calendarItems').doc(next['calendarItemKey']).get()).data()!['eventId']).toBe(item.eventId);
  });
  it('preserves the duration of a shorter preparation when moving to a configured period', async () => {
    id = randomUUID();
    await createPlanStore(fixture.db, createDemoCalendarSync(fixture.db)).save(supporter, owner, id, {
      assignment: { system: 'demo-lms', sourceId: 'fictional/task' }, date: '2030-11-11', period: 4,
      startsAt: '2030-11-11T14:40:00+09:00', endsAt: '2030-11-11T15:40:00+09:00',
    });
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'moved', plan: {
      period: 2, startsAt: '2030-11-12T10:30:00+09:00', endsAt: '2030-11-12T11:30:00+09:00',
    } });
  });
  it('no-slot does not write and recalculates when availability changes', async () => {
    const saved = (await plans().doc(id).get()).data()!;
    const calendarBefore = (await student().collection('calendarItems').doc(saved['calendarItemKey']).get()).data();
    await assignmentRef().update({ 'officialDeadline.deadline.dueAt': '2030-11-12T17:00:00+09:00' });
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'no-slot', plan: { date: '2030-11-11', startsAt: '2030-11-11T13:00:00+09:00', revision: 1 } });
    expect((await student().collection('calendarItems').doc(saved['calendarItemKey']).get()).data()).toEqual(calendarBefore);
    const updateTime = (await plans().doc(id).get()).updateTime;
    expect((await act('later')).status).toBe(200); expect((await plans().doc(id).get()).updateTime).toEqual(updateTime);
    expect((await student().collection('planActionReceipts').get()).empty).toBe(true);
    await assignmentRef().update({ 'officialDeadline.deadline.dueAt': '2030-11-15T17:00:00+09:00' });
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'moved', plan: { revision: 2 } });
  });
  it('queues real calendar movement with no Google call and keeps pending work through synchronization failure', async () => {
    const response = await act('later', real); expect(response.status).toBe(200);
    const plan = (await plans(real).doc(id).get()).data()!;
    const item = (await student(real).collection('calendarItems').doc(plan['calendarItemKey']).get()).data()!;
    expect(item).toMatchObject({ kind: 'preparation', appliedRevision: 0, desired: { state: 'present', event: { start: { dateTime: '2030-11-12T10:30:00+09:00' } } } });
    let fail = true; const sync = createDemoCalendarSync(fixture.db);
    const failing = createDigestStore(fixture.db, async uid => { if (fail) throw new Error('synthetic'); await sync(uid); }, 'https://study.example.invalid', () => now);
    await expect(failing.act(owner, id, 'later', 1)).rejects.toThrow('synthetic');
    const saved = (await plans().doc(id).get()).data()!; expect(saved['laterResult']).toBe('moved');
    fail = false; await failing.act(owner, id, 'later', 1);
    const applied = (await student().collection('calendarItems').doc(saved['calendarItemKey']).get()).data()!;
    expect(applied['appliedRevision']).toBe(applied['desiredRevision']); expect((await plans().doc(id).get()).data()!['revision']).toBe(2);
  });
  it('prepares the fictional morning sample only for the demo owner and reset clears all plan actions', async () => {
    expect((await request('/api/v1/digest/demo-plan', real)).status).toBe(403);
    expect((await request('/api/v1/digest/demo-plan', supporter)).status).toBe(403);
    expect((await request('/api/v1/digest/demo-plan')).status).toBe(200);
    expect((await request('/api/v1/digest/demo-plan')).status).toBe(200);
    expect((await plans().get()).size).toBe(2);
    await act('done');
    const response = await fetch(`${base}/api/v1/demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.get(owner)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ onlyIfStale: false }) });
    expect(response.status).toBe(200); expect((await plans().get()).empty).toBe(true);
    expect((await student().collection('planActionReceipts').get()).empty).toBe(true);
    expect((await plans(real).get()).size).toBe(1);
  });
  it('moves again with a new revision while replaying each old revision exactly, including after completion', async () => {
    const first = await (await act('later')).json();
    const second = await (await act('later', owner, 2)).json() as { outcome: string; plan: PreparationPlan };
    expect(second).toMatchObject({ outcome: 'moved', plan: { revision: 3 } });
    expect(second.plan.startsAt).not.toBe((first as { plan: PreparationPlan }).plan.startsAt);
    expect(await (await act('later')).json()).toEqual(first);
    expect(await (await act('done')).json()).toEqual(first);
    expect(await (await act('later', owner, 2)).json()).toEqual(second);
    expect((await plans().doc(id).get()).data()!['revision']).toBe(3);
    expect((await act('later', owner, 99)).status).toBe(409);
    expect((await act('done', owner, 3)).status).toBe(200);
    expect(await (await act('later')).json()).toEqual(first);
    expect((await plans().doc(id).get()).data()!['status']).toBe('done');
  });
  it('rebuilds demo mail plans on a new day or after inactivity, keeps the id, and avoids occupied clock intervals', async () => {
    const initial = await store.prepareDemo(owner);
    now = new Date('2030-11-12T00:00:00Z');
    await plans().doc('clock-blocker').set({ ...initial, date: '2030-11-12', period: 5,
      startsAt: '2030-11-12T10:30:00+09:00', endsAt: '2030-11-12T12:00:00+09:00' });
    const renewed = await store.prepareDemo(owner);
    expect(renewed).toMatchObject({ planId: initial.planId, date: '2030-11-12', period: 3, status: 'active', revision: 2 });
    expect(await store.prepareDemo(owner)).toEqual(renewed);
    await store.act(owner, renewed.planId, 'done', 2);
    const afterDone = await store.prepareDemo(owner);
    expect(afterDone).toMatchObject({ planId: initial.planId, date: '2030-11-12', status: 'active', revision: 4 });
    await plans().doc(initial.planId).update({ status: 'cancelled' });
    expect(await store.prepareDemo(owner)).toMatchObject({ status: 'active', revision: 5 });
  });

  it('does not move an unconfigured LMS and skips preparations whose clock intervals overlap another period', async () => {
    await plans().doc('clock-blocker').set({ ...(await plans().doc(id).get()).data(), period: 5, date: '2030-11-12',
      startsAt: '2030-11-12T10:45:00+09:00', endsAt: '2030-11-12T13:15:00+09:00' });
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'moved', plan: { period: 4, startsAt: '2030-11-12T14:40:00+09:00' } });
    const task = (await assignmentRef(real).get()).data()!;
    await student(real).collection('assignments').doc(documentKey('panda', 'fictional/task')).set({ ...task, key: { system: 'panda', sourceId: 'fictional/task' } });
    await plans(real).doc(id).update({ assignment: { system: 'panda', sourceId: 'fictional/task' } });
    expect(await (await act('later', real)).json()).toMatchObject({ outcome: 'no-slot', plan: { revision: 1 } });
  });

});
