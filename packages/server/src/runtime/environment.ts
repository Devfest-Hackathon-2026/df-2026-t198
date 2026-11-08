function localEndpoint(value: string | undefined): boolean {
  const match = value?.match(/^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/);
  return !!match && Number(match[1]) >= 1 && Number(match[1]) <= 65535;
}

export function assertEmulatorEnvironment(env: NodeJS.ProcessEnv, projectId?: string): void {
  const auth = env['FIREBASE_AUTH_EMULATOR_HOST'];
  const firestore = env['FIRESTORE_EMULATOR_HOST'];
  if (auth === undefined && firestore === undefined) return;
  if (env['NODE_ENV'] === 'production' || env['K_SERVICE'] !== undefined ||
    !localEndpoint(auth) || !localEndpoint(firestore) || !projectId?.startsWith('demo-') ||
    [env['GOOGLE_CLOUD_PROJECT'], env['GCLOUD_PROJECT']].some(value => value !== undefined && value !== projectId)) {
    throw new Error('invalid-emulator-environment');
  }
}
