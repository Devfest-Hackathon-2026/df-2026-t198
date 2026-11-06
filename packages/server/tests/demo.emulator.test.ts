import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { observation } from './observation-fixture.js';

describe.skipIf(process.env['RUN_DEMO_EMULATOR_TESTS'] !== '1')('demo API with real Auth and Firestore emulators', () => {
  let fixture: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  let student: { uid: string; token: string };
  let other: { uid: string; token: string };
  let supporter: { uid: string; token: string };
  let regular: { uid: string; token: string };
  const originalDue = '2026-11-12T08:00:00.000Z';
  const data = { courses: [{ courseId: 'DEMO101', name: '架空の観察入門', teacher: '架空の先生A', weekday: 1, period: 2,
    assignments: [{ sourceId: 'DEMO101_TASK1', title: '架空の観察ノート', dueAt: originalDue, submission: 'not-submitted' }] }] };
  async function account() {
    const result = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    if (!result.ok) throw new Error('emulator-signup-failed');
    const body = await result.json() as { localId: string; idToken: string };
    return { uid: body.localId, token: body.idToken };
  }
  beforeAll(async () => {
    fixture = await sessionEmulatorFixture();
    student = await account(); other = await account(); supporter = await account(); regular = await account();
    for (const owner of [student, other]) {
      await fixture.db.doc(`demoAccounts/${owner.uid}`).set({ role: 'student', studentId: owner.uid });
      await fixture.db.doc(`students/${owner.uid}/demo/current`).set(data);
    }
    await fixture.db.doc(`demoAccounts/${supporter.uid}`).set({ role: 'supporter', studentId: student.uid });
    await fixture.db.doc(`students/${student.uid}/supporters/${supporter.uid}`).set({ scopes: ['all'], revokedAt: null });
  });
  afterAll(async () => { await fixture?.close(); });
  const post = (path: string, body: unknown, token = student.token) => fetch(`${fixture.base}/api/v1/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const source = (uid: string) => fixture.db.doc(`students/${uid}/demo/current`);
  const extend = (due = originalDue, token = student.token) => post('demo/extend', { sourceId: 'DEMO101_TASK1', expectedDueAt: due }, token);
  async function ledger(uid: string) {
    return (await fixture.db.collection(`students/${uid}/assignments`).get()).docs.map(doc => doc.data());
  }
  it('extends only the source, once even with concurrent retries, without touching a ledger', async () => {
    const sample = observation(); sample.definitionId = 'demo-lms';
    expect((await post('observations', sample)).status).toBe(200);
    const before = await ledger(student.uid);
    const results = await Promise.all([extend(), extend()]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await source(student.uid).get()).data()!['courses'][0].assignments[0].dueAt).toBe('2026-11-13T08:00:00.000Z');
    expect((await source(other.uid).get()).data()).toEqual(data);
    expect(await ledger(student.uid)).toEqual(before);
    expect((await extend()).status).toBe(409);
    expect((await extend('2026-11-13T08:00:00.000Z')).status).toBe(200);
  });
  it('rejects a supporter and a non-demo account even when sharing is granted', async () => {
    for (const owner of [supporter, regular]) expect((await extend(originalDue, owner.token)).status).toBe(403);
    expect((await post('demo/extend', { sourceId: 'DEMO101_TASK1', expectedDueAt: originalDue, studentId: student.uid }, other.token)).status).toBe(400);
    const missing = await post('demo/extend', { sourceId: 'OTHER_TASK', expectedDueAt: originalDue }, other.token);
    expect(missing.status).toBe(403);
    expect((await source(other.uid).get()).data()).toEqual(data);
  });
  it('publishes a fictional notice only for its owner without changing source deadlines or ledgers', async () => {
    const publish = (token: string, sourceId = 'DEMO101_TASK1', expectedDueAt = originalDue) =>
      post('demo/announce', { sourceId, expectedDueAt }, token);
    const studentBefore = (await source(student.uid).get()).data();
    const ledgerBefore = await ledger(other.uid);
    for (const owner of [supporter, regular]) expect((await publish(owner.token)).status).toBe(403);
    expect((await publish(other.token, 'OTHER_TASK')).status).toBe(403);
    expect((await publish(other.token, 'DEMO101_TASK1', '2026-11-11T08:00:00.000Z')).status).toBe(409);
    expect((await publish(other.token)).status).toBe(200);
    const after = (await source(other.uid).get()).data()!;
    expect(after['courses']).toEqual(data.courses);
    expect(after['announcements']).toHaveLength(1);
    const notice = after['announcements'][0];
    expect(notice.courseId).toBe('DEMO101');
    expect(notice.announcement.body).toMatch(/^架空の観察ノートの提出期限を\d{4}-\d{2}-\d{2} 17:00/);
    expect(Date.parse(notice.announcement.publishedAt)).toBeGreaterThan(Date.now() - 60000);
    expect(await ledger(other.uid)).toEqual(ledgerBefore);
    expect((await source(student.uid).get()).data()).toEqual(studentBefore);
    expect((await publish(other.token)).status).toBe(200);
    expect((await source(other.uid).get()).data()!['announcements']).toHaveLength(1);
    expect((await post('demo/reset', { onlyIfStale: false }, other.token)).status).toBe(200);
    expect((await source(other.uid).get()).data()!['announcements']).toEqual([]);
  });
  it('refuses real-LMS observations and masquerading definitions for demo students', async () => {
    const before = await ledger(student.uid);
    for (const system of ['ynu-lms', 'panda'] as const) {
      const body = { ...observation(), observationId: randomUUID(), system };
      const response = await post('observations', body);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden' });
    }
    expect((await post('observations', observation())).status).toBe(403);
    expect(await ledger(student.uid)).toEqual(before);
  });
  it('refuses supporter and malformed demo profiles at the observation write boundary', async () => {
    const body = { ...observation(), definitionId: 'demo-lms' };
    expect((await post('observations', body, supporter.token)).status).toBe(403);
    for (const profile of [{ role: 'student', studentId: student.uid }, { role: 'student' }, {}]) {
      await fixture.db.doc(`demoAccounts/${other.uid}`).set(profile);
      expect((await post('observations', body, other.token)).status).toBe(403);
      expect((await extend(originalDue, other.token)).status).toBe(403);
    }
    expect(await ledger(other.uid)).toEqual([]);
    expect(await ledger(supporter.uid)).toEqual([]);
  });
  it('denies demo accounts at all real-calendar endpoints without changing a connection', async () => {
    for (const owner of [student, other, supporter]) {
      const connection = fixture.db.doc(`students/${owner.uid}/integrations/calendar`);
      const before = (await connection.get()).data();
      const pending = await fetch(`${fixture.base}/api/v1/calendar-sync`, { headers: { Authorization: `Bearer ${owner.token}` } });
      expect(pending.status).toBe(403);
      expect((await post('calendar-sync', { calendarId: 'fictional@group.calendar.google.com' }, owner.token)).status).toBe(403);
      expect((await post('calendar-sync', { itemKey: 'a'.repeat(64), generation: 1, revision: 1, eventId: 'abcde', errorCode: null }, owner.token)).status).toBe(403);
      expect((await connection.get()).data()).toEqual(before);
      expect((await connection.get()).data()?.['mode']).not.toBe('google');
    }
  });
  it('resets only the authenticated demo student, clears derived data, and refreshes stale dates', async () => {
    const owner = await account();
    await fixture.db.doc(`demoAccounts/${owner.uid}`).set({ role: 'student', studentId: owner.uid });
    await source(owner.uid).set(data);
    const studentRef = fixture.db.doc(`students/${owner.uid}`);
    const snapshotOther = async () => {
      const collections = await fixture.db.doc(`students/${student.uid}`).listCollections();
      return Promise.all(collections.map(async collection => ({ name: collection.id,
        documents: (await collection.get()).docs.map(doc => ({ id: doc.id, data: doc.data() })),
      })));
    };
    const beforeOther = await snapshotOther();
    const reset = (onlyIfStale: boolean, token = owner.token) => post('demo/reset', { onlyIfStale }, token);
    for (const token of [supporter.token, regular.token, other.token]) expect((await reset(false, token)).status).toBe(403);
    expect((await post('demo/reset', { onlyIfStale: false, studentId: student.uid }, owner.token)).status).toBe(400);
    const sample = { ...observation(), observationId: randomUUID(), definitionId: 'demo-lms' };
    expect((await post('observations', sample, owner.token)).status).toBe(200);
    const names = ['assignments', 'courses', 'changes', 'fetchStates', 'observationReceipts', 'calendarItems'];
    for (const name of names) expect((await studentRef.collection(name).get()).size).toBeGreaterThan(0);
    const sharing = studentRef.collection('supporters').doc(supporter.uid);
    await sharing.set({ scopes: ['all'], revokedAt: null });
    const start = Date.now();
    const response = await reset(false);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { reset: boolean }).reset).toBe(true);
    for (const name of names) expect((await studentRef.collection(name).get()).size).toBe(0);
    const calendar = studentRef.collection('integrations').doc('calendar');
    expect((await calendar.get()).exists).toBe(false);
    expect((await sharing.get()).data()).toEqual({ scopes: ['all'], revokedAt: null });
    expect(await snapshotOther()).toEqual(beforeOther);
    const initial = (await source(owner.uid).get()).data()!;
    expect(initial['courses'][0].assignments.map((item: { submission: string }) => item.submission)).toEqual(['not-submitted', 'submitted']);
    const due = new Date(start + 3 * 86400_000); due.setUTCHours(8, 0, 0, 0);
    expect(initial['courses'][0].assignments[0].dueAt).toBe(due.toISOString());
    const contextRef = studentRef.collection('sessionContext').doc('current');
    const context = (await contextRef.get()).data()!;
    expect(Date.parse(context['nextSessionAt']) - start).toBeGreaterThanOrEqual(7 * 86400_000);
    expect(Date.parse(context['lastSessionAt']) - start).toBeLessThan(-6 * 86400_000);
    // Re-login while fresh must preserve the ongoing scenario and its ledger.
    expect((await post('observations', sample, owner.token)).status).toBe(200);
    const changesBefore = (await studentRef.collection('changes').get()).docs.map(doc => doc.data());
    expect(((await (await reset(true)).json()) as { reset: boolean }).reset).toBe(false);
    expect((await studentRef.collection('changes').get()).docs.map(doc => doc.data())).toEqual(changesBefore);
    // An expired source deadline and an expired next session each trigger a fresh start.
    initial['courses'][0].assignments[0].dueAt = '2000-01-01T08:00:00.000Z';
    await source(owner.uid).set(initial);
    expect(((await (await reset(true)).json()) as { reset: boolean }).reset).toBe(true);
    expect((await ledger(owner.uid))).toEqual([]);
    await contextRef.update({ nextSessionAt: '2000-01-01T08:00:00.000Z' });
    expect(((await (await reset(true)).json()) as { reset: boolean }).reset).toBe(true);
    // A misconfigured real calendar is never erased, even on a demo profile.
    await calendar.set({ mode: 'google', executor: 'extension' });
    const before = (await source(owner.uid).get()).data();
    expect((await reset(false)).status).toBe(403);
    expect((await source(owner.uid).get()).data()).toEqual(before);
    expect((await calendar.get()).data()).toEqual({ mode: 'google', executor: 'extension' });
  });
  it('preserves observation handling for ordinary users and verifies disabled accounts', async () => {
    expect((await post('observations', { ...observation(), system: 'ynu-lms' }, regular.token)).status).toBe(200);
    await fixture.auth.updateUser(student.uid, { disabled: true });
    expect((await extend()).status).toBe(401);
  });
});
