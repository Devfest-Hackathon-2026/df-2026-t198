import { Button, TaskTable, DetailPanel, FetchState, Skeleton } from '../../shared/ui';
import { ContextEditor } from './context-editor';
import { linkedCourses } from '../../../../core/src/course-links';
import { ManualAssignments, ManualAssignmentRow } from '../manual-assignments/components';
import { manualAssignmentActions, type ManualAssignmentActions } from '../manual-assignments/api';
import { entryBelongsTo, entryDeadline, entryDisplayDeadline, entryId, entryTitle, type DeadlineEntry } from '../../shared/assignments/deadline-entries';
import { planProgress } from '../plans/progress';
import { LmsSourceLink } from '../../shared/assignments/lms-link';
import { fetchStatus } from '../../shared/assignments/fetch-status';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { AssignmentChange, LedgerAssignment, SessionContext } from '../../../../core/src/types';
import { getSessionServices, type SessionServices } from './firebase';
import { sessionPlanningView, sessionDeadlineEntries, buildSessionView, changeDescription, emptySession, reviewDescription, type SessionData } from './model';
import { dayInZone, formatDeadline, formatMoment } from '../../shared/assignments/deadline-format';
import { watchSession, type SessionState } from './watch';
import { SessionLink, sessionRoute } from './route';
import { comparePreparationPlans, PlanList } from '../plans/components';
import { planActions, type PlanActions } from '../plans/api';
import { SessionPlanning } from './planning';
import './session.css';
import { ChangedDeadline } from '../../shared/assignments/deadline-change';
import { missingDeadlineText } from '../../shared/assignments/review-reason';
import { DemoLogin } from '../../shared/auth/demo-login';
import { OperationMessages } from '../../shared/ui/operation-messages';
import { CourseColorProvider, useCourseColors } from '../../shared/course-color-context';

export function SessionPage({ path = '/session' }: { path?: string }) {
  const [services] = useState(() => { try { return getSessionServices(); } catch { return null; } });
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  useEffect(() => services?.observeUser(current => { setUser(current); setReady(true); setError(''); }), [services]);
  if (!services) return <p role="status">面談画面の準備がまだできていません。画面を用意した担当者に確認してください。</p>;
  if (!ready) return <Skeleton label="ログイン状態を確かめています…" />;
  return <>
    <div className="session-account">
      {user && <Button className="logout" busy={logoutBusy} busyLabel="ログアウト中…" onClick={() => { setLogoutBusy(true); void services.logout().catch(() => setError('ログアウトできませんでした。もう一度お試しください。')).finally(() => setLogoutBusy(false)); }}>ログアウト</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {user ? <SessionWorkspace key={user.uid} user={user} services={services} path={path} /> : <Login services={services} />}
  </>;
}
function Login({ services }: { services: SessionServices }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await services.login(String(form.get('email') ?? ''), String(form.get('password') ?? '')); }
    catch { setError('ログインできませんでした。アカウントと接続を確かめて、もう一度お試しください。'); }
    finally { setBusy(false); }
  }
  return <form className="session-login panel" onSubmit={event => { void login(event); }}>
    <h2>面談にログイン</h2>
    <DemoLogin />
    {services.local && <>
      <label>メールアドレス<input type="email" name="email" autoComplete="username" required /></label>
      <label>パスワード<input type="password" name="password" autoComplete="current-password" required /></label>
    </>}
    <Button type="submit" busy={busy} busyLabel="ログイン中…">{services.local ? 'ログイン' : 'Googleでログイン'}</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
