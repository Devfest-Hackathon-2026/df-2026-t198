import { firebaseAuth, observationIdentity, confirmGoogleIdentity } from './auth-probe-browser.js';
import { probeConfig, missingConfig } from './probe-config.js';
import { gmailScopes, gmailScope } from './oauth-scopes.js';
import { encodeMail, japanDate, morningAt, parseDigest, type DigestMail } from './digest.js';

const preferenceKey = 'digestPreference';
const pollAlarm = 'digest-poll';
const morningAlarm = 'digest-morning';
const namespace = `${probeConfig.firebase.projectId}:${probeConfig.oauthClientId}`;
interface Preference { enabled: boolean; uid: string; namespace: string; problem?: string }
interface Receipt { date: string; planIds: string[] }
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
async function tick() {
  const version = preferenceVersion;
  const saved = await preference();
  if (!saved?.enabled) { await clearAlarms(); return; }
  const now = new Date();
  await ensureAlarms(now);
  const user = await identity();
  if (!matches(saved, user)) return;
  const date = japanDate(now);
  const digest = await requestDigest(user, date);
  if (digest.empty) return;
  const receiptKey = `digestReceipt:${namespace}:${user.uid}`;
  const prior = (await chrome.storage.local.get(receiptKey))[receiptKey] as Receipt | undefined;
  const receipt: Receipt = prior?.date === date ? prior : { date, planIds: [] };
  const due: { id: string; mail: DigestMail; expiresAt?: number }[] = [];
  if (now.getTime() >= morningAt(date) && !receipt.planIds.includes('morning')) due.push({ id: 'morning', mail: digest });
  for (const plan of digest.plans) {
    const start = Date.parse(plan.startsAt);
    if (now.getTime() >= start - 30 * 60_000 && now.getTime() < start && !receipt.planIds.includes(plan.planId)) {
      due.push({ id: plan.planId, expiresAt: start, mail: { to: digest.to, subject: plan.subject, text: plan.text, html: plan.html } });
    }
  }
  if (!due.length) return;
  const token = await googleToken(user, false);
  const session = await chrome.storage.session.get('ynuSessionId');
  const secrets = [user.token, token, typeof session['ynuSessionId'] === 'string' ? session['ynuSessionId'] : ''];
  for (const item of due) {
    // Recheck consent and identity after every asynchronous boundary before sending.
    const current = await identity();
    if (!matches(await preference(), current) || current.uid !== user.uid || version !== preferenceVersion || japanDate(new Date()) !== date) return;
    if (item.expiresAt !== undefined && Date.now() >= item.expiresAt) continue;
    const raw = encodeMail(item.mail, current.email, [...secrets, current.token]);
    if (receipt.planIds.includes(item.id)) continue;
    // Gmail has no idempotency key: reserve before POST, including a lost response.
    receipt.planIds.push(item.id);
    await chrome.storage.local.set({ [receiptKey]: receipt });
    const consent = await preference();
    const owner = await identity();
    if (!matches(consent, owner) || owner.uid !== user.uid || version !== preferenceVersion || japanDate(new Date()) !== date ||
      (item.expiresAt !== undefined && Date.now() >= item.expiresAt)) return;
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) })
      .catch(() => { throw new Error('send-unconfirmed'); });
    if (response.status === 401) await chrome.identity.removeCachedAuthToken({ token });
    if (!response.ok) throw new Error('send-unconfirmed');
  }
  const latest = await preference();
  if (matches(latest, user) && version === preferenceVersion && latest?.problem && latest.problem !== 'send-unconfirmed') {
    await chrome.storage.local.set({ [preferenceKey]: { enabled: true, uid: user.uid, namespace } });
  }
}
export function runDigest(): Promise<void> {
  queue = queue.then(tick).catch(async error => {
    // Do not retain or display response bodies, exceptions or message contents.
    const saved = await preference();
    const problem = error instanceof Error && ['authorization-required', 'send-unconfirmed', 'unsafe-digest', 'invalid-digest'].includes(error.message)
      ? error.message : 'digest-unavailable';
    if (saved?.enabled) await chrome.storage.local.set({ [preferenceKey]: { ...saved, problem } });
  }).catch(() => undefined);
  return queue;
}
export function startDigest() {
  if (!chrome.alarms) return;
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === pollAlarm || alarm.name === morningAlarm) void runDigest(); });
  chrome.runtime.onStartup.addListener(() => { void runDigest(); });
  void runDigest();
}

export interface DigestStatus { ok: boolean; enabled: boolean; problem?: string }
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
        await googleToken(user, true);
        if (version !== preferenceVersion) throw new Error('setting-changed');
        await chrome.storage.local.set({ [preferenceKey]: { enabled: true, uid: user.uid, namespace } });
        await ensureAlarms(new Date());
        respond({ ok: true, enabled: true }); void runDigest(); return;
      }
      if (!saved?.enabled) { respond({ ok: true, enabled: false }); return; }
      const user = await identity();
      respond({ ok: true, enabled: matches(saved, user), ...(saved.problem ? { problem: saved.problem } : {}) });
    } catch { respond({ ok: false, enabled: false, problem: 'authorization-required' }); }
  })();
  return true;
}
