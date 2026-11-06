import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createHttpServer } from '../src/http.js';
import { firebaseDependencies } from '../src/firebase.js';

export async function sessionEmulatorFixture() {
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!/^127\.0\.0\.1:\d+$/.test(process.env[name] ?? '')) throw new Error('local-emulators-required');
  }
  if (process.env['GCLOUD_PROJECT'] !== 'demo-kadai-hisho') throw new Error('demo-project-required');
  initializeApp({ projectId: 'demo-kadai-hisho' });
  const db = getFirestore();
  const auth = getAuth();
  const server = createHttpServer(firebaseDependencies());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  return { db, auth, base: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await db.terminate(); await Promise.all(getApps().map(app => deleteApp(app)));
    },
  };
}
