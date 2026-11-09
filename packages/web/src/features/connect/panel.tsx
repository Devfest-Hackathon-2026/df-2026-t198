import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { Button } from '../../shared/ui';
import { firebase } from '../../shared/firebase';
import { availabilityText, savedText, type NotificationController } from '../notifications/settings';
import { askExtension, type AskExtension, type ExtensionReply } from './extension';
import { watchCalendarLink, type CalendarLink } from './calendar-link';
import './connect.css';

/** undefined: still asking. null: no extension answers in this browser. */
type Extension = 'none' | 'same' | 'other' | null | undefined;
const stateLabel = { pending: '同期待ち', connected: '連携済み', reconnect: '再接続が必要', failed: '入れられませんでした' };
const needsChrome = 'PCのChromeにToDokuの拡張機能を入れて、この画面を開くと設定できます。';
const otherAccount = '拡張機能は別のGoogleアカウントで使われています。この画面と同じアカウントのChromeで開いてください。';
const failureText: Record<string, string> = {
  'account-mismatch': 'この画面と拡張機能のGoogleアカウントが違うため、接続を止めました。同じアカウントのChromeで開いてください。',
  'authorization-denied': 'Googleの許可が終わりませんでした。もう一度ボタンを押すと、やり直せます。',
  busy: '別の画面で接続が進んでいます。終わってから、もう一度お試しください。',
  'recovery-required': '前に使っていたカレンダーを確かめられないため、接続を止めました。カレンダーを二重に作らないよう、自動では作り直しません。運営に知らせてください。',
  'reauthorization-required': 'Googleの許可を確かめられませんでした。「Google カレンダーにつなぎ直す」を押してください。',
  'sync-failed': '予定をカレンダーに入れられませんでした。しばらくしてから、もう一度お試しください。',
  unconfigured: 'この拡張機能では、Google カレンダーにつなげません。',
};
/** Shown while the setting stays on but the sender cannot deliver. */
const notReadyText: Record<string, string> = {
  preparing: '通知の送信元は準備中です。今はメールを送れません。',
  'authorization-required': '送信元の接続をやり直す必要があります。運営が確認するまで、メールを送れません。',
  'recipient-unavailable': 'ログインしたGoogleアカウントのメールアドレスを確認できません。今はメールを送れません。',
};
function resultText(reply: ExtensionReply | null): { tone: 'status' | 'alert'; text: string } {
  if (!reply) return { tone: 'alert', text: '拡張機能から返事がありませんでした。Chromeの拡張機能を確かめて、もう一度お試しください。' };
  if (reply.ok) return { tone: 'status', text: reply.synced === false ? 'カレンダーを用意しました。予定はまだ入っていません。' : 'Google カレンダーに予定を入れました。' };
  return { tone: 'alert', text: failureText[reply.code] ?? 'Google カレンダーにつなげませんでした。しばらくしてから、もう一度お試しください。' };
}

function CalendarSetting({ uid, link, ask }: { uid: string; link: CalendarLink | null; ask: AskExtension }) {
  const [extension, setExtension] = useState<Extension>(undefined);
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [result, setResult] = useState<ReturnType<typeof resultText> | null>(null);
  const [stalled, setStalled] = useState(false);
  const locked = useRef(false);
  // Events can wait on the server while this Chrome has no usable connection of its own.
  const state = link?.state === 'pending' && (stalled || extension === 'none') ? 'reconnect' : link?.state;
  useEffect(() => {
    let current = true;
    void ask('todoku-status', uid).then(reply => { if (current) setExtension(reply?.ok ? reply.account ?? 'none' : null); });
    return () => { current = false; };
  }, [ask, uid]);
  const run = async (type: 'todoku-calendar-connect' | 'todoku-calendar-sync', quiet = false) => {
    // The lock also covers a double click delivered before the disabled state is painted.
    if (locked.current) return;
    locked.current = true; setBusy(type === 'todoku-calendar-connect' ? 'connect' : 'sync'); setResult(null);
    try {
      const reply = await ask(type, uid);
      if (reply?.ok && type === 'todoku-calendar-connect') { setExtension('same'); setStalled(false); }
      if (reply && !reply.ok && ['reauthorization-required', 'not-connected'].includes(reply.code)) setStalled(true);
      if (!quiet || (reply && !reply.ok && reply.code === 'account-mismatch')) setResult(resultText(reply));
    } finally { locked.current = false; setBusy(null); }
  };
  useEffect(() => {
    // Changes saved while this page is open reach the calendar without waiting for the next LMS visit.
    if (state === 'pending' && extension === 'same') void run('todoku-calendar-sync', true);
  }, [state, extension]);
  if (!link) return <p className="connect-note">Google カレンダーの状態を確かめられませんでした。接続を確かめて、画面を開き直してください。</p>;
  const canAct = extension === 'none' || extension === 'same';
  const guide = extension === null ? needsChrome : extension === 'other' ? otherAccount : '';
  return <div className="connect-item">
    {state === 'not-connected'
      ? canAct && <Button variant="primary" busy={busy === 'connect'} busyLabel="Googleの画面を確かめてください…"
          onClick={() => void run('todoku-calendar-connect')}>Google カレンダーに予定を入れる</Button>
      : <p className="connect-state"><b>Google カレンダー</b><span className={`connect-chip connect-chip-${state}`}>{stateLabel[state!]}</span></p>}
    {state === 'not-connected' && !canAct && <p className="connect-note"><b>Google カレンダー</b>{guide || '拡張機能を確かめています…'}</p>}
    {state === 'connected' && <p className="connect-note">締切と準備の予定が、Google カレンダーに入っています。</p>}
    {state === 'pending' && <p className="connect-note">{busy === 'sync' ? 'カレンダーに入れています…' : extension === 'other' ? otherAccount : 'PCのChromeでこの画面かLMSを開くと、カレンダーに入ります。'}</p>}
    {state === 'reconnect' && (canAct
      ? <Button variant="primary" busy={busy === 'connect'} busyLabel="Googleの画面を確かめてください…"
          onClick={() => void run('todoku-calendar-connect')}>Google カレンダーにつなぎ直す</Button>
      : <p className="connect-note">{guide || '拡張機能を確かめています…'}</p>)}
    {state === 'failed' && <><p className="connect-note">予定をカレンダーに入れられませんでした。{guide}</p>
      {extension === 'same' && <Button busy={busy === 'sync'} busyLabel="入れ直しています…" onClick={() => void run('todoku-calendar-sync')}>もう一度試す</Button>}</>}
    {result && <p role={result.tone} className="connect-result">{result.text}</p>}
  </div>;
}

