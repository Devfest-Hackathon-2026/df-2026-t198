import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('local-emulators-required');
const env = { ...process.env, KADAI_DEMO_PASSWORD: randomUUID(), VITE_USE_FIREBASE_EMULATORS: 'true' };
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
  const api = start('node', ['packages/server/dist/index.js'], true);
  await ready('http://127.0.0.1:8080/healthz', api);
  const vite = start('pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], true);
  await ready('http://127.0.0.1:5177', vite);
  await finish(start('node', ['packages/web/tests/demo.browser.mjs']));
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
