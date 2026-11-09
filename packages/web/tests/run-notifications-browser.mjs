import { localProcesses } from './helpers/local-processes.mjs';
import process from 'node:process';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { createHttpServer } from '../../server/dist/http.js';
import { firebaseDependencies } from '../../server/dist/firebase.js';
import { createNotificationSettingsStore } from '../../server/dist/notifications/settings.js';

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
const { start, ready, finish, stop } = localProcesses(env, 'notifications');
try {
  const web = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], true);
  await ready(env.KADAI_WEB_ORIGIN, web);
  // --connect runs the calendar and mail buttons above the timetable instead of the settings panel.
  const script = process.argv.includes('--connect') ? 'connect.browser.mjs' : 'notifications.browser.mjs';
  await finish(start('node', [`packages/web/tests/${script}`, ...process.argv.slice(2)]));
} finally {
  stop();
  await new Promise(resolve => api.close(resolve));
  await getFirestore().terminate();
}
