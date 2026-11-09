import { localProcesses } from './helpers/local-processes.mjs';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('local-emulators-required');
const env = { ...process.env, SESSION_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_AUTH_EMULATOR_PORT: process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[1],
  VITE_FIRESTORE_EMULATOR_PORT: process.env.FIRESTORE_EMULATOR_HOST.split(':')[1],
  KADAI_API_PORT: '8182', PORT: '8182', KADAI_WEB_ORIGIN: 'http://127.0.0.1:5182', PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:5182' };
const { start, finish, ready, checkPorts, stop } = localProcesses(env, 'session');
try {
  await checkPorts([8182, 5182]);
  await finish(start('node', ['packages/server/scripts/seed-session.mjs']));
  const api = start('node', ['packages/server/dist/index.js'], true);
  await ready('http://127.0.0.1:8182/api/health', api);
  const web = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], true);
  await ready(env.KADAI_WEB_ORIGIN, web);
  if (!process.argv.includes('--capture-before')) await finish(start('node', ['packages/web/tests/session.browser.mjs']));
  await finish(start('node', ['packages/web/tests/session-redesign.browser.mjs', ...process.argv.slice(2)]));
} finally { stop(); }
