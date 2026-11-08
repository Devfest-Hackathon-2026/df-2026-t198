import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebase } from '../firebase';

export function PublicDemoEntry() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const student = { email: import.meta.env.VITE_PUBLIC_DEMO_STUDENT_EMAIL,
    password: import.meta.env.VITE_PUBLIC_DEMO_STUDENT_PASSWORD };
  const supporter = { email: import.meta.env.VITE_PUBLIC_DEMO_SUPPORTER_EMAIL,
    password: import.meta.env.VITE_PUBLIC_DEMO_SUPPORTER_PASSWORD };
  if (!firebase || !student.email || !student.password || !supporter.email || !supporter.password) return null;
  const auth = firebase.auth;
  async function enter(role: 'student' | 'supporter') {
    if (busy) return;
    setBusy(true); setFailed(false);
    const account = role === 'student' ? student : supporter;
    try {
      await signInWithEmailAndPassword(auth, account.email, account.password);
      window.location.assign(role === 'student' ? '/demo-lms' : '/session');
    } catch { setFailed(true); setBusy(false); }
  }
  return <section className="demo-login" aria-label="共用の体験">
    <p>誰でも使える共用の体験です。ほかの人と同じ画面を使うので、散らかっていたら『体験を最初からやり直す』を押してください。学生と支援担当を同時に見るには、別のブラウザか別の端末で開いてください。審査の方は、説明資料のアカウントを使ってください。</p>
    <button disabled={busy} onClick={() => { void enter('student'); }}>学生として試す</button>{' '}
    <button disabled={busy} onClick={() => { void enter('supporter'); }}>支援担当として試す</button>
    {failed && <p role="alert">共用の体験に入れませんでした。説明資料のアカウントか、紹介ページの動く見本をお使いください。</p>}
  </section>;
}
