import { deleteApp, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, initializeAuth, indexedDBLocalPersistence, inMemoryPersistence, signInWithCredential } from 'firebase/auth/web-extension';
import type { Auth, AuthCredential } from 'firebase/auth/web-extension';
import { createProbe, RequestNotSent } from './probe.js';
import type { ProbeState } from './probe.js';
import { missingConfig, probeConfig } from './config.js';
import { calendarScopes } from './scopes.js';

const stateKey = 'authProbeState';
let auth: Auth | undefined;

export function firebaseAuth(): Auth {
  // Callers check configuration before initializing the shared extension auth.
  auth ??= initializeAuth(initializeApp(probeConfig.firebase), { persistence: indexedDBLocalPersistence });
  return auth;
}

/** Restore the existing login without opening an authorization dialog. */
export async function observationIdentity(): Promise<{ uid: string; token: string } | null> {
  if (missingConfig(probeConfig).length) return null;
  const current = firebaseAuth();
  await current.authStateReady();
  const user = current.currentUser;
  return user ? { uid: user.uid, token: await user.getIdToken() } : null;
}

export async function readProbeState(): Promise<ProbeState | undefined> {
  return (await chrome.storage.local.get(stateKey))[stateKey] as ProbeState | undefined;
}

export async function confirmGoogleIdentity(token: string, expectedUid: string): Promise<boolean> {
  const credential = GoogleAuthProvider.credential(null, token);
  // Verification must never replace the user used by observations and digest mail.
  const app = initializeApp(probeConfig.firebase, `identity-check-${crypto.randomUUID()}`);
  try {
    const isolated = initializeAuth(app, { persistence: inMemoryPersistence });
    return (await signInWithCredential(isolated, credential)).user.uid === expectedUid;
  } finally {
    await deleteApp(app);
  }
}

export function browserProbe() {
  return createProbe({
    missing: missingConfig(probeConfig),
    namespace: `${probeConfig.firebase.projectId}:${probeConfig.oauthClientId}`,
    workerId,
    auth: {
      async restore() {
        const current = firebaseAuth();
        await current.authStateReady();
        return current.currentUser?.uid ?? null;
      },
      async getToken() {
        const result = await chrome.identity.getAuthToken({ interactive: true, scopes: calendarScopes });
        return result.token ?? '';
      },
      credential: (idToken, token) => GoogleAuthProvider.credential(idToken, token),
      async signIn(credential) {
        return (await signInWithCredential(firebaseAuth(), credential as AuthCredential)).user.uid;
      },
    },
    read: readProbeState,
    async write(state) {
      if (state === undefined) await chrome.storage.local.remove(stateKey);
      else await chrome.storage.local.set({ [stateKey]: state });
    },
    newEventId: () => crypto.randomUUID().replaceAll('-', ''),
    now: () => new Date(),
    async request(path, token, body) {
      let pending: Promise<Response>;
      try {
        pending = fetch(`https://www.googleapis.com/calendar/v3${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
          credentials: 'omit', redirect: 'error',
        });
      } catch {
        throw new RequestNotSent();
      }
      // A rejected fetch promise may have lost a successful response; keep it uncertain.
      const response = await pending;
      // Error response bodies are deliberately never parsed or passed to the UI.
      return { status: response.status, ...(response.ok ? { data: await response.json() as unknown } : {}) };
    },
  });
}

const workerId = crypto.randomUUID();
