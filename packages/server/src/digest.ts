import type { Course, Deadline, LedgerAssignment, LmsSystem, PreparationPlan } from '@kadai-hisho/core';

export type DigestDeadline = ({ kind: 'datetime'; dueAt: string } | { kind: 'date'; date: string } |
  { kind: 'none' | 'unreadable' }) & { timeZone: string };
export interface DigestAssignment { title: string; courseName: string; deadline: DigestDeadline | null; url: string }
export interface DigestPlan extends DigestAssignment {
  planId: string; date: string; period: number; startsAt: string; endsAt: string; status: 'active';
  doneUrl: string; laterUrl: string; subject: string; text: string; html: string;
}
export interface Digest {
  date: string; to: string; subject: string; text: string; html: string; empty: boolean;
  plans: DigestPlan[]; assignments: DigestAssignment[];
}
export const japanDay = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function safeText(value: string) {
  let decoded = value;
  for (let i = 0; i < 4; i++) {
    if (/\b(?:sid|jsessionid|session[_-]?id|cookie|authorization|(?:access|refresh|id)[_-]?token)\s*[:=]|\bbearer\s+\S+/i.test(decoded)) throw new Error('unsafe-digest-source');
    try { const next = decodeURIComponent(decoded); if (next === decoded) return value; decoded = next; }
    catch { return value; }
  }
  throw new Error('unsafe-digest-source');
}
function safeUrl(value: string) {
  safeText(value);
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash ||
    [...url.searchParams.keys()].some(key => /sid|session|cookie|token|auth|password|secret|api[_-]?key/i.test(key))) throw new Error('unsafe-digest-source');
  return value;
}
function cleanDeadline(deadline: Deadline | undefined): DigestDeadline | null {
  if (!deadline) return null;
  const { kind, timeZone } = deadline;
  if (kind === 'datetime') return { kind, timeZone, dueAt: deadline.dueAt };
  if (kind === 'date') return { kind, timeZone, date: deadline.date };
  return { kind, timeZone };
}
function deadlineLabel(value: DigestDeadline | null) {
  if (!value || value.kind === 'unreadable') return 'LMSで確かめてください';
  if (value.kind === 'none') return 'ありません';
  if (value.kind === 'date') return `${value.date.slice(5).replace('-', '/')}（日付のみ）`;
  if (value.kind !== 'datetime') return 'LMSで確かめてください';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: value.timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value.dueAt));
}
function nearDeadline(row: LedgerAssignment, now: Date) {
  const value = row.officialDeadline?.deadline;
  if (value?.kind === 'datetime') return Date.parse(value.dueAt) >= now.getTime() && Date.parse(value.dueAt) <= now.getTime() + 48 * 3600_000;
  // A date-only deadline intersects the window; do not invent a deadline time.
  if (value?.kind === 'date') {
    const day = (at: number) => new Date(at).toLocaleDateString('sv-SE', { timeZone: value.timeZone });
    return value.date >= day(now.getTime()) && value.date <= day(now.getTime() + 48 * 3600_000);
  }
  return false;
}
export function buildDigest(to: string, plans: PreparationPlan[], assignments: LedgerAssignment[],
  courses: (Course & { system: LmsSystem })[], origin: string, now = new Date()): Digest {
  const date = japanDay(now);
  const pending = assignments.filter(row => row.submission !== 'submitted' && row.presenceState !== 'cancelled');
  const summary = (row: LedgerAssignment): DigestAssignment => ({ title: safeText(row.latest.title),
    courseName: safeText(courses.find(course => course.system === row.key.system && course.courseId === row.latest.courseId)?.name ?? '授業'),
    deadline: cleanDeadline(row.officialDeadline?.deadline), url: safeUrl(row.latest.url) });
  const subject = `今日やること（${date.replaceAll('-', '/')}）`;
  const today: DigestPlan[] = plans.filter(plan => plan.status === 'active' && plan.date === date).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.planId.localeCompare(b.planId)).flatMap(plan => {
    const row = pending.find(row => row.key.system === plan.assignment.system && row.key.sourceId === plan.assignment.sourceId);
    if (!row) return [];
    const task = summary(row);
    const link = (action: string) => new URL(`/student/plan?id=${encodeURIComponent(plan.planId)}&do=${action}`, origin).href;
    const doneUrl = link('done'); const laterUrl = link('later');
    const line = `今日 ${plan.period}限（${plan.startsAt.slice(11, 16)}〜）：${task.title}の準備。締切は${deadlineLabel(task.deadline)}。`;
    const text = `${line}\n${task.courseName}\nLMSで見る：${task.url}\n終わった：${doneUrl}\n後回し：${laterUrl}\n「終わった」は準備の記録です。LMSへの提出は別に行ってください。`;
    const html = `<article><p>${escape(line)}</p><p>${escape(task.courseName)}</p><p><a href="${escape(task.url)}">LMSで見る</a></p><p><a href="${escape(doneUrl)}">終わった</a> <a href="${escape(laterUrl)}">後回し</a></p><p>「終わった」は準備の記録です。LMSへの提出は別に行ってください。</p></article>`;
    return [{ ...task, planId: plan.planId, date, period: plan.period, startsAt: plan.startsAt, endsAt: plan.endsAt,
      status: 'active' as const, doneUrl, laterUrl, subject, text, html }];
  });
  const order = (task: DigestAssignment) => task.deadline?.kind === 'datetime' ? Date.parse(task.deadline.dueAt) :
    task.deadline?.kind === 'date' ? Date.parse(`${task.deadline.date}T00:00:00+09:00`) : Infinity;
  const due = pending.filter(row => nearDeadline(row, now) && !plans.some(plan => plan.status === 'done' &&
    plan.assignment.system === row.key.system && plan.assignment.sourceId === row.key.sourceId)).map(summary)
    .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title));
  const lines = due.map(task => `${task.title}の締切は${deadlineLabel(task.deadline)}。${task.courseName}\nLMSで見る：${task.url}`);
  return { date, to, subject, empty: !today.length && !due.length, plans: today, assignments: due,
    text: [...today.map(plan => plan.text), ...lines].join('\n\n'),
    html: `<div lang="ja">${today.map(plan => plan.html).join('')}${due.map((task, index) => `<article><p>${escape(lines[index]!.split('\n')[0]!)}</p><a href="${escape(task.url)}">LMSで見る</a></article>`).join('')}</div>` };
}
