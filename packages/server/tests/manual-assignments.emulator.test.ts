import type { CalendarItem, ManualAssignment, ManualAssignmentInput } from '@kadai-hisho/core';
import { createManualAssignmentStore } from '../src/manual-assignment-store.js';
import { createDemoCalendarSync } from '../src/demo-calendar.js';
import { initialDemo } from '../src/demo-initial.js';
import { documentKey, createObservationStore } from '../src/observation-store.js';
import { observation } from './observation-fixture.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';

describe.skipIf(process.env['RUN_MANUAL_EMULATOR_TESTS'] !== '1')('hand-entered assignment authority', () => {
  let fixture: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  const tokens = new Map<string, string>();
  const student = 'manual-student'; const supporter = 'manual-supporter'; const other = 'manual-other';
  const input = { title: '架空の紙のレポート', date: '2030-11-11', time: null, course: null, memo: '次の授業で配布' } satisfies ManualAssignmentInput;
  const rows = () => fixture.db.collection(`students/${student}/manualAssignments`);
  async function request(actor: string, id: string, method = 'PUT', body: unknown = input, uid = student) {
    return fetch(`${fixture.base}/api/v1/students/${uid}/manual-assignments/${id}`, { method,
      headers: { Authorization: `Bearer ${tokens.get(actor)}`, 'Content-Type': 'application/json' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) });
  }
  beforeAll(async () => {
    fixture = await sessionEmulatorFixture();
    for (const uid of [student, supporter, other, 'manual-real']) {
      await fixture.auth.createUser({ uid });
      const response = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-only`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          token: await fixture.auth.createCustomToken(uid), returnSecureToken: true,
        }),
      });
      tokens.set(uid, (await response.json() as { idToken: string }).idToken);
    }
    await fixture.db.doc(`demoAccounts/${student}`).set({ role: 'student', studentId: student });
    await fixture.db.doc(`demoAccounts/${supporter}`).set({ role: 'supporter', studentId: student });
    await fixture.db.doc(`students/${student}/supporters/${supporter}`).set({ scopes: ['all'], revokedAt: null });
  });
  afterAll(async () => { await fixture?.close(); });
  it('lets a shared supporter add once and the student remove it, never reviving a delayed create', async () => {
    const id = randomUUID();
    const response = await request(supporter, id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await rows().doc(id).get()).data()).toMatchObject({ ...input, createdBy: supporter, createdByRole: 'supporter', status: 'active', revision: 1 });
    const before = (await rows().doc(id).get()).updateTime;
    expect((await request(supporter, id)).status).toBe(200);
    expect((await rows().doc(id).get()).updateTime).toEqual(before);
    expect((await request(student, id, 'DELETE')).status).toBe(200);
    expect((await request(student, id, 'DELETE')).status).toBe(200);
    expect((await request(supporter, id)).status).toBe(409);
    expect((await rows().doc(id).get()).data()).toMatchObject({ status: 'cancelled', revision: 2 });
  });
  it('denies outsiders, revoked sharing and removing another author’s task', async () => {
    const id = randomUUID();
    expect((await request(other, id)).status).toBe(403);
    expect((await rows().doc(id).get()).exists).toBe(false);
    expect((await request(student, id)).status).toBe(200);
    expect((await request(supporter, id, 'DELETE')).status).toBe(403);
    await fixture.db.doc(`students/${student}/supporters/${supporter}`).update({ revokedAt: new Date().toISOString() });
    expect((await request(supporter, randomUUID())).status).toBe(403);
    expect((await request(student, id, 'DELETE')).status).toBe(200);
    await fixture.db.doc(`students/${student}/supporters/${supporter}`).update({ revokedAt: null });
  });
  it('validates bounded fields, author spoofing, real dates and time precision', async () => {
    for (const bad of [{ ...input, title: '' }, { ...input, title: ' '.repeat(3) }, { ...input, date: '2030-02-30' },
      { ...input, time: '24:00' }, { ...input, memo: 'x'.repeat(301) }, { ...input, title: 'x'.repeat(161) },
      { ...input, memo: 'a\nb' }, { ...input, createdBy: student }, { ...input, extra: true },
      { ...input, course: { system: 'demo-lms', courseId: 'fictional', extra: true } }]) {
      const id = randomUUID(); const response = await request(student, id, 'PUT', bad);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid-manual-assignment' });
      expect((await rows().doc(id).get()).exists).toBe(false);
    }
    expect((await request(student, 'not-a-uuid')).status).toBe(400);
    expect((await request(student, randomUUID(), 'PUT', { ...input, course: { system: 'demo-lms', courseId: 'missing' } })).status).toBe(409);
    const url = `${fixture.base}/api/v1/students/${student}/manual-assignments/${randomUUID()}`;
    expect((await fetch(url, { method: 'PUT' })).status).toBe(401);
    const headers = { Authorization: `Bearer ${tokens.get(student)}` };
    expect((await fetch(url, { method: 'PUT', headers, body: '{}' })).status).toBe(415);
    const large = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: 'body-too-large' });
  });
  it('uses the chosen course and saved mock events, keeps memos off the calendar and survives LMS observations', async () => {
    const course = { system: 'demo-lms', courseId: 'paper', name: '架空の紙の授業', slots: [{ weekday: 2, period: 2 }] };
    await fixture.db.doc(`students/${student}/courses/${documentKey(course.system, course.courseId)}`).set(course);
    const id = randomUUID();
    const response = await request(supporter, id, 'PUT', { ...input, course: { system: course.system, courseId: course.courseId }, time: '13:45' });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as ManualAssignment;
    const item = (await fixture.db.doc(`students/${student}/calendarItems/${saved.calendarItemKey}`).get()).data() as CalendarItem;
    expect(item).toMatchObject({ kind: 'manual-deadline', sourceKey: { system: 'manual', sourceId: id }, appliedRevision: 1 });
    const integration = (await fixture.db.doc(`students/${student}/integrations/calendar`).get()).data()!;
    expect(integration['mockEvents'][item.eventId].event).toMatchObject({ summary: '架空の紙の授業：架空の紙のレポート',
      start: { dateTime: '2030-11-11T13:45:00+09:00' } });
    expect(integration['mockEvents'][item.eventId].event.description).not.toContain(input.memo);
    const before = await rows().doc(id).get();
    for (const n of [981, 982]) await createObservationStore(fixture.db)(student, { ...observation(n), definitionId: 'demo-lms', assignments: [], courseResults: [] });
    expect((await rows().doc(id).get()).data()).toEqual(before.data());
    expect((await rows().doc(id).get()).updateTime).toEqual(before.updateTime);
    expect((await request(supporter, id, 'DELETE')).status).toBe(200);
    expect((await fixture.db.doc(`students/${student}/integrations/calendar`).get()).data()!['mockEvents'][item.eventId]).toBeUndefined();
  });
  it('retries an uncertain mock synchronization without duplicating a task or event', async () => {
    const id = randomUUID(); let fail = true;
    const sync = createDemoCalendarSync(fixture.db);
    const store = createManualAssignmentStore(fixture.db, async uid => { if (fail) throw new Error('synthetic-destination-failure'); await sync(uid); });
    await expect(store.save(student, student, id, input)).rejects.toThrow('synthetic-destination-failure');
    const saved = (await rows().doc(id).get()).data() as ManualAssignment;
    const ref = fixture.db.doc(`students/${student}/calendarItems/${saved.calendarItemKey}`);
    expect((await ref.get()).data()!['appliedRevision']).toBe(0);
    fail = false;
    await Promise.all([store.save(student, student, id, input), store.save(student, student, id, input)]);
    expect((await rows().doc(id).get()).data()!['revision']).toBe(1);
    const applied = (await ref.get()).data() as CalendarItem;
    expect(applied.appliedRevision).toBe(applied.desiredRevision);
    const events = (await fixture.db.doc(`students/${student}/integrations/calendar`).get()).data()!['mockEvents'];
    expect(Object.values(events).filter(event => (event as { itemKey: string }).itemKey === saved.calendarItemKey)).toHaveLength(1);
    expect((await request(student, id, 'DELETE')).status).toBe(200);
  });
  it('queues real-account deadlines for the existing extension, connects later and acknowledges removal by revision', async () => {
    const uid = 'manual-real'; const id = randomUUID();
    const response = await request(uid, id, 'PUT', input, uid);
    expect(response.status).toBe(200);
    const saved = await response.json() as ManualAssignment;
    const ref = fixture.db.doc(`students/${uid}/calendarItems/${saved.calendarItemKey}`);
    expect((await ref.get()).data()).toMatchObject({ calendarId: null, appliedRevision: 0 });
    const api = async (body?: unknown) => fetch(`${fixture.base}/api/v1/calendar-sync`, { method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${tokens.get(uid)}`, 'Content-Type': 'application/json',
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await api({ calendarId: 'manual@group.calendar.google.com' })).status).toBe(200);
    const pending = (await (await api()).json() as { items: CalendarItem[] }).items.find(item => item.itemKey === saved.calendarItemKey)!;
    expect(pending.desired).toMatchObject({ state: 'present', event: { start: { date: input.date }, end: { date: '2030-11-12' } } });
    expect((await request(uid, id, 'DELETE', undefined, uid)).status).toBe(200);
    const report = { itemKey: pending.itemKey, eventId: pending.eventId, generation: pending.generation, revision: pending.desiredRevision, errorCode: null };
    expect((await api(report)).status).toBe(200);
    expect((await ref.get()).data()!['appliedRevision']).toBe(0);
    const removed = (await ref.get()).data() as CalendarItem;
    expect((await api({ ...report, revision: removed.desiredRevision })).status).toBe(200);
    expect((await (await api()).json() as { items: CalendarItem[] }).items).toEqual([]);
  });
  it('isolates demo pairs even when a grant is present and rejects a real course for a demo student', async () => {
    await fixture.db.doc(`students/manual-real/supporters/${supporter}`).set({ scopes: ['all'], revokedAt: null });
    expect((await request(supporter, randomUUID(), 'PUT', input, 'manual-real')).status).toBe(403);
    expect((await request(student, randomUUID(), 'PUT', { ...input, course: { system: 'ynu-lms', courseId: 'fictional' } })).status).toBe(403);
  });
  it('resets only the current demo student including active and cancelled manual tasks and their mock events', async () => {
    const demo = initialDemo(Date.now());
    await fixture.db.doc(`students/${student}/demo/current`).set(demo.data);
    await fixture.db.doc(`students/${student}/sessionContext/current`).set(demo.context);
    expect((await request(student, randomUUID())).status).toBe(200);
    await fixture.db.doc(`students/${student}/plans/fictional-plan`).set({ status: 'active', title: '架空の準備' });
    await fixture.db.doc('students/manual-other/manualAssignments/untouched').set({ title: '架空の別組' });
    const reset = (token: string, onlyIfStale = false) => fetch(`${fixture.base}/api/v1/demo/reset`, { method: 'POST',
      headers: { Authorization: `Bearer ${tokens.get(token)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ onlyIfStale }) });
    expect((await reset(student, true)).status).toBe(200);
    expect((await rows().get()).empty).toBe(false);
    expect((await reset(supporter)).status).toBe(403);
    expect((await reset(student)).status).toBe(200);
    expect((await rows().get()).empty).toBe(true);
    expect((await fixture.db.collection(`students/${student}/plans`).get()).empty).toBe(true);
    expect((await fixture.db.collection(`students/${student}/calendarItems`).get()).empty).toBe(true);
    expect((await fixture.db.doc(`students/${student}/integrations/calendar`).get()).exists).toBe(false);
    expect((await fixture.db.doc('students/manual-other/manualAssignments/untouched').get()).data()).toEqual({ title: '架空の別組' });
  });

});
