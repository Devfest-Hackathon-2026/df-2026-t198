import { localProcesses } from './helpers/local-processes.mjs';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('local-emulators-required');
const apiPort = process.env.KADAI_API_PORT || '8195';
const webPort = process.env.KADAI_WEB_PORT || '5195';
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_AUTH_EMULATOR_PORT: process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[1],
  VITE_FIRESTORE_EMULATOR_PORT: process.env.FIRESTORE_EMULATOR_HOST.split(':')[1],
  PUBLIC_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  PORT: apiPort, KADAI_API_PORT: apiPort, KADAI_WEB_ORIGIN: `http://127.0.0.1:${webPort}` };
const { start, finish, ready, checkPorts, stop } = localProcesses(env, 'plans');
try {
  await checkPorts([apiPort, webPort]);
  await finish(start('node', ['packages/server/scripts/seed-demo.mjs']));
  const api = start('node', ['packages/server/dist/index.js'], true);
  await ready(`http://127.0.0.1:${apiPort}/api/health`, api);
  const web = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], true);
  await ready(env.KADAI_WEB_ORIGIN, web);
  await finish(start('node', ['packages/web/tests/course-colors.browser.mjs']));
} finally {
  stop();
}
