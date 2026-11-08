import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteApp, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeFirebaseDependencies, firebaseDependencies } from '../src/firebase.js';

const directories: string[] = [];

beforeEach(() => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'PUBLIC_WEB_ORIGIN', 'ENABLE_DEMO_ANNOUNCEMENTS', 'FIREBASE_CONFIG', 'K_SERVICE', 'NODE_ENV']) vi.stubEnv(key, undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(getApps().map(deleteApp));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
it('reuses the default app regardless of an earlier named app and closes only its resources once', async () => {
  const other = initializeApp({ projectId: 'demo-unrelated' }, 'unrelated');
  const app = initializeApp({ projectId: 'demo-kadai-hisho' });
  const db = getFirestore(app);
  const terminate = vi.spyOn(db, 'terminate').mockImplementation(async () => {
    expect(getApps()).toContain(app);
    await Promise.resolve();
  });
  const dependencies = firebaseDependencies();
  const first = closeFirebaseDependencies(dependencies);
  expect(closeFirebaseDependencies(dependencies)).toBe(first);
  await first;
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(getApps()).toEqual([other]);
});
it('creates a default app rather than selecting an unrelated named app', async () => {
  const other = initializeApp({ projectId: 'demo-unrelated' }, 'unrelated');
  const dependencies = firebaseDependencies();
  expect(getApps().map(app => app.name)).toEqual(['unrelated', '[DEFAULT]']);
  await closeFirebaseDependencies(dependencies);
  expect(getApps()).toEqual([other]);
});
it('still releases the owned app after Firestore termination fails and shares the rejection', async () => {
  const app = initializeApp({ projectId: 'demo-kadai-hisho' });
  const terminate = vi.spyOn(getFirestore(app), 'terminate').mockRejectedValue(new Error('fixture-termination-failure'));
  const dependencies = firebaseDependencies();
  const first = closeFirebaseDependencies(dependencies);
  expect(closeFirebaseDependencies(dependencies)).toBe(first);
  await expect(first).rejects.toThrow('fixture-termination-failure');
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(getApps()).toEqual([]);
});
it('rejects a mixed emulator configuration before creating any SDK app', () => {
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8085');
  vi.stubEnv('GCLOUD_PROJECT', 'demo-kadai-hisho');
  expect(() => firebaseDependencies()).toThrow('invalid-emulator-environment');
  expect(getApps()).toEqual([]);
});
async function firebaseConfig(mode: 'json' | 'file', projectId: string) {
  const options = { projectId, storageBucket: 'fictional-bucket.invalid' };
  const json = JSON.stringify(options);
  if (mode === 'json') vi.stubEnv('FIREBASE_CONFIG', json);
  else {
    const directory = await mkdtemp(join(tmpdir(), 'kadai-firebase-config-'));
    directories.push(directory);
    const file = join(directory, 'firebase.json');
    await writeFile(file, json);
    vi.stubEnv('FIREBASE_CONFIG', file);
  }
  return options;
}
it.each(['json', 'file'] as const)('preserves %s Firebase configuration for optional features without emulators', async mode => {
  const options = await firebaseConfig(mode, 'fictional-live-project');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ENABLE_DEMO_ANNOUNCEMENTS', 'true');
  const dependencies = firebaseDependencies();
  expect(dependencies.announcements).toBeDefined();
  expect(getApp().options).toMatchObject(options);
  await closeFirebaseDependencies(dependencies);
});
it.each([
  ['json', 'fictional-live-project'], ['json', 'demo-other'],
  ['file', 'fictional-live-project'], ['file', 'demo-other'],
] as const)('binds the inspected demo project despite %s Firebase configuration naming %s', async (mode, projectId) => {
  await firebaseConfig(mode, projectId);
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8085');
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
  vi.stubEnv('GCLOUD_PROJECT', 'demo-checked');
  vi.stubEnv('ENABLE_DEMO_ANNOUNCEMENTS', 'true');
  const dependencies = firebaseDependencies();
  const app = getApp();
  expect(app.options.projectId).toBe('demo-checked');
  expect(app.options.storageBucket).toBeUndefined();
  expect(dependencies.announcements).toBeDefined();
  await closeFirebaseDependencies(dependencies);
});
it('rejects a real existing default app rather than replacing it in an emulator process', () => {
  const app = initializeApp({ projectId: 'fictional-live-project' });
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8085');
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
  vi.stubEnv('GCLOUD_PROJECT', 'demo-checked');
  expect(() => firebaseDependencies()).toThrow('invalid-emulator-environment');
  expect(getApps()).toEqual([app]);
});
