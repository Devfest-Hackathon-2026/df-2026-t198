import { firebaseAuth, observationIdentity, confirmGoogleIdentity } from '../auth/browser.js';
import { probeConfig, missingConfig } from '../auth/config.js';
import { gmailScopes, gmailScope } from '../auth/scopes.js';
import { encodeMail, japanDate, morningAt, parseDigest, type DigestMail } from './mail.js';

const preferenceKey = 'digestPreference';
const pollAlarm = 'digest-poll';
const morningAlarm = 'digest-morning';
const namespace = `${probeConfig.firebase.projectId}:${probeConfig.oauthClientId}`;
interface Preference { enabled: boolean; uid: string; namespace: string; problem?: string; problemDate?: string }
interface Receipt { date: string; planIds: string[] }
interface Schedule {
  date: string;
  checkedAt: number;
  plans: { planId: string; startsAt: string }[];
  requestedIds: string[];
}
const refreshInterval = 15 * 60_000;
type Identity = { uid: string; token: string; email: string };
let queue: Promise<void> = Promise.resolve();
let preferenceVersion = 0;

async function identity(): Promise<Identity> {
  if (missingConfig(probeConfig).length || !probeConfig.apiOrigin) throw new Error('authorization-required');
  const current = await observationIdentity();
  const user = firebaseAuth().currentUser;
  if (!current || !user?.email || current.uid !== user.uid) throw new Error('authorization-required');
  return { ...current, email: user.email };
}
async function preference(): Promise<Preference | undefined> {
  return (await chrome.storage.local.get(preferenceKey))[preferenceKey] as Preference | undefined;
}
function matches(saved: Preference | undefined, user: Identity): boolean {
  return saved?.enabled === true && saved.uid === user.uid && saved.namespace === namespace;
}
async function googleToken(user: Identity, interactive: boolean): Promise<string> {
  const result = await chrome.identity.getAuthToken({ interactive, scopes: gmailScopes })
    .catch(() => { throw new Error('authorization-required'); });
  if (!result.token || (result.grantedScopes && !result.grantedScopes.includes(gmailScope)) ||
    !await confirmGoogleIdentity(result.token, user.uid)) throw new Error('authorization-required');
  const current = await identity();
  if (current.uid !== user.uid || current.email.toLowerCase() !== user.email.toLowerCase()) throw new Error('authorization-required');
  return result.token;
}
async function clearAlarms() {
  await Promise.all([chrome.alarms.clear(pollAlarm), chrome.alarms.clear(morningAlarm)]);
}
async function ensureAlarms(now: Date) {
  if (!await chrome.alarms.get(pollAlarm)) await chrome.alarms.create(pollAlarm, { periodInMinutes: 1 });
  const today = morningAt(japanDate(now));
  const when = today > now.getTime() ? today : today + 86_400_000;
  if ((await chrome.alarms.get(morningAlarm))?.scheduledTime !== when) await chrome.alarms.create(morningAlarm, { when });
}
async function requestDigest(user: Identity, date: string) {
  const response = await fetch(`${probeConfig.apiOrigin}/api/v1/digest`, { method: 'GET',
    headers: { Authorization: `Bearer ${user.token}` }, credentials: 'omit', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('digest-unavailable');
  return parseDigest(await response.json(), date);
}
async function deliveryOwner(user: Identity): Promise<'none' | 'extension' | 'cloud' | null> {
  const response = await fetch(`${probeConfig.apiOrigin}/api/v1/digest/delivery`, { method: 'GET',
    headers: { Authorization: `Bearer ${user.token}` }, credentials: 'omit', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('digest-unavailable');
  const setting = await response.json() as { enabled?: unknown; deliveryOwner?: unknown } | null;
  return typeof setting?.enabled === 'boolean' &&
    (setting.deliveryOwner === 'none' || setting.deliveryOwner === 'extension' || setting.deliveryOwner === 'cloud')
    ? setting.deliveryOwner : null;
}
async function updateProblem(user: Identity, version: number, problem?: string) {
  const saved = await preference();
  if (!matches(saved, user) || version !== preferenceVersion) return;
  await chrome.storage.local.set({ [preferenceKey]: { enabled: true, uid: user.uid, namespace,
    ...(problem ? { problem, problemDate: japanDate(new Date()) } : {}) } });
}
function duePlan(plan: { startsAt: string }, now: number): boolean {
  const start = Date.parse(plan.startsAt);
  return now >= start - 30 * 60_000 && now < start;
}
async function tick() {
  const version = preferenceVersion;
  const saved = await preference();
  if (!saved?.enabled) { await clearAlarms(); return; }
  const now = new Date();
  await ensureAlarms(now);
  const user = await identity();
  if (!matches(saved, user)) return;
  const date = japanDate(now);
  if (saved.problem && saved.problemDate !== date) await updateProblem(user, version);
  const receiptKey = `digestReceipt:${namespace}:${user.uid}`;
  const scheduleKey = `digestSchedule:${namespace}:${user.uid}`;
  const stored = await chrome.storage.local.get([receiptKey, scheduleKey]);
  const prior = stored[receiptKey] as Receipt | undefined;
  const receipt: Receipt = prior?.date === date ? prior : { date, planIds: [] };
  const previous = stored[scheduleKey] as Schedule | undefined;
  const schedule: Schedule = previous?.date === date ? previous : { date, checkedAt: 0, plans: [], requestedIds: [] };
  const wanted = [
    ...(now.getTime() >= morningAt(date) ? ['morning'] : []),
    ...schedule.plans.filter(plan => duePlan(plan, now.getTime())).map(plan => plan.planId),
  ].filter(id => !receipt.planIds.includes(id) && !schedule.requestedIds.includes(id));
  if (!wanted.length && now.getTime() - schedule.checkedAt < refreshInterval) return;
  // Persist attempts before GET, including failures, so worker restarts cannot amplify polling.
  schedule.checkedAt = now.getTime();
  schedule.requestedIds.push(...wanted);
  await chrome.storage.local.set({ [scheduleKey]: schedule });
  const digest = await requestDigest(user, date);
  schedule.plans = digest.plans.map(({ planId, startsAt }) => ({ planId, startsAt }));
  // A regular refresh may discover an already-due plan: it has also been checked now.
  schedule.requestedIds = [...new Set([...schedule.requestedIds,
    ...schedule.plans.filter(plan => duePlan(plan, now.getTime())).map(plan => plan.planId)])];
  await chrome.storage.local.set({ [scheduleKey]: schedule });
  const due: { id: string; mail: DigestMail; expiresAt?: number }[] = [];
  if (!digest.empty) {
    if (now.getTime() >= morningAt(date) && !receipt.planIds.includes('morning')) due.push({ id: 'morning', mail: digest });
    for (const plan of digest.plans) {
      if (duePlan(plan, now.getTime()) && !receipt.planIds.includes(plan.planId)) {
        due.push({ id: plan.planId, expiresAt: Date.parse(plan.startsAt),
          mail: { to: digest.to, subject: plan.subject, text: plan.text, html: plan.html } });
      }
    }
  }
  // Unknown delivery remains visible for this day; recoverable errors clear on a healthy response.
  let problem = saved.problemDate === date && saved.problem === 'send-unconfirmed' ? saved.problem : undefined;
  if (!due.length) { await updateProblem(user, version, problem); return; }
  const token = await googleToken(user, false);
  const session = await chrome.storage.session.get('ynuSessionId');
  const secrets = [user.token, token, typeof session['ynuSessionId'] === 'string' ? session['ynuSessionId'] : ''];
  for (const item of due) {
    try {
      const delivery = await deliveryOwner(await identity());
      if (delivery !== 'none' && delivery !== 'extension') return;
      // Complete asynchronous identity/consent checks before reserving a send.
      const current = await identity();
      const consent = await preference();
      if (!matches(consent, current) || current.uid !== user.uid || current.email.toLowerCase() !== user.email.toLowerCase() ||
        version !== preferenceVersion || japanDate(new Date()) !== date) return;
      if (item.expiresAt !== undefined && Date.now() >= item.expiresAt) continue;
      const raw = encodeMail(item.mail, current.email, [...secrets, current.token]);
      if (receipt.planIds.includes(item.id)) continue;
      // Gmail has no idempotency key: reserve immediately before POST, including a lost response.
      receipt.planIds.push(item.id);
      await chrome.storage.local.set({ [receiptKey]: receipt });
      const owner = firebaseAuth().currentUser;
      const stopped = version !== preferenceVersion || owner?.uid !== user.uid || owner.email?.toLowerCase() !== user.email.toLowerCase() ||
        japanDate(new Date()) !== date;
      if (stopped || (item.expiresAt !== undefined && Date.now() >= item.expiresAt)) {
        receipt.planIds = receipt.planIds.filter(id => id !== item.id);
        await chrome.storage.local.set({ [receiptKey]: receipt });
        if (stopped) return;
        continue;
      }
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) })
        .catch(() => { throw new Error('send-unconfirmed'); });
      if ([400, 401, 403, 429].includes(response.status)) {
        // Confirmed rejection: release only this mail. The 15-minute refresh still throttles retries.
        receipt.planIds = receipt.planIds.filter(id => id !== item.id);
        await chrome.storage.local.set({ [receiptKey]: receipt });
        if (response.status === 401) await chrome.identity.removeCachedAuthToken({ token });
        throw new Error(response.status === 401 ? 'authorization-required' : 'digest-unavailable');
      }
      if (!response.ok) throw new Error('send-unconfirmed');
    } catch (error) {
      // One rejected mail must not suppress unrelated reminders.
      const failure = digestProblem(error);
      if (problem !== 'send-unconfirmed') problem = failure;
    }
  }
  await updateProblem(user, version, problem);
}
function digestProblem(error: unknown): string {
  return error instanceof Error && ['authorization-required', 'send-unconfirmed', 'unsafe-digest', 'invalid-digest'].includes(error.message)
    ? error.message : 'digest-unavailable';
}
export function runDigest(): Promise<void> {
  queue = queue.then(tick).catch(async error => {
    // Do not retain or display response bodies, exceptions or message contents.
    const saved = await preference();
    const problem = digestProblem(error);
    if (saved?.enabled) await chrome.storage.local.set({ [preferenceKey]: { ...saved, problem, problemDate: japanDate(new Date()) } });
  }).catch(() => undefined);
  return queue;
}
export function startDigest() {
  if (!chrome.alarms) return;
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === pollAlarm || alarm.name === morningAlarm) void runDigest(); });
  chrome.runtime.onStartup.addListener(() => { void runDigest(); });
  chrome.runtime.onInstalled.addListener(() => { void runDigest(); });
}

