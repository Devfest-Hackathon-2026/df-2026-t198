import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({ auth: { emulatorConfig: null as { host: string } | null }, db: {},
  login: vi.fn(async () => {}), logout: vi.fn(async () => {}) }));
const observe = vi.hoisted(() => vi.fn(() => () => {}));
const localLogin = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/shared/firebase', () => ({ firebase: shared }));
vi.mock('firebase/auth', async original => ({ ...await original<typeof import('firebase/auth')>(),
  onAuthStateChanged: observe, signInWithEmailAndPassword: localLogin }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); shared.auth.emulatorConfig = null; });
afterEach(() => vi.unstubAllEnvs());

it('uses the same configured identity as the student screen without separate Firebase configuration', async () => {
  vi.stubEnv('VITE_FIREBASE_CONFIG', '');
  vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false');
  const { getSessionServices } = await import('../src/features/session/firebase');
  const service = getSessionServices();
  expect(service).not.toBeNull();
  const next = vi.fn(); service!.observeUser(next);
  expect(observe).toHaveBeenCalledWith(shared.auth, next);
  await service!.login('', ''); expect(shared.login).toHaveBeenCalledOnce();
  await service!.logout(); expect(shared.logout).toHaveBeenCalledOnce();
});

it('uses the configured Auth emulator rather than independently interpreting environment flags', async () => {
  vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false');
  shared.auth.emulatorConfig = { host: '127.0.0.1' };
  const { getSessionServices } = await import('../src/features/session/firebase');
  const service = getSessionServices()!;
  expect(service.local).toBe(true);
  await service.login('synthetic@example.invalid', 'synthetic-password');
  expect(localLogin).toHaveBeenCalledWith(shared.auth, 'synthetic@example.invalid', 'synthetic-password');
  expect(shared.login).not.toHaveBeenCalled();
});
