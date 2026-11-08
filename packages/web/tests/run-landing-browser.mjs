import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { localProcesses } from './helpers/local-processes.mjs';

// Run through scripts/run-emulators.mjs; every account and observation stays local.
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('local-emulators-required');
const mode = process.argv[2] || '--landing';
const port = process.env.KADAI_LANDING_PORT || '5184';
const apiPort = process.env.KADAI_API_PORT || '24880';
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(),
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_AUTH_EMULATOR_PORT: process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[1],
  VITE_FIRESTORE_EMULATOR_PORT: process.env.FIRESTORE_EMULATOR_HOST.split(':')[1],
  KADAI_API_PORT: apiPort, PORT: apiPort,
  KADAI_WEB_ORIGIN: `http://127.0.0.1:${port}`, PUBLIC_WEB_ORIGIN: `http://127.0.0.1:${port}` };
if (mode === '--shared') {
  for (const role of ['STUDENT', 'SUPPORTER']) {
    env[`VITE_PUBLIC_DEMO_${role}_EMAIL`] = `trial-${role.toLowerCase()}@example.invalid`;
    env[`VITE_PUBLIC_DEMO_${role}_PASSWORD`] = env.KADAI_DEMO_PASSWORD;
  }
}
const { start, finish, ready, checkPorts, stop } = localProcesses(env, 'landing');
try {
  await checkPorts([port, apiPort]);
  await finish(start('node', ['packages/server/scripts/seed-demo.mjs']));
  const api = start('node', ['packages/server/dist/index.js'], true);
  await ready(`${env.PUBLIC_WEB_ORIGIN.replace(`:${port}`, `:${apiPort}`)}/api/health`, api);
  const vite = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', port, '--strictPort'], true);
  await ready(env.KADAI_WEB_ORIGIN, vite);
  const scripts = mode === '--capture' ? ['capture-landing-shots.mjs']
    : mode === '--qa' ? ['judge-qa.browser.mjs']
    : mode === '--m6' ? ['demo.browser.mjs']
    : mode === '--shared' ? ['landing-shared.browser.mjs']
    : ['landing-chapters.browser.mjs', 'landing-flow.browser.mjs', 'landing.browser.mjs'];
  for (const script of scripts) await finish(start('node', [`packages/web/tests/${script}`]));
} finally { stop(); }
