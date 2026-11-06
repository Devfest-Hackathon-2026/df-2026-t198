import { manualDeadline } from './manual-assignment.js';
import type { CalendarDesired, CalendarItem, CalendarReport, DeadlineEvent, LedgerAssignment, PreparationPlan, ManualAssignment } from './types.js';

export function deadlineDesired(assignment: LedgerAssignment, courseName: string): CalendarDesired {
  const deadline = assignment.officialDeadline?.deadline;
  if (assignment.presenceState === 'cancelled' || assignment.presenceState === 'ended' || !deadline || (deadline.kind !== 'date' && deadline.kind !== 'datetime')) {
    return { state: 'deleted' };
  }
  const lines = [`締切：${deadline.dueText}`, `LMSで開く：${assignment.latest.url}`];
  const conflictDates = assignment.reviewReasons.filter(r => r.kind === 'conflicting-deadline')
    .flatMap(r => r.detail.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g)?.slice(0, 1) ?? []);
  if (conflictDates.length) lines.push(`要確認：課題の欄 ${deadline.kind === 'date' ? deadline.date : deadline.dueAt} ／ お知らせ ${[...new Set(conflictDates)].join('、')}`);
  if (deadline.kind === 'datetime') lines.push('予定は5分間の目印です。締切が5分延びる意味ではありません。');
  const endDate = deadline.kind === 'date' ? new Date(`${deadline.date}T00:00:00Z`) : null;
  endDate?.setUTCDate(endDate.getUTCDate() + 1);
  return { state: 'present', event: {
    summary: `${assignment.reviewReasons.length ? '【要確認】' : ''}${courseName}：${assignment.latest.title}`,
    description: lines.join('\n').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    start: deadline.kind === 'date' ? { date: deadline.date } : { dateTime: deadline.dueAt, timeZone: deadline.timeZone },
    end: deadline.kind === 'date' ? { date: endDate!.toISOString().slice(0, 10) }
      : { dateTime: new Date(Date.parse(deadline.dueAt) + 5 * 60_000).toISOString(), timeZone: deadline.timeZone },
    transparency: 'transparent', reminders: { useDefault: assignment.submission !== 'submitted' },
  } };
}

export function manualDeadlineDesired(assignment: ManualAssignment): CalendarDesired {
  if (assignment.status === 'cancelled') return { state: 'deleted' };
  const deadline = manualDeadline(assignment);
  const end = new Date(`${assignment.date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const description = `手で入れた課題（${assignment.createdByRole === 'student' ? '学生' : '支援担当'}が入れました）\n締切：${deadline.dueText}`;
  return { state: 'present', event: {
    summary: `${assignment.courseName ? `${assignment.courseName}：` : ''}${assignment.title}`,
    description: (description + (deadline.kind === 'datetime' ? '\n予定は5分間の目印です。締切が5分延びる意味ではありません。' : ''))
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    start: deadline.kind === 'datetime' ? { dateTime: deadline.dueAt, timeZone: deadline.timeZone } : { date: assignment.date },
    end: deadline.kind === 'datetime' ? { dateTime: new Date(Date.parse(deadline.dueAt) + 300_000).toISOString(), timeZone: deadline.timeZone }
      : { date: end.toISOString().slice(0, 10) },
    transparency: 'transparent', reminders: { useDefault: true },
  } };
}

function desiredSignature(desired: CalendarDesired): string {
  if (desired.state === 'deleted') return 'deleted';
  const time = (value: DeadlineEvent['start']) => 'date' in value
    ? ['date', value.date] : ['datetime', value.dateTime, value.timeZone];
  const event = desired.event;
  return JSON.stringify([event.summary, event.description, time(event.start), time(event.end),
    event.transparency, event.reminders.useDefault]);
}

export function reconcileCalendarItem(previous: CalendarItem | undefined, itemKey: string,
  assignment: LedgerAssignment, courseName: string, calendarId: string | null, newEventId: () => string): CalendarItem | undefined {
  return reconcileDesiredCalendarItem(previous, { itemKey, kind: 'deadline', sourceKey: assignment.key },
    deadlineDesired(assignment, courseName), calendarId, newEventId);
}

export function preparationDesired(plan: PreparationPlan): CalendarDesired {
  if (plan.status === 'cancelled') return { state: 'deleted' };
  return { state: 'present', event: {
    summary: `準備：${plan.title}`, description: `${plan.createdByRole === 'student' ? '学生' : '支援担当'}が入れた準備の予定です。`,
    start: { dateTime: plan.startsAt, timeZone: plan.timeZone }, end: { dateTime: plan.endsAt, timeZone: plan.timeZone },
    transparency: 'transparent', reminders: { useDefault: true },
  } };
}

export function reconcileDesiredCalendarItem(previous: CalendarItem | undefined,
  source: Pick<CalendarItem, 'itemKey' | 'kind' | 'sourceKey'>, desired: CalendarDesired,
  calendarId: string | null, newEventId: () => string): CalendarItem | undefined {
  if (!previous && desired.state === 'deleted') return undefined;
  // Finish an uncertain deletion before giving a restored assignment a new ID.
  if (previous?.desired.state === 'deleted' && previous.appliedRevision !== previous.desiredRevision) return previous;
  if (previous && desiredSignature(previous.desired) === desiredSignature(desired) && previous.calendarId === calendarId) return previous;
  const regenerate = !previous || (previous.desired.state === 'deleted' && desired.state === 'present');
  return {
    ...source, calendarId,
    eventId: regenerate ? newEventId() : previous.eventId,
    generation: (previous?.generation ?? 0) + (regenerate ? 1 : 0),
    desiredRevision: (previous?.desiredRevision ?? 0) + 1, desired,
    appliedRevision: previous?.appliedRevision ?? 0, appliedAt: previous?.appliedAt ?? null,
    lastAttemptedAt: previous?.lastAttemptedAt ?? null, lastErrorCode: null,
  };
}

export function acknowledgeCalendarItem(item: CalendarItem, report: CalendarReport, now: string): CalendarItem {
  if (item.itemKey !== report.itemKey || item.generation !== report.generation || item.eventId !== report.eventId ||
    item.desiredRevision !== report.revision || item.appliedRevision === report.revision) return item;
  return { ...item, lastAttemptedAt: now, lastErrorCode: report.errorCode,
    ...(report.errorCode === null ? { appliedRevision: report.revision, appliedAt: now } : {}) };
}

export type { CalendarDesired, CalendarItem, CalendarReport, CalendarIntegration, Course, LedgerAssignment, PreparationPlan, ManualAssignment } from './types.js';
