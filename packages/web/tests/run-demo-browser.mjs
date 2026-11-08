import { localProcesses } from './helpers/local-processes.mjs';
import process from 'node:process';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { seedPairs } from '../../server/scripts/seed-demo-live.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('local-emulators-required');
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true',
  PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:5177' };
const publicDemo = process.argv[2] === '--public-demo';
const { start, finish, ready, checkPorts, stop } = localProcesses(env, 'demo');
try {
  await checkPorts([8080, 5177]);
  await finish(start('node', ['packages/server/scripts/seed-demo.mjs']));
  if (publicDemo) {
    const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
    const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
    const { getAuth } = requireServer('firebase-admin/auth');
    const { getFirestore } = requireServer('firebase-admin/firestore');
    const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'public-demo-seed');
    const db = getFirestore(app);
    try {
      await seedPairs({ auth: getAuth(app), db, publicPair: true, persist: async ({ pairs }) => {
        for (const role of ['student', 'supporter']) {
          env[`VITE_PUBLIC_DEMO_${role.toUpperCase()}_EMAIL`] = pairs[0][role].email;
          env[`VITE_PUBLIC_DEMO_${role.toUpperCase()}_PASSWORD`] = pairs[0][role].password;
        }
      } });
    } finally { await db.terminate(); await deleteApp(app); }
  }
  const api = start('node', [publicDemo ? 'packages/web/tests/demo-announcements-server.mjs' : 'packages/server/dist/index.js'], true);
  await ready('http://127.0.0.1:8080/api/health', api);
  const vite = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], true);
  await ready('http://127.0.0.1:5177', vite);
  if (publicDemo) await finish(start('node', ['packages/web/tests/public-demo.browser.mjs']));
  else {
    await finish(start('node', ['packages/web/tests/demo-reset.browser.mjs']));
    await finish(start('node', ['packages/web/tests/demo.browser.mjs']));
  }
} finally {
  stop();
}
