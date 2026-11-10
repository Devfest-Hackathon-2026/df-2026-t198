import { useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { firebase } from '../../shared/firebase';
import type { StudentData } from '../../shared/assignments/types';
import { CalendarSetting, MailSetting } from '../connect/panel';
import { watchCalendarLink, type CalendarLink } from '../connect/calendar-link';
import { askExtension } from '../connect/extension';
import { NotificationSettingsView, type NotificationController } from '../notifications/settings';
import { SharingControls, sharingRequest, watchSharing, type SharingData } from '../sharing/panel';

const calendarLabels = { 'not-connected': '未設定', pending: '同期待ち', connected: '連携済み', reconnect: '再接続が必要', failed: '入れられませんでした' };
export function connectionSummary(link: CalendarLink | null | undefined, mail: NotificationController, sharing: SharingData | null | undefined) {
  const demo = link?.demo;
  const calendar = demo ? '体験用' : link ? calendarLabels[link.state] : link === null ? '確認できません' : '確認中';
  const view = mail.view;
  const receiving = view?.settings.enabled && view.availability === 'ready' && view.status?.state !== 'failed' && view.status?.errorCode !== 'authorization-required';
  const email = demo ? '見本' : mail.error ? '確認が必要' : !view ? '確認中' : !view.settings.enabled ? '停止中' : receiving ? '受け取り中' : '送れません';
  const share = sharing === undefined ? '確認中' : sharing === null ? '確認できません' : sharing.supporters.some(person => !person.revoked) ? '共有中' : '共有なし';
  return { calendar, email, share, needsSetup: !demo && !!link && (link.state === 'not-connected' || link.state === 'reconnect' || (!!view && !view.settings.enabled)) };
}
export function StudentSettings({ user, mail, data, children }: { user: User; mail: NotificationController; data: StudentData; children: ReactNode }) {
  const [link, setLink] = useState<CalendarLink | null>();
  const [sharing, setSharing] = useState<SharingData | null>();
  useEffect(() => firebase ? watchCalendarLink(firebase.db, user.uid, setLink) : undefined, [user.uid]);
  useEffect(() => watchSharing(user, setSharing), [user]);
  const summary = connectionSummary(link, mail, sharing);
  const demo = link?.demo;
  return <details className="rd-settings rd-fold"><summary>連携と設定
    <span className="rd-settings-badges"><span className="rd-pill" data-ready={summary.calendar === '連携済み' || undefined}>Google カレンダー · {summary.calendar}</span><span className="rd-pill" data-ready={summary.email === '受け取り中' || undefined}>朝のメール · {summary.email}</span><span className="rd-pill">共有 · {summary.share}</span></span>
    {summary.needsSetup && <span className="rd-setup-link">設定する</span>}
  </summary>
    <section className="connect-panel" aria-label="カレンダーとメール">
    {demo && <p className="connect-note">体験版では、実際のGoogle カレンダーとメールにはつなぎません。</p>}
    <div className="rd-setting-row"><h3>Google カレンダー</h3>{demo ? <p>体験用カレンダーで確かめられます。</p> : link === undefined ? <p>状態を確かめています…</p> : <CalendarSetting uid={user.uid} link={link} ask={askExtension} />}</div>
    <div className="rd-setting-row"><h3>朝のメール</h3>{demo ? <><p>実際のメールは送りません。体験の画面で見本を確かめられます。</p><NotificationSettingsView controller={mail} /></> : <><MailSetting mail={mail} /><NotificationSettingsView controller={mail} /></>}</div>
    </section>
    <div className="rd-setting-row"><h3>共有</h3>{sharing ? <><p>{summary.share}</p><SharingControls data={sharing} change={async supporter => { await sharingRequest(user, supporter); }} /></>
      : <p>{summary.share}</p>}</div>
    <div className="rd-setting-row"><h3>課題を手で入れる</h3><p>{data.manualAssignments.filter(row => row.status === 'active').length}件を手で入れています。</p><div>{children}</div></div>
  </details>;
}
