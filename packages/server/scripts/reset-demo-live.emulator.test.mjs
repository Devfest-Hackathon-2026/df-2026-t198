import process from 'node:process';
import { afterAll, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resetDemoPairs } from './reset-demo-live.mjs';
import { createDemoStore } from '../src/demo/store.js';
import { initialDemo } from '../src/demo/initial.js';

const enabled = process.env.RUN_DEMO_EMULATOR_TESTS === '1';
let app;
let db;
afterAll(async () => { if (db) await db.terminate(); if (app) await deleteApp(app); });
it.runIf(enabled)('uses the app reset on four emulator pairs while retaining sharing and unrelated students', async () => {
  if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('local-emulator-required');
  app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'reset-demo-pairs-test');
  db = getFirestore(app);
  const pairs = ['trial-1', 'trial-2', 'trial-3', 'public-1'];
  const now = Date.parse('2026-11-09T09:00:00+09:00');
  const refs = [];
  try {
    for (const pair of pairs) {
      for (const role of ['student', 'supporter']) {
        const ref = db.doc(`demoAccounts/${pair}-${role}`);
        refs.push(ref);
        await ref.set({ role, studentId: `${pair}-student`, ...(pair === 'public-1' ? { public: true } : {}) });
      }
      const owner = db.doc(`students/${pair}-student`);
      refs.push(owner);
      const previous = initialDemo(now - 86400_000).data;
      previous.courses[0].name = '変更済みの体験授業';
      await owner.collection('demo').doc('current').set(previous);
      await owner.collection('plans').doc('old').set({ title: '消える準備' });
      await owner.collection('supporters').doc(`${pair}-supporter`).set({ scopes: ['all'], revokedAt: null });
    }
    const other = db.doc('students/reset-test-unrelated/demo/current');
    refs.push(other);
    await other.set({ protected: true });
    const reports = [];
    const options = { db, reset: createDemoStore(db, () => now).reset, report: value => reports.push(value) };
    await resetDemoPairs({ ...options, dryRun: true });
    expect(reports).toEqual([4]);
    expect((await db.doc('students/trial-1-student/demo/current').get()).data().courses[0].name).toBe('変更済みの体験授業');
    await resetDemoPairs({ ...options, dryRun: false });
    for (const pair of pairs) {
      const owner = db.doc(`students/${pair}-student`);
      const data = (await owner.collection('demo').doc('current').get()).data();
      expect(data.courses.map(course => course.name)).toEqual([
        '文章表現', '生物学実験', '線形代数', '経済学入門', '社会調査法', '統計学入門',
      ]);
      expect(data.courses[0].assignments[0]).toEqual({ sourceId: 'DEMO101_TASK1',
        title: '第3回レポート（要約と引用）', dueAt: '2026-11-12T08:00:00.000Z', submission: 'not-submitted' });
      expect(data.courses.flatMap(course => course.assignments).filter(task => task.submission === 'submitted')).toHaveLength(2);
      expect((await owner.collection('plans').get()).empty).toBe(true);
      expect((await owner.collection('supporters').doc(`${pair}-supporter`).get()).data()).toEqual({ scopes: ['all'], revokedAt: null });
    }
    expect((await other.get()).data()).toEqual({ protected: true });
    expect(reports.at(-1)).toBe('reset-completed: 4');
  } finally { for (const ref of refs) await db.recursiveDelete(ref); }
});
