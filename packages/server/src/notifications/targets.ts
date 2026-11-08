import { createHash } from 'node:crypto';
import { isSafeMailText, preparationAfterDeadline } from '@kadai-hisho/core';
import type { Course, FetchState, LedgerAssignment, LmsSystem, NotificationSettings,
  NotificationTarget, PreparationPlan } from '@kadai-hisho/core';
import { buildDigest, japanDay } from '../digest/digest.js';

export interface NotificationSnapshot {
  uid: string;
  demo: boolean;
  settings: NotificationSettings | undefined;
  plans: PreparationPlan[];
  assignments: LedgerAssignment[];
  courses: (Course & { system: LmsSystem })[];
  fetchStates: FetchState[];
}
export interface NotificationMessage { subject: string; text: string; html: string }
export function cloudNotificationsEnabled(snapshot: NotificationSnapshot): boolean {
  const s = snapshot.settings;
  return !snapshot.demo && s?.enabled === true && s.deliveryOwner === 'cloud' &&
    Number.isSafeInteger(s.version) && s.version > 0 && s.recipientUid === snapshot.uid &&
    s.migrationState === 'ready' && s.timeZone === 'Asia/Tokyo' && s.morningTime === '07:30';
}
const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function activeAssignments(snapshot: NotificationSnapshot, now: Date) {
  return snapshot.assignments.filter(row => row.key.system !== 'demo-lms' &&
    row.submission !== 'submitted' && row.presenceState !== 'cancelled' && row.presenceState !== 'ended' &&
    !preparationAfterDeadline(now.toISOString(), row.officialDeadline?.deadline));
}
function digest(snapshot: NotificationSnapshot, now: Date, origin: string) {
  const assignments = activeAssignments(snapshot, now);
  const plans = snapshot.plans.filter(p => p.status !== 'active' || (Date.parse(p.endsAt) > now.getTime() &&
    !preparationAfterDeadline(p.startsAt, assignments.find(row => row.key.system === p.assignment.system &&
      row.key.sourceId === p.assignment.sourceId)?.officialDeadline?.deadline)));
  return buildDigest('', plans, assignments, snapshot.courses, origin, now);
}
/** Extract reminders independently of today's digest, including tomorrow just after midnight. */
export function notificationTargets(snapshot: NotificationSnapshot, now: Date, origin: string): NotificationTarget[] {
  if (!cloudNotificationsEnabled(snapshot)) return [];
  const at = now.getTime(), day = japanDay(now);
  const morning = Date.parse(`${day}T07:30:00+09:00`), end = Date.parse(`${day}T08:00:00+09:00`);
  const targets: NotificationTarget[] = [];
  if (at >= morning && at < end && !digest(snapshot, now, origin).empty) targets.push({
    key: hash([snapshot.uid, day, 'morning']), kind: 'morning', scheduledAt: new Date(morning).toISOString(),
    expiresAt: new Date(end).toISOString(), planId: null, startsAt: null, planRevision: null,
  });
  for (const plan of snapshot.plans) {
    const starts = Date.parse(plan.startsAt);
    if (plan.status !== 'active' || !(at >= starts - 30 * 60_000 && at < starts)) continue;
    const row = activeAssignments(snapshot, now).find(row => row.key.system === plan.assignment.system && row.key.sourceId === plan.assignment.sourceId);
    if (!row || preparationAfterDeadline(plan.startsAt, row.officialDeadline?.deadline)) continue;
    // Only reuse the renderer at the plan's date; never use its "today" restriction as the selector.
    if (!buildDigest('', [plan], [row], snapshot.courses, origin, new Date(starts)).plans.length) continue;
    targets.push({ key: hash([snapshot.uid, plan.planId, new Date(starts).toISOString(), 'reminder']), kind: 'reminder',
      scheduledAt: new Date(starts - 30 * 60_000).toISOString(), expiresAt: new Date(starts).toISOString(),
      planId: plan.planId, startsAt: new Date(starts).toISOString(), planRevision: plan.revision });
  }
  return targets;
}
function freshness(snapshot: NotificationSnapshot, now: Date): string {
  const systems = new Set(activeAssignments(snapshot, now).map(row => row.key.system));
  return [...systems].map(system => {
    const state = snapshot.fetchStates.find(s => s.system === system);
    const date = state?.lastSucceededAt && new Date(state.lastSucceededAt);
    const valid = date && Number.isFinite(date.getTime());
    const label = valid ? date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hourCycle: 'h23' }) : '取得歴なし';
    const notes = [!valid || now.getTime() - date.getTime() >= 72 * 3600_000 ? '3日以上更新できていないか、取得時刻が不明です' : '',
      state?.lastResult === 'partial' ? '前回は一部だけ取得できました' : state?.lastResult === 'failed' ? '前回の取得は失敗しました' : ''].filter(Boolean);
    return `${system}：${label}（日本時間）${notes.length ? `。${notes.join('。')}` : ''}。PCを閉じている間のLMSの変更は反映されません。`;
  }).join('\n');
}
export function notificationMessage(snapshot: NotificationSnapshot, target: NotificationTarget, now: Date, origin: string): NotificationMessage {
  let body: NotificationMessage;
  if (target.kind === 'morning') body = digest(snapshot, now, origin);
  else {
    const plan = snapshot.plans.find(p => p.planId === target.planId)!;
    const rendered = buildDigest('', [plan], activeAssignments(snapshot, now), snapshot.courses, origin, new Date(plan.startsAt));
    const reminder = rendered.plans[0];
    if (!reminder) throw new Error('target-changed');
    const day = japanDay(new Date(plan.startsAt));
    body = { subject: `${day} ${reminder.subject}`, text: reminder.text.replaceAll('今日 ', `${day} `),
      html: reminder.html.replaceAll('今日 ', `${day} `) };
  }
  const note = freshness(snapshot, now);
  const text = `${body.text}\n\n情報の取得時点\n${note}`;
  const html = `${body.html}<p>情報の取得時点</p><p>${note.replaceAll('\n', '<br>')}</p>`;
  if (![body.subject, text, html].every(value => isSafeMailText(value))) throw new Error('unsafe-notification');
  return { subject: body.subject, text, html };
}