function SessionWorkspace({ user, services, path }: { user: User; services: SessionServices; path: string }) {
  const [students, setStudents] = useState<{ uid: string; displayName?: string }[] | null>(null);
  const { uid: selected, planning } = sessionRoute(path);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await services.students(user);
        if (!active) return;
        setStudents(rows); setError('');
      } catch {
        if (!active) return;
        setStudents(null);
        setError('担当する学生を開けませんでした。接続とログインを確かめてください。');
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user, services]);
  if (selected) return <div className="session-content">
    <StudentSession key={selected} uid={selected} user={user} services={services} planning={planning}
      displayName={students === null ? '学生' : students.find(student => student.uid === selected)?.displayName} />
  </div>;
  return <section className="session-students">
    <h2>{students?.length === 0 ? '自分の面談' : '担当する学生'}</h2>
    {students?.length !== 0 && <p>共有を許可した学生の授業と課題を出しています。</p>}
    <nav aria-label="担当する学生">
      {students?.map(student => <StudentChoice key={student.uid} student={student} user={user} services={services} />)}
    </nav>
    {students?.length === 0 && <SessionLink href={`/session/${encodeURIComponent(user.uid)}`}>自分の面談を見る</SessionLink>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
function StudentChoice({ student, user, services }: {
  student: { uid: string; displayName?: string }; user: User; services: SessionServices;
}) {
  const [state, setState] = useState<SessionState>({ status: 'loading', data: emptySession() });
  useEffect(() => watchSession(services.source, student.uid, user.uid, setState), [services, student.uid, user.uid]);
  const context = state.data.context;
  const descriptionId = useId();
  return <SessionLink href={`/session/${encodeURIComponent(student.uid)}`} aria-label={student.displayName ?? `学生 ${student.uid}`}
    aria-describedby={state.status === 'ready' ? descriptionId : undefined}>
    <span className="rd-avatar" aria-hidden="true">{(student.displayName ?? '学生').slice(0, 1)}</span>
    <span className="rd-student-description"><strong>{student.displayName ?? '学生'}</strong>
      {!student.displayName && <span className="session-student-id">{student.uid}</span>}
      {state.status === 'ready' && <span className="rd-student-facts" id={descriptionId}>
        <span>次の面談：{context.nextSessionAt ? formatMoment(context.nextSessionAt) : '日時未設定'}</span>
        <span>前回の面談からの変化 {buildSessionView(state.data, new Date()).changes.length}件</span>
      </span>}
    </span><span className="rd-open" aria-hidden="true">開く</span>
  </SessionLink>;
}
function StudentSession({ uid, user, services, planning, displayName }: { uid: string; user: User; services: SessionServices; planning: boolean; displayName?: string | undefined }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', data: emptySession() });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => watchSession(services.source, uid, user.uid, state => {
    setState(state);
    setNow(new Date());
  }), [services, uid, user.uid]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  if (state.status === 'loading') return <>
    {uid !== user.uid && <SessionLink className="session-back" href="/session">学生を選び直す</SessionLink>}
    <Skeleton label="面談画面を開いています…" lines={6} />
  </>;
  if (state.status === 'denied') return <>
    {uid !== user.uid && <SessionLink className="session-back" href="/session">学生を選び直す</SessionLink>}
    <p role="alert">この学生の共有が終わったか、許可されていません。表示していた内容を消しました。</p>
  </>;
  if (state.status === 'error') return <>
    {uid !== user.uid && <SessionLink className="session-back" href="/session">学生を選び直す</SessionLink>}
    <p role="alert">面談の内容を確認できなくなったため、表示を消しました。{uid === user.uid ? '接続を確かめて、画面を開き直してください。' : '学生を選び直してください。'}</p>
  </>;
  return <SessionDetails key={uid} data={state.data} now={now} own={uid === user.uid} uid={uid} planning={planning}
    displayName={displayName} actions={planActions(user, uid)} manualActions={manualAssignmentActions(user, uid)} viewerUid={user.uid} save={context => services.saveContext(user, uid, context)} />;
}
interface SessionDetailsProps {
  data: SessionData; now: Date; own: boolean; uid: string; planning: boolean;
  actions?: PlanActions | undefined; manualActions?: ManualAssignmentActions | undefined; viewerUid?: string | undefined; displayName?: string | undefined; save: (context: SessionContext) => Promise<void> }
