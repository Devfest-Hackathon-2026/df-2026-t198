import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHttpServer } from '../src/http.js';
import { firebaseDependencies } from '../src/firebase.js';
import { documentKey } from '../src/observations/store.js';
import { createAnnouncementStore } from '../src/announcements/store.js';
import { createRuntimeBudget } from '../src/announcements/runtime-budget.js';
import type { Announcement, AssignmentCandidate } from '../src/announcements/extract.js';
import { observation as fixtureObservation } from './observation-fixture.js';

// Demo students accept only the demo reading definition (the shared fixture uses the placeholder ID "demo").
const observation = (index = 1) => ({ ...fixtureObservation(index), definitionId: 'demo-lms' });

const enabled = process.env['RUN_ANNOUNCEMENT_EMULATOR_TESTS'] === '1';
describe.skipIf(!enabled)('announcement intake with local Auth and Firestore', () => {
  let db: ReturnType<typeof getFirestore>;
  let server: ReturnType<typeof createHttpServer>;
  let base: string;
  let analysisClock = Date.now;
  let owner: { uid: string; token: string };
  const notice = { announcementId: 'fictional-notice', version: '1', publishedAt: observation().fetchedAt,
    body: '架空のレポートの締切を2026年11月30日17時に延長します。' };
  const input = () => ({ system: 'demo-lms' as const, courseId: 'fictional/course', announcement: { ...notice } });
  const generate = vi.fn(async (a: Announcement, candidates: readonly AssignmentCandidate[]) => ({ output: {
    announcementId: a.announcementId, assignmentKey: candidates[0]!.assignmentKey,
    proposedDueAt: '2026-11-30T17:00:00+09:00', quote: a.body, reason: null,
  }, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }));
  const runtimeModel = (publicDemo: boolean) => {
    const budget = createRuntimeBudget(db, new Date(analysisClock()), publicDemo);
    return { async generate(a: Announcement, candidates: readonly AssignmentCandidate[]) {
      await budget.reserve(200, 100);
      const result = await generate(a, candidates);
      await budget.settle(result.usage);
      return result;
    } };
  };
  async function account(demo = true) {
    const result = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    if (!result.ok) throw new Error('emulator-signup-failed');
    const data = await result.json() as { localId: string; idToken: string };
    if (demo) await db.doc(`demoAccounts/${data.localId}`).set({ role: 'student', studentId: data.localId });
    return { uid: data.localId, token: data.idToken };
  }
  beforeAll(async () => {
    for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      if (!/^127\.0\.0\.1:\d+$/.test(process.env[name] ?? '')) throw new Error('local-emulators-required');
    }
    if (process.env['GCLOUD_PROJECT'] !== 'demo-kadai-hisho') throw new Error('demo-project-required');
    initializeApp({ projectId: 'demo-kadai-hisho' }); db = getFirestore();
    server = createHttpServer({ ...firebaseDependencies(), announcements: createAnnouncementStore(db, runtimeModel) });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing-port');
    base = `http://127.0.0.1:${address.port}/api/v1`;
    owner = await account();
    expect((await post('observations', observation())).status).toBe(200);
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (db) await db.terminate();
    await Promise.all(getApps().map(app => deleteApp(app)));
  });
  function post(path: string, body: unknown, token = owner.token, type = 'application/json') {
    return fetch(`${base}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      body: JSON.stringify(body) });
  }
  const assignment = (uid = owner.uid, sourceId = 'fictional/task') =>
    db.doc(`students/${uid}/assignments/${documentKey('demo-lms', sourceId)}`);

  it('adds only a review reason, deduplicates concurrent retries and survives a store restart', async () => {
    const before = (await assignment().get()).data()!;
    const results = await Promise.all([post('announcements', input()), post('announcements', input())]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const bodies = await Promise.all(results.map(async r => await r.json() as { status: string }));
    expect(bodies.map(r => r.status).sort()).toEqual(['duplicate', 'proposal']);
    expect(generate).toHaveBeenCalledTimes(1);
    const after = (await assignment().get()).data()!;
    expect(after).toEqual({ ...before, reviewReasons: [{ kind: 'conflicting-deadline',
      detail: 'fictional-notice (1): 2026-11-30T17:00:00+09:00' }] });
    const updated = (await assignment().get()).updateTime;
    const restarted = createAnnouncementStore(db, { generate });
    expect(await restarted(owner.uid, input())).toEqual({ status: 'duplicate', changed: false });
    expect((await assignment().get()).updateTime).toEqual(updated);
    const receipts = await db.collection(`students/${owner.uid}/announcementReceipts`).get();
    expect(receipts.size).toBe(1);
    expect(receipts.docs[0]!.data()).toEqual({ status: 'proposal', changed: true });
    expect(JSON.stringify(after)).not.toContain(notice.body);
    const nextVersion = input(); nextVersion.announcement.version = '2';
    expect((await post('announcements', nextVersion)).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    // A subsequent LMS observation must retain the announcement review.
    expect((await post('observations', observation(2))).status).toBe(200);
    expect((await assignment().get()).data()!['reviewReasons']).toHaveLength(2);
  });

  it('derives candidates from the owner/course only and rejects real sources and non-demo accounts', async () => {
    const other = await account();
    expect((await post('observations', observation(), other.token)).status).toBe(200);
    const foreign = observation(3);
    foreign.assignments[0]!.sourceId = 'other-task'; foreign.assignments[0]!.courseId = 'other-course';
    foreign.catalogCourses[0]!.courseId = 'other-course';
    foreign.courseResults[0] = { courseId: 'other-course', listComplete: true, seenSourceIds: ['other-task'] };
    expect((await post('observations', foreign)).status).toBe(200);
    const before = generate.mock.calls.length;
    expect((await post('announcements', { ...input(), system: 'ynu-lms' })).status).toBe(403);
    const real = await account(false);
    expect((await post('announcements', input(), real.token)).status).toBe(403);
    await db.doc(`demoAccounts/${real.uid}`).set({ role: 'supporter', studentId: owner.uid });
    expect((await post('announcements', input(), real.token)).status).toBe(403);
    expect(generate).toHaveBeenCalledTimes(before);
    expect((await post('announcements', input(), other.token)).status).toBe(200);
    expect(generate.mock.calls.at(-1)![1].map(c => c.assignmentKey)).toEqual(['["demo-lms","fictional/task"]']);
    const foreignBefore = (await assignment(owner.uid, 'other-task').get()).data();
    expect(foreignBefore!['reviewReasons']).toEqual([]);
    expect((await assignment(other.uid).get()).data()!['reviewReasons']).toHaveLength(1);
  });

  it('allows observations during a slow/failed model call and merges only into the latest assignment', async () => {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    generate.mockImplementationOnce(async () => { started(); await gate; throw new Error('private-provider-response'); });
    const request = input(); request.announcement.announcementId = 'slow-failure';
    const pending = post('announcements', request);
    await ready;
    const changed = observation(4); changed.assignments[0]!.title = '更新後の架空の課題';
    const observed = await post('observations', changed);
    expect(observed.status).toBe(200);
    release();
    expect(await (await pending).json()).toEqual({ status: 'model-error', changed: false });
    const count = generate.mock.calls.length;
    expect(await (await post('announcements', request)).json()).toEqual({ status: 'duplicate', changed: false });
    expect(generate).toHaveBeenCalledTimes(count);
    const afterFailure = (await assignment().get()).data()!;
    expect(afterFailure['latest'].title).toBe('更新後の架空の課題');
    generate.mockImplementationOnce(async (a, candidates) => {
      const update = observation(5); update.assignments[0]!.submission = 'submitted';
      expect((await post('observations', update)).status).toBe(200);
      return { output: { announcementId: a.announcementId, assignmentKey: candidates[0]!.assignmentKey,
        proposedDueAt: '2026-11-30T17:00:00+09:00', quote: a.body, reason: null },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
    });
    request.announcement.announcementId = 'concurrent-observation';
    expect(await (await post('announcements', request)).json()).toEqual({ status: 'proposal', changed: true });
    const latest = (await assignment().get()).data()!;
    expect(latest['submission']).toBe('submitted');
    expect(latest['officialDeadline'].observationId).toBe(observation(5).observationId);
    expect(latest['reviewReasons']).toHaveLength(3);
  });

  it('rejects credentials, unknown ownership fields, malformed input and invalid tokens without echoing them', async () => {
    const before = generate.mock.calls.length;
    for (const body of [{ ...input(), public: true }, { ...input(), uid: 'another-student' }, { ...input(), system: ['demo-lms'] },
      { ...input(), announcement: { ...notice, extra: true } },
      { ...input(), announcement: { ...notice, body: 'Cookie: synthetic-marker' } },
      { ...input(), announcement: { ...notice, publishedAt: '2026-02-30T12:00:00Z' } }]) {
      const response = await post('announcements', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid-announcement' });
    }
    expect((await post('announcements', input(), 'invalid-emulator-credential')).status).toBe(401);
    expect((await post('announcements', input(), owner.token, 'text/plain')).status).toBe(415);
    expect((await post('announcements', { ...input(), padding: 'x'.repeat(65536) })).status).toBe(413);
    expect(generate).toHaveBeenCalledTimes(before);
  });

  it('discards out-of-course model keys and never adds a conflict for the current official instant', async () => {
    const before = (await assignment().get()).data()!;
    const request = input(); request.announcement.announcementId = 'foreign-output';
    generate.mockImplementationOnce(async a => ({ output: { announcementId: a.announcementId,
      assignmentKey: '["demo-lms","other-task"]', proposedDueAt: '2026-11-30T17:00:00+09:00', quote: a.body, reason: null },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }));
    expect(await (await post('announcements', request)).json()).toEqual({ status: 'invalid-output', changed: false });
    expect((await assignment().get()).data()).toEqual(before);
    const aligned = observation(6);
    aligned.assignments[0]!.deadline = { kind: 'datetime', dueAt: '2026-11-30T08:00:00Z',
      dueText: '11月30日17時（日本時間）', timeZone: 'Asia/Tokyo' };
    expect((await post('observations', aligned)).status).toBe(200);
    const alignedBefore = (await assignment().get()).data();
    request.announcement.announcementId = 'aligned-output';
    expect(await (await post('announcements', request)).json()).toEqual({ status: 'proposal', changed: false });
    expect((await assignment().get()).data()).toEqual(alignedBefore);
    for (const collection of ['assignments', 'announcementReceipts', 'changes']) {
      const rows = await db.collection(`students/${owner.uid}/${collection}`).get();
      const stored = JSON.stringify(rows.docs.map(row => row.data()));
      expect(stored).not.toContain(notice.body);
      expect(stored).not.toContain('private-provider-response');
    }
  });

  it('reserves and settles public analyses separately, keeps trials available and restores both budgets at JST midnight', async () => {
    const shared = await account();
    await db.doc(`demoAccounts/${shared.uid}`).update({ public: true });
    expect((await post('observations', observation(), shared.token)).status).toBe(200);
    let now = Date.parse('2026-11-08T14:59:59Z');
    analysisClock = () => now;
    const stores = [createAnnouncementStore(db, runtimeModel), createAnnouncementStore(db, runtimeModel)];
    const request = (id: string) => ({ ...input(), announcement: { ...notice, announcementId: id } });
    const publicRef = db.doc('publicAnnouncementUsage/2026-11-08');
    const standardRef = db.doc('announcementUsage/2026-11-08');
    const standardBefore = (await standardRef.get()).data();
    const count = generate.mock.calls.length;
    // Calls are informative only: more than ten analyses remain available.
    for (let i = 1; i <= 12; i++) await stores[0]!(shared.uid, request(`public-${i}`));
    expect(generate).toHaveBeenCalledTimes(count + 12);
    expect((await publicRef.get()).data()!['calls']).toBe(12);
    expect((await publicRef.get()).data()!['yen']).toBeCloseTo(1.26);
    expect((await standardRef.get()).data()).toEqual(standardBefore);
    expect(await stores[1]!(shared.uid, request('public-1'))).toEqual({ status: 'duplicate', changed: false });
    const invalid = request('invalid'); invalid.announcement.body = '';
    expect(await stores[0]!(shared.uid, invalid)).toEqual({ status: 'invalid-input', changed: false });
    expect((await publicRef.get()).data()!['calls']).toBe(12);
    // A failed call keeps its full reservation and is never sent again.
    generate.mockRejectedValueOnce(new Error('private-provider-response'));
    expect(await stores[0]!(shared.uid, request('failed'))).toEqual({ status: 'model-error', changed: false });
    expect((await publicRef.get()).data()!['yen']).toBeCloseTo(1.47);
    expect(await stores[1]!(shared.uid, request('failed'))).toEqual({ status: 'duplicate', changed: false });
    await publicRef.set({ yen: 2999.75, calls: 13 });
    const race = await Promise.allSettled(stores.map((store, i) => store(shared.uid, request(`race-${i}`))));
    expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(count + 14);
    // The last settled cost still leaves too little for the next full reservation.
    const exhausted = (await publicRef.get()).data();
    expect(exhausted!['yen']).toBeCloseTo(2999.855);
    expect(exhausted!['calls']).toBe(14);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await post('announcements', request('http-limit'), shared.token);
      expect(response.status).toBe(429);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'public-demo-limit' });
    }
    const { createDemoStore } = await import('../src/demo/store.js');
    const { initialDemo } = await import('../src/demo/initial.js');
    await db.doc(`students/${shared.uid}/demo/current`).set(initialDemo(now).data);
    const demo = createDemoStore(db, () => now);
    const reset = await demo.reset(shared.uid, false);
    const task = reset.data.courses[0]!.assignments[0]!;
    await demo.extend(shared.uid, task.sourceId, task.dueAt);
    expect((await post('observations', observation(), shared.token)).status).toBe(200);
    await expect(stores[0]!(shared.uid, request('after-reset'))).rejects.toThrow('public-demo-limit');
    expect((await publicRef.get()).data()).toEqual(exhausted);
    const trial = await account();
    expect((await post('observations', observation(), trial.token)).status).toBe(200);
    expect(await stores[0]!(trial.uid, request('trial'))).toEqual({ status: 'proposal', changed: true });
    expect((await standardRef.get()).data()!['yen']).toBeCloseTo((standardBefore?.['yen'] ?? 0) + 0.105);
    expect((await publicRef.get()).data()).toEqual(exhausted);
    // Conversely, an exhausted standard budget does not block a public analysis.
    await standardRef.set({ yen: 10000, calls: 1 });
    await publicRef.set({ yen: 1, calls: 14 });
    expect((await stores[0]!(trial.uid, request('standard-limit'))).status).toBe('budget-limit');
    expect((await stores[1]!(shared.uid, request('public-independent'))).status).toBe('proposal');
    await publicRef.set(exhausted!);
    now += 1000; // Midnight in Japan, still the same UTC day.
    // The same previously refused public notice can be read tomorrow.
    expect((await stores[1]!(shared.uid, request('http-limit'))).status).toBe('proposal');
    expect((await stores[0]!(trial.uid, request('trial-next-day'))).status).toBe('proposal');
    expect((await publicRef.get()).data()).toEqual(exhausted);
    expect((await standardRef.get()).data()).toEqual({ yen: 10000, calls: 1 });
    for (const collection of ['publicAnnouncementUsage', 'announcementUsage']) {
      const next = (await db.doc(`${collection}/2026-11-09`).get()).data();
      expect(next!['calls']).toBe(1);
      expect(next!['yen']).toBeCloseTo(0.105);
    }
    expect((await db.collection(`students/${shared.uid}/publicDemoUsage`).get()).empty).toBe(true);
    analysisClock = Date.now;
  });

  it.each([false, true])('reserves atomically, settles and keeps unknown usage (public=%s)', async publicDemo => {
    const now = new Date('2026-11-06T10:00:00+09:00');
    const ref = db.doc(`${publicDemo ? 'publicAnnouncementUsage' : 'announcementUsage'}/2026-11-06`);
    const limit = publicDemo ? 3000 : 10000;
    await ref.set({ yen: limit - 0.06, calls: 1 }); // One 0.045-yen reservation fits; two do not.
    const budgets = [createRuntimeBudget(db, now, publicDemo), createRuntimeBudget(db, now, publicDemo)];
    const results = await Promise.allSettled(budgets.map(b => b.reserve(100, 10)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const index = results.findIndex(r => r.status === 'fulfilled');
    const reserved = (await ref.get()).data()!['yen'];
    expect(reserved).toBeLessThanOrEqual(limit);
    await expect(budgets[index]!.settle({ inputTokens: 101, outputTokens: 0, totalTokens: 101 })).rejects.toThrow('budget-usage-invalid');
    expect((await ref.get()).data()!['yen']).toBe(reserved);
    await budgets[index]!.settle({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect((await ref.get()).data()!['yen']).toBeLessThan(reserved);
    await expect(createRuntimeBudget(db, now, publicDemo).reserve(60_000, 1)).rejects.toThrow('budget-limit');
    await ref.set({ yen: limit - 0.03, calls: 1 });
    await createRuntimeBudget(db, now, publicDemo).reserve(100, 0);
    expect((await ref.get()).data()!['yen']).toBe(limit);
    await expect(createRuntimeBudget(db, now, publicDemo).reserve(1, 0))
      .rejects.toThrow(publicDemo ? 'public-demo-limit' : 'budget-limit');
  });
});
