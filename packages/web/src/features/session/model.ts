import { dayInZone, formatDeadline } from '../../shared/assignments/deadline-format';
import { deadlineEntries, entryDeadline } from '../../shared/assignments/deadline-entries';
import { preparationSlots } from '@kadai-hisho/core';
import { reviewReasonText } from '../../shared/assignments/review-reason';
import type { AssignmentChange, Course, Deadline, FetchState, LedgerAssignment, LmsSystem,
  PreparationCandidate, PreparationPlan, ManualAssignment, SessionContext } from '../../../../core/src/types';

export interface SessionData {
  assignments: LedgerAssignment[];
  changes: AssignmentChange[];
  context: SessionContext;
  courses: (Course & { system: LmsSystem })[];
  fetchStates: FetchState[];
  plans: PreparationPlan[];
  manualAssignments: ManualAssignment[];
}
export const emptySession = (): SessionData => ({ assignments: [], changes: [], courses: [], fetchStates: [], plans: [], manualAssignments: [],
  context: { lastSessionAt: null, nextSessionAt: null } });
export function buildSessionView(data: Pick<SessionData, 'assignments' | 'changes' | 'context'>, now: Date) {
  const { lastSessionAt, nextSessionAt } = data.context;
  const next = nextSessionAt ? new Date(nextSessionAt) : null;
  const deadlines = data.assignments.filter(row => {
    if (!next || row.submission === 'submitted' || row.presenceState === 'cancelled' || row.presenceState === 'ended') return false;
    const deadline = row.officialDeadline?.deadline;
    if (deadline?.kind === 'datetime') {
      const due = Date.parse(deadline.dueAt);
      return due >= now.getTime() && due <= next.getTime();
    }
    if (deadline?.kind === 'date') {
      return next.getTime() >= now.getTime() && deadline.date >= dayInZone(now, deadline.timeZone) &&
        deadline.date <= dayInZone(next, deadline.timeZone);
    }
    return false;
  }).sort((a, b) => deadlineSortKey(a.officialDeadline!.deadline).localeCompare(deadlineSortKey(b.officialDeadline!.deadline)));
  const changes = lastSessionAt ? data.changes.filter(change =>
    Date.parse(change.recordedAt) > Date.parse(lastSessionAt) && Date.parse(change.recordedAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)) : [];
  const review = data.assignments.filter(row => row.presenceState !== 'cancelled' && row.presenceState !== 'ended' && row.reviewReasons.length > 0);
  return { deadlines, changes, review };
}
export function sessionDeadlineEntries(data: SessionData, now: Date) {
  const next = data.context.nextSessionAt;
  if (!next || Date.parse(next) < now.getTime()) return [];
  return deadlineEntries(data.assignments, data.manualAssignments, now.getTime()).filter(entry => {
    const deadline = entryDeadline(entry);
    if (deadline?.kind === 'datetime') return Date.parse(deadline.dueAt) >= now.getTime() && Date.parse(deadline.dueAt) <= Date.parse(next);
    return deadline?.kind === 'date' && deadline.date >= dayInZone(now, deadline.timeZone) && deadline.date <= dayInZone(new Date(next), deadline.timeZone);
  });
}
function deadlineSortKey(deadline: Deadline) {
  if (deadline.kind === 'datetime') return dayInZone(new Date(deadline.dueAt), deadline.timeZone) + 'T' + deadline.dueAt;
  return deadline.kind === 'date' ? deadline.date : '';
}
const changeLabels: Record<AssignmentChange['kind'], string> = { new: '課題が出ました', 'title-changed': '題名が変わりました',
  'deadline-changed': '締切が変わりました', submitted: '提出しました', 'cancellation-candidate': '一覧に見当たりません',
  cancelled: '課題が取り消されました', restored: '一覧に戻りました', ended: '課題が終了しました' };
export function changeDescription(change: AssignmentChange) {
  const value = (v: AssignmentChange['before']) => typeof v === 'string' ? v : v ? formatDeadline(v) : '—';
  if (change.kind === 'deadline-changed') return `締切が ${value(change.before)} から ${value(change.after)} に変わりました`;
  return changeLabels[change.kind] + (change.kind === 'title-changed'
    ? `：${value(change.before)} → ${value(change.after)}` : '');
}
export function reviewDescription(row: LedgerAssignment) {
  const reason = row.reviewReasons[0];
  if (!reason) return row.presenceState === 'cancellation-candidate' ? 'LMSの一覧で見つかりませんでした。' : '';
  return reviewReasonText(reason, row.latest.deadline);
}

// Use whole future days before the due date, excluding all active preparation plans.
export function preparationCandidates(data: SessionData, now: Date): PreparationCandidate[] {
  const candidates: PreparationCandidate[] = [];
  for (const row of buildSessionView(data, now).deadlines) {
    const deadline = row.officialDeadline!.deadline;
    if (deadline.kind !== 'date' && deadline.kind !== 'datetime') continue;
    // The timetable is in Japan time; compare a datetime deadline's date in that zone too.
    const dueDate = deadline.kind === 'date' ? deadline.date : dayInZone(new Date(deadline.dueAt), 'Asia/Tokyo');
    candidates.push(...preparationSlots(row.key, dueDate, data.courses, now, 2, data.plans));
  }
  return candidates;
}

/** The header and timetable describe the same currently selected assignment. */
export function sessionPlanningView(data: SessionData, now: Date, selected = '') {
  const view = buildSessionView(data, now);
  const tasks = [...view.deadlines, ...view.review.filter(row => !view.deadlines.includes(row))];
  const task = tasks.find(row => JSON.stringify(row.key) === selected) ?? tasks[0];
  const candidates = preparationCandidates(data, now).filter(candidate =>
    candidate.assignment.system === task?.key.system && candidate.assignment.sourceId === task.key.sourceId);
  return { tasks, task, candidates };
}
