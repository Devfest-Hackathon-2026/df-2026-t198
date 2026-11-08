import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { log } from 'node:console';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createObservationStore, documentKey } from '../dist/observations/store.js';

// This helper refuses real projects and never emits credentials or account tokens.
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.SESSION_DEMO_PASSWORD || process.env.SESSION_DEMO_PASSWORD.length < 8) {
  throw new Error('local-emulators-and-demo-password-required');
}
const app = initializeApp({ projectId: 'demo-kadai-hisho' });
const db = getFirestore(app);
try {
  const auth = getAuth(app);
  for (const uid of ['demo-supporter', 'demo-student-a', 'demo-student-b']) {
    try { await auth.getUser(uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw new Error('demo-user-lookup-failed', { cause: error });
      await auth.createUser({ uid, email: `${uid}@example.invalid`, password: process.env.SESSION_DEMO_PASSWORD }); }
  }
  const at = new Date().toISOString();
  const day = n => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  for (const [student, title] of [['demo-student-a', '架空の数学レポート'], ['demo-student-b', '架空の物理演習']]) {
    await db.doc(`students/${student}/supporters/demo-supporter`).set({ scopes: ['all'], revokedAt: null });
    await db.doc(`students/${student}/sessionContext/current`).set({
      lastSessionAt: new Date(Date.now() - 7 * 86400_000).toISOString(),
      nextSessionAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    await createObservationStore(db)(student, { schemaVersion: 1, observationId: randomUUID(),
      system: 'demo-lms', definitionId: 'demo', definitionVersion: 1, fetchedAt: at,
      catalogCourses: [{ courseId: 'fictional-course', name: '架空の授業', slots: [{ weekday: 1, period: 2 }] }],
      courseResults: [{ courseId: 'fictional-course', listComplete: true, seenSourceIds: ['fictional-task'] }],
      assignments: [{ sourceId: 'fictional-task', courseId: 'fictional-course', title,
        url: 'https://example.invalid/tasks/fictional-task', submission: 'not-submitted',
        deadline: { kind: 'date', date: day(3), dueText: '架空の日付', timeZone: 'Asia/Tokyo' } }], failures: [],
    });
    if (student === 'demo-student-a') await db.doc(`students/${student}/assignments/${documentKey('demo-lms', 'fictional-task')}`)
      .update({ reviewReasons: [{ kind: 'unreadable-deadline', detail: 'unreadable' }] });
  }
  log('Seeded fictional session accounts and two student ledgers in local emulators.');
} finally { await db.terminate(); await deleteApp(app); }
