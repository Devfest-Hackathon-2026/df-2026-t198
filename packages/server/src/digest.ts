import { readFileSync } from 'node:fs';
import { assignmentLmsLink, isSafeMailText, preparationAfterDeadline } from '@kadai-hisho/core';
import type { Course, Deadline, LedgerAssignment, LmsSystem, PreparationPlan } from '@kadai-hisho/core';

export type DigestDeadline = ({ kind: 'datetime'; dueAt: string } | { kind: 'date'; date: string } |
  { kind: 'none' | 'unreadable' }) & { timeZone: string };
export interface DigestAssignment { title: string; courseName: string; deadline: DigestDeadline | null; url: string; route: string | null }
export interface DigestPlan extends DigestAssignment {
  planId: string; date: string; period: number; startsAt: string; endsAt: string; status: 'active';
  doneUrl: string; laterUrl: string; subject: string; text: string; html: string;
}
export interface Digest {
  date: string; to: string; subject: string; text: string; html: string; empty: boolean;
  plans: DigestPlan[]; assignments: DigestAssignment[]; readyToSubmit: DigestAssignment[];
}
export const japanDay = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const navigationBySystem: Partial<Record<LmsSystem, { statefulSession: boolean; home: string }>> = {
  'ynu-lms': JSON.parse(readFileSync(new URL('../../../lms-definitions/coursepower/navigation.json', import.meta.url), 'utf8')),
};
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
const mailNote = '返信の入力は不要です。リンク先で1回押すと記録されます。「終わった」は準備の完了で、LMSへの提出の記録とは別です。提出はLMSで行ってください。';
function mailButton(url: string, action: 'done' | 'later'): string {
  const look = action === 'done' ? 'background:#17694e;color:white' : 'background:#edf1f6;color:#263746';
  return `<a href="${escape(url)}" style="${mailButtonStyle}${look}">${action === 'done' ? '✅ 終わった' : '🕒 後回し'}</a>`;
}

const submissionNote = '提出済みかどうかは、次にLMSを開いたときに確かめます。提出済みと分かると「次は提出」から消えます。';
const taskHeading = (task: DigestAssignment) => `${task.courseName}：${task.title}`;
const taskLinkText = (task: DigestAssignment) => `LMSを開く：${task.url}${task.route ? `\n道順：${task.route}` : ''}`;
const taskLinkHtml = (task: DigestAssignment) => `<p><a href="${escape(task.url)}">LMSを開く</a></p>${task.route ? `<p>道順：${escape(task.route)}</p>` : ''}`;
const taskText = (task: DigestAssignment, preparation = '') =>
  `${taskHeading(task)}\n${preparation ? `${preparation}\n` : ''}締切 ${deadlineLabel(task.deadline)}\n${taskLinkText(task)}`;
const taskHtml = (task: DigestAssignment, preparation = '', buttons = '') =>
  `<article><h3 style="font-size:17px;margin:20px 0 6px">${escape(taskHeading(task))}</h3>${preparation ? `<p>${escape(preparation)}</p>` : ''}<p>締切 ${escape(deadlineLabel(task.deadline))}</p>${buttons}${taskLinkHtml(task)}</article>`;
const noteHtml = `<p style="${mailNoteStyle}">${escape(mailNote)}</p>`;

