import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, terminate } from 'firebase/firestore';
import { observation } from '../../server/tests/observation-fixture';
import { firebaseSessionSource } from '../src/features/session/firebase';
import { watchSession, type SessionState } from '../src/features/session/watch';

const enabled = process.env['RUN_SESSION_EMULATOR_TESTS'] === '1';
describe.skipIf(!enabled)('session API and Web listeners with Auth and Firestore rules', () => {
  let fixture: Awaited<ReturnType<typeof import('../../server/tests/session-emulator-fixture').sessionEmulatorFixture>>;
  const app = initializeApp({ projectId: 'demo-kadai-hisho', apiKey: 'emulator-only' }, 'session-test');
  const auth = getAuth(app);
  const db = getFirestore(app);
  let token: string;
  const grant = { scopes: ['all'], revokedAt: null };
  beforeAll(async () => {
    // Check the environment before either SDK makes a request.
    const { sessionEmulatorFixture } = await import('../../server/tests/session-emulator-fixture');
    fixture = await sessionEmulatorFixture();
    connectAuthEmulator(auth, `http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}`, { disableWarnings: true });
    const [host, port] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':');
    connectFirestoreEmulator(db, host!, Number(port));
    await fixture.auth.createUser({ uid: 'session-supporter' });
    const custom = await fixture.auth.createCustomToken('session-supporter');
    token = await (await signInWithCustomToken(auth, custom)).user.getIdToken();
    await Promise.all([
      fixture.db.doc('students/session-student-a/supporters/session-supporter').set(grant),
      fixture.db.doc('students/session-student-b/supporters/session-supporter').set({ scopes: ['all'], revokedAt: '2026-11-06T00:00:00Z' }),
      fixture.db.doc('students/session-student-c/supporters/other-supporter').set(grant),
      fixture.db.doc('students/session-malformed/supporters/session-supporter').set({ scopes: ['all'] }),
      fixture.db.doc('students/session-narrow/supporters/session-supporter').set({ scopes: ['courses'], revokedAt: null }),
      fixture.db.doc('unrelated/path/supporters/session-supporter').set(grant),
      fixture.db.doc('students/session-student-a/observationReceipts/private').set({ marker: 'must-stay-private' }),
    ]);
  });
  afterAll(async () => { await signOut(auth); await terminate(db); await deleteApp(app); await fixture?.close(); });
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const list = () => fetch(`${fixture.base}/api/v1/supporter/students`, { headers: headers() });
  const put = (student: string, body: unknown) => fetch(`${fixture.base}/api/v1/students/${student}/session-context`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(body),
  });
  const context = { lastSessionAt: '2026-11-01T10:00:00+09:00', nextSessionAt: '2026-11-13T11:00:00+09:00' };
  it('returns only active complete grants for this supporter, and only student IDs', async () => {
    expect(await (await list()).json()).toEqual({ students: [{ uid: 'session-student-a' }] });
    expect((await fetch(`${fixture.base}/api/v1/supporter/students`)).status).toBe(401);
    expect((await put('session-student-a', context)).status).toBe(200);
    expect((await fixture.db.doc('students/session-student-a/sessionContext/current').get()).data()).toEqual(context);
    for (const student of ['session-student-b', 'session-student-c', 'session-malformed', 'session-narrow']) {
      expect((await put(student, context)).status).toBe(403);
      expect((await fixture.db.doc(`students/${student}/sessionContext/current`).get()).exists).toBe(false);
    }
  });
  it('streams real ledger changes and context, then clears all data on grant revocation and rejects later writes', async () => {
    let state: SessionState | undefined;
    const stop = watchSession(firebaseSessionSource(db), 'session-student-a', 'session-supporter', next => { state = next; });
    try {
      await expect.poll(() => state?.status).toBe('ready');
      const plan = { assignment: { system: 'demo-lms', sourceId: 'fictional' }, date: '2026-11-10',
        period: 3, decidedOn: '2026-11-01', planId: 'confirmed', title: '架空の準備', timeZone: 'Asia/Tokyo', startsAt: '2026-11-10T13:00:00+09:00', endsAt: '2026-11-10T14:30:00+09:00', confirmedBy: 'session-supporter', createdByRole: 'supporter', confirmedAt: '2026-11-01T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'fictional' };
      await fixture.db.doc('students/session-student-a/plans/confirmed').set(plan);
      await expect.poll(() => state?.data.plans).toEqual([plan]);
      expect(state?.data.context).toEqual(context);
      const student = await fixture.auth.createUser({ uid: 'session-student-a' });
      const signed = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-only`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          token: await fixture.auth.createCustomToken(student.uid), returnSecureToken: true,
        }),
      });
      const studentToken = (await signed.json()).idToken;
      const response = await fetch(`${fixture.base}/api/v1/observations`, {
        method: 'POST', headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(observation(51)),
      });
      expect(response.status).toBe(200);
      await expect.poll(() => state?.data.assignments.length).toBe(1);
      await expect.poll(() => state?.data.changes.length).toBe(1);
      expect(state?.data.assignments[0]?.latest.title).toBe(observation().assignments[0]!.title);
      expect(JSON.stringify(state)).not.toContain('must-stay-private');
      await fixture.db.doc('students/session-student-a/supporters/session-supporter').update({ revokedAt: '2026-11-06T00:00:00Z' });
      await expect.poll(() => state?.status !== 'ready').toBe(true);
      expect(state?.data.assignments).toEqual([]);
      expect(state?.data.changes).toEqual([]);
      expect(state?.data.plans).toEqual([]);
      expect(state?.data.context).toEqual({ lastSessionAt: null, nextSessionAt: null });
      expect(await (await list()).json()).toEqual({ students: [] });
      expect((await put('session-student-a', { lastSessionAt: null, nextSessionAt: null })).status).toBe(403);
      expect((await fixture.db.doc('students/session-student-a/sessionContext/current').get()).data()).toEqual(context);
    } finally { stop(); }
  });
});
