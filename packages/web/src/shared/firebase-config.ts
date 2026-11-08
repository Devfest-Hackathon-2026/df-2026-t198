interface FirebaseEnvironment {
  DEV: boolean;
  VITE_USE_FIREBASE_EMULATORS?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_AUTH_EMULATOR_PORT?: string;
  VITE_FIRESTORE_EMULATOR_PORT?: string;
}

function emulatorPort(value: string | undefined, fallback: number): number | null {
  if (!value) return fallback;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function resolveFirebaseConfig(env: FirebaseEnvironment, hostname: string) {
  if (env.VITE_USE_FIREBASE_EMULATORS === 'true') {
    if (!env.DEV || !['127.0.0.1', 'localhost'].includes(hostname)) return null;
    const authPort = emulatorPort(env.VITE_AUTH_EMULATOR_PORT, 9099);
    const firestorePort = emulatorPort(env.VITE_FIRESTORE_EMULATOR_PORT, 8085);
    if (authPort === null || firestorePort === null) return null;
    return { options: { projectId: 'demo-kadai-hisho', apiKey: 'demo-key', authDomain: 'localhost' },
      emulator: { authPort, firestorePort } };
  }
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
  return projectId && apiKey && authDomain ? { options: { projectId, apiKey, authDomain }, emulator: null } : null;
}
