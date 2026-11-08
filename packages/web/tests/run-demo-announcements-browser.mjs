import { localProcesses } from './helpers/local-processes.mjs';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('local-emulators-required');
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true', ENABLE_DEMO_ANNOUNCEMENTS: 'false' };
const { start, finish, ready, checkPorts, stop } = localProcesses(env, 'demo');
try {
  await checkPorts([8080, 5177]);
  await finish(start('node', ['packages/server/scripts/seed-demo.mjs']));
  const api = start('node', ['packages/web/tests/demo-announcements-server.mjs'], true);
  await ready('http://127.0.0.1:8080/api/health', api);
  const vite = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], true);
  await ready('http://127.0.0.1:5177', vite);
  await finish(start('node', ['packages/web/tests/demo-announcements.browser.mjs']));
} finally {
  stop();
}
