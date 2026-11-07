import { manualAssignmentActions, ManualAssignments, ManualAssignmentForm, ManualAssignmentRow, manualAuthor, type ManualAssignmentActions } from './manual-assignments';
import { deadlineEntries, entryBelongsTo, entryDeadline, entryDisplayDeadline, entryId, entryTitle, deadlineValue, manualAssignmentEnded } from './deadline-entries';
import { PlanLinkAction } from './plan-progress';
import { LmsSourceLink } from './lms-link';
import { fetchStatus } from './fetch-status';
import { missingDeadlineText, reviewReasonText } from './review-reason';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Deadline, LedgerAssignment } from '../../core/src/types';
import { planActions, PlanCell, PlanForm, PlanList, PlanSummary, type PlanActions } from './preparation-plans';
import { DemoCalendar } from './demo-calendar';
import { ChangedDeadline, useDeadlineChanges } from './deadline-change';
import { DemoLogin } from './demo-login';
import { OperationMessages } from './operation-messages';
import { firebase } from './firebase';
import { watchAccount, type StudentCourse, type StudentData, type StudentState } from './student-data';
import { NotificationSettingsPanel } from './notification-settings';

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
  const upcomingList = !!upcoming.length && <section className="upcoming" aria-labelledby="upcoming-title"><h2 id="upcoming-title">締切の近い課題</h2>
      <ul>{upcoming.slice(0, 3).map(item => {
        const owner = data.courses.find(c => entryBelongsTo(item, c));
        return <li key={entryId(item)}>{owner ? <button onClick={() => select(owner)} aria-controls="course-assignments">
          <strong>{deadlineText(entryDeadline(item))}</strong> {entryTitle(item)}<span className="muted">{owner.name}</span>{item.kind === 'manual' && <small>{manualAuthor(item.row)}</small>}
        </button> : <span>{deadlineText(entryDeadline(item))} {entryTitle(item)}{item.kind === 'manual' && <small className="manual-author"> {manualAuthor(item.row)}</small>}</span>}</li>;
      })}</ul></section>;
  return <OperationMessages>
    {planLink}
    <div className="student-heading"><h1>時間割と課題</h1><p>LMSは、大学の授業支援システムです。準備は、課題に取り組む時間のことです。</p>
      {changed.size > 0 && <p className="muted">黄色は、今変わった締切の目印です。しばらくすると元の色に戻ります。</p>}</div>
    {!data.online && <p role="status" className="notice">接続を確かめています。前に開いたときの内容を表示することがあります。</p>}
    {data.fetchStates.map(state => {
      const last = state.lastSucceededAt;
      const { stale, failed } = fetchStatus(state, now);
      const label = { 'ynu-lms': 'YNU LMS', panda: 'PandA', 'demo-lms': '体験用LMS' }[state.system];
      return stale || failed ? <p className="notice" key={state.system}>
        {label}：{stale ? `${new Date(last!).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}から更新がありません。LMSを開くと新しくなります。` :
          '課題をすべて確認できていません。LMSを開いて確かめてください。'}</p> : null;
    })}
    {!data.assignments.length && !hasManual && <p className="empty">まだ課題がありません。LMSを開くと、ここに課題が並びます。</p>}
    {calendar ? <>{hasManual && upcomingList}<DemoCalendar courses={data.courses} assignments={data.assignments} fallback={hasManual ? undefined : upcomingList} now={now} /></> : upcomingList}
    <div className={`student-layout${course || selectedPlan ? ' with-course' : ''}`}>
      <div><p className="scroll-hint">時間割は左右に動かせます。</p><div ref={timetable} className="timetable-scroll" tabIndex={0} role="region" aria-label="授業と次の締切"><table className="timetable" style={{ minWidth: 44 + days * 120 }}><caption className="sr-only">授業と次の締切</caption>
        <thead><tr><th scope="col">時限</th>{Array.from({ length: days }, (_, d) => <th scope="col" key={d} data-weekday={d + 1}>{'月火水木金土日'[d]}</th>)}</tr></thead>
        <tbody>{Array.from({ length: periods }, (_, p) => <tr key={p}><th scope="row">{p + 1}限</th>
          {Array.from({ length: days }, (_, d) => <td key={d}>{courses.filter(c =>
            c.slots.some(slot => slot.weekday === d + 1 && slot.period === p + 1)).map(c => {
            const next = courseEntries(c)[0];
            return <button className={`course-cell${changed.has(courseKey(c)) ? ' changed' : ''}`} key={courseKey(c)} onClick={() => select(c)}
              aria-pressed={courseKey(c) === selected} aria-controls="course-assignments">
              <strong>{c.name}</strong>{next && <><span>{deadlineText(entryDisplayDeadline(next))}</span><span>{entryTitle(next)}</span>{next.kind === 'manual' && <small>手で入れた課題</small>}
                {next.kind === 'lms' && (next.row.reviewReasons.length > 0 || next.row.presenceState === 'cancellation-candidate') && <span className="review">要確認：{next.row.reviewReasons[0]?.kind === 'unreadable-deadline'
                  ? missingDeadlineText(next.row.latest.deadline) ?? '締切を確認できていません。' : next.row.reviewReasons[0] ? reviewReasonText(next.row.reviewReasons[0]) : 'LMSの一覧で見つかりませんでした。'}</span>}</>}
            </button>;
          })}{plans.filter(plan => (new Date(`${plan.date}T00:00:00Z`).getUTCDay() || 7) === d + 1 && plan.period === p + 1)
            .map(plan => <PlanCell key={plan.planId} plan={plan} assignments={data.assignments} selected={plan.planId === selectedPlanId}
              onSelect={() => { setSelected(null); setSelectedPlanId(plan.planId); }} />)}</td>)}</tr>)}</tbody>
      </table></div>{!!unscheduled.length && <section><h2>曜日・時限のない授業</h2>{unscheduled.map(c =>
        <button className="plain-button" key={courseKey(c)} onClick={() => select(c)} aria-controls="course-assignments">{c.name}</button>)}</section>}</div>
      {course && <aside ref={panel} tabIndex={-1} className="course-panel" id="course-assignments" aria-label={`${course.name}の課題`}>
        <div className="panel-heading"><h2>{course.name}</h2><button onClick={() => setSelected(null)}>閉じる</button></div>
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
    {actions && <details className="preparation-add"><summary>準備の予定を入れる</summary>
      <PlanForm assignments={data.assignments} actions={actions} /></details>}
    <PlanList plans={data.plans} assignments={data.assignments} actions={actions} own />
    <ManualAssignments rows={data.manualAssignments} courses={data.courses} actions={manualActions} own now={now} />
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
      <button className="plain-button" disabled={authBusy} onClick={() => accountAction(client.login)}>{authBusy ? 'ログイン中…' : 'Googleでログイン'}</button></> :
      <><button className="logout" onClick={() => accountAction(client.logout)}>ログアウト</button>
        {state.status === 'ready' ? <><StudentView key={client.auth.currentUser?.uid} data={state} now={now} calendar
          planLink={window.location.pathname === '/student/plan' && client.auth.currentUser && <PlanLinkAction user={client.auth.currentUser} data={state} />}
          actions={client.auth.currentUser ? planActions(client.auth.currentUser, client.auth.currentUser.uid) : undefined}
          manualActions={client.auth.currentUser ? manualAssignmentActions(client.auth.currentUser, client.auth.currentUser.uid) : undefined} />
          {client.auth.currentUser && <><NotificationSettingsPanel key={client.auth.currentUser.uid} user={client.auth.currentUser} />
            <a href={`/session/${encodeURIComponent(client.auth.currentUser.uid)}`}>自分の面談日時を見る・変える</a></>}</> : <p role="status">{state.status === 'error'
          ? '課題を開けませんでした。接続を確かめて、画面を開き直してください。' : '課題を開いています…'}</p>}</>}
    {authError && <p role="alert">ログイン状態を変更できませんでした。もう一度お試しください。</p>}
  </>;
}
