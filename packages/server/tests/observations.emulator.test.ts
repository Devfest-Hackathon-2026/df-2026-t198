import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Observation } from '@kadai-hisho/core/ledger';
import { createHttpServer } from '../src/http.js';
import { firebaseDependencies } from '../src/firebase.js';
import { documentKey } from '../src/observation-store.js';
import { observation } from './observation-fixture.js';

const enabled = process.env['RUN_OBSERVATION_EMULATOR_TESTS'] === '1';
describe.skipIf(!enabled)('observation API with Auth and Firestore emulators', () => {
  let server: ReturnType<typeof createHttpServer>;
  let db: ReturnType<typeof getFirestore>;
  let base: string;
  let owner: { uid: string; token: string };
  let other: { uid: string; token: string };
  async function account() {
    const result = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    if (!result.ok) throw new Error('emulator-signup-failed');
    const data = await result.json() as { localId: string; idToken: string };
    return { uid: data.localId, token: data.idToken };
  }
  beforeAll(async () => {
    // Fail closed before SDK initialization: this suite must never reach a real project.
    for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      if (!/^127\.0\.0\.1:\d+$/.test(process.env[name] ?? '')) throw new Error('local-emulators-required');
    }
    if (process.env['GCLOUD_PROJECT'] !== 'demo-kadai-hisho') throw new Error('demo-project-required');
    initializeApp({ projectId: 'demo-kadai-hisho' });
    db = getFirestore();
    server = createHttpServer(firebaseDependencies());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing-port');
    base = `http://127.0.0.1:${address.port}/api/v1/observations`;
    owner = await account(); other = await account();
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (db) await db.terminate();
    await Promise.all(getApps().map(app => deleteApp(app)));
  });
  function post(body: unknown, token = owner.token) {
    return fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function assignment(uid = owner.uid) {
    return db.doc(`students/${uid}/assignments/${documentKey('demo-lms', 'fictional/task')}`).get();
  }
  async function apply(body: Observation) {
    const result = await post(body);
    expect(result.status).toBe(200);
    return result.json();
  }
  function missing(n: number, complete = true): Observation {
    return { ...observation(n), assignments: [], courseResults: [
      { courseId: 'fictional/course', listComplete: complete, seenSourceIds: [] },
    ] };
  }
  async function snapshot() {
    const data: Record<string, unknown> = {};
    for (const collection of ['assignments', 'changes', 'observationReceipts', 'courses', 'fetchStates']) {
      const rows = await db.collection(`students/${owner.uid}/${collection}`).get();
      data[collection] = rows.docs.map(doc => ({ id: doc.id, data: doc.data(), updated: doc.updateTime.toMillis() }));
    }
    return data;
  }

  it('persists new, changed, missing, restored and detail-failed observations atomically', async () => {
    expect(await apply(observation(1))).toEqual({ status: 'applied', changed: true, changeCount: 1 });
    expect((await assignment()).data()).toMatchObject({ presenceState: 'active', submission: 'not-submitted' });
    const updated = observation(2);
    updated.assignments[0]!.title = '変更した架空の課題';
    updated.assignments[0]!.deadline = { kind: 'datetime', dueAt: '2026-11-15T12:00:00+09:00',
      dueText: '11月15日12時', timeZone: 'Asia/Tokyo' };
    updated.assignments[0]!.submission = 'submitted';
    expect(await apply(updated)).toMatchObject({ changeCount: 3 });
    await apply(missing(3));
    expect((await assignment()).data()).toMatchObject({ presenceState: 'cancellation-candidate', consecutiveMissingCount: 1 });
    const beforeReplay = await snapshot();
    await apply(missing(3));
    expect(await snapshot()).toEqual(beforeReplay);
    await apply(missing(4, false));
    expect((await assignment()).data()).toMatchObject({ consecutiveMissingCount: 1 });
    await apply(missing(5));
    expect((await assignment()).data()).toMatchObject({ presenceState: 'cancelled', submission: 'submitted' });
    const detailFailed: Observation = { ...observation(6), assignments: [], failures: [
      { courseId: 'fictional/course', kind: 'parse', detail: 'detail-unavailable' },
    ] };
    detailFailed.fetchedAt = '2026-11-06T10:10:00+09:00';
    await apply(detailFailed);
    expect((await assignment()).data()).toMatchObject({ presenceState: 'active', consecutiveMissingCount: 0,
      submission: 'submitted', lastSeenObservationId: detailFailed.observationId });
    const fetchState = (await db.doc(`students/${owner.uid}/fetchStates/demo-lms`).get()).data();
    expect(fetchState).toMatchObject({ lastResult: 'partial', lastAttemptedAt: detailFailed.fetchedAt,
      lastSucceededAt: observation().fetchedAt });
    const changes = await db.collection(`students/${owner.uid}/changes`).get();
    expect(changes.docs.map(doc => doc.data()['kind']).sort()).toEqual([
      'new', 'title-changed', 'deadline-changed', 'submitted', 'cancellation-candidate', 'cancelled', 'restored',
    ].sort());
    expect((await assignment()).data()).not.toHaveProperty('history');
    expect((await db.doc(`students/${owner.uid}/observationReceipts/${detailFailed.observationId}`).get()).data())
      .toEqual({ observationId: detailFailed.observationId, result: { status: 'applied', changed: true, changeCount: 1 } });
  });

  it('persists the course URL and removes it when the next observation omits it', async () => {
    const courseOwner = await account();
    const body = observation(40);
    body.catalogCourses[0]!.url = 'https://example.invalid/course?id=fictional';
    expect((await post(body, courseOwner.token)).status).toBe(200);
    const ref = db.doc(`students/${courseOwner.uid}/courses/${documentKey(body.system, body.catalogCourses[0]!.courseId)}`);
    expect((await ref.get()).data()).toMatchObject({ url: body.catalogCourses[0]!.url });
    const unsafe = observation(41);
    unsafe.catalogCourses[0]!.url = 'https://example.invalid/course;SID=synthetic-marker';
    const before = (await ref.get()).data();
    expect((await post(unsafe, courseOwner.token)).status).toBe(400);
    expect((await ref.get()).data()).toEqual(before);
    expect((await post(observation(42), courseOwner.token)).status).toBe(200);
    expect((await ref.get()).data()).not.toHaveProperty('url');
  });

  it('completes ended-only and out-of-term courses without cancellations and removes their deadline targets', async () => {
    const accountOwner = await account();
    const student = db.collection('students').doc(accountOwner.uid);
    const send = async (body: Observation) => expect((await post(body, accountOwner.token)).status).toBe(200);
    const taskRef = student.collection('assignments').doc(documentKey('demo-lms', 'fictional/task'));
    const calendarRef = student.collection('calendarItems').doc(documentKey('demo-lms', 'fictional/task'));
    await send(observation(50));
    expect((await calendarRef.get()).data()!['desired']['state']).toBe('present');
    const ended: Observation = { ...observation(51), assignments: [], courseResults: [{ courseId: 'fictional/course',
      listComplete: true, seenSourceIds: ['fictional/task', 'never-imported'], endedSourceIds: ['fictional/task', 'never-imported'] }] };
    await send(ended);
    expect((await taskRef.get()).data()).toMatchObject({ presenceState: 'ended', consecutiveMissingCount: 0 });
    expect((await student.collection('assignments').get()).size).toBe(1);
    expect((await calendarRef.get()).data()!['desired']).toEqual({ state: 'deleted' });
    expect((await student.collection('fetchStates').doc('demo-lms').get()).data()).toMatchObject({
      lastResult: 'success', lastSucceededAt: ended.fetchedAt,
    });
    const changes = await student.collection('changes').get();
    expect(changes.docs.map(doc => doc.data()['kind']).sort()).toEqual(['ended', 'new']);
    const before = (await taskRef.get()).updateTime;
    await send(ended);
    expect((await taskRef.get()).updateTime).toEqual(before);
    await send(observation(52));
    const past: Observation = { ...observation(53), assignments: [], courseResults: [],
      catalogCourses: [{ ...observation(53).catalogCourses[0]!, currentTerm: false }] };
    await send(past);
    expect((await taskRef.get()).data()).toMatchObject({ presenceState: 'ended', consecutiveMissingCount: 0 });
    expect((await student.collection('fetchStates').doc('demo-lms').get()).data()!['lastResult']).toBe('success');
    expect((await student.collection('courses').get()).docs[0]!.data()['currentTerm']).toBe(false);
  });

  it('serializes concurrent retries and keeps different users separate', async () => {
    const body = observation(20);
    const results = await Promise.all([post(body, other.token), post(body, other.token)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const changes = await db.collection(`students/${other.uid}/changes`).get();
    expect(changes.size).toBe(1);
    expect((await assignment(other.uid)).data()).toMatchObject({ submission: 'not-submitted' });
    expect((await assignment(owner.uid)).data()).toMatchObject({ submission: 'submitted' });
    const before = await snapshot();
    expect((await post({ ...observation(21), uid: other.uid })).status).toBe(400);
    expect((await post(observation(21), 'invalid-emulator-credential')).status).toBe(401);
    const unsafe = observation(21);
    unsafe.assignments[0]!.url += ';SID=synthetic-marker';
    expect((await post(unsafe)).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it('returns the first receipt even if a reused ID has a different payload (Issue #16 scope)', async () => {
    const before = await snapshot();
    const reused = observation(1); reused.assignments[0]!.title = '再利用したIDの異なる題名';
    expect(await apply(reused)).toEqual({ status: 'applied', changed: true, changeCount: 1 });
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a token after the emulator account has been disabled', async () => {
    await getAuth().updateUser(other.uid, { disabled: true });
    const before = (await assignment(other.uid)).data();
    expect((await post(missing(30), other.token)).status).toBe(401);
    expect((await assignment(other.uid)).data()).toEqual(before);
  });
});
