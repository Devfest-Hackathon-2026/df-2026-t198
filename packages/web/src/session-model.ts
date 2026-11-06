import type { AssignmentChange, Course, Deadline, FetchState, LedgerAssignment, LmsSystem,
  SessionContext } from '../../core/src/types';

export interface SessionData {
  assignments: LedgerAssignment[];
  changes: AssignmentChange[];
  context: SessionContext;
  courses: (Course & { system: LmsSystem })[];
  fetchStates: FetchState[];
}
export const emptySession = (): SessionData => ({ assignments: [], changes: [], courses: [], fetchStates: [],
  context: { lastSessionAt: null, nextSessionAt: null } });
export function dayInZone(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
export function buildSessionView(data: Pick<SessionData, 'assignments' | 'changes' | 'context'>, now: Date) {
  const { lastSessionAt, nextSessionAt } = data.context;
  const next = nextSessionAt ? new Date(nextSessionAt) : null;
  const deadlines = data.assignments.filter(row => {
    if (!next || row.submission === 'submitted' || row.presenceState === 'cancelled') return false;
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
  const review = data.assignments.filter(row => row.presenceState !== 'cancelled' && row.reviewReasons.length > 0);
  return { deadlines, changes, review };
}
function deadlineSortKey(deadline: Deadline) {
  if (deadline.kind === 'datetime') return dayInZone(new Date(deadline.dueAt), deadline.timeZone) + 'T' + deadline.dueAt;
  return deadline.kind === 'date' ? deadline.date : '';
}
export function formatMoment(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function formatDeadline(deadline: Deadline) {
  switch (deadline.kind) {
    case 'date': return `${deadline.date.replaceAll('-', '/')}（日付のみ）`;
    case 'datetime': return new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.timeZone,
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(deadline.dueAt)) + `（${deadline.timeZone}）`;
    case 'none': return '締切なし';
    case 'unreadable': return '締切を確認できませんでした';
  }
}
const changeLabels: Record<AssignmentChange['kind'], string> = { new: '課題が出ました', 'title-changed': '題名が変わりました',
  'deadline-changed': '締切が変わりました', submitted: '提出しました', 'cancellation-candidate': '一覧に見当たりません',
  cancelled: '課題が取り消されました', restored: '一覧に戻りました' };
export function changeDescription(change: AssignmentChange) {
  const value = (v: AssignmentChange['before']) => typeof v === 'string' ? v : v ? formatDeadline(v) : '—';
  return changeLabels[change.kind] + (change.kind === 'deadline-changed' || change.kind === 'title-changed'
    ? `：${value(change.before)} → ${value(change.after)}` : '');
}
export function reviewDescription(row: LedgerAssignment) {
  return row.reviewReasons.map(reason => reason.kind === 'unreadable-deadline'
    ? '今回、課題の締切を読めませんでした。LMSで日付を確かめます。'
    : reason.detail || '課題とお知らせの日付が食い違っています。LMSで日付を確かめます。').join(' ');
}
