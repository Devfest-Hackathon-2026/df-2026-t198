import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, initializeAuth, indexedDBLocalPersistence, signInWithCredential } from 'firebase/auth/web-extension';
import type { Auth, AuthCredential } from 'firebase/auth/web-extension';
import { createProbe } from './auth-probe.js';
import type { ProbeState } from './auth-probe.js';
import { missingConfig, probeConfig } from './probe-config.js';

const stateKey = 'authProbeState';
let auth: Auth | undefined;

function firebaseAuth(): Auth {
  // Initialized only after a trusted options-page request and complete config.
  auth ??= initializeAuth(initializeApp(probeConfig.firebase), { persistence: indexedDBLocalPersistence });
  return auth;
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
        const result = await chrome.identity.getAuthToken({ interactive: true });
        return result.token ?? '';
      },
      credential: (idToken, token) => GoogleAuthProvider.credential(idToken, token),
      async signIn(credential) {
        return (await signInWithCredential(firebaseAuth(), credential as AuthCredential)).user.uid;
      },
    },
    async read() {
      const saved = (await chrome.storage.local.get(stateKey))[stateKey] as ProbeState | undefined;
      return saved;
    },
    async write(state) { await chrome.storage.local.set({ [stateKey]: state }); },
    newEventId: () => crypto.randomUUID().replaceAll('-', ''),
    now: () => new Date(),
    async request(path, token, body) {
      const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit', redirect: 'error',
      });
      // Error response bodies are deliberately never parsed or passed to the UI.
      return { status: response.status, ...(response.ok ? { data: await response.json() as unknown } : {}) };
    },
  });
}

const workerId = crypto.randomUUID();