function MailSetting({ mail: { view, busy, error, saved, request } }: { mail: NotificationController }) {
  const ready = view?.availability === 'ready';
  const enabled = view?.settings.enabled === true;
  // "Enabled" alone does not mean mail goes out: the sender can be unavailable, or the last send can have failed.
  const failed = view?.status?.state === 'failed' || view?.status?.errorCode === 'authorization-required';
  const receiving = enabled && ready && !failed;
  return <div className="connect-item">
    {receiving && <><p className="connect-state"><b>朝のメール</b><span className="connect-chip connect-chip-connected">受け取り中</span></p>
      <p className="connect-note">課題がある朝は、メールが届きます。止めるときは、下の「メール通知の設定」を開いてください。</p></>}
    {enabled && ready && failed && <><p className="connect-state"><b>朝のメール</b><span className="connect-chip connect-chip-failed">送れませんでした</span></p>
      <p className="connect-note">前のメールを送れませんでした。詳しくは、下の「メール通知の設定」を開いてください。</p></>}
    {view && !enabled && ready && <Button variant="primary" busy={busy} busyLabel="保存中…"
      onClick={() => void request({ enabled: true, version: view.settings.version })}>朝のメールを受け取る</Button>}
    {view && !ready && <><p className="connect-state"><b>朝のメール</b><span className="connect-chip connect-chip-pending">準備中</span></p>
      <p className="connect-note">{enabled ? notReadyText[view.availability] ?? '今はメールを送れません。' : availabilityText[view.availability] ?? '今は有効にできません。'}</p></>}
    {!view && !error && <p className="connect-note">朝のメールの状態を確かめています…</p>}
    {!view && error && <><p className="connect-note"><b>朝のメール</b>{error}</p>
      <Button busy={busy} busyLabel="確認中…" onClick={() => void request()}>もう一度確かめる</Button></>}
    {saved && saved !== 'stopped' && <p role="status" className="connect-result">{savedText[saved]}</p>}
    {view && error && <p role="alert" className="connect-result">{error}</p>}
  </div>;
}

export interface ConnectViewProps {
  uid: string; mail: NotificationController; ask: AskExtension;
  /** undefined: not read yet. null: could not be read. */
  link: CalendarLink | null | undefined;
}
export function ConnectView({ uid, link, mail, ask }: ConnectViewProps) {
  if (link === undefined) return null;
  // Demo accounts must not see a control that starts a real Google connection.
  if (link?.demo) return <section className="connect-panel" aria-label="カレンダーとメール">
    <p className="connect-note">体験版では、実際のGoogle カレンダーとメールにはつなぎません。</p></section>;
  return <section className="connect-panel" aria-label="カレンダーとメール">
    <p className="connect-lead">締切と準備の予定を、ふだん使うカレンダーとメールで確かめられます。</p>
    <div className="connect-items"><CalendarSetting uid={uid} link={link} ask={ask} /><MailSetting mail={mail} /></div>
  </section>;
}

export function ConnectPanel({ user, mail }: { user: Pick<User, 'uid'>; mail: NotificationController }) {
  const [link, setLink] = useState<CalendarLink | null | undefined>(undefined);
  useEffect(() => firebase ? watchCalendarLink(firebase.db, user.uid, setLink) : undefined, [user.uid]);
  return <ConnectView uid={user.uid} link={link} mail={mail} ask={askExtension} />;
}
