import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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
const children = [];
function start(command, args, quiet = false) {
  const child = spawn(command, args, { env, stdio: quiet ? 'ignore' : 'inherit' }); children.push(child); return child;
}
function finish(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('plans-process-start-failed')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('plans-process-failed')));
  });
}
async function ready(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('plans-server-stopped');
    try { if ((await globalThis.fetch(url)).ok) return; } catch { /* Local startup only. */ }
    await new Promise(resolve => globalThis.setTimeout(resolve, 100));
  }
  throw new Error('plans-server-not-ready');
}
try {
  for (const port of [apiPort, webPort]) await new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', () => reject(new Error('plans-port-in-use')));
    server.listen(Number(port), '127.0.0.1', () => server.close(resolve));
  });
  await finish(start('node', ['packages/server/scripts/seed-demo.mjs']));
  const api = start('node', ['packages/server/dist/index.js'], true);
  await ready(`http://127.0.0.1:${apiPort}/api/health`, api);
  const web = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], true);
  await ready(env.KADAI_WEB_ORIGIN, web);
  await finish(start('node', [process.argv.includes('--kulasis') ? 'packages/web/tests/kulasis.browser.mjs' : process.argv.includes('--judge-qa') ? 'packages/web/tests/judge-qa.browser.mjs' : process.argv.includes('--manual-assignments') ? 'packages/web/tests/manual-assignments.browser.mjs' : process.argv.includes('--demo-regression')
    ? 'packages/web/tests/demo.browser.mjs' : 'packages/web/tests/plans.browser.mjs']));
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
