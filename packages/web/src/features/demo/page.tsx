import { LongWait, Skeleton } from '../../shared/ui/loading';
import { Button } from '../../shared/ui/button';
import { serverFetch } from '../../shared/network';
import { DigestPreview } from '../digest/preview';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DemoAccount, DemoData, Observation } from '@kadai-hisho/core';
import { firebase } from '../../shared/firebase';
import { DemoPages } from './pages';
import { DemoTriptych } from './triptych';
import { CourseColorProvider } from '../../shared/course-color-context';
import { DemoObserved, useDemoObserved } from './observed';
import { Staged } from '../../shared/ui/motion';
import { readDemoAnnouncements, readDemoObservation } from './reader';
import './demo.css';
import { OperationMessages, useOperationMessage } from '../../shared/ui/operation-messages';
import { PublicDemoEntry } from '../../shared/auth/public-demo-entry';
import { hasJudgeLink, judgeLoginFailure, loginWithJudgeLink } from './judge-link';

class DemoRequestError extends Error {
  constructor(readonly status: number, readonly code = 'demo-request-failed') { super(code); }
}
async function post(user: User, path: string, body: unknown) {
  const response = await serverFetch(path, { method: 'POST', cache: 'no-store', headers: {
    Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  if (!response.ok) {
    if (response.status === 429) {
      const body: unknown = await response.json().catch(() => null);
      if (body && typeof body === 'object' && 'error' in body && body.error === 'public-demo-limit') {
        throw new DemoRequestError(429, 'public-demo-limit');
      }
    }
    throw new DemoRequestError(response.status);
  }
  return response;
}
export function DemoPage() {
  const [entry, setEntry] = useState<'pending' | 'absent' | 'success' | 'failed'>('pending');
  const attempt = useRef<ReturnType<typeof loginWithJudgeLink> | null>(null);
  useEffect(() => {
    let active = true;
    // Keep one authentication attempt across StrictMode's effect replay.
    attempt.current ??= loginWithJudgeLink(window, firebase, signInWithEmailAndPassword);
    void attempt.current.then(result => { if (active) setEntry(result); });
    const followLink = () => {
      if (hasJudgeLink(window.location.hash)) {
        setEntry('pending'); window.location.reload();
      }
    };
    window.addEventListener('hashchange', followLink);
    return () => { active = false; window.removeEventListener('hashchange', followLink); };
  }, []);
  if (entry === 'pending') return <><p role="status">ログイン中…</p><Skeleton label="ログイン中…" /></>;
  return <DemoPageContent initialLinkFailed={entry === 'failed'} />;
}
function DemoPageContent({ initialLinkFailed }: { initialLinkFailed: boolean }) {
  const [linkFailed, setLinkFailed] = useState(initialLinkFailed);
  const [sessionUser, setUser] = useState<User | null | undefined>(undefined);
  const user = linkFailed ? null : sessionUser;
  const [error, setError] = useState(initialLinkFailed ? judgeLoginFailure : '');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  useEffect(() => firebase ? onAuthStateChanged(firebase.auth, setUser) : undefined, []);
  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    if (!user || !returnTo) return;
    let url: URL;
    try { url = new URL(returnTo, window.location.origin); } catch { return; }
    const rev = url.searchParams.get('rev') ?? '';
    if (url.origin === window.location.origin && url.pathname === '/student/plan' &&
      /^[a-f0-9-]{36}$/.test(url.searchParams.get('id') ?? '') && ['done', 'later'].includes(url.searchParams.get('do') ?? '') &&
      /^[1-9]\d*$/.test(rev) && Number.isSafeInteger(Number(rev))) {
      window.location.assign(`/student/plan?id=${encodeURIComponent(url.searchParams.get('id')!)}&do=${url.searchParams.get('do')}&rev=${rev}`);
    }
  }, [user]);
  if (!firebase) return <p>体験画面の準備中です。担当者に確認してください。</p>;
  const client = firebase;
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoginBusy(true);
    const form = new FormData(event.currentTarget);
    try { await signInWithEmailAndPassword(client.auth, String(form.get('email')), String(form.get('password'))); setLinkFailed(false); }
    catch { setError('ログインできませんでした。アカウントと接続を確かめてください。'); }
    finally { setLoginBusy(false); }
  }
  return <div className="demo-shell"><header className="demo-header"><h1>ToDokuを試す</h1>
    {user && <Button className="demo-logout" busy={logoutBusy} busyLabel="ログアウト中…" onClick={() => { setLogoutBusy(true); void client.logout().catch(() => setError('ログアウトできませんでした。もう一度お試しください。')).finally(() => setLogoutBusy(false)); }}>ログアウト</Button>}</header>
    <p>ここで扱う授業と課題は架空のものです。</p>
    {user === undefined ? <Skeleton label="ログインの状態を確かめています…" /> : user ? <>
      <DemoWorkspace key={user.uid} user={user} />
    </> : <><PublicDemoEntry showDescription={false} showUnavailable /><details className="demo-judge-login" open={linkFailed || undefined}>
      <summary>審査員の方（説明資料のアカウント）</summary><form className="session-login" onSubmit={event => { void login(event); }}>
      <label>メールアドレス<input name="email" type="email" autoComplete="username" required /></label>
      <label>パスワード<input name="password" type="password" autoComplete="current-password" required /></label>
      <Button type="submit" busy={loginBusy} busyLabel="ログイン中…">ログイン</Button>
    </form></details></>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
function DemoWorkspace({ user }: { user: User }) {
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [data, setData] = useState<DemoData | null>(null);
  const [failure, setFailure] = useState<'not-demo' | 'load' | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let stopData = () => {};
    let profileVersion = 0;
    const fail = () => { if (active) { setAccount(null); setData(null); setFailure('load'); stopData(); } };
    const stop = onSnapshot(doc(firebase!.db, 'demoAccounts', user.uid), { includeMetadataChanges: true }, snapshot => {
      if (!active || snapshot.metadata.fromCache) return;
      const version = ++profileVersion;
      stopData(); setData(null);
      if (!snapshot.exists()) { setAccount(null); setFailure('not-demo'); return; }
      const profile = snapshot.data() as DemoAccount | undefined;
      if (!profile || !['student', 'supporter'].includes(profile.role) ||
        (profile.role === 'student' && profile.studentId !== user.uid)) { fail(); return; }
      setAccount(profile); setFailure(null);
      if (profile.role === 'student') void post(user, '/api/v1/demo/reset', { onlyIfStale: true }).then(() => {
        if (!active || version !== profileVersion) return;
        stopData = onSnapshot(doc(firebase!.db, 'students', user.uid, 'demo', 'current'),
          { includeMetadataChanges: true }, value => {
            if (!active || version !== profileVersion || value.metadata.fromCache) return;
            if (!value.exists()) { fail(); return; }
            setData(value.data() as DemoData);
          }, fail);
      }).catch(fail);
    }, fail);
    return () => { active = false; stop(); stopData(); };
  }, [user.uid]);
  if (failure === 'not-demo') return <div>
    <p role="alert">このアカウントは体験用ではありません。ログアウトして、体験用のアカウントでログインしてください。</p>
    <Button busy={logoutBusy} busyLabel="ログアウト中…" onClick={() => { setLogoutBusy(true); void firebase!.logout().catch(() => setLogoutFailed(true)).finally(() => setLogoutBusy(false)); }}>ログアウト</Button>
    {logoutFailed && <p role="alert">ログアウトできませんでした。もう一度お試しください。</p>}
  </div>;
  if (failure) return <p role="alert">体験用のデータを開けませんでした。体験用アカウントと接続を確かめてください。</p>;
  if (!account) return <Skeleton label="体験用のデータを開いています…" />;
  if (account.role === 'supporter') return <a href="/session">面談を開く</a>;
  return data ? <OperationMessages><DemoStudent key={user.uid} user={user} data={data} /></OperationMessages> : <Skeleton label="授業を開いています…" />;
}
function DemoStudent({ user, data }: { user: User; data: DemoData }) {
  const pages = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('open');
  const [stage, setStage] = useState(0);
  const [autoRead, setAutoRead] = useState(false);
  const [mailOpen, setMailOpen] = useState(0);
  const showMail = mailOpen > 0;
  const observed = useDemoObserved(user);
  const [awaiting, setAwaiting] = useState<{ dates: { sourceId: string; dueAt: string }[]; announcementIds?: string[]; message: string; next?: 'read' | 'reset' } | null>(null);
  const [message, setMessage] = useOperationMessage();
  const [error, setError] = useOperationMessage();
  const pending = useRef<Observation | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (awaiting && (awaiting.announcementIds === undefined ||
      JSON.stringify((data.announcements ?? []).map(item => item.announcement.announcementId)) === JSON.stringify(awaiting.announcementIds)) && awaiting.dates.every(expected => data.courses.some(course => course.assignments.some(task =>
      task.sourceId === expected.sourceId && task.dueAt === expected.dueAt)))) {
      setMessage(awaiting.message); setAwaiting(null);
      if (awaiting.next === 'read') { setStage(2); setAutoRead(true); }
      if (awaiting.next === 'reset') { setStage(0); setMailOpen(0); }
    }
  }, [awaiting, data]);
  const blocked = busy || awaiting !== null;
  async function action(run: () => Promise<string>, key = 'open') {
    if (blocked) return;
    setBusy(true); setOperation(key); setMessage(''); setError('');
    try { const text = await run(); if (active.current) setMessage(text); }
    catch (failure) { if (active.current) setError(failure instanceof DemoRequestError && failure.status === 409
      ? '締切がすでに変わっています。今の締切を確かめてください。'
      : failure instanceof DemoRequestError && failure.status >= 400 && failure.status < 500
        ? '操作が受け付けられませんでした。体験用アカウントの設定を担当者に確認してください。'
        : '操作が終わりませんでした。接続を確かめて、もう一度お試しください。'); }
    finally { if (active.current) setBusy(false); }
  }
  const open = () => {
    setAutoRead(false);
    return action(async () => {
      pending.current ??= readDemoObservation(pages.current!, window.location.origin, crypto.randomUUID(), new Date().toISOString());
      try { await post(user, '/api/v1/observations', pending.current); }
      catch (failure) {
        if (failure instanceof DemoRequestError && failure.status < 500) pending.current = null;
        throw failure;
      }
      pending.current = null;
      const notices = readDemoAnnouncements(pages.current!);
      const results = await Promise.allSettled(notices.map(async notice => {
        const response = await post(user, '/api/v1/announcements', notice);
        return (await response.json() as { status: string }).status;
      }));
      if (results.some(result => result.status === 'rejected' && result.reason instanceof DemoRequestError &&
        result.reason.code === 'public-demo-limit')) return '体験版で今日使えるお知らせの読み取りの回数を使い切りました';
      if (results.some(result => result.status === 'rejected' ||
        !['proposal', 'duplicate', 'abstained'].includes(result.value))) {
        return '課題を確認しました。お知らせは最後まで確認できませんでした。LMSのお知らせと課題ページの締切を見比べてください。';
      }
      setStage(stage >= 2 ? 3 : 1);
      return '課題を確認しました。';
    });
  };
  useEffect(() => {
    if (!autoRead || blocked) return;
    const timer = window.setTimeout(() => { void open(); }, 3000);
    return () => window.clearTimeout(timer);
  }, [autoRead, blocked, data]);
  const tasks = data.courses.flatMap(course => course.assignments).filter(task => task.submission !== 'submitted');
  const hero = tasks[0];
  const extend = (task: typeof tasks[number]) => action(async () => {
    const response = await post(user, '/api/v1/demo/extend', { sourceId: task.sourceId, expectedDueAt: task.dueAt });
    const expected = await response.json() as { sourceId: string; dueAt: string };
    window.location.hash = `detail-${task.sourceId}`;
    setAwaiting({ dates: [expected], next: 'read', message: 'LMSの締切を1日延ばしました。' });
    return 'LMSの締切が変わるのを待っています…';
  }, `extend:${task.sourceId}`);
  const teacherButton = (task: typeof tasks[number], primary = false) => <Button variant={primary ? 'primary' : 'quiet'}
    disabled={blocked || pending.current !== null} busy={blocked && operation === `extend:${task.sourceId}`} busyLabel="変更中…"
    onClick={() => { void extend(task); }}>「{task.title}」の締切を1日延ばす</Button>;
  const openButton = <Button variant={stage === 0 || stage === 2 ? 'primary' : 'quiet'} disabled={blocked}
    busy={blocked && operation === 'open'} busyLabel="確認中…" onClick={() => { void open(); }}>LMSを開く</Button>;
  const result = message ? <p role="status">{message}</p> : error ? <p role="alert">{error}</p> : null;
  const sourceAhead = observed.status === 'ready' && observed.data.assignments.length > 0 && tasks.some(task => {
    const due = observed.data.assignments.find(row => row.key.sourceId === task.sourceId)?.officialDeadline?.deadline;
    return due?.kind === 'datetime' && Date.parse(due.dueAt) !== Date.parse(task.dueAt);
  });
  return <Staged>
    <div className="demo-flow-header"><ol className="demo-steps" aria-label="体験の段階">
      {['LMSを開く', '先生が締切を延ばす', '学生と支援担当の画面', '朝のメール'].map((label, index) =>
        <li key={label} aria-current={index === stage ? 'step' : undefined} data-complete={index < stage}>
          <span aria-hidden="true">{index < stage ? '✓' : index + 1}</span>{label}</li>)}
    </ol><Button variant="quiet" disabled={blocked} busy={blocked && operation === 'reset'} busyLabel="やり直しています…" onClick={() => {
      if (!window.confirm('体験を最初の状態に戻しますか？')) return;
      setAutoRead(false);
      void action(async () => {
        const response = await post(user, '/api/v1/demo/reset', { onlyIfStale: false });
        const result = await response.json() as { data: DemoData };
        pending.current = null;
        window.location.hash = 'courses';
        setAwaiting({ announcementIds: [], dates: result.data.courses.flatMap(course => course.assignments),
          next: 'reset', message: '体験を最初の状態に戻しました。' });
        return '体験の画面を更新しています…';
      }, 'reset');
    }}>体験を最初からやり直す</Button></div>
    <div className="demo-command" aria-label="今の操作">
      {stage === 0 || stage === 2 ? <>{openButton}{result}</> : <>
        {stage === 1 && hero ? teacherButton(hero, true) : <Button variant="primary" disabled={blocked}
          busy={blocked && operation === 'mail'} busyLabel="開いています…" onClick={() => {
          void action(async () => {
            await post(user, '/api/v1/digest/demo-plan', undefined);
            if (active.current) {
              setMailOpen(value => value + 1); setStage(3);
              window.setTimeout(() => document.getElementById('demo-morning-mail')?.scrollIntoView({ block: 'start' }), 0);
            }
            return '';
          }, 'mail');
        }}>朝のメールを見る</Button>}{result}
      </>}
      <LongWait busy={blocked} afterThree={operation === 'mail' ? 'メールの見本を開いています…' : operation === 'open' ? '課題とお知らせを確認しています…' : 'LMSの変更を待っています…'}
        afterTen="まだ応答を待っています。接続を確かめて、この画面でお待ちください。" />
    </div>
    <CourseColorProvider courses={observed.data.courses}>
      <DemoTriptych waiting={sourceAhead} lms={<div ref={pages}><DemoPages data={data} /></div>}
        student={<DemoObserved state={observed} role="student" />} supporter={<DemoObserved state={observed} role="supporter" />} />
    </CourseColorProvider>
    <div className="demo-secondary"><a href="/student" target="_blank" rel="noreferrer">学生の画面を開く</a>
      <a href="/session">面談を開く</a>
      {stage !== 0 && stage !== 2 && openButton}
    </div>
    <details className="demo-more"><summary>先生役の操作・メールの見本</summary>
      <section aria-label="先生役の操作"><h2>先生役の操作</h2>
        {tasks.map(task => <div className="demo-teacher-action" key={task.sourceId}>
          {!(stage === 1 && task === hero) && teacherButton(task)}
          <Button variant="quiet" disabled={blocked || pending.current !== null} busy={blocked && operation === `announce:${task.sourceId}`} busyLabel="投稿中…"
            onClick={() => { setAutoRead(false); void action(async () => {
              const response = await post(user, '/api/v1/demo/announce', { sourceId: task.sourceId, expectedDueAt: task.dueAt });
              const result = await response.json() as { announcementId: string };
              setAwaiting({ dates: [], announcementIds: [...(data.announcements ?? [])
                .filter(item => item.courseId !== data.courses.find(course => course.assignments.includes(task))?.courseId)
                .map(item => item.announcement.announcementId), result.announcementId],
                message: 'お知らせを出しました。' });
              return 'お知らせが画面に出るのを待っています…';
            }, `announce:${task.sourceId}`); }}>お知らせを出す</Button>
          <span>{task.title}</span>
        </div>)}
      </section>
      {!showMail && <DigestPreview user={user} />}
    </details>
    {showMail && <div id="demo-morning-mail"><DigestPreview key={mailOpen} user={user} initiallyOpened /></div>}
  </Staged>;
}
