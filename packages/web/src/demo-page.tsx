import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DemoAccount, DemoData, Observation } from '@kadai-hisho/core';
import { firebase } from './firebase';
import { DemoPages, demoDueText } from './demo-pages';
import { readDemoAnnouncements, readDemoObservation } from './demo-reader';
import './demo.css';

class DemoRequestError extends Error {
  constructor(readonly status: number) { super('demo-request-failed'); }
}
async function post(user: User, path: string, body: unknown) {
  const response = await fetch(path, { method: 'POST', cache: 'no-store', headers: {
    Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  if (!response.ok) throw new DemoRequestError(response.status);
  return response;
}
export function DemoPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => firebase ? onAuthStateChanged(firebase.auth, setUser) : undefined, []);
  if (!firebase) return <p>体験画面の準備中です。担当者に確認してください。</p>;
  const client = firebase;
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    try { await signInWithEmailAndPassword(client.auth, String(form.get('email')), String(form.get('password'))); }
    catch { setError('ログインできませんでした。アカウントと接続を確かめてください。'); }
  }
  return <div className="demo-shell"><header className="demo-header"><h1>課題の秘書を試す</h1>
    {user && <button className="demo-logout" onClick={() => { void client.logout().catch(() => setError('ログアウトできませんでした。もう一度お試しください。')); }}>ログアウト</button>}</header>
    <p>ここで扱う授業と課題は架空のものです。学生と支援担当は別のブラウザでログインしてください。</p>
    {user === undefined ? <p role="status">ログインを確かめています…</p> : user ? <>
      <DemoWorkspace key={user.uid} user={user} />
    </> : <form className="session-login" onSubmit={event => { void login(event); }}>
      <label>メールアドレス<input name="email" type="email" autoComplete="username" required /></label>
      <label>パスワード<input name="password" type="password" autoComplete="current-password" required /></label>
      <button>ログイン</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
function DemoWorkspace({ user }: { user: User }) {
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [data, setData] = useState<DemoData | null>(null);
  const [failure, setFailure] = useState<'not-demo' | 'load' | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(false);
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
    <button onClick={() => { void firebase!.logout().catch(() => setLogoutFailed(true)); }}>ログアウト</button>
    {logoutFailed && <p role="alert">ログアウトできませんでした。もう一度お試しください。</p>}
  </div>;
  if (failure) return <p role="alert">体験用のデータを開けませんでした。体験用アカウントと接続を確かめてください。</p>;
  if (!account) return <p role="status">体験用のデータを開いています…</p>;
  if (account.role === 'supporter') return <><p>面談画面で、担当する学生を選んでください。</p><a href="/session">面談を開く</a></>;
  return data ? <DemoStudent key={user.uid} user={user} data={data} /> : <p role="status">授業を開いています…</p>;
}
function DemoStudent({ user, data }: { user: User; data: DemoData }) {
  const pages = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState<{ dates: { sourceId: string; dueAt: string }[]; announcementIds?: string[]; message: string } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<Observation | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (awaiting && (awaiting.announcementIds === undefined ||
      JSON.stringify((data.announcements ?? []).map(item => item.announcement.announcementId)) === JSON.stringify(awaiting.announcementIds)) && awaiting.dates.every(expected => data.courses.some(course => course.assignments.some(task =>
      task.sourceId === expected.sourceId && task.dueAt === expected.dueAt)))) {
      setMessage(awaiting.message); setAwaiting(null);
    }
  }, [awaiting, data]);
  const blocked = busy || awaiting !== null;
  async function action(run: () => Promise<string>) {
    if (blocked) return;
    setBusy(true); setMessage(''); setError('');
    try { const text = await run(); if (active.current) setMessage(text); }
    catch (failure) { if (active.current) setError(failure instanceof DemoRequestError && failure.status === 409
      ? '締切がすでに変わっています。今の締切を確かめてください。'
      : failure instanceof DemoRequestError && failure.status >= 400 && failure.status < 500
        ? '操作が受け付けられませんでした。体験用アカウントの設定を担当者に確認してください。'
        : '操作が終わりませんでした。接続を確かめて、もう一度お試しください。'); }
    finally { if (active.current) setBusy(false); }
  }
  const open = () => action(async () => {
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
    if (results.some(result => result.status === 'rejected' ||
      !['proposal', 'duplicate', 'abstained'].includes(result.value))) {
      return '課題を確認しました。お知らせの確認は終わりませんでした。LMSのお知らせと課題の欄を見比べてください。';
    }
    return '課題を確認しました。学生の画面と面談画面で今の締切を見られます。';
  });
  return <>
    <ol className="demo-steps">
      <li><h2>1. LMSを開く</h2><p>学生としてLMSを開き、課題を読み込みます。</p>
        <button disabled={blocked} onClick={() => { void open(); }}>LMSを開く</button>
        {message ? <p role="status">{message}</p> : error ? <p role="alert">{error}</p> : null}
      </li>
      <li><h2>2. 学生の画面を開く</h2>
        <p>時間割とカレンダーに締切が入ります。開いたままにしてください。</p>
        <a href="/student" target="_blank" rel="noreferrer">学生の画面を開く</a>
      </li>
      <li><section aria-label="先生役の操作"><h2>3. 先生役で締切やお知らせを変える</h2>
        <p>延ばしたら、もう一度 1 を押します。</p>
        {data.courses.flatMap(course => course.assignments).filter(task => task.submission !== 'submitted').map(task =>
          <div className="demo-teacher-action" key={task.sourceId}><p>{task.title}：{demoDueText(task.dueAt)}</p>
            <button disabled={blocked || pending.current !== null} onClick={() => { void action(async () => {
              const response = await post(user, '/api/v1/demo/extend', { sourceId: task.sourceId, expectedDueAt: task.dueAt });
              const expected = await response.json() as { sourceId: string; dueAt: string };
              setAwaiting({ dates: [expected], message: 'LMSの締切を1日延ばしました。「LMSを開く」で課題を確かめてください。' });
              return 'LMSの締切が変わるのを待っています…';
            }); }}>「{task.title}」の締切を1日延ばす</button>
            <button disabled={blocked || pending.current !== null} onClick={() => { void action(async () => {
              const response = await post(user, '/api/v1/demo/announce', { sourceId: task.sourceId, expectedDueAt: task.dueAt });
              const result = await response.json() as { announcementId: string };
              setAwaiting({ dates: [], announcementIds: [...(data.announcements ?? [])
                .filter(item => item.courseId !== data.courses.find(course => course.assignments.includes(task))?.courseId)
                .map(item => item.announcement.announcementId), result.announcementId],
                message: 'お知らせを出しました。「LMSを開く」で、課題の締切との違いを確かめてください。' });
              return 'お知らせが画面に出るのを待っています…';
            }); }}>お知らせを出す</button>
            <p>課題の欄はそのままに、締切を延ばすお知らせを出します。もう一度 1 を押すと「要確認」が出ます。</p>
          </div>)}
      </section></li>
    </ol>
    <button disabled={blocked} onClick={() => { void action(async () => {
      const response = await post(user, '/api/v1/demo/reset', { onlyIfStale: false });
      const result = await response.json() as { data: DemoData };
      pending.current = null;
      setAwaiting({ announcementIds: [], dates: result.data.courses.flatMap(course => course.assignments),
        message: '体験を最初の状態に戻しました。「LMSを開く」から始めてください。' });
      return '体験の画面を更新しています…';
    }); }}>体験を最初からやり直す</button>
    <div className="demo-lms"><h2>LMSの画面（架空）</h2>
      <div ref={pages}><DemoPages data={data} /></div>
    </div>
  </>;
}