export function buildDigest(to: string, plans: PreparationPlan[], assignments: LedgerAssignment[],
  courses: (Course & { system: LmsSystem })[], origin: string, now = new Date()): Digest {
  const date = japanDay(now);
  const pending = assignments.filter(row => row.submission !== 'submitted' && row.presenceState !== 'cancelled' && row.presenceState !== 'ended');
  const summary = (row: LedgerAssignment): DigestAssignment[] => {
    const title = mailLabel(row.latest.title);
    const courseName = mailLabel(courses.find(course => course.system === row.key.system && course.courseId === row.latest.courseId)?.name ?? '授業');
    const link = assignmentLmsLink(row.latest.url, courseName, title, navigationBySystem[row.key.system], (value, base) => new URL(value, base));
    if (!isSafeMailText(title) || !isSafeMailText(courseName) || !link) return [];
    return [{ title, courseName, deadline: cleanDeadline(row.officialDeadline?.deadline), ...link }];
  };
  const subject = `今日やること（${date.replaceAll('-', '/')}）`;
  const today: DigestPlan[] = plans.filter(plan => plan.status === 'active' && plan.date === date).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.planId.localeCompare(b.planId)).flatMap(plan => {
    const row = pending.find(row => row.key.system === plan.assignment.system && row.key.sourceId === plan.assignment.sourceId);
    if (!row) return [];
    const task = summary(row)[0];
    if (!task) return [];
    const link = (action: string) => new URL(`/student/plan?id=${encodeURIComponent(plan.planId)}&do=${action}&rev=${plan.revision}`, origin).href;
    const doneUrl = link('done'); const laterUrl = link('later');
    const line = `今日 ${plan.startsAt.slice(11, 16)}〜${plan.endsAt.slice(11, 16)} に準備`;
    const text = `${taskText(task, line)}\n✅ 終わった：${doneUrl}\n🕒 後回し：${laterUrl}\n${mailNote}`;
    const html = taskHtml(task, line, `<p>${mailButton(doneUrl, 'done')}\n${mailButton(laterUrl, 'later')}</p>`) + noteHtml;
    return [{ ...task, planId: plan.planId, date, period: plan.period, startsAt: plan.startsAt, endsAt: plan.endsAt,
      status: 'active' as const, doneUrl, laterUrl, subject: `${plan.startsAt.slice(11, 16)}から：${task.title}の準備`, text, html }];
  });
  const order = (task: DigestAssignment) => task.deadline?.kind === 'datetime' ? Date.parse(task.deadline.dueAt) :
    task.deadline?.kind === 'date' ? Date.parse(`${task.deadline.date}T00:00:00+09:00`) : Infinity;
  const byDeadline = (a: DigestAssignment, b: DigestAssignment) => order(a) - order(b) || a.title.localeCompare(b.title);
  const due = pending.filter(row => nearDeadline(row, now)).flatMap(summary).sort(byDeadline);
  const completed = new Set(plans.filter(plan => plan.status === 'done').map(plan => JSON.stringify([plan.assignment.system, plan.assignment.sourceId])));
  const readyRows = pending.filter(row => completed.has(JSON.stringify([row.key.system, row.key.sourceId])) &&
    !preparationAfterDeadline(now.toISOString(), row.officialDeadline?.deadline));
  const readyToSubmit = readyRows.flatMap(summary).sort(byDeadline);
  // Keep the API's near-deadline list intact; each submission task appears once in the mail.
  const upcoming = pending.filter(row => nearDeadline(row, now) && !readyRows.includes(row)).flatMap(summary).sort(byDeadline);
  const introduction = today.length ? `今日の準備は${today.length}つです。` : '締切と、これからの提出をお知らせします。';
  const planText = today.map(plan => taskText(plan, `今日 ${plan.startsAt.slice(11, 16)}〜${plan.endsAt.slice(11, 16)} に準備`) +
    `\n✅ 終わった：${plan.doneUrl}\n🕒 後回し：${plan.laterUrl}`);
  const planHtml = today.map(plan => taskHtml(plan, `今日 ${plan.startsAt.slice(11, 16)}〜${plan.endsAt.slice(11, 16)} に準備`,
    `<p>${mailButton(plan.doneUrl, 'done')}\n${mailButton(plan.laterUrl, 'later')}</p>`)).join('');
  return { date, to, subject, empty: !today.length && !due.length && !readyToSubmit.length, plans: today, assignments: due, readyToSubmit,
    text: [introduction, ...planText, ...(readyToSubmit.length ? ['次は提出', submissionNote, ...readyToSubmit.map(task => taskText(task))] : []),
      ...(upcoming.length ? ['48時間以内の締切', ...upcoming.map(task => taskText(task))] : []), mailNote].join('\n\n'),
    html: `<div lang="ja"><p>${introduction}</p>${planHtml}${readyToSubmit.length ? `<section aria-label="次は提出"><h2>次は提出</h2><p>${submissionNote}</p>${readyToSubmit.map(task => taskHtml(task)).join('')}</section>` : ''}${upcoming.length ? `<section><h2>48時間以内の締切</h2>${upcoming.map(task => taskHtml(task)).join('')}</section>` : ''}${noteHtml}</div>` };
}
