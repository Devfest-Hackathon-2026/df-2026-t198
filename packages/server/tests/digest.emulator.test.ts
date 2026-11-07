import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@kadai-hisho/core';
import type { CalendarItem, PreparationPlan } from '@kadai-hisho/core';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { createPlanStore } from '../src/plan-store.js';
import { createDigestStore, type PlanActionResult } from '../src/digest-store.js';
import { createDemoCalendarSync } from '../src/demo-calendar.js';
import { createHttpServer } from '../src/http.js';
import { firebaseDependencies } from '../src/firebase.js';
import { observation } from './observation-fixture.js';
import { createObservationStore, documentKey } from '../src/observation-store.js';
import { createSessionStore } from '../src/session-store.js';

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
      for (const name of ['plans', 'calendarItems', 'planActionReceipts', 'notificationSettings']) for (const doc of (await student(uid).collection(name).get()).docs) await doc.ref.delete();
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
  afterEach(() => vi.restoreAllMocks());
  it('reports current completion when an old later link is replayed (B1)', async () => {
    expect((await act('later')).status).toBe(200);
    const finished = await (await act('done', owner, 2)).json() as PlanActionResult;
    const saved = await plans().doc(id).get();
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'unchanged', plan: finished.plan });
    expect((await plans().doc(id).get()).updateTime).toEqual(saved.updateTime);
  });
  it('creates a new sample after later, preserving the old plan, calendar and replay receipt (B1/B4)', async () => {
    const sample = await store.prepareDemo(owner);
    const original = await plans().doc(sample.planId).get();
    expect(await store.prepareDemo(owner)).toEqual(sample);
    expect((await plans().doc(sample.planId).get()).updateTime).toEqual(original.updateTime);
    await store.act(owner, sample.planId, 'later', sample.revision);
    const moved = (await plans().doc(sample.planId).get()).data() as PreparationPlan;
    const calendarRef = student().collection('calendarItems').doc(moved.calendarItemKey);
    const calendar = await calendarRef.get();
    const receiptRef = student().collection('planActionReceipts').doc(`${sample.planId}-${sample.revision}-later`);
    const receipt = await receiptRef.get();
    const replacement = await store.prepareDemo(owner);
    expect(replacement).toMatchObject({ date: '2030-11-11', status: 'active', revision: 1 });
    expect(replacement.planId).not.toBe(sample.planId);
    expect((await plans().doc(sample.planId).get()).data()).toEqual(moved);
    expect((await calendarRef.get()).updateTime).toEqual(calendar.updateTime);
    expect((await receiptRef.get()).updateTime).toEqual(receipt.updateTime);
    const finished = await store.act(owner, sample.planId, 'done', moved.revision);
    const saved = await plans().doc(sample.planId).get();
    expect(await store.prepareDemo(owner)).toEqual(replacement);
    expect(await store.act(owner, sample.planId, 'later', sample.revision)).toMatchObject({ outcome: 'unchanged', plan: finished.plan });
    expect((await plans().doc(sample.planId).get()).updateTime).toEqual(saved.updateTime);
  });
  it.each(['done', 'cancelled', 'previous-day'] as const)('creates a fresh sample without overwriting a %s sample (B4)', async state => {
    const sample = await store.prepareDemo(owner);
    if (state === 'done') await store.act(owner, sample.planId, 'done', sample.revision);
    else if (state === 'cancelled') await createPlanStore(fixture.db, createDemoCalendarSync(fixture.db)).save(owner, owner, sample.planId, null);
    else now = new Date('2030-11-12T00:00:00Z');
    const saved = await plans().doc(sample.planId).get();
    const replacement = await store.prepareDemo(owner);
    expect(replacement.planId).not.toBe(sample.planId);
    expect(replacement).toMatchObject({ date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }), status: 'active', revision: 1 });
    expect((await plans().doc(sample.planId).get()).updateTime).toEqual(saved.updateTime);
    expect((await plans().doc(sample.planId).get()).data()).toEqual(saved.data());
    expect(await store.prepareDemo(owner)).toEqual(replacement);
  });
  it('concurrent sample requests reuse the same active sample', async () => {
    const [first, second] = await Promise.all([store.prepareDemo(owner), store.prepareDemo(owner)]);
    expect(second).toEqual(first);
    expect((await plans().get()).size).toBe(2);
  });
  it('reuses a legacy sample that is still active today', async () => {
    const legacyId = '11200000-0000-4000-8000-000000000001';
    const legacy = { ...(await plans().doc(id).get()).data(), planId: legacyId };
    await plans().doc(legacyId).set(legacy);
    const saved = await plans().doc(legacyId).get();
    expect(await store.prepareDemo(owner)).toEqual(legacy);
    expect((await plans().doc(legacyId).get()).updateTime).toEqual(saved.updateTime);
  });
  it('reads the demo display name from the profile and falls back only for legacy profiles', async () => {
    const sessions = createSessionStore(fixture.db);
    expect(await sessions.listStudents(supporter)).toEqual([{ uid: owner, displayName: '架空の学生A' }]);
    const profile = fixture.db.doc(`demoAccounts/${owner}`);
    try {
      await profile.update({ displayName: '架空の学生B' });
      expect(await sessions.listStudents(supporter)).toEqual([{ uid: owner, displayName: '架空の学生B' }]);
    } finally { await profile.set({ role: 'student', studentId: owner }); }
  });
  it('leaves a preparation and its calendar unchanged when no slot remains before the deadline', async () => {
    await assignmentRef().update({ 'officialDeadline.deadline': { kind: 'datetime', dueAt: '2030-11-12T08:00:00+09:00', dueText: '架空', timeZone: 'Asia/Tokyo' } });
    const saved = await plans().doc(id).get();
    const item = student().collection('calendarItems').doc(saved.data()!['calendarItemKey']);
    const calendar = (await item.get()).data();
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'no-slot', plan: saved.data() });
    expect((await plans().doc(id).get()).updateTime).toEqual(saved.updateTime);
    expect((await item.get()).data()).toEqual(calendar);
  });
  it('rejects a postponement candidate after the deadline without consuming the revision (B2 defense)', async () => {
    // Inject a candidate outside the conservative generator policy to exercise the store boundary itself.
    vi.spyOn(core, 'preparationSlots').mockReturnValue([{ assignment: { system: 'demo-lms', sourceId: 'fictional/task' }, date: '2030-11-18', period: 3 }]);
    const saved = await plans().doc(id).get();
    const calendarRef = student().collection('calendarItems').doc(saved.data()!['calendarItemKey']);
    const calendar = await calendarRef.get();
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'no-slot', plan: saved.data() });
    expect((await plans().doc(id).get()).updateTime).toEqual(saved.updateTime);
    expect((await calendarRef.get()).updateTime).toEqual(calendar.updateTime);
    expect((await student().collection('planActionReceipts').get()).empty).toBe(true);
  });
  it('does not create a morning sample whose available starts are all after the deadline', async () => {
    await assignmentRef().update({ 'officialDeadline.deadline': { kind: 'datetime', dueAt: '2030-11-11T08:00:00+09:00', dueText: '架空', timeZone: 'Asia/Tokyo' } });
    const response = await request('/api/v1/digest/demo-plan');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'plan-after-deadline' });
    expect((await plans().get()).size).toBe(1);
  });
  it('returns only the verified recipient and owner data, never a requested uid or recipient', async () => {
    const response = await request(`/api/v1/digest?uid=${owner}&to=other@example.invalid`, owner, 'GET');
    expect(response.status).toBe(200); const digest = await response.json() as { plans: unknown[] };
    expect(digest).toMatchObject({ date: '2030-11-11', to: `${owner}@example.invalid`, empty: false });
    expect(digest.plans).toHaveLength(1); expect(JSON.stringify(digest)).not.toContain('do not copy source');
    expect((await request('/api/v1/digest', supporter, 'GET')).status).toBe(403);
    const other = await (await request(`/api/v1/digest?uid=${owner}`, stranger, 'GET')).json();
    expect(other).toMatchObject({ to: `${stranger}@example.invalid`, empty: true, plans: [] });
  });
  it('blocks legacy digest for cloud owners, even OFF, but isolates the fictional preview', async () => {
    for (const uid of [real, owner]) {
      const settings = student(uid).collection('notificationSettings').doc('current');
      for (const enabled of [true, false]) {
        await settings.set({ enabled, deliveryOwner: 'cloud' });
        const legacy = await request(`/api/v1/digest?preview=true&uid=${stranger}`, uid, 'GET');
        expect(legacy.status).toBe(403); expect(await legacy.json()).toEqual({ error: 'forbidden' });
        expect((await request('/api/v1/digest/demo-preview', uid, 'GET')).status).toBe(uid === owner ? 200 : 403);
      }
    }
    expect((await request('/api/v1/digest/demo-preview', supporter, 'GET')).status).toBe(403);
    expect((await request('/api/v1/digest/demo-preview', stranger, 'GET')).status).toBe(403);
  });
  it.each(['no-record', 'none', 'extension', 'cloud'])('reports %s without overriding local extension consent', async kind => {
    const settings = student(real).collection('notificationSettings').doc('current');
    for (const enabled of [false, true]) {
      if (kind !== 'no-record') await settings.set({ enabled, deliveryOwner: kind, recipientUid: real, version: 1,
        timeZone: 'Asia/Tokyo', morningTime: '07:30', migrationState: 'not-started', updatedAt: now.toISOString() });
      const before = await settings.get();
      const response = await request(`/api/v1/digest/delivery?uid=${owner}`, real, 'GET');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(kind === 'no-record' ? { enabled: false, deliveryOwner: 'none' } : { enabled, deliveryOwner: kind });
      expect((await settings.get()).updateTime).toEqual(before.updateTime);
      expect((await request('/api/v1/digest', real, 'GET')).status).toBe(kind === 'cloud' ? 403 : 200);
    }
  });
  it('cannot confirm invalid records or demo delivery and never replaces them with none', async () => {
    const settings = student(real).collection('notificationSettings').doc('current');
    const valid = { enabled: true, deliveryOwner: 'extension', recipientUid: real, version: 1,
      timeZone: 'Asia/Tokyo', morningTime: '07:30', migrationState: 'not-started', updatedAt: now.toISOString() };
    for (const patch of [{ enabled: 'true' }, { recipientUid: owner }, { version: 0 },
      { deliveryOwner: 'unexpected' }, { timeZone: 'UTC' }, { morningTime: '08:00' }, { migrationState: 'unexpected' }]) {
      await settings.set({ ...valid, ...patch });
      const before = await settings.get();
      const response = await request(`/api/v1/digest/delivery?uid=${owner}`, real, 'GET');
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'unavailable' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect((await settings.get()).updateTime).toEqual(before.updateTime);
      expect((await request('/api/v1/digest', real, 'GET')).status).toBe(200);
    }
    await settings.set(valid);
    const before = await settings.get();
    expect(await (await request('/api/v1/digest/delivery', real, 'GET')).json()).toEqual({ enabled: true, deliveryOwner: 'extension' });
    expect((await request('/api/v1/digest', real, 'GET')).status).toBe(200);
    await student().collection('notificationSettings').doc('current').set({ ...valid, recipientUid: owner });
    expect((await request('/api/v1/digest/delivery', owner, 'GET')).status).toBe(503);
    expect((await request('/api/v1/digest/delivery', supporter, 'GET')).status).toBe(403);
    expect((await settings.get()).updateTime).toEqual(before.updateTime);
  });
  it('cannot confirm delivery when reading settings fails and exposes no underlying error', async () => {
    vi.spyOn(fixture.db, 'runTransaction').mockRejectedValueOnce(new Error('synthetic-private-settings-error'));
    const response = await request('/api/v1/digest/delivery', real, 'GET');
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'internal-error' });
    expect(response.headers.get('cache-control')).toBe('no-store');
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
    expect(await response.json()).toMatchObject({ outcome: 'moved', demo: false });
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
  it('moves with new revisions and returns the current plan for old replays, including after completion', async () => {
    const first = await (await act('later')).json();
    const second = await (await act('later', owner, 2)).json() as { outcome: string; plan: PreparationPlan };
    expect(second).toMatchObject({ outcome: 'moved', plan: { revision: 3 } });
    expect(second.plan.startsAt).not.toBe((first as { plan: PreparationPlan }).plan.startsAt);
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'unchanged', plan: second.plan });
    expect((await act('done')).status).toBe(409);
    expect(await (await act('later', owner, 2)).json()).toMatchObject({ outcome: 'unchanged', plan: second.plan });
    expect((await plans().doc(id).get()).data()!['revision']).toBe(3);
    expect((await act('later', owner, 99)).status).toBe(409);
    expect((await act('done', owner, 3)).status).toBe(200);
    expect(await (await act('later')).json()).toMatchObject({ outcome: 'unchanged', plan: { status: 'done', revision: 4 } });
    expect((await plans().doc(id).get()).data()!['status']).toBe('done');
  });
  it.each([['later', 'done'], ['done', 'later']])('rejects stale %s/%s action conflicts without changing the plan or calendar', async (firstAction, conflictingAction) => {
    const first = await act(firstAction!);
    expect(first.status).toBe(200);
    const result = await first.json() as PlanActionResult;
    const saved = await plans().doc(id).get();
    const calendar = await student().collection('calendarItems').get();
    expect((await act(conflictingAction!)).status).toBe(409);
    expect(await (await act(firstAction!)).json()).toEqual({ ...result, outcome: 'unchanged' });
    expect((await plans().doc(id).get()).updateTime).toEqual(saved.updateTime);
    expect((await student().collection('calendarItems').get()).docs.map(doc => doc.data())).toEqual(calendar.docs.map(doc => doc.data()));
    expect((await student().collection('planActionReceipts').get()).docs.map(doc => doc.id)).toEqual([`${id}-1-${firstAction}`]);
  });
  it('allows only one of two different concurrent actions on the same revision', async () => {
    const actions = ['done', 'later'];
    const responses = await Promise.all(actions.map(action => act(action)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex(response => response.status === 200);
    const result = await responses[winner]!.json() as PlanActionResult;
    expect(await (await act(actions[winner]!)).json()).toEqual({ ...result, outcome: 'unchanged' });
    expect((await act(actions[1 - winner]!)).status).toBe(409);
    expect((await plans().doc(id).get()).data()!['revision']).toBe(2);
    expect((await student().collection('planActionReceipts').get()).size).toBe(1);
  });
  it('creates distinct demo samples across days and completion, avoiding occupied clock intervals', async () => {
    const initial = await store.prepareDemo(owner);
    now = new Date('2030-11-12T00:00:00Z');
    await plans().doc('clock-blocker').set({ ...initial, date: '2030-11-12', period: 5,
      startsAt: '2030-11-12T10:30:00+09:00', endsAt: '2030-11-12T12:00:00+09:00' });
    const renewed = await store.prepareDemo(owner);
    expect(renewed.planId).not.toBe(initial.planId);
    expect(renewed).toMatchObject({ date: '2030-11-12', period: 3, status: 'active', revision: 1 });
    expect(await store.prepareDemo(owner)).toEqual(renewed);
    await store.act(owner, renewed.planId, 'done', renewed.revision);
    const afterDone = await store.prepareDemo(owner);
    expect(afterDone.planId).not.toBe(renewed.planId);
    expect(afterDone).toMatchObject({ date: '2030-11-12', period: 3, status: 'active', revision: 1 });
    expect((await plans().doc(initial.planId).get()).data()).toEqual(initial);
    expect((await plans().doc(renewed.planId).get()).data()).toMatchObject({ status: 'done', revision: 2 });
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

  it('keeps plan actions available without a public web origin', async () => {
    const withoutOrigin = createDigestStore(fixture.db, createDemoCalendarSync(fixture.db), undefined, () => now);
    await expect(withoutOrigin.read(owner, 'student@example.invalid')).rejects.toThrow();
    expect(await withoutOrigin.act(owner, id, 'done', 1)).toMatchObject({ outcome: 'done', plan: { status: 'done', revision: 2 } });
  });

});
