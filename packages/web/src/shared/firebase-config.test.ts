import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFirebaseConfig } from './firebase-config';

const live = { VITE_FIREBASE_PROJECT_ID: 'synthetic-project', VITE_FIREBASE_API_KEY: 'synthetic-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'synthetic.firebaseapp.com' };
const local = { ...live, DEV: true, VITE_USE_FIREBASE_EMULATORS: 'true' };
const sdk = vi.hoisted(() => ({
  app: {}, auth: {}, db: {}, initializeApp: vi.fn(), getAuth: vi.fn(), getFirestore: vi.fn(),
  connectAuthEmulator: vi.fn(), connectFirestoreEmulator: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: sdk.initializeApp }));
vi.mock('firebase/auth', () => ({ getAuth: sdk.getAuth, connectAuthEmulator: sdk.connectAuthEmulator,
  GoogleAuthProvider: class {}, signInWithPopup: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ getFirestore: sdk.getFirestore, connectFirestoreEmulator: sdk.connectFirestoreEmulator }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  sdk.initializeApp.mockReturnValue(sdk.app); sdk.getAuth.mockReturnValue(sdk.auth); sdk.getFirestore.mockReturnValue(sdk.db);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Firebase environment selection before SDK initialization', () => {
  it.each([true, false])('preserves a complete live configuration with DEV=%s', DEV => {
    expect(resolveFirebaseConfig({ ...live, DEV }, 'app.example.test')).toEqual({
      options: { projectId: live.VITE_FIREBASE_PROJECT_ID, apiKey: live.VITE_FIREBASE_API_KEY,
        authDomain: live.VITE_FIREBASE_AUTH_DOMAIN }, emulator: null,
    });
  });
  it.each(Object.keys(live))('disables Firebase when %s is missing', key => {
    expect(resolveFirebaseConfig({ ...live, [key]: '', DEV: false }, 'app.example.test')).toBeNull();
  });
  it.each(['localhost', '127.0.0.1'])('uses only the fixed demo project on %s', hostname => {
    expect(resolveFirebaseConfig(local, hostname)).toEqual({
      options: { projectId: 'demo-kadai-hisho', apiKey: 'demo-key', authDomain: 'localhost' },
      emulator: { authPort: 9099, firestorePort: 8085 },
    });
    expect(resolveFirebaseConfig({ ...local, VITE_AUTH_EMULATOR_PORT: '1', VITE_FIRESTORE_EMULATOR_PORT: '65535' }, hostname)?.emulator)
      .toEqual({ authPort: 1, firestorePort: 65535 });
  });
  it('does not fall back to the live project for production or non-loopback emulator requests', () => {
    expect(resolveFirebaseConfig({ ...local, DEV: false }, 'localhost')).toBeNull();
    for (const hostname of ['', 'app.example.test', '127.0.0.1.example.test', 'localhost.example.test']) {
      expect(resolveFirebaseConfig(local, hostname)).toBeNull();
    }
  });
  it.each(['VITE_AUTH_EMULATOR_PORT', 'VITE_FIRESTORE_EMULATOR_PORT'])('rejects invalid %s without live fallback', key => {
    for (const value of ['0', '-1', '65536', '8085.5', '1e3', '8085/path', 'not-a-port']) {
      expect(resolveFirebaseConfig({ ...local, [key]: value }, 'localhost')).toBeNull();
    }
    expect(resolveFirebaseConfig({ ...local, [key]: '' }, 'localhost')).toEqual(resolveFirebaseConfig(local, 'localhost'));
  });
  it.each([
    { dev: false, hostname: 'localhost', port: '9099' },
    { dev: true, hostname: 'app.example.test', port: '9099' },
    { dev: true, hostname: 'localhost', port: '0' },
  ])('does not initialize any SDK for an invalid emulator configuration: %j', async ({ dev, hostname, port }) => {
    vi.stubEnv('DEV', dev); vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    for (const [key, value] of Object.entries(live)) vi.stubEnv(key, value);
    vi.stubEnv('VITE_AUTH_EMULATOR_PORT', port); vi.stubEnv('VITE_FIRESTORE_EMULATOR_PORT', '8085');
    vi.stubGlobal('window', { location: { hostname } });
    expect((await import('./firebase')).firebase).toBeNull();
    expect(sdk.initializeApp).not.toHaveBeenCalled(); expect(sdk.getAuth).not.toHaveBeenCalled();
    expect(sdk.getFirestore).not.toHaveBeenCalled();
  });
  it('connects both emulators before exposing the initialized connection', async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    vi.stubEnv('VITE_AUTH_EMULATOR_PORT', '9198'); vi.stubEnv('VITE_FIRESTORE_EMULATOR_PORT', '8188');
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    const { firebase } = await import('./firebase');
    expect(firebase).toMatchObject({ auth: sdk.auth, db: sdk.db });
    expect(sdk.initializeApp).toHaveBeenCalledWith({ projectId: 'demo-kadai-hisho', apiKey: 'demo-key', authDomain: 'localhost' });
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(sdk.auth, 'http://127.0.0.1:9198', { disableWarnings: true });
    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledWith(sdk.db, '127.0.0.1', 8188);
    expect(sdk.connectAuthEmulator.mock.invocationCallOrder[0]).toBeLessThan(sdk.getFirestore.mock.invocationCallOrder[0]!);
  });
  it('initializes a configured production app without connecting either emulator', async () => {
    vi.stubEnv('DEV', false); vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false');
    for (const [key, value] of Object.entries(live)) vi.stubEnv(key, value);
    vi.stubGlobal('window', { location: { hostname: 'app.example.test' } });
    expect((await import('./firebase')).firebase).toMatchObject({ auth: sdk.auth, db: sdk.db });
    expect(sdk.initializeApp).toHaveBeenCalledWith({ projectId: live.VITE_FIREBASE_PROJECT_ID,
      apiKey: live.VITE_FIREBASE_API_KEY, authDomain: live.VITE_FIREBASE_AUTH_DOMAIN });
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled(); expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled();
  });
});
