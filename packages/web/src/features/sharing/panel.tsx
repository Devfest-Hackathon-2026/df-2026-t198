import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { firebase } from '../../shared/firebase';
import { serverFetch } from '../../shared/network';
import { Button } from '../../shared/ui';
import './sharing.css';

export interface Supporter { uid: string; displayName?: string; revoked: boolean }
export interface SharingData { supporters: Supporter[]; canManage: boolean }
const endpoint = '/api/v1/sharing/supporters';
export async function sharingRequest(user: User, supporter?: Supporter) {
  const response = await serverFetch(supporter ? `${endpoint}/${encodeURIComponent(supporter.uid)}/${supporter.revoked ? 'restore' : 'revoke'}` : endpoint, {
    method: supporter ? 'POST' : 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!response.ok) throw new Error('sharing-request-failed');
  return response;
}
export function watchSharing(user: User, next: (data: SharingData | null) => void) {
  if (!firebase) return () => {};
  let active = true;
  let version = 0;
  const stop = onSnapshot(collection(firebase.db, 'students', user.uid, 'supporters'), { includeMetadataChanges: true }, snapshot => {
    const current = ++version;
    if (snapshot.metadata.fromCache) return;
    void sharingRequest(user).then(response => response.json() as Promise<SharingData>).then(data => {
      if (active && current === version) next(data);
    }).catch(() => { if (active && current === version) next(null); });
  }, () => { version++; if (active) next(null); });
  return () => { active = false; stop(); };
}
export function SharingPanel({ user }: { user: User }) {
  const [data, setData] = useState<SharingData>({ supporters: [], canManage: false });
  const [error, setError] = useState('');
  useEffect(() => watchSharing(user, value => {
    if (value) { setData(value); setError(''); }
    else { setData({ supporters: [], canManage: false }); setError('共有を確認できませんでした。接続を確かめて、画面を開き直してください。'); }
  }), [user]);
  return error ? <p role="alert">{error}</p> : <SharingControls data={data} change={async supporter => {
    await sharingRequest(user, supporter);
  }} />;
}
export function SharingControls({ data, change }: { data: SharingData; change: (supporter: Supporter) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  if (!data.canManage || !data.supporters.length) return null;
  async function act(supporter: Supporter) {
    setNotice(''); setError('');
    if (!supporter.revoked && !window.confirm('共有をやめますか？\nこの支援担当はあなたの時間割・課題・準備の予定を見られなくなります。')) return;
    setBusy(supporter.uid);
    try {
      await change(supporter);
      setNotice(supporter.revoked ? '共有を再開しました。' : '共有をやめました。');
    } catch { setError('共有を変更できませんでした。接続を確かめて、もう一度お試しください。'); }
    finally { setBusy(null); }
  }
  return <section className="student-sharing" aria-labelledby="sharing-title">
    <h2 id="sharing-title">共有している支援担当</h2>
    <ul>{data.supporters.map(supporter => <li key={supporter.uid}>
      <span><strong>{supporter.displayName ?? '支援担当'}</strong>{supporter.revoked && <small>共有を停止中</small>}</span>
      <Button disabled={busy !== null} busy={busy === supporter.uid} busyLabel="変更中…" onClick={() => { void act(supporter); }}>
        {supporter.revoked ? 'もう一度共有する' : '共有をやめる'}
      </Button>
    </li>)}</ul>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
