/** Fixed by the public key in packages/extension/manifest.json; extension.test.ts keeps the two in step. */
export const EXTENSION_ID = 'ghlhpjencbpglkbjmhadcbjgjpngdhll';

export type ExtensionRequest = 'todoku-status' | 'todoku-calendar-connect' | 'todoku-calendar-sync';
export type ExtensionReply =
  | { ok: true; account?: 'none' | 'same' | 'other'; synced?: boolean }
  | { ok: false; code: string };
/** Resolves to null when no ToDoku extension answers: another browser, a phone, or not installed. */
export type AskExtension = (type: ExtensionRequest, uid: string) => Promise<ExtensionReply | null>;

interface Runtime {
  sendMessage(extensionId: string, message: unknown, callback: (reply: unknown) => void): void;
  lastError?: unknown;
}
// The Google dialog has no time limit; the other requests never wait for the student.
const waitMs: Record<ExtensionRequest, number | null> = { 'todoku-status': 5_000, 'todoku-calendar-sync': 60_000, 'todoku-calendar-connect': null };

export const askExtension: AskExtension = (type, uid) => new Promise(resolve => {
  // Chrome defines this only on pages listed in an installed extension's externally_connectable.
  const runtime = (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  if (!runtime?.sendMessage) { resolve(null); return; }
  const limit = waitMs[type];
  const timer = limit === null ? undefined : setTimeout(() => resolve(null), limit);
  try {
    runtime.sendMessage(EXTENSION_ID, { type, uid }, reply => {
      clearTimeout(timer);
      void runtime.lastError; // Reading it tells Chrome the missing extension was handled.
      resolve(reply && typeof reply === 'object' && typeof (reply as { ok?: unknown }).ok === 'boolean' ? reply as ExtensionReply : null);
    });
  } catch { clearTimeout(timer); resolve(null); }
});
