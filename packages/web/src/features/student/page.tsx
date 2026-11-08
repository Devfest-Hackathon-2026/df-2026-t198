import { Button, TaskRow, Tabs, FetchState, Skeleton } from '../../shared/ui';
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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Deadline, LedgerAssignment } from '../../../../core/src/types';
import { PlanCell, PlanForm, PlanList, PlanSummary } from '../plans/components';
import { planActions, type PlanActions } from '../plans/api';
import { DemoCalendar } from '../calendar/calendar';
import { ChangedDeadline, useDeadlineChanges } from '../../shared/assignments/deadline-change';
import { DemoLogin } from '../../shared/auth/demo-login';
import { OperationMessages } from '../../shared/ui/operation-messages';
import { firebase } from '../../shared/firebase';
import { watchAccount, type StudentState } from './data';
import { type StudentCourse, type StudentData } from '../../shared/assignments/types';
import { NotificationSettingsPanel } from '../notifications/settings';
import { courseColor } from '../../shared/course-color';

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
function AssignmentRow({ item, courseName }: { item: LedgerAssignment; courseName: string }) {
  return <li className="assignment">
    <h3>{item.latest.title}</h3>
    <p><ChangedDeadline value={deadlineText(displayDeadlineOf(item))} /> {item.submission === 'submitted' && <span className="badge done">出せました</span>}
      {item.presenceState === 'cancelled' && <span className="badge">取り消されました</span>}</p>
    {item.presenceState === 'ended' && <p className="muted">この課題は終了しました。</p>}
    {item.presenceState !== 'ended' && <Review item={item} />}
    <details><summary>LMSの課題ページに書いてあったこと</summary><p>{deadlineOf(item)?.dueText ?? item.latest.deadline.dueText}</p>
      <p className="muted">{new Date(item.officialDeadline?.fetchedAt ?? item.lastSeenAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} 時点</p></details>
    <LmsSourceLink item={item} courseName={courseName} />
  </li>;
}
export function StudentView({ data, now = Date.now(), calendar = false, actions, manualActions, planLink }: { data: StudentData; now?: number; calendar?: boolean; actions?: PlanActions | undefined; manualActions?: ManualAssignmentActions | undefined; planLink?: ReactNode }) {
  data = { ...data, courses: linkedCourses(data.courses) };
  const [tab, setTab] = useState(planLink ? 'preparation' : 'deadlines');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const timetable = useRef<HTMLDivElement>(null);
  const todayWeekday = new Date(now).toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' });
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(todayWeekday) + 1;
  useEffect(() => {
    const scroll = timetable.current;
    const today = scroll?.querySelector<HTMLElement>(`[data-weekday="${weekday}"]`);
    if (scroll && today) scroll.scrollLeft = today.offsetLeft - 44;
  }, [weekday]);
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
      return <li key={entryId(item)}><TaskRow course={owner?.name ?? '手で入れた課題'} courseIdentity={owner} title={entryTitle(item)}
        deadline={<ChangedDeadline value={deadlineText(entryDisplayDeadline(item))} />}
        onSelect={owner ? () => select(owner) : undefined} />
        {item.kind === 'manual' && <small className="manual-author">{manualAuthor(item.row)}</small>}</li>;
    })}</ul>;
  const upcomingList = !!upcoming.length && <section className="upcoming" aria-labelledby="upcoming-title"><h2 id="upcoming-title">今週の締切</h2>
    {taskRows(upcoming.filter(inWeek))}
    {!!upcoming.filter(item => !inWeek(item)).length && <details className="other-deadlines"><summary>その他の締切</summary>{taskRows(upcoming.filter(item => !inWeek(item)))}</details>}
    </section>;
  return <OperationMessages>
    <div className="student-workspace">
    {planLink}
    <div className="student-heading td-stage"><h1>時間割と課題</h1></div>
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
    <div className="student-deadlines">{upcomingList}</div>
    <section className="student-timetable" aria-label="時間割"><h2>時間割</h2>
    <div className={`student-layout${course || selectedPlan ? ' with-course' : ''}`}>
      <div><ScrollFrame scrollRef={timetable} className="timetable-scroll" label="授業と次の締切"><table className="timetable" style={{ minWidth: 44 + days * 120 }}><caption className="sr-only">授業と次の締切</caption>
        <thead><tr><th scope="col">時限</th>{Array.from({ length: days }, (_, d) => <th scope="col" key={d} data-weekday={d + 1}>{'月火水木金土日'[d]}</th>)}</tr></thead>
        <tbody>{Array.from({ length: periods }, (_, p) => <tr key={p}><th scope="row">{p + 1}限</th>
          {Array.from({ length: days }, (_, d) => <td key={d}>{courses.filter(c =>
            c.slots.some(slot => slot.weekday === d + 1 && slot.period === p + 1)).map(c => {
            const next = courseEntries(c)[0];
            return <button className={`course-cell${changed.has(courseKey(c)) ? ' changed' : ''}`} key={courseKey(c)} onClick={() => select(c)}
              data-course-color={courseColor(c)} aria-pressed={courseKey(c) === selected} aria-controls="course-assignments">
              <strong>{c.name}</strong>{next && <><span><ChangedDeadline value={deadlineText(entryDisplayDeadline(next))} /></span><span>{entryTitle(next)}</span>{next.kind === 'manual' && <small>手で入れた課題</small>}
                {next.kind === 'lms' && (next.row.reviewReasons.length > 0 || next.row.presenceState === 'cancellation-candidate') && <span className="review">要確認：{next.row.reviewReasons[0]?.kind === 'unreadable-deadline'
                  ? missingDeadlineText(next.row.latest.deadline) ?? '締切を確認できていません。' : next.row.reviewReasons[0] ? reviewReasonText(next.row.reviewReasons[0]) : 'LMSの一覧で見つかりませんでした。'}</span>}</>}
            </button>;
          })}{plans.filter(plan => (new Date(`${plan.date}T00:00:00Z`).getUTCDay() || 7) === d + 1 && plan.period === p + 1)
            .map(plan => <PlanCell key={plan.planId} plan={plan} assignments={data.assignments} selected={plan.planId === selectedPlanId}
              onSelect={() => { setSelected(null); setSelectedPlanId(plan.planId); }} />)}</td>)}</tr>)}</tbody>
      </table></ScrollFrame>{!!unscheduled.length && <section><h2>曜日・時限のない授業</h2>{unscheduled.map(c =>
        <button className="plain-button" key={courseKey(c)} onClick={() => select(c)} aria-controls="course-assignments">{c.name}</button>)}</section>}</div>
      {course && <aside ref={panel} tabIndex={-1} className="course-panel" id="course-assignments" aria-label={`${course.name}の課題`}>
        <div className="panel-heading" data-course-color={courseColor(course)}><h2 className="course-label">{course.name}</h2><button onClick={() => setSelected(null)}>閉じる</button></div>
        {!!course.slots.length && <p>{course.slots.map(slot => `${'月火水木金土日'[slot.weekday - 1]}曜${slot.period}限`).join('・')}</p>}
        {course.url && <a href={course.url} target="_blank" rel="noreferrer">LMSで授業を開く</a>}
        <ul>{courseEntries(course).map(entry => entry.kind === 'lms'
          ? <AssignmentRow key={entryId(entry)} item={entry.row} courseName={course.name} />
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
      </aside>}
    </div>
    </section>
    <section className="student-preparation" aria-label="準備"><h2>準備の予定</h2>
    {actions && <details className="preparation-add"><summary>準備の予定を入れる</summary>
      <PlanForm assignments={data.assignments} actions={actions} /></details>}
    <PlanList plans={data.plans} assignments={data.assignments} actions={actions} own />
    </section>
    {calendar && <div className="student-calendar"><DemoCalendar courses={data.courses} assignments={data.assignments} manual={data.manualAssignments} now={now} /></div>}
    </div>
    <ManualAssignments rows={data.manualAssignments} courses={data.courses} actions={manualActions} own now={now} />
    </div>
  </OperationMessages>;
}
export function StudentPage() {
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
      <><Button className="logout" busy={authBusy} busyLabel="ログアウト中…" onClick={() => accountAction(client.logout)}>ログアウト</Button>
        {state.status === 'ready' ? <><StudentView key={client.auth.currentUser?.uid} data={state} now={now} calendar
          planLink={window.location.pathname === '/student/plan' && client.auth.currentUser && <PlanLinkAction user={client.auth.currentUser} data={state} />}
          actions={client.auth.currentUser ? planActions(client.auth.currentUser, client.auth.currentUser.uid) : undefined}
          manualActions={client.auth.currentUser ? manualAssignmentActions(client.auth.currentUser, client.auth.currentUser.uid) : undefined} />
          {client.auth.currentUser && <><NotificationSettingsPanel key={client.auth.currentUser.uid} user={client.auth.currentUser} />
            <a href={`/session/${encodeURIComponent(client.auth.currentUser.uid)}`}>自分の面談日時を見る・変える</a></>}</> : state.status === 'error' ? <FetchState state="error" title="課題を表示できませんでした" detail="接続を確かめて、画面を開き直してください。" /> : <Skeleton label="課題を読み込んでいます…" lines={6} />}</>}
    {authError && <p role="alert">ログイン状態を変更できませんでした。もう一度お試しください。</p>}
  </>;
}
