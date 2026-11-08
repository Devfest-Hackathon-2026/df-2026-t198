import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { emulatorOptions } from './run-emulators.mjs';

test('keeps an overridden config and the emulator command literal across process boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kadai-emulators-'));
  try {
    const output = join(dir, 'arguments.json');
    await writeFile(join(dir, 'firebase'), `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(process.env.ARGUMENTS_FILE, JSON.stringify({ args: process.argv.slice(2), path: process.env.PATH }));\nprocess.exit(37);\n`, { mode: 0o700 });
    const command = 'node --test "a file.mjs" && RUN_TESTS=1 pnpm test';
    const env = { ...process.env, PATH: dir, JAVA_HOME_21_X64: '/java home',
      KADAI_FIREBASE_CONFIG: '/config with spaces/firebase.json', ARGUMENTS_FILE: output };
    const result = spawnSync(process.execPath, [resolve('scripts/run-emulators.mjs'), '--config-from-env',
      '--project', 'demo-kadai-hisho', '--only', 'auth,firestore', command], { env, encoding: 'utf8' });
    assert.equal(result.status, 37, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      args: ['emulators:exec', '--config', env.KADAI_FIREBASE_CONFIG, '--project', 'demo-kadai-hisho', '--only', 'auth,firestore', command],
      path: `/opt/homebrew/opt/openjdk@21/bin:/java home/bin:${dir}`,
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('only config-enabled invocations consult the config override', () => {
  const env = { PATH: '/bin', KADAI_FIREBASE_CONFIG: 'other.json' };
  assert.deepEqual(emulatorOptions(['--only', 'firestore'], env).args, ['emulators:exec', '--only', 'firestore']);
  assert.deepEqual(emulatorOptions(['--config-from-env'], { PATH: '/bin' }), {
    args: ['emulators:exec', '--config', 'firebase.json'],
    env: { PATH: '/opt/homebrew/opt/openjdk@21/bin:/bin' },
  });
});

test('reports a missing Firebase executable without leaking command arguments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kadai-emulators-missing-'));
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/run-emulators.mjs'), 'private-command'], {
      env: { PATH: dir }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'firebase-emulators-start-failed\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('forwards termination to Firebase and returns its signal', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kadai-emulators-signal-'));
  let child;
  try {
    await writeFile(join(dir, 'firebase'), `#!${process.execPath}\nprocess.stdout.write('ready');\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    child = spawn(process.execPath, [resolve('scripts/run-emulators.mjs'), '--only', 'firestore'], {
      env: { PATH: dir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await once(child.stdout, 'data');
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
  } finally {
    child?.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});
