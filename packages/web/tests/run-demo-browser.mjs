import process from 'node:process';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { seedPairs } from '../../server/scripts/seed-demo-live.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('local-emulators-required');
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true',
  PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:5177' };
const publicDemo = process.argv[2] === '--public-demo';
const children = [];
function start(command, args, quiet = false) {
  const child = spawn(command, args, { env, stdio: quiet ? 'ignore' : 'inherit' });
  children.push(child);
  return child;
}
function finish(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('demo-process-start-failed')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('demo-process-failed')));
  });
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('demo-server-stopped');
    try { if ((await globalThis.fetch(url)).ok) return; } catch { /* Wait for the local process. */ }
    await new Promise(resolve => globalThis.setTimeout(resolve, 100));
  }
  throw new Error('demo-server-not-ready');
}
try {
  for (const port of [8080, 5177]) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('demo-port-in-use')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
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
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
