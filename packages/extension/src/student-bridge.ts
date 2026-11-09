import { browserConnect, observationIdentity } from './auth/browser.js';
import { missingConfig, probeConfig } from './auth/config.js';
import type { ConnectCode } from './auth/probe.js';
import { claimCalendarSetup, releaseCalendarSetup } from './auth/worker.js';
import { syncCalendar } from './calendar/browser.js';
import { CalendarFailure } from './calendar/sync.js';
import { studentPageUrl } from './student-page.js';

export type BridgeCode = ConnectCode | 'busy' | 'not-connected' | 'reauthorization-required' | 'sync-failed';
export type BridgeReply =
  | { ok: true; account?: 'none' | 'same' | 'other'; synced?: boolean }
  | { ok: false; code: BridgeCode };
const types = ['todoku-status', 'todoku-calendar-connect', 'todoku-calendar-sync'] as const;
type BridgeMessage = { type: (typeof types)[number]; uid: string };

function parse(message: unknown): BridgeMessage | null {
  if (!message || typeof message !== 'object') return null;
  const { type, uid, ...rest } = message as Record<string, unknown>;
  if (Object.keys(rest).length || typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return null;
  return types.includes(type as BridgeMessage['type']) ? { type: type as BridgeMessage['type'], uid } : null;
}

/** The manifest already limits callers; this repeats the check and excludes embedded frames. */
function fromStudentPage(sender: chrome.runtime.MessageSender): boolean {
  const page = studentPageUrl();
  if (!page || sender.frameId !== 0 || !sender.url) return false;
  const origin = new URL(page).origin;
  try { return new URL(sender.url).origin === origin && (sender.origin === undefined || sender.origin === origin); }
  catch { return false; }
}

async function sync(uid: string): Promise<BridgeReply> {
  const current = await observationIdentity();
  if (!current) return { ok: false, code: 'not-connected' };
  if (current.uid !== uid) return { ok: false, code: 'account-mismatch' };
  try { await syncCalendar(); return { ok: true, synced: true }; }
  catch (error) {
    return { ok: false, code: error instanceof CalendarFailure && error.code === 'authorization-required' ? 'reauthorization-required' : 'sync-failed' };
  }
}

async function handle({ type, uid }: BridgeMessage): Promise<BridgeReply> {
  if (missingConfig(probeConfig).length || !probeConfig.apiOrigin) return { ok: false, code: 'unconfigured' };
  if (type === 'todoku-status') {
    const current = await observationIdentity();
    return { ok: true, account: !current ? 'none' : current.uid === uid ? 'same' : 'other' };
  }
  if (type === 'todoku-calendar-sync') return sync(uid);
  // Repeated clicks and a running connection test must never create a second calendar.
  if (!claimCalendarSetup()) return { ok: false, code: 'busy' };
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const connected = await browserConnect()(uid);
    if (!connected.ok) return connected;
    return { ok: true, synced: (await sync(uid)).ok };
  } finally { releaseCalendarSetup(); }
}

/** Lets the signed-in student page start the calendar connection without opening the options page. */
export function startStudentBridge() {
  chrome.runtime.onMessageExternal?.addListener((message: unknown, sender, respond: (reply: BridgeReply) => void) => {
    const request = fromStudentPage(sender) ? parse(message) : null;
    if (!request) { respond({ ok: false, code: 'unconfigured' }); return false; }
    // Exceptions may carry tokens or response bodies; only fixed codes reach the page.
    void handle(request).then(respond, () => respond({ ok: false, code: 'calendar-unavailable' }));
    return true;
  });
}
