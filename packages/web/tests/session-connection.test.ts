import { expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({ auth: {}, db: {}, login: vi.fn(async () => {}), logout: vi.fn(async () => {}) }));
const observe = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('../src/firebase', () => ({ firebase: shared }));
vi.mock('firebase/auth', async original => ({ ...await original<typeof import('firebase/auth')>(), onAuthStateChanged: observe }));

it('uses the same configured identity as the student screen without separate Firebase configuration', async () => {
  vi.stubEnv('VITE_FIREBASE_CONFIG', '');
  vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false');
  const { getSessionServices } = await import('../src/session-firebase');
  const service = getSessionServices();
  expect(service).not.toBeNull();
  const next = vi.fn(); service!.observeUser(next);
  expect(observe).toHaveBeenCalledWith(shared.auth, next);
  await service!.login('', ''); expect(shared.login).toHaveBeenCalledOnce();
  await service!.logout(); expect(shared.logout).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});
