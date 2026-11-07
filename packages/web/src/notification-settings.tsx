import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { NotificationSettings, NotificationStatus } from '../../core/src/types';

interface SettingsView { settings: NotificationSettings; status: NotificationStatus | null; availability: string }
const availabilityText: Record<string, string> = {
  preparing: '通知の送信元は準備中です。今は有効にできません。',
  'authorization-required': '送信元の接続をやり直す必要があります。運営が確認するまで通知を送れません。',
  'migration-pending': 'クラウドからの通知は準備中です。送信の切り替えが済むと有効にできます。',
  'recipient-unavailable': 'ログインしたGoogleアカウントのメールアドレスを確認できません。今は有効にできません。',
};
const statusText: Record<string, string> = {
  pending: '通知の準備を待っています。', reserved: '通知を準備しています。', sending: '通知を送信しています。',
  accepted: '送信サービスが受け付けました。受信箱への到着は確認していません。',
  failed: '通知を送れませんでした。', unknown: '送信の結果が分かりません。重複を避けるため、この通知は自動で送り直しません。',
  skipped: '予定や設定が変わったため、この通知は送りませんでした。', expired: '通知する時刻を過ぎたため、この通知は送りませんでした。',
};
const dateText = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hourCycle: 'h23' });

export function NotificationSettingsPanel({ user }: { user: Pick<User, 'uid' | 'getIdToken'> }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const locked = useRef(false);
  const active = useRef(false);
  const request = async (input?: { enabled: boolean; version: number }) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setSaved(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/v1/notification-settings', {
        method: input ? 'PUT' : 'GET', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      if (!active.current) return;
      if (!response.ok) {
        if (response.status === 403) { setView(null); setError('このアカウントでは、実際のメール通知を設定できません。'); }
        else {
          if (input) setView(null);
          setError(response.status === 409 ? '設定や送信の準備状況が変わりました。「状態を更新」で確かめてください。' :
            input ? '保存できたか確認できません。「状態を更新」で確かめてください。' : '通知の状態を開けませんでした。もう一度お試しください。');
        }
        return;
      }
      const next = await response.json() as SettingsView;
      if (active.current) { setView(next); setSaved(!!input); }
    } catch {
      if (active.current) {
        if (input) setView(null);
        setError(input ? '保存できたか確認できません。「状態を更新」で確かめてください。' : '通知の状態を開けませんでした。接続を確かめてください。');
      }
    } finally { locked.current = false; if (active.current) setBusy(false); }
  };
  useEffect(() => {
    active.current = true;
    void request();
    return () => { active.current = false; };
    // The parent keys this component by authenticated UID, clearing all previous account state.
  }, []);
  return <details className="notification-settings">
    <summary>メール通知の設定</summary>
    <section aria-label="メール通知の設定">
      <p>有効にすると、Googleでログインしている本人に、朝7:30のまとめと準備を始める30分前のメールを送ります。</p>
      {view && <>
        <p>クラウドからの通知：{view.settings.enabled ? '有効' : '停止中'}</p>
        {availabilityText[view.availability] && <p className="notice">{availabilityText[view.availability]}</p>}
        <button className="plain-button" disabled={busy || (!view.settings.enabled && view.availability !== 'ready')}
          onClick={() => void request({ enabled: !view.settings.enabled, version: view.settings.version })}>
          {view.settings.enabled ? '通知を停止する' : '通知を有効にする'}</button>
        <p className="muted">設定の保存だけではメールは送られません。停止する前に送信を始めたメールは届くことがあります。</p>
        <p>{view.status ? statusText[view.status.state] : 'まだ送信の記録はありません。'}</p>
        {view.status?.errorCode === 'authorization-required' && <p>送信元の接続をやり直す必要があります。運営が確認します。</p>}
        {view.status?.lastAcceptedAt && <p>最後に送信サービスが受け付けた日時：{dateText(view.status.lastAcceptedAt)}（日本時間）</p>}
        {view.status && <p className="muted">通知の記録：{dateText(view.status.updatedAt)} 時点（日本時間）</p>}
      </>}
      <button className="plain-button" disabled={busy} onClick={() => void request()}>{busy ? '確認しています…' : '状態を更新'}</button>
      {saved && <p role="status">通知の設定を保存しました。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  </details>;
}
