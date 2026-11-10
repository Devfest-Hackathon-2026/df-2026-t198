import { HeaderAction } from '../../shared/ui/header-action';
import { deadlineDay, NextAction, nextPreparation } from './nearest';
import { Button, TaskRow, Tabs, FetchState, Skeleton, StatusChip } from '../../shared/ui';
import { ScrollFrame } from '../../shared/ui/scroll-frame';
import './student.css';
import { linkedCourses } from '../../../../core/src/course-links';
import { ManualAssignments, ManualAssignmentForm, ManualAssignmentRow, manualAuthor } from '../manual-assignments/components';
import { manualAssignmentActions, type ManualAssignmentActions } from '../manual-assignments/api';
import { deadlineEntries, entryBelongsTo, entryDeadline, entryDisplayDeadline, entryId, entryTitle, deadlineValue, manualAssignmentEnded } from '../../shared/assignments/deadline-entries';
import { PlanLinkAction } from '../plans/progress';
import { LmsSourceLink } from '../../shared/assignments/lms-link';
import { fetchStatus } from '../../shared/assignments/fetch-status';
import { missingDeadlineText, reviewReasonText } from '../../shared/assignments/review-reason';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Deadline, LedgerAssignment } from '../../../../core/src/types';
import { PlanCell, PlanControls, PlanForm, PlanList, PlanSummary } from '../plans/components';
import { planActions, type PlanActions } from '../plans/api';
import { DemoCalendar } from '../calendar/calendar';
import { ChangedDeadline, useDeadlineChanges } from '../../shared/assignments/deadline-change';
import { DemoLogin } from '../../shared/auth/demo-login';
import { OperationMessages, useOperationMessage } from '../../shared/ui/operation-messages';
import { firebase } from '../../shared/firebase';
import { watchAccount, type StudentState } from './data';
import { type StudentCourse, type StudentData } from '../../shared/assignments/types';
import { useNotificationSettings } from '../notifications/settings';
import { StudentSettings } from './settings';
import type { User } from 'firebase/auth';
import { CourseColorProvider, useCourseColors } from '../../shared/course-color-context';

export const courseKey = (course: StudentCourse) => JSON.stringify([course.system, course.courseId]);
const belongsTo = (item: LedgerAssignment, course: StudentCourse) =>
  item.key.system === course.system && item.latest.courseId === course.courseId;
const deadlineOf = (item: LedgerAssignment | undefined) => item?.officialDeadline?.deadline;
const displayDeadlineOf = (item: LedgerAssignment | undefined) => deadlineOf(item) ??
  (item?.latest.deadline.kind === 'unreadable' ? item.latest.deadline : undefined);
const dateKey = (deadline: Deadline | undefined) => deadline?.kind === 'datetime' ? Date.parse(deadline.dueAt) :
  deadline?.kind === 'date' ? Date.parse(`${deadline.date}T00:00:00Z`) : Infinity;
