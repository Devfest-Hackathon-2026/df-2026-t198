import { Button, Skeleton } from '../../shared/ui';
import './settings.css';
import { serverFetch } from '../../shared/network';
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { NotificationSettings, NotificationStatus } from '../../../../core/src/types';

interface SettingsView { settings: NotificationSettings; status: NotificationStatus | null; availability: string }
export const availabilityText: Record<string, string> = {
  preparing: '通知の送信元は準備中です。今は有効にできません。',
  'authorization-required': '送信元の接続をやり直す必要があります。運営が確認するまで通知を送れません。',
  'recipient-unavailable': 'ログインしたGoogleアカウントのメールアドレスを確認できません。今は有効にできません。',
};
const statusText: Record<string, string> = {
  pending: '通知の準備を待っています。', reserved: '通知を準備しています。', sending: '通知を送信しています。',
  accepted: '送信サービスが受け付けました。受信箱への到着は確認していません。',
  failed: '通知を送れませんでした。', unknown: '送信の結果が分かりません。重複を避けるため、この通知は自動で送り直しません。',
  skipped: '予定や設定が変わったため、この通知は送りませんでした。', expired: '通知する時刻を過ぎたため、この通知は送りませんでした。',
};
export const savedText = {
  cutover: '通知を有効にしました。朝のまとめは次の07:30から、今日やることがある日に送ります。切り替え前に通知の時刻を過ぎた分は送りません。',
  enabled: '通知を有効にしました。',
  stopped: '通知を停止しました。拡張機能からも送りません。',
};
const dateText = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hourCycle: 'h23' });

export interface NotificationController {
  view: SettingsView | null; busy: boolean; error: string; saved: keyof typeof savedText | null;
  request: (input?: { enabled: boolean; version: number }) => Promise<void>;
}
/** One state for the buttons above the timetable and the detailed panel below it. */
export function useNotificationSettings(user: Pick<User, 'uid' | 'getIdToken'>): NotificationController {
  const [view, setView] = useState<SettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<keyof typeof savedText | null>(null);
  const locked = useRef(false);
  const active = useRef(false);
  const request = async (input?: { enabled: boolean; version: number }) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setSaved(null);
    try {
      const token = await user.getIdToken();
      const response = await serverFetch('/api/v1/notification-settings', {
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
      if (active.current) {
        setView(next);
        setSaved(!input ? null : !next.settings.enabled ? 'stopped' :
          next.settings.cloudSince !== view?.settings.cloudSince ? 'cutover' : 'enabled');
      }
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
  return { view, busy, error, saved, request };
}
export function NotificationSettingsPanel({ user }: { user: Pick<User, 'uid' | 'getIdToken'> }) {
  return <NotificationSettingsView controller={useNotificationSettings(user)} />;
}
export function NotificationSettingsView({ controller: { view, busy, error, saved, request } }: { controller: NotificationController }) {
  return <details className="notification-settings">
    <summary>メール通知の設定</summary>
    <section aria-label="メール通知の設定">
      <dl className="notification-schedule"><dt>朝のまとめ</dt><dd>07:30</dd><dt>準備の通知</dt><dd>開始30分前</dd><dt>宛先</dt><dd>ログイン中の本人</dd></dl>
      {!view && busy && <Skeleton label="通知の状態を確かめています…" />}
      {view && <>
        <p>メール通知：{view.settings.enabled ? '有効' : '停止中'}</p>
        {availabilityText[view.availability] && <p className="notice">{availabilityText[view.availability]}</p>}
        <Button className="plain-button" busy={busy} busyLabel="保存中…" disabled={busy || (!view.settings.enabled && view.availability !== 'ready')}
          onClick={() => void request({ enabled: !view.settings.enabled, version: view.settings.version })}>
          {view.settings.enabled ? '通知を停止する' : '通知を有効にする'}</Button>
        <p>{view.status ? statusText[view.status.state] : 'まだ送信の記録はありません。'}</p>
        {view.status?.errorCode === 'authorization-required' && <p>送信元の接続をやり直す必要があります。運営が確認します。</p>}
        {view.status?.lastAcceptedAt && <p>最後に送信サービスが受け付けた日時：{dateText(view.status.lastAcceptedAt)}（日本時間）</p>}
        {view.status && <p className="muted">通知の記録：{dateText(view.status.updatedAt)} 時点（日本時間）</p>}
      </>}
      <Button className="plain-button" busy={busy} busyLabel="確認中…" onClick={() => void request()}>状態を更新</Button>
      {saved && <p role="status">{savedText[saved]}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  </details>;
}
