import type { AssignmentChange, Course, Deadline, FetchState, LedgerAssignment, LmsSystem,
  PreparationCandidate, PreparationPlan, SessionContext } from '../../core/src/types';

export interface SessionData {
  assignments: LedgerAssignment[];
  changes: AssignmentChange[];
  context: SessionContext;
  courses: (Course & { system: LmsSystem })[];
  fetchStates: FetchState[];
  plans: PreparationPlan[];
}
export const emptySession = (): SessionData => ({ assignments: [], changes: [], courses: [], fetchStates: [], plans: [],
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
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadline.dueAt));
    case 'none': return '締切なし';
    case 'unreadable': return '締切を確認できませんでした';
  }
}
const changeLabels: Record<AssignmentChange['kind'], string> = { new: '課題が出ました', 'title-changed': '題名が変わりました',
  'deadline-changed': '締切が変わりました', submitted: '提出しました', 'cancellation-candidate': '一覧に見当たりません',
  cancelled: '課題が取り消されました', restored: '一覧に戻りました' };
export function changeDescription(change: AssignmentChange) {
  const value = (v: AssignmentChange['before']) => typeof v === 'string' ? v : v ? formatDeadline(v) : '—';
  if (change.kind === 'deadline-changed') return `締切が ${value(change.before)} から ${value(change.after)} に変わりました`;
  return changeLabels[change.kind] + (change.kind === 'title-changed'
    ? `：${value(change.before)} → ${value(change.after)}` : '');
}
export function reviewDescription(row: LedgerAssignment) {
  const reason = row.reviewReasons[0];
  if (!reason) return row.presenceState === 'cancellation-candidate' ? 'LMSの一覧で見つかりませんでした。' : '';
  return reason.kind === 'unreadable-deadline' ? '今回、課題の締切を読めませんでした。'
    : reason.detail || '課題とお知らせの日付が食い違っています。';
}

// Period times are not configured yet. Use only whole future days before the due date.
export function preparationCandidates(data: SessionData, now: Date): PreparationCandidate[] {
  const candidates: PreparationCandidate[] = [];
  const periods = Math.max(5, ...data.courses.flatMap(course => course.slots.map(slot => slot.period)));
  for (const row of buildSessionView(data, now).deadlines) {
    const deadline = row.officialDeadline!.deadline;
    if (deadline.kind !== 'date' && deadline.kind !== 'datetime') continue;
    // The timetable is in Japan time; compare a datetime deadline's date in that zone too.
    const dueDate = deadline.kind === 'date' ? deadline.date : dayInZone(new Date(deadline.dueAt), 'Asia/Tokyo');
    const cursor = new Date(`${dayInZone(now, 'Asia/Tokyo')}T00:00:00Z`);
    let count = 0;
    while (count < 2) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const date = cursor.toISOString().slice(0, 10);
      if (date >= dueDate) break;
      const weekday = cursor.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (let period = 1; period <= periods && count < 2; period++) {
        if (data.courses.some(course => course.slots.some(slot => slot.weekday === weekday && slot.period === period))) continue;
        candidates.push({ assignment: row.key, date, period }); count++;
      }
    }
  }
  return candidates;
}