export interface DigestStatus { ok: boolean; enabled: boolean; problem?: string; cloudOwned?: boolean }
export function handleDigestMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (status: DigestStatus) => void): boolean | undefined {
  if (!message || typeof message !== 'object' || !('type' in message) ||
    (message.type !== 'digest-status' && message.type !== 'digest-setting')) return undefined;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html') ||
    (sender.frameId !== undefined && sender.frameId !== 0)) { respond({ ok: false, enabled: false }); return false; }
  const version = message.type === 'digest-setting' ? ++preferenceVersion : preferenceVersion;
  void (async () => {
    try {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      const saved = await preference();
      if (message.type === 'digest-setting') {
        if (!('enabled' in message) || typeof message.enabled !== 'boolean') throw new Error('invalid-setting');
        if (version !== preferenceVersion) throw new Error('setting-changed');
        if (!message.enabled) {
          if (saved) await chrome.storage.local.set({ [preferenceKey]: { ...saved, enabled: false } });
          await clearAlarms(); respond({ ok: true, enabled: false }); return;
        }
        const user = await identity();
        const owner = await deliveryOwner(user);
        if (owner === 'cloud') { respond({ ok: true, enabled: false, cloudOwned: true }); return; }
        if (owner === null) throw new Error('digest-unavailable');
        await googleToken(user, true);
        if (version !== preferenceVersion) throw new Error('setting-changed');
        await chrome.storage.local.set({ [preferenceKey]: { enabled: true, uid: user.uid, namespace } });
        await ensureAlarms(new Date());
        respond({ ok: true, enabled: true }); void runDigest(); return;
      }
      if (!firebaseAuth().currentUser && !saved?.enabled) { respond({ ok: true, enabled: false }); return; }
      const user = await identity();
      if (await deliveryOwner(user) === 'cloud') { respond({ ok: true, enabled: false, cloudOwned: true }); return; }
      if (!saved?.enabled) { respond({ ok: true, enabled: false }); return; }
      respond({ ok: true, enabled: matches(saved, user), ...(saved.problem ? { problem: saved.problem } : {}) });
    } catch { respond({ ok: false, enabled: false, problem: 'authorization-required' }); }
  })();
  return true;
}
