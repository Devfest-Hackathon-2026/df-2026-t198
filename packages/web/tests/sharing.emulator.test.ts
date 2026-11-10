import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, doc, getDocFromServer, getDocsFromServer, collection, setDoc, terminate, setLogLevel } from 'firebase/firestore';
import { firebaseSessionSource } from '../src/features/session/firebase';
import { watchSession, type SessionState } from '../src/features/session/watch';
import { initialDemo } from '../../server/src/demo/initial';

describe.skipIf(process.env['RUN_SHARING_EMULATOR_TESTS'] !== '1')('student-controlled sharing with real Auth, transactions and Firestore rules', () => {
  let fixture: Awaited<ReturnType<typeof import('../../server/tests/session-emulator-fixture').sessionEmulatorFixture>>;
  let student: { uid: string; token: string };
  let other: typeof student;
  let supporter: typeof student;
  let demo: typeof student;
  let demoSupporter: typeof student;
  let publicStudent: typeof student;
  let publicSupporter: typeof student;
  const app = initializeApp({ projectId: 'demo-kadai-hisho', apiKey: 'emulator-only' }, 'sharing-supporter');
  const db = getFirestore(app);
  const ownerApp = initializeApp({ projectId: 'demo-kadai-hisho', apiKey: 'emulator-only' }, 'sharing-owner');
  const ownerDb = getFirestore(ownerApp);
  const grant = { scopes: ['all'], revokedAt: null, audit: 'preserve-me' };
  const context = { lastSessionAt: null, nextSessionAt: null };
  async function account(uid: string, displayName?: string) {
    await fixture.auth.createUser({ uid, ...(displayName ? { displayName } : {}) });
    const response = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-only`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: await fixture.auth.createCustomToken(uid), returnSecureToken: true }),
    });
    if (!response.ok) throw new Error('emulator-signin-failed');
    return { uid, token: ((await response.json()) as { idToken: string }).idToken };
  }
  const grantRef = (uid = student.uid, sid = supporter.uid) => fixture.db.doc(`students/${uid}/supporters/${sid}`);
  const request = (owner: typeof student, path: string, method = 'POST', body?: unknown) => fetch(`${fixture.base}/api/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${owner.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const change = (owner = student, action = 'revoke', sid = supporter.uid) => request(owner, `sharing/supporters/${sid}/${action}`);
  beforeAll(async () => {
    const { sessionEmulatorFixture } = await import('../../server/tests/session-emulator-fixture');
    fixture = await sessionEmulatorFixture();
    student = await account('sharing-student'); other = await account('sharing-other');
    supporter = await account('sharing-supporter', '架空の支援担当A');
    demo = await account('sharing-demo'); demoSupporter = await account('sharing-demo-supporter');
    publicStudent = await account('sharing-public'); publicSupporter = await account('sharing-public-supporter');
    for (const [owner, helper, publicPair] of [[demo, demoSupporter, false], [publicStudent, publicSupporter, true]] as const) {
      await fixture.db.doc(`demoAccounts/${owner.uid}`).set({ role: 'student', studentId: owner.uid, public: publicPair });
      await fixture.db.doc(`demoAccounts/${helper.uid}`).set({ role: 'supporter', studentId: owner.uid, public: publicPair });
      await fixture.db.doc(`students/${owner.uid}/demo/current`).set(initialDemo(Date.now()).data);
      await grantRef(owner.uid, helper.uid).set(grant);
    }
    await grantRef().set(grant);
    for (const path of ['courses/sample', 'assignments/sample', 'plans/sample', 'manualAssignments/sample', 'changes/sample', 'fetchStates/sample']) {
      await fixture.db.doc(`students/${student.uid}/${path}`).set({ marker: 'fictional' });
    }
    await fixture.db.doc(`students/${student.uid}/sessionContext/current`).set(context);
    const [host, port] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':');
    for (const [clientApp, clientDb, uid] of [[app, db, supporter.uid], [ownerApp, ownerDb, student.uid]] as const) {
      const clientAuth = getAuth(clientApp);
      connectAuthEmulator(clientAuth, `http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}`, { disableWarnings: true });
      connectFirestoreEmulator(clientDb, host!, Number(port));
      await signInWithCustomToken(clientAuth, await fixture.auth.createCustomToken(uid));
    }
    setLogLevel('silent');
  });
  afterAll(async () => { await Promise.all([terminate(db), terminate(ownerDb)]); await Promise.all([deleteApp(app), deleteApp(ownerApp)]); await fixture?.close(); });
  it('lists only the owner’s existing supporters with a name and no email; no grant means no supporters', async () => {
    const response = await request(student, 'sharing/supporters', 'GET');
    expect(await response.json()).toEqual({ supporters: [{ uid: supporter.uid, displayName: '架空の支援担当A', revoked: false }], canManage: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await (await request(other, 'sharing/supporters', 'GET')).json()).toEqual({ supporters: [], canManage: true });
  });
  it('denies other people, missing supporters, arbitrary target fields and direct client writes', async () => {
    const before = await grantRef().get();
    for (const owner of [other, supporter]) expect((await change(owner)).status).toBe(403);
    expect((await change(student, 'restore', 'missing')).status).toBe(403);
    expect((await request(other, `sharing/supporters/${supporter.uid}/revoke?studentId=${student.uid}`)).status).toBe(403);
    expect((await request(student, `sharing/supporters/${supporter.uid}/revoke`, 'POST', { studentId: other.uid })).status).toBe(400);
    expect((await grantRef().get()).updateTime).toEqual(before.updateTime);
    for (const client of [ownerDb, db]) await expect(setDoc(doc(client, grantRef().path), grant)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('revokes concurrently once, clears the open session, denies all shared reads and supporter writes, then restores without changing scopes', async () => {
    let state: SessionState | undefined;
    const stop = watchSession(firebaseSessionSource(db), student.uid, supporter.uid, value => { state = value; });
    try {
      await expect.poll(() => state?.status).toBe('ready');
      expect((await request(supporter, `students/${student.uid}/session-context`, 'PUT', context)).status).toBe(200);
      const start = Date.now();
      expect((await Promise.all([change(), change()])).map(response => response.status)).toEqual([200, 200]);
      const revoked = await grantRef().get();
      expect(revoked.data()!['revokedAt'].toMillis()).toBeGreaterThanOrEqual(start);
      expect(revoked.data()!['scopes']).toEqual(['all']);
      expect(revoked.data()!['audit']).toBe('preserve-me');
      expect((await change()).status).toBe(200);
      expect((await grantRef().get()).updateTime).toEqual(revoked.updateTime);
      await expect.poll(() => state?.status !== 'ready').toBe(true);
      expect(state?.data.courses).toEqual([]); expect(state?.data.plans).toEqual([]); expect(state?.data.assignments).toEqual([]);
      for (const name of ['courses', 'assignments', 'plans', 'manualAssignments', 'changes', 'fetchStates']) {
        await expect(getDocFromServer(doc(db, 'students', student.uid, name, 'sample'))).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(getDocsFromServer(collection(db, 'students', student.uid, name))).rejects.toMatchObject({ code: 'permission-denied' });
      }
      await expect(getDocFromServer(doc(db, 'students', student.uid, 'sessionContext/current'))).rejects.toMatchObject({ code: 'permission-denied' });
      expect(await (await request(supporter, 'supporter/students', 'GET')).json()).toEqual({ students: [] });
      expect((await request(supporter, `students/${student.uid}/session-context`, 'PUT', context)).status).toBe(403);
      expect((await request(supporter, `students/${student.uid}/plans/00000000-0000-4000-8000-000000000000`, 'DELETE')).status).toBe(403);
      expect((await request(supporter, `students/${student.uid}/manual-assignments/00000000-0000-4000-8000-000000000000`, 'DELETE')).status).toBe(403);
      expect((await change(student, 'restore')).status).toBe(200);
      const restored = await grantRef().get();
      expect(restored.data()).toEqual(grant);
      expect((await change(student, 'restore')).status).toBe(200);
      expect((await grantRef().get()).updateTime).toEqual(restored.updateTime);
      expect((await getDocFromServer(doc(db, 'students', student.uid, 'courses/sample'))).exists()).toBe(true);
      expect(await (await request(supporter, 'supporter/students', 'GET')).json()).toEqual({ students: [{ uid: student.uid }] });
    } finally { stop(); }
  });
  it('cannot revive a missing, malformed or narrower permission', async () => {
    for (const data of [{ scopes: ['courses'], revokedAt: null }, { scopes: 'all', revokedAt: null }, { scopes: ['all'] }]) {
      const ref = grantRef(other.uid);
      await ref.set(data);
      for (const action of ['revoke', 'restore']) expect((await change(other, action)).status).toBe(403);
      expect((await ref.get()).data()).toEqual(data);
    }
  });
  it('lists multiple students for the authenticated supporter and removes only the revoked grant', async () => {
    await grantRef(other.uid).set(grant);
    const rows = async () => (await (await request(supporter, 'supporter/students', 'GET')).json()).students;
    try {
      expect(await rows()).toEqual([{ uid: other.uid }, { uid: student.uid }]);
      expect((await change(other)).status).toBe(200);
      expect(await rows()).toEqual([{ uid: student.uid }]);
      // A query cannot switch the authenticated supporter's identity.
      expect((await (await request(other, `supporter/students?supporterUid=${supporter.uid}`, 'GET')).json()).students).toEqual([]);
      await expect(getDocsFromServer(collection(db, 'students', other.uid, 'assignments'))).rejects.toMatchObject({ code: 'permission-denied' });
      expect((await getDocFromServer(doc(db, 'students', student.uid, 'courses/sample'))).exists()).toBe(true);
    } finally { await grantRef(other.uid).delete(); }
  });
  // Executable acceptance cases for the proposed contract, not implemented behavior.
  // Remove skip only after agreement on docs/records/2026-11-10-f2-plan.md and implementation.
  describe.skip('F2 display-name proposal — awaiting human agreement', () => {
    const path = () => `sharing/supporters/${supporter.uid}/display-name`;
    it('lets only the owner name an existing grant and rejects invalid input', async () => {
      const before = (await grantRef().get()).data()!;
      try {
        expect((await request(student, path(), 'PUT', { displayName: ' 架空の呼び名 ' })).status).toBe(200);
        expect((await grantRef().get()).data()!['displayName']).toBe('架空の呼び名');
        for (const owner of [other, supporter]) expect((await request(owner, path(), 'PUT', { displayName: '変更' })).status).toBe(403);
        expect((await request(student, 'sharing/supporters/missing/display-name', 'PUT', { displayName: '追加' })).status).toBe(403);
        for (const displayName of ['', ' ', 'a'.repeat(81), '\u0000', 123]) {
          expect((await request(student, path(), 'PUT', { displayName })).status).toBe(400);
        }
        expect((await request(student, path(), 'PUT', { displayName: '名前', studentId: other.uid })).status).toBe(400);
        await expect(setDoc(doc(ownerDb, grantRef().path), { ...grant, displayName: '直接入力' })).rejects.toMatchObject({ code: 'permission-denied' });
      } finally { await grantRef().set(before); }
    });
    it('returns the chosen name only to the named supporter and removes it on request', async () => {
      const before = (await grantRef().get()).data()!;
      try {
        expect((await request(student, path(), 'PUT', { displayName: '架空の呼び名' })).status).toBe(200);
        expect(await (await request(supporter, 'supporter/students', 'GET')).json()).toEqual({ students: [{ uid: student.uid, displayName: '架空の呼び名' }] });
        expect(await (await request(other, 'supporter/students', 'GET')).json()).toEqual({ students: [] });
        expect((await request(student, path(), 'PUT', { displayName: null })).status).toBe(200);
        expect(await (await request(supporter, 'supporter/students', 'GET')).json()).toEqual({ students: [{ uid: student.uid }] });
      } finally { await grantRef().set(before); }
    });
    it('deletes the chosen name on revocation and does not revive it on restoration', async () => {
      const before = (await grantRef().get()).data()!;
      try {
        expect((await request(student, path(), 'PUT', { displayName: '架空の呼び名' })).status).toBe(200);
        expect((await change()).status).toBe(200);
        expect((await getDocFromServer(doc(db, grantRef().path))).data()).not.toHaveProperty('displayName');
        expect(await (await request(supporter, 'supporter/students', 'GET')).json()).toEqual({ students: [] });
        expect((await change(student, 'restore')).status).toBe(200);
        expect(await (await request(supporter, 'supporter/students', 'GET')).json()).toEqual({ students: [{ uid: student.uid }] });
      } finally { await grantRef().set(before); }
    });
  });
  it('restores only the paired demo grant on reset and blocks shared public accounts at the API', async () => {
    expect((await change(demo, 'revoke', demoSupporter.uid)).status).toBe(200);
    // An unrelated grant does not become active through the demo reset.
    await grantRef(demo.uid, supporter.uid).set({ scopes: ['all'], revokedAt: 'past' });
    expect((await request(demo, 'demo/reset', 'POST', { onlyIfStale: false })).status).toBe(200);
    expect((await grantRef(demo.uid, demoSupporter.uid).get()).data()).toEqual(grant);
    expect((await grantRef(demo.uid, supporter.uid).get()).data()!['revokedAt']).toBe('past');
    expect((await (await request(publicStudent, 'sharing/supporters', 'GET')).json() as { canManage: boolean }).canManage).toBe(false);
    for (const action of ['revoke', 'restore']) expect((await change(publicStudent, action, publicSupporter.uid)).status).toBe(403);
    expect((await grantRef(publicStudent.uid, publicSupporter.uid).get()).data()).toEqual(grant);
  });
});
