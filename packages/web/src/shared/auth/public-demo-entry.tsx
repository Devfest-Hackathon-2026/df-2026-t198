import { Button } from '../ui/button';
import { useEffect, useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebase } from '../firebase';

export function PublicDemoEntry({ showDescription = true }: { showDescription?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [role, setRole] = useState<'student' | 'supporter'>('student');
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { setBusy(false); setFailed(false); } };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  const student = { email: import.meta.env.VITE_PUBLIC_DEMO_STUDENT_EMAIL,
    password: import.meta.env.VITE_PUBLIC_DEMO_STUDENT_PASSWORD };
  const supporter = { email: import.meta.env.VITE_PUBLIC_DEMO_SUPPORTER_EMAIL,
    password: import.meta.env.VITE_PUBLIC_DEMO_SUPPORTER_PASSWORD };
  if (!firebase || !student.email || !student.password || !supporter.email || !supporter.password) return null;
  const auth = firebase.auth;
  async function enter(role: 'student' | 'supporter') {
    if (busy) return;
    setBusy(true); setRole(role); setFailed(false);
    const account = role === 'student' ? student : supporter;
    try {
      await signInWithEmailAndPassword(auth, account.email, account.password);
      window.location.assign(role === 'student' ? '/demo-lms' : '/session');
    } catch { setFailed(true); setBusy(false); }
  }
  return <section className="demo-login" aria-label="共用の体験">
    {showDescription && <p>誰でも使える共用の体験です。ほかの人と同じデータを使うので、前の人の操作が残っていたら『体験を最初からやり直す』を押してください。学生と支援担当を同時に見るには、別のブラウザか別の端末で開いてください。審査員の方は、説明資料のアカウントを使ってください。</p>}
    <Button disabled={busy} busy={busy && role === 'student'} busyLabel="ログイン中…" onClick={() => { void enter('student'); }}>学生として試す</Button>{' '}
    <Button disabled={busy} busy={busy && role === 'supporter'} busyLabel="ログイン中…" onClick={() => { void enter('supporter'); }}>支援担当として試す</Button>
    {failed && <p role="alert">共用の体験に入れませんでした。少し待ってからもう一度押すか、説明資料のアカウントで入ってください。</p>}
  </section>;
}
