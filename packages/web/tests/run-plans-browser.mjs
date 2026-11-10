import { localProcesses } from './helpers/local-processes.mjs';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('local-emulators-required');
const apiPort = process.env.KADAI_API_PORT || '8180';
const webPort = process.env.KADAI_WEB_PORT || '5178';
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_AUTH_EMULATOR_PORT: process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[1],
  VITE_FIRESTORE_EMULATOR_PORT: process.env.FIRESTORE_EMULATOR_HOST.split(':')[1],
  PUBLIC_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  PORT: apiPort, KADAI_API_PORT: apiPort, KADAI_WEB_ORIGIN: `http://127.0.0.1:${webPort}` };
if (process.argv.includes('--student-future')) {
  for (const role of ['STUDENT', 'SUPPORTER']) {
    env[`VITE_PUBLIC_DEMO_${role}_EMAIL`] = `trial-${role.toLowerCase()}@example.invalid`;
    env[`VITE_PUBLIC_DEMO_${role}_PASSWORD`] = env.KADAI_DEMO_PASSWORD;
  }
}
const { start, finish, ready, checkPorts, stop } = localProcesses(env, 'plans');
try {
  await checkPorts([apiPort, webPort]);
  await finish(start('node', ['packages/server/scripts/seed-demo.mjs']));
  const api = start('node', ['packages/server/dist/index.js'], true);
  await ready(`http://127.0.0.1:${apiPort}/api/health`, api);
  const web = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], true);
  await ready(env.KADAI_WEB_ORIGIN, web);
  await finish(start('node', [process.argv.includes('--student-future') ? 'packages/web/tests/student-future.browser.mjs' : process.argv.includes('--sharing') ? 'packages/web/tests/sharing.browser.mjs' : process.argv.includes('--student-fit') ? 'packages/web/tests/student-fit.browser.mjs' : process.argv.includes('--judge-links') ? 'packages/web/tests/judge-links.browser.mjs' : process.argv.includes('--student-screens') ? 'packages/web/tests/student-screens.browser.mjs' : process.argv.includes('--capture-landing-shots') ? 'packages/web/tests/capture-landing-shots.mjs' : process.argv.includes('--kulasis') ? 'packages/web/tests/kulasis.browser.mjs' : process.argv.includes('--judge-qa') ? 'packages/web/tests/judge-qa.browser.mjs' : process.argv.includes('--manual-assignments') ? 'packages/web/tests/manual-assignments.browser.mjs' : process.argv.includes('--demo-regression')
    ? 'packages/web/tests/demo.browser.mjs' : 'packages/web/tests/plans.browser.mjs']));
  if (process.argv.includes('--student-fit')) await finish(start('node', ['packages/web/tests/student.browser.mjs']));
} finally {
  stop();
}