export function pending(items: LedgerAssignment[]) {
  return items.filter(item => item.submission !== 'submitted' && item.presenceState !== 'cancelled' && item.presenceState !== 'ended')
    .sort((a, b) => dateKey(deadlineOf(a)) - dateKey(deadlineOf(b)) || a.latest.title.localeCompare(b.latest.title, 'ja'));
}
function nextDeadlineText(deadline: Deadline | undefined) {
  if (deadline?.kind !== 'date' && deadline?.kind !== 'datetime') return deadlineText(deadline);
  const day = new Date(deadline.kind === 'date' ? `${deadline.date}T12:00:00Z` : deadline.dueAt);
  const date = new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.kind === 'date' ? 'UTC' : deadline.timeZone, month: 'numeric', day: 'numeric', weekday: 'short' }).format(day).replace('(', '（').replace(')', '）');
  return deadline.kind === 'date' ? date : date + new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(day);
}
export function deadlineText(deadline: Deadline | undefined) {
  const missing = missingDeadlineText(deadline);
  if (missing) return missing;
  if (!deadline || deadline.kind === 'unreadable') return '締切を確認できていません';
  if (deadline.kind === 'none') return '締切なし';
  if (deadline.kind === 'date') return `${Number(deadline.date.slice(5, 7))}/${Number(deadline.date.slice(8))}（日付のみ）`;
  if (deadline.kind !== 'datetime') return '締切を確認できていません';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.timeZone, month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadline.dueAt));
}
function Review({ item }: { item: LedgerAssignment }) {
  return <>{item.reviewReasons.map((reason, index) => <p className="review" key={index}>
    <span className="badge">要確認</span> {reason.kind === 'unreadable-deadline'
      ? missingDeadlineText(item.latest.deadline) ?? '今回、締切を読めませんでした。前に確認できた締切があれば、そのまま出しています。'
      : reviewReasonText(reason)}</p>)}{item.presenceState === 'cancellation-candidate' &&
      <p className="review"><span className="badge">要確認</span> LMSの一覧で見つかりませんでした。LMSで確かめてください。</p>}</>;
}
function AssignmentRow({ item, courseName, changed = false }: { item: LedgerAssignment; courseName: string; changed?: boolean }) {
  return <li className="assignment">
    <h3>{item.latest.title}</h3>
    {changed && <StatusChip status="changed" />}
    <p><ChangedDeadline value={deadlineText(displayDeadlineOf(item))} /> {item.submission === 'submitted' && <span className="badge done">出せました</span>}
      {item.presenceState === 'cancelled' && <span className="badge">取り消されました</span>}</p>
    {item.presenceState === 'ended' && <p className="muted">この課題は終了しました。</p>}
    {item.presenceState !== 'ended' && <Review item={item} />}
    <details><summary>LMSの課題ページに書いてあったこと</summary><p>{deadlineOf(item)?.dueText ?? item.latest.deadline.dueText}</p>
      <p className="muted">{new Date(item.officialDeadline?.fetchedAt ?? item.lastSeenAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} 時点</p></details>
    <LmsSourceLink item={item} courseName={courseName} />
  </li>;
}
interface StudentViewProps { data: StudentData; now?: number; calendar?: boolean; actions?: PlanActions | undefined; manualActions?: ManualAssignmentActions | undefined; planLink?: ReactNode; setup?: ReactNode; settings?: ReactNode }
export function StudentView(props: StudentViewProps) {
  return <CourseColorProvider courses={props.data.courses}><OperationMessages><StudentContent {...props} /></OperationMessages></CourseColorProvider>;
}
function StudentContent({ data, now = Date.now(), calendar = false, actions, manualActions, planLink, setup, settings }: StudentViewProps) {
  const courseColor = useCourseColors();
  const [detailMessage, reportDetail] = useOperationMessage();
  data = { ...data, courses: linkedCourses(data.courses) };
  const [tab, setTab] = useState(planLink ? 'preparation' : 'deadlines');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const prepare = useRef<HTMLDetailsElement>(null);
  const preparationFold = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (tab === 'preparation' && preparationFold.current) preparationFold.current.open = true; }, [tab]);
  const [prepareFor, setPrepareFor] = useState<string | null>(null);
  const timetable = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = timetable.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      if (!frame.getClientRects().length) return;
      const header = frame.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const offset = frame.getBoundingClientRect().top + window.scrollY + header + 8;
      frame.style.setProperty('--timetable-offset', `${offset}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame.closest('.student-workspace')!);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [tab]);
  const todayWeekday = new Date(now).toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' });
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(todayWeekday) + 1;
  useEffect(() => {
    if ((selected || selectedPlanId) && window.matchMedia('(max-width: 850px)').matches) {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'start' });
    }
  }, [selected, selectedPlanId]);
  const courses = data.courses.filter(course => course.currentTerm !== false);
  const course = data.courses.find(item => courseKey(item) === selected);
  const hasManual = data.manualAssignments.some(row => row.status === 'active');
  const entries = deadlineEntries(data.assignments, data.manualAssignments, now);
  const upcoming = entries.filter(item => Number.isFinite(deadlineValue(entryDeadline(item))));
  const plans = data.plans.filter(plan => plan.status === 'active');
  const selectedPlan = plans.find(plan => plan.planId === selectedPlanId);
  const days = Math.max(5, weekday, ...plans.map(plan => new Date(`${plan.date}T00:00:00Z`).getUTCDay() || 7), ...courses.flatMap(c => c.slots.map(s => s.weekday)));
  const periods = Math.max(5, ...plans.map(plan => plan.period), ...courses.flatMap(c => c.slots.map(s => s.period)));
  const select = (value: StudentCourse) => { setSelectedPlanId(null); setSelected(courseKey(value)); };
  const unscheduled = courses.filter(c => c.slots.length === 0);
  const courseItems = course ? data.assignments.filter(item => belongsTo(item, course)) : [];
  const finished = courseItems.filter(item => item.submission === 'submitted' || item.presenceState === 'cancelled' || item.presenceState === 'ended');
  const finishedManual = data.manualAssignments.filter(row => row.status === 'active' && course &&
    entryBelongsTo({ kind: 'manual', row }, course) && manualAssignmentEnded(row, now));
  const courseEntries = (owner: StudentCourse) => entries.filter(item => entryBelongsTo(item, owner));
  const changed = useDeadlineChanges(new Map(courses.map(c => [courseKey(c),
    deadlineText(courseEntries(c)[0] ? entryDisplayDeadline(courseEntries(c)[0]!) : undefined)])));
  const deadlineLabels = new Map(entries.map(item => [entryId(item), deadlineText(entryDisplayDeadline(item))]));
  const changedEntries = useDeadlineChanges(deadlineLabels);
  const lastLabels = useRef(deadlineLabels);
  const previousLabels = useRef(new Map<string, string>());
  useEffect(() => {
    for (const [id, label] of deadlineLabels) {
      const last = lastLabels.current.get(id);
      if (last !== undefined && last !== label) previousLabels.current.set(id, last);
    }
    for (const id of previousLabels.current.keys()) if (!deadlineLabels.has(id)) previousLabels.current.delete(id);
    lastLabels.current = deadlineLabels;
  }, [deadlineLabels]);
  const monday = new Date(new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const weekStart = monday.toISOString().slice(0, 10);
  const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
  const weekEnd = sunday.toISOString().slice(0, 10);
  const inWeek = (item: (typeof upcoming)[number]) => {
    const deadline = entryDeadline(item);
    const day = deadline?.kind === 'date' ? deadline.date : deadline?.kind === 'datetime'
      ? new Date(deadline.dueAt).toLocaleDateString('sv-SE', { timeZone: deadline.timeZone }) : '';
    return day >= weekStart && day <= weekEnd;
  };
  const taskRows = (items: typeof upcoming) => <ul className="td-tasklist">{items.map(item => {
      const owner = data.courses.find(c => entryBelongsTo(item, c));
      return <li key={entryId(item)} className={changedEntries.has(entryId(item)) ? 'rd-row-changed' : undefined}>
        {deadlineDay(entryDeadline(item)) && <time className="rd-row-day" aria-hidden="true" dateTime={deadlineDay(entryDeadline(item))}><b>{Number(deadlineDay(entryDeadline(item))!.slice(8))}</b><span>{'日月火水木金土'[new Date(`${deadlineDay(entryDeadline(item))}T00:00:00Z`).getUTCDay()]}</span></time>}<TaskRow course={owner?.name ?? '手で入れた課題'} courseIdentity={owner} title={entryTitle(item)} changed={changedEntries.has(entryId(item))}
        deadline={<ChangedDeadline value={deadlineText(entryDisplayDeadline(item))} />}
        onSelect={owner ? () => select(owner) : undefined} />
        <span className="rd-row-time" aria-hidden="true">{entryDeadline(item)?.kind === 'datetime' ? new Intl.DateTimeFormat('ja-JP', { timeZone: entryDeadline(item)!.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadlineValue(entryDeadline(item)))) : '日付のみ'}</span>
        {item.kind === 'manual' && <small className="manual-author">{manualAuthor(item.row)}</small>}</li>;
    })}</ul>;
  const thisWeek = upcoming.filter(inWeek);
  const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const futureDeadlines = upcoming.filter(item => (deadlineDay(entryDeadline(item)) ?? '') >= today);
  const showFuture = thisWeek.length === 0 && futureDeadlines.length > 0;
  const visibleDeadlines = showFuture ? futureDeadlines.slice(0, 3) : thisWeek;
  const otherDeadlines = upcoming.filter(item => !visibleDeadlines.includes(item));
  const upcomingList = (!!data.assignments.length || hasManual) && <section className="upcoming" aria-labelledby="upcoming-title"><h2 id="upcoming-title">{showFuture ? 'これからの締切' : '今週の締切'} <span className="rd-count" aria-hidden="true">{visibleDeadlines.length}</span></h2>
    {visibleDeadlines.length ? taskRows(visibleDeadlines) : <p className="empty-week">今週の締切はありません</p>}
    {!!otherDeadlines.length && <details className="other-deadlines"><summary>その他の締切</summary>{taskRows(otherDeadlines)}</details>}
    </section>;
  const next = nextPreparation(entries[0], data.plans, now);
  const plannedAssignment = next.today && data.assignments.find(row => row.key.system === next.today!.assignment.system && row.key.sourceId === next.today!.assignment.sourceId);
  const nearest = next.today ? plannedAssignment ? { kind: 'lms' as const, row: plannedAssignment } : undefined : entries[0];
  const demo = data.fetchStates.some(state => state.system === 'demo-lms');
  const beginPreparation = (item: LedgerAssignment) => {
    setPrepareFor(JSON.stringify(item.key)); setTab('preparation');
    if (prepare.current) { prepare.current.open = true; const outer = prepare.current.closest<HTMLDetailsElement>('.rd-preparation'); if (outer) outer.open = true; }
    requestAnimationFrame(() => {
      prepare.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
      prepare.current?.querySelector<HTMLInputElement>('input[name="date"]')?.focus({ preventScroll: true });
    });
  };
  return <div className="student-workspace">
    {planLink}
    <div className="student-heading td-stage"><h1>時間割と課題</h1>
      <p className="student-today">今日 <time dateTime={new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}>{new Date(now).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' })}</time></p>
      <div className="rd-head-status">{data.online && data.fetchStates.map(state => {
        const { stale, failed } = fetchStatus(state, now);
        if (stale || failed || !state.lastSucceededAt) return null;
        const label = { 'ynu-lms': 'YNU LMS', kulms: 'KULMS', kulasis: 'KULASIS', 'demo-lms': '体験用LMS' }[state.system];
        return <span className="rd-pill rd-fetched" key={state.system}>✓ {label} {new Date(state.lastSucceededAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} 時点</span>;
      })}</div></div>
    <p className="rd-key"><span><i />いま見るもの・今日</span><span><i className="rd-yellow" />準備の予定</span><span><i className="rd-red" />締切が変わった</span><span><i className="rd-green" />終わった</span><span><i className="rd-blue" />選べる・押せる</span></p>
    {!data.online && <p role="status" className="notice">接続を確かめています。前に開いたときの内容を表示することがあります。</p>}
    {data.fetchStates.map(state => {
      const last = state.lastSucceededAt;
      const { stale, failed } = fetchStatus(state, now);
      const label = { 'ynu-lms': 'YNU LMS', kulms: 'KULMS', kulasis: 'KULASIS', 'demo-lms': '体験用LMS' }[state.system];
      return stale || failed ? <FetchState state="error" key={state.system} title={label} detail={<p className="notice">
        {label}：{stale ? `${new Date(last!).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}から更新がありません。LMSを開くと新しくなります。` :
          '課題をすべて確認できていません。LMSを開いて確かめてください。'}</p>} /> : null;
    })}
    {!data.assignments.length && !hasManual && <p className="empty">まだ課題がありません。LMSを開くと、ここに課題が並びます。</p>}
    <div className="student-mobile-tabs"><Tabs label="学生の画面" value={tab} onChange={setTab}
      items={[{ value: 'deadlines', label: '締切' }, { value: 'timetable', label: '時間割' }, { value: 'preparation', label: '準備' }]} /></div>
    <div className="student-overview td-stage" style={{ animationDelay: '100ms' }} data-tab={tab}>
    <div className="student-deadlines"><NextAction entry={nearest} course={nearest ? data.courses.find(c => entryBelongsTo(nearest, c)) : undefined}
      text={nearest ? nextDeadlineText(entryDisplayDeadline(nearest)) : ''} previous={nearest ? previousLabels.current.get(entryId(nearest)) : undefined}
      now={now} changed={!!nearest && changedEntries.has(entryId(nearest))}
      today={next.today} future={next.future} hasPlans={next.hasPlans} actions={actions}
      onPrepare={actions && nearest?.kind === 'lms' ? () => beginPreparation(nearest.row) : undefined} />{upcomingList}</div>
    <section className="student-timetable" aria-label="時間割"><h2>時間割</h2>
    <div className={`student-layout${course || selectedPlan ? ' with-course' : ''}`}>
      <div><ScrollFrame scrollRef={timetable} className="timetable-scroll" label="授業と次の締切"><table className="timetable" style={{ '--periods': periods } as CSSProperties}><caption className="sr-only">授業と次の締切</caption>
        <thead><tr><th scope="col">時限</th>{Array.from({ length: days }, (_, d) => <th scope="col" key={d} data-weekday={d + 1} data-today={d + 1 === weekday || undefined}>{'月火水木金土日'[d]}{d + 1 === weekday && '・今日'}</th>)}</tr></thead>
        <tbody>{Array.from({ length: periods }, (_, p) => <tr key={p}><th scope="row">{p + 1}限</th>
          {Array.from({ length: days }, (_, d) => <td key={d} data-today={d + 1 === weekday || undefined}><div className="timetable-slot">{courses.filter(c =>
            c.slots.some(slot => slot.weekday === d + 1 && slot.period === p + 1)).map(c => {
            const items = courseEntries(c);
            const next = items[0];
            const deadline = next ? entryDisplayDeadline(next) : undefined;
            // The cell shows the day only; the time stays in the description and the course panel.
            const summary = deadline?.kind === 'datetime' ? new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.timeZone, month: 'numeric', day: 'numeric' }).format(new Date(deadline.dueAt)) : deadline?.kind === 'date'
              ? `${Number(deadline.date.slice(5, 7))}/${Number(deadline.date.slice(8))}` : deadlineText(deadline);
            return <button className={`course-cell${changed.has(courseKey(c)) ? ' changed' : ''}`} key={courseKey(c)} onClick={() => select(c)}
              data-course-color={courseColor(c)} title={c.name} aria-label={c.name}
              aria-description={next ? `${deadlineText(deadline)}・${entryTitle(next)}・${items.length}件` : undefined}
              aria-pressed={courseKey(c) === selected} aria-controls="course-assignments">
              <strong>{c.name}</strong>{next && <><span className="course-deadline"><ChangedDeadline value={`${summary} 締切${items.length > 1 ? ` ほか${items.length - 1}件` : ''}`} /></span>
                <span className="sr-only">{entryTitle(next)}{next.kind === 'manual' && <small>手で入れた課題</small>}</span>
                {next.kind === 'lms' && (next.row.reviewReasons.length > 0 || next.row.presenceState === 'cancellation-candidate') && <span className="sr-only">要確認：{next.row.reviewReasons[0]?.kind === 'unreadable-deadline'
                  ? missingDeadlineText(next.row.latest.deadline) ?? '締切を確認できていません。' : next.row.reviewReasons[0] ? reviewReasonText(next.row.reviewReasons[0]) : 'LMSの一覧で見つかりませんでした。'}</span>}</>}
            </button>;
          })}{plans.filter(plan => (new Date(`${plan.date}T00:00:00Z`).getUTCDay() || 7) === d + 1 && plan.period === p + 1)
            .map(plan => <PlanCell key={plan.planId} plan={plan} assignments={data.assignments} selected={plan.planId === selectedPlanId}
              onSelect={() => { setSelected(null); setSelectedPlanId(plan.planId); }} />)}</div></td>)}</tr>)}</tbody>
      </table></ScrollFrame>{!!unscheduled.length && <section><h2>曜日・時限のない授業</h2>{unscheduled.map(c =>
        <button className="plain-button" key={courseKey(c)} onClick={() => select(c)} aria-controls="course-assignments">{c.name}</button>)}</section>}</div>
      {course && <aside ref={panel} tabIndex={-1} className="course-panel" id="course-assignments" aria-label={`${course.name}の課題`}>
        <div className="panel-heading" data-course-color={courseColor(course)}><h2 className="course-label">{course.name}</h2><button onClick={() => setSelected(null)}>閉じる</button></div>
        {!!course.slots.length && <p>{course.slots.map(slot => `${'月火水木金土日'[slot.weekday - 1]}曜${slot.period}限`).join('・')}</p>}
        {course.url && <a href={course.url} target="_blank" rel="noreferrer">LMSで授業を開く</a>}
        <ul>{courseEntries(course).map(entry => entry.kind === 'lms'
          ? <AssignmentRow key={entryId(entry)} item={entry.row} courseName={course.name} changed={changedEntries.has(entryId(entry))} />
          : <ManualAssignmentRow key={entryId(entry)} row={entry.row} actions={manualActions} own />)}</ul>
        {manualActions && <details><summary>この授業の課題を手で入れる</summary>
          <ManualAssignmentForm key={courseKey(course)} courses={data.courses} course={course} actions={manualActions} /></details>}
        {(!!finished.length || !!finishedManual.length) && <details className="finished-assignments"><summary>終了した課題</summary>
          <ul>{finished.map(item => <AssignmentRow key={JSON.stringify(item.key)} item={item} courseName={course.name} />)}
            {finishedManual.map(row => <ManualAssignmentRow key={row.manualAssignmentId} row={row} actions={manualActions} own />)}</ul></details>}
        {!courseItems.length && !courseEntries(course).length && !finishedManual.length && <p>この授業の課題はまだありません。</p>}
      </aside>}
      {selectedPlan && <aside ref={panel} tabIndex={-1} className="course-panel preparation-details" id="preparation-details" aria-label="準備の予定の詳細">
        <div className="panel-heading"><h2>準備の予定</h2><button onClick={() => setSelectedPlanId(null)}>閉じる</button></div>
        <PlanSummary plan={selectedPlan} assignments={data.assignments} /><span>{selectedPlan.period}限（日本時間）</span>
        <PlanControls plan={selectedPlan} actions={actions} now={now} report={reportDetail} />
      </aside>}
      {detailMessage && <p role="status">{detailMessage}</p>}
    </div>
    <p className="rd-timetable-help">マスを押すと、課題や準備の中身が開きます</p>
    </section>
    </div>
    <details ref={preparationFold} className="rd-preparation rd-fold" aria-label="準備"><summary>準備の予定 <span className="rd-count">{data.plans.filter(plan => plan.status !== 'cancelled').length}件</span></summary>
    {actions && <details ref={prepare} className="preparation-add"><summary>準備の予定を入れる</summary>
      <PlanForm key={prepareFor ?? 'all'} assignments={prepareFor ? [...data.assignments].sort((a, b) => Number(JSON.stringify(b.key) === prepareFor) - Number(JSON.stringify(a.key) === prepareFor)) : data.assignments} actions={actions} /></details>}
    <PlanList plans={data.plans} assignments={data.assignments} actions={actions} own />
    </details>
    {calendar && <details className="student-calendar rd-fold"><summary>締切のカレンダー {demo && <span className="rd-pill">体験用カレンダー</span>}</summary>
      <DemoCalendar courses={data.courses} assignments={data.assignments} manual={data.manualAssignments} now={now} /></details>}
    {settings ?? <details className="rd-settings rd-fold"><summary>連携と設定</summary>{setup}
      {demo && !setup && <p>体験版では、実際のGoogle カレンダーとメールにはつなぎません。</p>}
      <ManualAssignments rows={data.manualAssignments} courses={data.courses} actions={manualActions} own now={now} /></details>}
    </div>;
}
/** Keep one mail controller for the summary and its settings. */
function StudentAccount({ user, data, now, showOwnSession }: { user: User; data: StudentData; now: number; showOwnSession: boolean }) {
  const mail = useNotificationSettings(user);
  return <><StudentView data={data} now={now} calendar
    planLink={window.location.pathname === '/student/plan' && <PlanLinkAction user={user} data={data} />}
    actions={planActions(user, user.uid)} manualActions={manualAssignmentActions(user, user.uid)}
    settings={<StudentSettings user={user} mail={mail} data={data}>
      {showOwnSession && <a href={`/session/${encodeURIComponent(user.uid)}`}>自分の面談日時を見る・変える</a>}
      <ManualAssignments rows={data.manualAssignments} courses={linkedCourses(data.courses)} actions={manualAssignmentActions(user, user.uid)} own now={now} />
    </StudentSettings>} />
    </>;
}
export function StudentPage({ showOwnSession = false }: { showOwnSession?: boolean }) {
  const [state, setState] = useState<StudentState>({ status: 'loading' });
  const [authError, setAuthError] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => firebase ? watchAccount(firebase.auth, firebase.db, setState) : undefined, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (!firebase) return <><h1>時間割と課題</h1><p>画面の準備中です。しばらくしてから開き直してください。</p></>;
  const client = firebase;
  const accountAction = (action: () => Promise<unknown>) => { setAuthError(false); setAuthBusy(true); void action().catch(() => setAuthError(true)).finally(() => setAuthBusy(false)); };
  return <>
    {state.status === 'signed-out' ? <><h1>時間割と課題</h1><DemoLogin returnTo={window.location.pathname === '/student/plan' ? window.location.pathname + window.location.search : undefined} />
      <Button className="plain-button" busy={authBusy} busyLabel="ログイン中…" onClick={() => accountAction(client.login)}>Googleでログイン</Button></> :
      <><HeaderAction><Button className="logout student-logout" busy={authBusy} busyLabel="ログアウト中…" onClick={() => accountAction(client.logout)}>ログアウト</Button></HeaderAction>
        {state.status === 'ready' ? (client.auth.currentUser
          ? <StudentAccount key={client.auth.currentUser.uid} user={client.auth.currentUser} data={state} now={now} showOwnSession={showOwnSession} />
          : <StudentView data={state} now={now} calendar />) : state.status === 'error' ? <FetchState state="error" title="課題を表示できませんでした" detail="接続を確かめて、画面を開き直してください。" /> : <Skeleton label="課題を読み込んでいます…" lines={6} />}</>}
    {authError && <p role="alert">ログイン状態を変更できませんでした。もう一度お試しください。</p>}
  </>;
}
