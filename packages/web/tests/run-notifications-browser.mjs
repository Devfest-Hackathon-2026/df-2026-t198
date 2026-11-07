import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { createHttpServer } from '../../server/dist/http.js';
import { firebaseDependencies } from '../../server/dist/firebase.js';
import { createNotificationSettingsStore } from '../../server/dist/notification-settings.js';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('local-emulators-required');
const apiPort = process.env.KADAI_API_PORT || '8192';
const webPort = process.env.KADAI_WEB_PORT || '5192';
const deps = firebaseDependencies();
deps.notificationSettings = createNotificationSettingsStore(getFirestore(), {
  checkSender: async () => 'ready',
  resolveRecipient: async uid => { const u = await getAuth().getUser(uid); return !u.disabled && u.emailVerified ? u.email ?? null : null; },
});
const api = createHttpServer(deps);
await new Promise(resolve => api.listen(Number(apiPort), '127.0.0.1', resolve));
const env = { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_AUTH_EMULATOR_PORT: process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[1],
  VITE_FIRESTORE_EMULATOR_PORT: process.env.FIRESTORE_EMULATOR_HOST.split(':')[1],
  KADAI_API_PORT: apiPort, KADAI_WEB_ORIGIN: `http://127.0.0.1:${webPort}` };
const web = spawn('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], { env, stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await globalThis.fetch(env.KADAI_WEB_ORIGIN)).ok) { ready = true; break; } } catch { /* Local startup. */ }
    if (web.exitCode !== null) throw new Error('web-stopped');
    await new Promise(resolve => globalThis.setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('web-not-ready');
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['packages/web/tests/notifications.browser.mjs', ...process.argv.slice(2)], { env, stdio: 'inherit' });
    child.once('error', () => reject(new Error('browser-start-failed')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('browser-failed')));
  });
} finally {
  web.kill('SIGTERM');
  await new Promise(resolve => api.close(resolve));
  await getFirestore().terminate();
}
