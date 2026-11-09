import type { Deadline, PreparationPlan } from '@kadai-hisho/core';
import type { DeadlineEntry } from '../../shared/assignments/deadline-entries';
import { entryDeadline, entryId, entryTitle } from '../../shared/assignments/deadline-entries';
import { dayInZone } from '../../shared/assignments/deadline-format';
import { ChangedDeadline } from '../../shared/assignments/deadline-change';
import { LmsSourceLink } from '../../shared/assignments/lms-link';
import { useOperationMessage } from '../../shared/ui/operation-messages';
import { StatusChip } from '../../shared/ui';
import type { StudentCourse } from '../../shared/assignments/types';
import { useCourseColors } from '../../shared/course-color-context';
import { PlanControls } from '../plans/components';
import type { PlanActions } from '../plans/api';

export function deadlineDay(deadline: Deadline | undefined) {
  return deadline?.kind === 'date' ? deadline.date : deadline?.kind === 'datetime'
    ? dayInZone(new Date(deadline.dueAt), deadline.timeZone) : undefined;
}
export function remainingDays(deadline: Deadline | undefined, now: number) {
  const day = deadlineDay(deadline);
  if (!day || !deadline) return undefined;
  const days = Math.round((Date.parse(day) - Date.parse(dayInZone(new Date(now), deadline.timeZone))) / 86400000);
  // The due day reads "today", including after its time has passed.
  return days < 0 ? undefined : days === 0 ? '今日' : `あと${days}日`;
}
export function planTime(value: string) {
  return new Date(value).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
function planDay(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).replace('(', '（').replace(')', '）');
}
export function nextPreparation(entry: DeadlineEntry | undefined, plans: PreparationPlan[], now: number) {
  const active = plans.filter(plan => plan.status === 'active').sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const today = dayInZone(new Date(now), 'Asia/Tokyo');
  const current = active.find(plan => plan.date === today);
  if (current) return { today: current, future: undefined, hasPlans: true };
  const matching = entry?.kind === 'lms' ? active.filter(plan => plan.assignment.system === entry.row.key.system && plan.assignment.sourceId === entry.row.key.sourceId) : [];
  return { today: undefined, future: matching.find(plan => Date.parse(plan.startsAt) > now), hasPlans: matching.length > 0 };
}
export function NextAction({ entry, course, text, previous, now, changed, today, future, hasPlans, actions, onPrepare }: {
  entry?: DeadlineEntry | undefined; course?: StudentCourse | undefined; text: string; previous?: string | undefined; now: number; changed: boolean;
  today?: PreparationPlan | undefined; future?: PreparationPlan | undefined; hasPlans: boolean;
  actions?: PlanActions | undefined; onPrepare?: (() => void) | undefined;
}) {
  const color = useCourseColors();
  const [message, report] = useOperationMessage();
  const remaining = entry && remainingDays(entryDeadline(entry), now);
  const heading = today ? `今日 ${planTime(today.startsAt)}〜${planTime(today.endsAt)} に、準備をする`
    : future ? `次の準備は ${planDay(future.startsAt)}${planTime(future.startsAt)}`
    : entry && !hasPlans ? `${entryTitle(entry)}の、準備の時間を決める`
    : entry ? '準備の予定を確かめる' : 'いま急ぎの課題はありません';
  return <section className="rd-next" aria-label="次にやること" data-course-color={color(course)}>
    <p className="rd-next-eyebrow">次にやること {changed && <StatusChip status="changed" />}</p>
    <h2>{heading}</h2>
    {entry && <><p className="rd-next-course">{course?.name ?? '手で入れた課題'} · {entryTitle(entry)}</p>
      <div className="rd-next-when"><span>締切</span><ChangedDeadline key={entryId(entry)} value={text} previous={previous} highlight={changed} />{remaining && <span className="rd-next-left">{remaining}</span>}</div></>}
    {!entry && today && <p className="rd-next-course">{today.title}</p>}
    <div className="rd-next-actions">
      {today ? <PlanControls plan={today} actions={actions} primary now={now} report={report} />
        : !hasPlans && onPrepare && <button className="rd-next-prepare" onClick={onPrepare}>準備の予定を入れる</button>}
      {entry?.kind === 'lms' && <LmsSourceLink item={entry.row} courseName={course?.name ?? '授業'} label="LMSで見る" />}
    </div>{message && <p role="status">{message}</p>}
  </section>;
}