export function SessionDetails(props: SessionDetailsProps) {
  return <CourseColorProvider courses={props.data.courses}><SessionContent {...props} /></CourseColorProvider>;
}
function SessionContent({ data, now, own, save, uid, planning, actions, manualActions, viewerUid, displayName }: SessionDetailsProps) {
  data = { ...data, courses: linkedCourses(data.courses) };
  const view = buildSessionView(data, now);
  const deadlines = sessionDeadlineEntries(data, now);
  const [selectedAssignment, setSelectedAssignment] = useState('');
  const slots = sessionPlanningView(data, now, selectedAssignment).candidates.length;
  const promises = data.plans.filter(plan => plan.status !== 'cancelled' && data.context.lastSessionAt &&
    plan.decidedOn === dayInZone(new Date(data.context.lastSessionAt), 'Asia/Tokyo')).sort(comparePreparationPlans);
  const changeLine = (change: AssignmentChange) => <>
    <time>{formatMoment(change.recordedAt)}</time>{' '}
    {data.assignments.find(row => sameAssignment(row, change.assignmentKey))?.latest.title ?? '課題'}：{changeDescription(change)}
  </>;
  const base = `/session/${encodeURIComponent(uid)}`;
  return <OperationMessages>
    <header className="session-heading td-stage">
      <span className="rd-avatar" aria-hidden="true">{(own ? '自' : displayName ?? '学生').slice(0, 1)}</span>
      <div><h1>{own ? '自分の面談' : displayName ?? '学生'}</h1>
        {!own && !displayName && <p className="session-student-id">{uid}</p>}</div>
      <div className="session-meta-fetch" aria-label="情報の取得時点"><div className="session-updates">
        {!data.fetchStates.length && <p>取得記録なし</p>}
        {data.fetchStates.map(state => {
          const { stale, failed } = fetchStatus(state, now.getTime());
          const label = { 'ynu-lms': 'YNU LMS', kulms: 'KULMS', kulasis: 'KULASIS', 'demo-lms': '体験用LMS' }[state.system];
          if (stale || failed) return <FetchState state="error" title={label} key={state.system} detail={<p className="notice">
            {label}：{stale ? `${new Date(state.lastSucceededAt!).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}から更新がありません。学生がLMSを開くと新しくなります。` :
              '課題をすべて確認できていません。LMSを一緒に開いて確かめてください。'}</p>} />;
          return <p className={state.lastSucceededAt ? "rd-fetch-ok" : undefined} key={state.system}><strong>{state.system === 'ynu-lms' ? 'YNU' : label}</strong>
            <span>{state.lastSucceededAt ? `${formatMoment(state.lastSucceededAt)} 時点の情報` : 'まだ更新できていません'}</span></p>;
        })}
      </div></div>
      {!own && <SessionLink className="session-back" href="/session">学生を選び直す</SessionLink>}
    </header>
    <p className="rd-key" aria-label="色の意味">
      <span><i aria-hidden="true" />いま見るもの・今日</span><span><i className="rd-yellow" aria-hidden="true" />準備の予定</span>
      <span><i className="rd-red" aria-hidden="true" />締切が変わった</span><span><i className="rd-green" aria-hidden="true" />終わった</span>
      <span><i className="rd-blue" aria-hidden="true" />選べる・押せる</span>
    </p>
    <nav className="session-steps td-stage" style={{ animationDelay: '100ms' }} aria-label="面談の画面">
      <SessionLink href={base} aria-label="① 確かめる" aria-describedby="session-check-count" aria-current={!planning ? 'page' : undefined}>
        <strong>① 確かめる</strong><span id="session-check-count">締切{deadlines.length}件・変化{view.changes.length}件</span>
      </SessionLink>
      <SessionLink href={`${base}/plan`} aria-label="② 相談する" aria-describedby="session-plan-count" aria-current={planning ? 'page' : undefined}>
        <strong>② 相談する</strong><span id="session-plan-count">準備の候補 {slots}コマ</span>
      </SessionLink>
    </nav>
    <div className="session-meta td-stage" style={{ animationDelay: '150ms' }}>
      <section className="session-meta-last"><h2>前回の面談</h2>
        <p>{data.context.lastSessionAt ? <time dateTime={data.context.lastSessionAt}>{formatMoment(data.context.lastSessionAt)}</time> : '日時未設定'}</p>
      </section>
      <section className="session-meta-next"><h2>次の面談</h2>
        <p>{data.context.nextSessionAt ? <time dateTime={data.context.nextSessionAt}>{formatMoment(data.context.nextSessionAt)}</time> : '日時未設定'}</p>
        <ContextEditor key={`${data.context.lastSessionAt}/${data.context.nextSessionAt}`} context={data.context} save={save} />
      </section>
      <section className="rd-session-plan-fact"><h2>準備の予定</h2>
        <p>入れた {data.plans.filter(plan => plan.status !== 'cancelled').length}件・終わった {data.plans.filter(plan => plan.status === 'done').length}件</p>
      </section>
    </div>
    {planning ? <SessionPlanning data={data} now={now} actions={actions} own={own} viewerUid={viewerUid}
      selectedAssignment={selectedAssignment} onSelectAssignment={setSelectedAssignment} /> : <>
      <div className="session-check td-stage" style={{ animationDelay: '200ms' }}>
        <div className="session-primary"><section aria-labelledby="session-deadlines"><h2 id="session-deadlines">次の面談までの締切 <span className="session-count" aria-hidden="true">{deadlines.length}件</span></h2>
          {!data.context.nextSessionAt && <a href="#session-dates-editor">次の面談日時を決める</a>}
          {!deadlines.length && <p className="session-empty">{data.context.nextSessionAt ? '該当する締切なし' : '次の面談日時が未設定です。'}</p>}
          {!!deadlines.length && <SessionTaskTable entries={deadlines} data={data} now={now}
            manualActions={manualActions} own={own} viewerUid={viewerUid} />}
        <SessionLink className="session-next" href={`${base}/plan`}>準備する時間を相談する →</SessionLink>
        </section>
        {!!view.review.filter(row => !view.deadlines.includes(row)).length && <ul className="panel session-rows session-other-review"
          aria-label="締切を確かめる課題">
          {view.review.filter(row => !view.deadlines.includes(row)).map(row =>
            <SessionAssignment key={JSON.stringify(row.key)} row={row} data={data} />)}
        </ul>}
        </div>
        <aside className="session-supplement">
        {!!promises.length && <section aria-labelledby="session-promises"><h2 id="session-promises">前回の約束</h2>
          <ul className="panel session-rows">{promises.map(plan =>
            <li key={plan.planId}>{data.assignments.find(row => sameAssignment(row, plan.assignment))?.latest.title ?? '課題'}：
              <time dateTime={plan.startsAt}>{plan.date.replaceAll('-', '/')} {plan.startsAt.slice(11, 16)}〜{plan.endsAt.slice(11, 16)}</time> {plan.period}限に準備 {planProgress(plan)}</li>)}</ul>
        </section>}
        <section aria-labelledby="session-changes"><h2 id="session-changes">前回の面談からの変化 <span className="session-count" aria-hidden="true">{view.changes.length}</span></h2>
          {!view.changes.length && <p className="session-empty">{data.context.lastSessionAt ? '変化なし' : '前回の面談日時未設定'}</p>}
          {!data.context.lastSessionAt && <a href="#session-dates-editor">前回の面談日時を入れる</a>}
          {!!view.changes.length && <ul className="panel session-rows session-brief">{view.changes.slice(0, 5).map(change => <li key={change.changeId}>
            <ChangeStatus change={change} />
            {changeLine(change)}
          </li>)}</ul>}
          {view.changes.length > 5 && <details><summary>ほかの変化</summary><ul className="panel session-rows session-brief">
            {view.changes.slice(5).map(change => <li key={change.changeId}>
            <ChangeStatus change={change} />{changeLine(change)}</li>)}
          </ul></details>}
        </section>
        </aside>
      </div>
      <PlanList plans={data.plans} assignments={data.assignments} own={own} />
    </>}
    <ManualAssignments rows={data.manualAssignments} courses={data.courses} actions={manualActions} own={own} viewerUid={viewerUid} now={now.getTime()} />
  </OperationMessages>;
}
function SessionTaskTable({ entries, data, now, manualActions, own, viewerUid }: {
  entries: DeadlineEntry[]; data: SessionData; now: Date; manualActions?: ManualAssignmentActions | undefined; own: boolean; viewerUid?: string | undefined;
}) {
  const [selected, setSelected] = useState('');
  const entry = entries.find(item => entryId(item) === selected);
  const changes = buildSessionView(data, now).changes;
  return <div className="session-task-workspace"><TaskTable caption="次の面談までの課題" selected={selected} onSelect={setSelected}
    now={now.toISOString()} rows={entries.map(item => ({ id: entryId(item), title: entryTitle(item),
      course: data.courses.find(course => entryBelongsTo(item, course))?.name ?? '授業の指定なし',
      courseIdentity: data.courses.find(course => entryBelongsTo(item, course)),
      deadline: <SessionDeadline entry={item} changes={changes} />,
      remaining: remainingDays(item, now),
      ...(item.kind === 'lms' && changes.some(change => change.kind === 'deadline-changed' && sameAssignment(item.row, change.assignmentKey))
        ? { status: 'changed' as const } : {}),
      note: item.kind === 'lms' && reviewDescription(item.row) ? <span className="session-review"><span className="review-tag session-status-review">要確認</span> {reviewDescription(item.row)}</span> : undefined,
    }))} />
    {entry && <DetailPanel title="課題の詳細" actions={<Button variant="quiet" onClick={() => setSelected('')}>閉じる</Button>}
      facts={[["課題", <ul key={selected}>{entry.kind === 'lms' ? <SessionAssignment key={selected} row={entry.row} data={data} open /> :
        <ManualAssignmentRow row={entry.row} actions={manualActions} own={own} viewerUid={viewerUid} />}</ul>]]} />}
  </div>;
}
function SessionDeadline({ entry, changes }: { entry: DeadlineEntry; changes: AssignmentChange[] }) {
  const deadline = entryDisplayDeadline(entry);
  const date = deadline?.kind === 'datetime' ? dayInZone(new Date(deadline.dueAt), deadline.timeZone) : deadline?.kind === 'date' ? deadline.date : '';
  const change = entry.kind === 'lms' ? changes.filter(change => change.kind === 'deadline-changed' && sameAssignment(entry.row, change.assignmentKey))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0] : undefined;
  const previous = change?.before && typeof change.before !== 'string' ? formatDeadline(change.before) : undefined;
  return <>
    {date && <span className="rd-deadline-day" aria-hidden="true"><b>{Number(date.slice(8))}</b>
      <span>{'日月火水木金土'[new Date(`${date}T00:00:00Z`).getUTCDay()]}</span></span>}
    {previous && <s className="rd-previous-deadline" aria-label="変更前">{previous}</s>}
    <ChangedDeadline value={deadline ? formatDeadline(deadline) : '締切を確認できていません'} />
  </>;
}
function remainingDays(entry: DeadlineEntry, now: Date) {
  const deadline = entryDeadline(entry);
  if (!deadline || (deadline.kind !== 'date' && deadline.kind !== 'datetime')) return '';
  const days = deadline.kind === 'date'
    ? Math.round((Date.parse(deadline.date) - Date.parse(dayInZone(now, deadline.timeZone))) / 86400_000)
    : Math.ceil((Date.parse(deadline.dueAt) - now.getTime()) / 86400_000);
  return days <= 0 ? '今日' : `あと${days}日`;
}
function ChangeStatus({ change }: { change: AssignmentChange }) {
  return change.kind === 'submitted' ? <span className="session-status session-status-done">✓ 出せました</span> :
    change.kind === 'deadline-changed' ? <span className="session-status session-status-changed">→ 締切が変わった</span> : null;
}
function sameAssignment(row: LedgerAssignment, key: LedgerAssignment['key']) {
  return row.key.system === key.system && row.key.sourceId === key.sourceId;
}
export function SessionAssignment({ row, data, open = false }: { row: LedgerAssignment; data: SessionData; open?: boolean }) {
  const courseColor = useCourseColors();
  const course = data.courses.find(course => course.system === row.key.system && course.courseId === row.latest.courseId);
  const changes = data.changes.filter(change => sameAssignment(row, change.assignmentKey))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const reason = reviewDescription(row);
  return <li><details className="session-task" data-course-color={courseColor({ system: row.key.system, courseId: row.latest.courseId })} open={open}><summary><div>
    <span className="eyebrow course-label">{course?.name ?? '授業'}</span>
    <h3>{row.latest.title}</h3>
    <ChangedDeadline value={row.officialDeadline ? formatDeadline(row.officialDeadline.deadline) :
      missingDeadlineText(row.latest.deadline) ?? '締切を確認できていません'} />
    {reason && <span className="session-review"><span className="review-tag session-status-review">要確認</span> {reason}</span>}
  </div></summary><div className="session-task-detail">
    <LmsSourceLink item={row} courseName={course?.name ?? '授業'} />
    <h4>LMSの課題ページに書いてあったこと</h4><p>{row.latest.deadline.dueText}</p>
    {row.officialDeadline && row.latest.deadline.kind === 'unreadable' && <p>
      前に確認できた締切：{row.officialDeadline.deadline.dueText}</p>}
    {!!changes.length && <><h4>これまでの変更</h4><ul>{changes.map(change => <li key={change.changeId}>
      <time>{formatMoment(change.recordedAt)}</time> {changeDescription(change)}</li>)}</ul></>}
  </div></details></li>;
}
