import { afterEach, expect, it, vi } from 'vitest';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { firebaseDependencies } from '../src/firebase.js';
import { createDigestStore } from '../src/digest-store.js';
import { getFirestore } from 'firebase-admin/firestore';
import { createHttpServer } from '../src/http.js';
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(getApps().map(deleteApp)); });
it('starts the API without PUBLIC_WEB_ORIGIN and returns 503 only for the digest subsystem', async () => {
  vi.stubEnv('PUBLIC_WEB_ORIGIN', undefined);
  initializeApp({ projectId: 'demo-kadai-hisho' });
  const dependencies = firebaseDependencies();
  expect(dependencies.digest).toBeUndefined();
  expect(dependencies.plans).toBeDefined(); expect(dependencies.saveObservation).toBeDefined();
  const server = createHttpServer(dependencies);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/digest`, { headers: { Authorization: 'Bearer fictional' } })).status).toBe(503);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('accepts trailing slashes on the configured web origin', () => {
  const app = initializeApp({ projectId: 'demo-kadai-hisho' });
  expect(() => createDigestStore(getFirestore(app), async () => {}, 'https://study.example.invalid///')).not.toThrow();
  vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://study.example.invalid/');
  expect(() => firebaseDependencies()).not.toThrow();
});

it('does not require either a web origin or an explicit Firebase project at startup', () => {
  vi.stubEnv('PUBLIC_WEB_ORIGIN', undefined);
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', undefined); vi.stubEnv('GCLOUD_PROJECT', undefined);
  initializeApp({});
  expect(() => firebaseDependencies()).not.toThrow();
});
