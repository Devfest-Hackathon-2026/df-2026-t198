import { isSafeMailText } from '@kadai-hisho/core';
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
function safeUrl(value: string) {
  if (!isSafeMailText(value)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash &&
      ![...url.searchParams.keys()].some(key => /sid|session|cookie|token|auth|password|secret|api[_-]?key/i.test(key));
  } catch { return false; }
}
const mailLabel = (value: string) => value.replace(/\s+/g, ' ').trim();
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
// Button and note styles follow Sora's own mail design (ynu-lms-agent, 2026-11-07), so the two read alike.
const mailButtonStyle = 'display:inline-block;padding:15px 22px;margin:5px 8px 5px 0;border-radius:10px;text-decoration:none;font-weight:700;';
const mailNoteStyle = 'font-size:13px;color:#536171;line-height:1.7';
const mailNote = '返信の入力は不要です。リンク先で1回押すと記録されます。「終わった」は準備の記録で、LMSへの提出は別に行ってください。';
function mailButton(url: string, action: 'done' | 'later'): string {
  const look = action === 'done' ? 'background:#17694e;color:white' : 'background:#edf1f6;color:#263746';
  return `<a href="${escape(url)}" style="${mailButtonStyle}${look}">${action === 'done' ? '✅ 終わった' : '🕒 後回し'}</a>`;
}

export function buildDigest(to: string, plans: PreparationPlan[], assignments: LedgerAssignment[],
  courses: (Course & { system: LmsSystem })[], origin: string, now = new Date()): Digest {
  const date = japanDay(now);
  const pending = assignments.filter(row => row.submission !== 'submitted' && row.presenceState !== 'cancelled' && row.presenceState !== 'ended');
  const summary = (row: LedgerAssignment): DigestAssignment[] => {
    const title = mailLabel(row.latest.title);
    const courseName = mailLabel(courses.find(course => course.system === row.key.system && course.courseId === row.latest.courseId)?.name ?? '授業');
    if (!isSafeMailText(title) || !isSafeMailText(courseName) || !safeUrl(row.latest.url)) return [];
    return [{ title, courseName, deadline: cleanDeadline(row.officialDeadline?.deadline), url: row.latest.url }];
  };
  const subject = `今日やること（${date.replaceAll('-', '/')}）`;
  const today: DigestPlan[] = plans.filter(plan => plan.status === 'active' && plan.date === date).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.planId.localeCompare(b.planId)).flatMap(plan => {
    const row = pending.find(row => row.key.system === plan.assignment.system && row.key.sourceId === plan.assignment.sourceId);
    if (!row) return [];
    const task = summary(row)[0];
    if (!task) return [];
    const link = (action: string) => new URL(`/student/plan?id=${encodeURIComponent(plan.planId)}&do=${action}&rev=${plan.revision}`, origin).href;
    const doneUrl = link('done'); const laterUrl = link('later');
    const line = `今日 ${plan.startsAt.slice(11, 16)}〜${plan.endsAt.slice(11, 16)}：${task.title}に取り組む時間。締切は${deadlineLabel(task.deadline)}。`;
    const text = `${line}\n${task.courseName}\nLMSで見る：${task.url}\n✅ 終わった：${doneUrl}\n🕒 後回し：${laterUrl}\n${mailNote}`;
    const html = `<article><p style="font-weight:700;font-size:17px;margin:20px 0 6px">${escape(line)}</p><p style="margin:0 0 6px">${escape(task.courseName)}</p><p style="margin:0 0 6px"><a href="${escape(task.url)}">LMSで見る</a></p><p>${mailButton(doneUrl, 'done')}\n${mailButton(laterUrl, 'later')}</p><p style="${mailNoteStyle}">${escape(mailNote)}</p></article>`;
    return [{ ...task, planId: plan.planId, date, period: plan.period, startsAt: plan.startsAt, endsAt: plan.endsAt,
      status: 'active' as const, doneUrl, laterUrl, subject: `${plan.startsAt.slice(11, 16)}から：${task.title}の準備`, text, html }];
  });
  const order = (task: DigestAssignment) => task.deadline?.kind === 'datetime' ? Date.parse(task.deadline.dueAt) :
    task.deadline?.kind === 'date' ? Date.parse(`${task.deadline.date}T00:00:00+09:00`) : Infinity;
  const due = pending.filter(row => nearDeadline(row, now)).flatMap(summary)
    .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title));
  const lines = due.map(task => `${task.title}の締切は${deadlineLabel(task.deadline)}。${task.courseName}\nLMSで見る：${task.url}`);
  return { date, to, subject, empty: !today.length && !due.length, plans: today, assignments: due,
    text: [...today.map(plan => plan.text), ...lines].join('\n\n'),
    html: `<div lang="ja">${today.map(plan => plan.html).join('')}${due.map((task, index) => `<article><p>${escape(lines[index]!.split('\n')[0]!)}</p><a href="${escape(task.url)}">LMSで見る</a></article>`).join('')}</div>` };
}
