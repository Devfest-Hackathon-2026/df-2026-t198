import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { closeFirebaseDependencies, firebaseDependencies } from '../src/firebase.js';

beforeEach(() => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'PUBLIC_WEB_ORIGIN', 'ENABLE_DEMO_ANNOUNCEMENTS', 'FIREBASE_CONFIG']) vi.stubEnv(key, undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(getApps().map(deleteApp));
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
  expect(() => firebaseDependencies()).toThrow();
  expect(getApps()).toEqual([]);
});
it('preserves an implicitly configured project for optional features without emulators', async () => {
  vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-config' }));
  vi.stubEnv('ENABLE_DEMO_ANNOUNCEMENTS', 'true');
  const dependencies = firebaseDependencies();
  expect(dependencies.announcements).toBeDefined();
  await closeFirebaseDependencies(dependencies);
});
