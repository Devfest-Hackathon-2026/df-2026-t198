import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebase } from '../firebase';
import { TodokuLogo } from '../ui/todoku-logo';

export function AppHome() {
  const [href, setHref] = useState('/student');
  useEffect(() => {
    if (!firebase) return;
    const client = firebase;
    let stopAccount = () => {};
    const stopAuth = onAuthStateChanged(client.auth, user => {
      stopAccount(); setHref('/student');
      if (!user) return;
      let active = true;
      const stop = onSnapshot(doc(client.db, 'demoAccounts', user.uid), snapshot => {
        if (active) setHref(snapshot.exists() ? '/demo-lms' : '/student');
      }, () => { if (active) setHref('/student'); });
      stopAccount = () => { active = false; stop(); };
    });
    return () => { stopAuth(); stopAccount(); };
  }, []);
  return <a className="app-home" href={href} aria-label="アプリのホーム"><TodokuLogo /></a>;
}
