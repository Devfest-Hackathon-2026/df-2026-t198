import process from 'node:process';
import { log } from 'node:console';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// This helper cannot create accounts or change data in a real Firebase project.
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.KADAI_DEMO_PASSWORD || process.env.KADAI_DEMO_PASSWORD.length < 8) {
  throw new Error('local-emulators-and-demo-password-required');
}
const app = initializeApp({ projectId: 'demo-kadai-hisho' });
const db = getFirestore(app);
try {
  const auth = getAuth(app);
  const studentId = 'trial-student';
  for (const [uid, role] of [[studentId, 'student'], ['trial-supporter', 'supporter']]) {
    try { await auth.getUser(uid); }
    catch (error) {
      // Do not include SDK error details in a setup failure.
      // eslint-disable-next-line preserve-caught-error
      if (error.code !== 'auth/user-not-found') throw new Error('demo-account-lookup-failed');
      await auth.createUser({ uid, email: `${uid}@example.invalid`, password: process.env.KADAI_DEMO_PASSWORD });
    }
    await db.doc(`demoAccounts/${uid}`).set({ role, studentId });
  }
  const student = db.doc(`students/${studentId}`);
  const ref = student.collection('demo').doc('current');
  // Re-running the setup preserves changes made by the person trying the app.
  if (!(await ref.get()).exists) {
    const due = new Date(Date.now() + 3 * 86400_000);
    due.setUTCHours(8, 0, 0, 0);
    await ref.set({ courses: [
      { courseId: 'DEMO101', name: '架空の観察入門', teacher: '架空の先生A', weekday: 1, period: 2, assignments: [
        { sourceId: 'DEMO101_TASK1', title: '架空の観察ノート', dueAt: due.toISOString(), submission: 'not-submitted' },
        { sourceId: 'DEMO101_TASK2', title: '架空の振り返り', dueAt: due.toISOString(), submission: 'submitted' },
      ] },
      { courseId: 'DEMO202', name: '架空の表現演習', teacher: '架空の先生B', weekday: 4, period: 4, assignments: [] },
    ] });
    await student.collection('sessionContext').doc('current').set({
      lastSessionAt: new Date(Date.now() - 7 * 86400_000).toISOString(),
      nextSessionAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
  }
  await student.collection('supporters').doc('trial-supporter').set({ scopes: ['all'], revokedAt: null });
  log('Prepared fictional student and supporter accounts in local emulators. No ledger observations were seeded.');
} catch {
  throw new Error('demo-setup-failed');
} finally { await db.terminate(); await deleteApp(app); }
