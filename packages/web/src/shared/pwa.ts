export function registerPwa(): void {
  if (!import.meta.env.PROD || import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
      !('serviceWorker' in navigator)) return;
  // Installation must never prevent the ordinary online application from opening.
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
}
