import type { CalendarIntegration, CalendarItem, Observation, ObservationResult } from '../../core/src/types.js';
import { firebaseAuth, readProbeState, confirmGoogleIdentity } from './auth-probe-browser.js';
import { probeConfig, missingConfig } from './probe-config.js';
import { CalendarFailure, createCalendarSync, googleCalendarTarget, sendObservationAndSync } from './calendar-sync.js';

async function connection() {
  if (missingConfig(probeConfig).length || !probeConfig.apiOrigin) throw new CalendarFailure('authorization-required');
  const auth = firebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  const state = await readProbeState();
  if (!user || state?.uid !== user.uid || state.namespace !== `${probeConfig.firebase.projectId}:${probeConfig.oauthClientId}` ||
    state.calendar.status !== 'ready') throw new CalendarFailure('authorization-required');
  return { user, calendarId: state.calendar.id };
}
async function api(path: string, body?: unknown): Promise<unknown> {
  const { user } = await connection();
  const response = await fetch(`${probeConfig.apiOrigin}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new CalendarFailure(response.status === 401 ? 'authorization-required' : 'calendar-unavailable');
  return response.json();
}
let verifiedGoogleToken: { uid: string; token: string } | undefined;
const sync = createCalendarSync({
  async pending() {
    const { calendarId } = await connection();
    const current = await api('calendar-sync') as { integration: CalendarIntegration | null; items: CalendarItem[] };
    if (!current.integration) {
      await api('calendar-sync', { calendarId });
      return (await api('calendar-sync') as { items: CalendarItem[] }).items;
    }
    if (current.integration.mode !== 'google' || current.integration.executor !== 'extension' || current.integration.calendarId !== calendarId ||
      current.items.some(item => item.calendarId !== calendarId)) throw new CalendarFailure('event-conflict');
    return current.items;
  },
  async report(report) { await api('calendar-sync', report); },
}, googleCalendarTarget(async (path, method, body) => {
  const { user, calendarId } = await connection();
  const collection = `/calendars/${encodeURIComponent(calendarId)}/events`;
  if (path !== collection && !path.startsWith(`${collection}/`)) throw new CalendarFailure('event-conflict');
  let token: string | undefined;
  try { token = (await chrome.identity.getAuthToken({ interactive: false })).token; }
  catch { throw new CalendarFailure('authorization-required'); }
  if (!token) throw new CalendarFailure('authorization-required');
  if (verifiedGoogleToken?.uid !== user.uid || verifiedGoogleToken.token !== token) {
    let sameUser = false;
    try { sameUser = await confirmGoogleIdentity(token, user.uid); } catch { /* Fixed failure below. */ }
    if (!sameUser) throw new CalendarFailure('authorization-required');
    verifiedGoogleToken = { uid: user.uid, token };
  }
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method, credentials: 'omit', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) {
    verifiedGoogleToken = undefined;
    await chrome.identity.removeCachedAuthToken({ token });
  }
  return { status: response.status, ...(response.ok && method !== 'DELETE' ? { data: await response.json() as unknown } : {}) };
}));

export function syncCalendarInBackground(): Promise<void> { return sync().catch(() => undefined); }
export function sendObservation(observation: Observation): Promise<ObservationResult> {
  return sendObservationAndSync(observation, async body => await api('observations', body) as ObservationResult, sync);
}
export function startCalendarSync() {
  // Only configured builds restore credentials automatically; the probe-only build remains inert.
  if (!probeConfig.apiOrigin) return;
  chrome.runtime.onStartup.addListener(() => { void syncCalendarInBackground(); });
  void syncCalendarInBackground();
}

/** Only trusted extension UI may request a diagnostic send or immediate sync. */
export function handleCalendarMessage(message: unknown, sender: chrome.runtime.MessageSender,
  respond: (result: { ok: boolean; result?: ObservationResult }) => void): boolean | undefined {
  if (!message || typeof message !== 'object' || !('type' in message) ||
    (message.type !== 'calendar-sync' && message.type !== 'observation-send')) return undefined;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html') ||
    (sender.frameId !== undefined && sender.frameId !== 0)) { respond({ ok: false }); return false; }
  void (async () => {
    try {
      if (message.type === 'calendar-sync') { await sync(); respond({ ok: true }); }
      else if ('observation' in message) {
        const result = await sendObservation(message.observation as Observation);
        respond({ ok: true, result });
      } else respond({ ok: false });
    } catch { respond({ ok: false }); }
  })();
  return true;
}
