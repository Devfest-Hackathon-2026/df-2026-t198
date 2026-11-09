import { createRequire } from 'node:module';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { NotificationSettings } from '../../core/src/types';
import type { NotificationController } from '../src/features/notifications/settings';
import type { CalendarLink, CalendarState } from '../src/features/connect/calendar-link';
import type { AskExtension, ExtensionReply } from '../src/features/connect/extension';
import { ConnectView } from '../src/features/connect/panel';

vi.mock('../src/shared/firebase', () => ({ firebase: null }));
afterEach(() => vi.unstubAllGlobals());
const { parseHTML } = createRequire(new URL('../../core/package.json', import.meta.url))('linkedom');

const settings: NotificationSettings = { enabled: false, deliveryOwner: 'none', version: 3, timeZone: 'Asia/Tokyo', morningTime: '07:30',
  recipientUid: 'student', migrationState: 'not-started', updatedAt: '2030-11-10T00:00:00.000Z' };
function mailState(change: Partial<NotificationController> = {}, availability = 'ready', enabled = false): NotificationController {
  return { view: { settings: { ...settings, enabled }, status: null, availability }, busy: false, error: '', saved: null,
    request: vi.fn(async () => {}), ...change };
}
type Replies = Partial<Record<Parameters<AskExtension>[0], ExtensionReply | null | Promise<ExtensionReply | null>>>;
async function mount(options: { state?: CalendarState; demo?: boolean; link?: CalendarLink | null | undefined; replies?: Replies; mail?: NotificationController } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const replies: Replies = { 'todoku-status': { ok: true, account: 'none' }, ...options.replies };
  const ask = vi.fn<AskExtension>(async type => replies[type] ?? null);
  const mail = options.mail ?? mailState();
  const host = document.getElementById('root')!; const root = createRoot(host);
  const render = (link: CalendarLink | null | undefined) => act(async () => root.render(<StrictMode>
    <ConnectView uid="student" link={link} mail={mail} ask={ask} /></StrictMode>));
  await render('link' in options ? options.link : { demo: options.demo ?? false, state: options.state ?? 'not-connected' });
  const buttons = () => [...host.querySelectorAll('button')].map(button => button.textContent);
  const click = async (name: string, times = 1) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === name)!;
    expect(button).toBeTruthy();
    await act(async () => { for (let i = 0; i < times; i++) button.click(); });
  };
  const asked = (type: string) => ask.mock.calls.filter(call => call[0] === type);
  return { host, ask, asked, mail, buttons, click, render, close: () => act(async () => root.unmount()) };
}

it('offers both settings above the timetable, and each starts with one click', async () => {
  const view = await mount({ replies: { 'todoku-calendar-connect': { ok: true, synced: true } } });
  try {
    expect(view.buttons()).toEqual(['Google カレンダーに予定を入れる', '朝のメールを受け取る']);
    await view.click('Google カレンダーに予定を入れる', 2);
    expect(view.asked('todoku-calendar-connect')).toEqual([['todoku-calendar-connect', 'student']]);
    expect(view.host.querySelector('[role=status]')!.textContent).toBe('Google カレンダーに予定を入れました。');
    await view.click('朝のメールを受け取る');
    expect(view.mail.request).toHaveBeenCalledWith({ enabled: true, version: 3 });
  } finally { await view.close(); }
});

it('keeps the calendar button disabled while the Google dialog is open', async () => {
  let finish!: (reply: ExtensionReply) => void;
  const view = await mount({ replies: { 'todoku-calendar-connect': new Promise<ExtensionReply | null>(resolve => { finish = resolve; }) } });
  try {
    await view.click('Google カレンダーに予定を入れる');
    const button = view.host.querySelector('button')!;
    expect(button.textContent).toBe('Googleの画面を確かめてください…');
    expect(button.disabled).toBe(true);
    await act(async () => finish({ ok: true, synced: false }));
    expect(view.host.querySelector('[role=status]')!.textContent).toBe('カレンダーを用意しました。予定はまだ入っていません。');
  } finally { await view.close(); }
});

it('shows the state in the same place and never repeats a button once connected', async () => {
  for (const [state, label, button] of [['connected', '連携済み', null], ['pending', '同期待ち', null],
    ['reconnect', '再接続が必要', 'Google カレンダーにつなぎ直す'], ['failed', '入れられませんでした', 'もう一度試す']] as const) {
    const view = await mount({ state, replies: { 'todoku-status': { ok: true, account: 'same' }, 'todoku-calendar-sync': { ok: false, code: 'sync-failed' } } });
    try {
      expect(view.host.textContent).toContain(label);
      expect(view.buttons()).toEqual([...(button ? [button] : []), '朝のメールを受け取る']);
    } finally { await view.close(); }
  }
});

it('asks the open Chrome to write waiting events once, without a dialog or a message', async () => {
  const view = await mount({ state: 'pending', replies: { 'todoku-status': { ok: true, account: 'same' }, 'todoku-calendar-sync': { ok: true, synced: true } } });
  try {
    expect(view.asked('todoku-calendar-sync')).toHaveLength(1);
    expect(view.asked('todoku-calendar-connect')).toEqual([]);
    expect(view.host.querySelector('[role=status], [role=alert]')).toBeNull();
    await view.render({ demo: false, state: 'connected' });
    expect(view.host.textContent).toContain('連携済み');
    expect(view.asked('todoku-calendar-sync')).toHaveLength(1);
  } finally { await view.close(); }
});

it('offers reconnection when events wait but this Chrome has no usable connection', async () => {
  for (const replies of [{ 'todoku-status': { ok: true, account: 'none' } },
    { 'todoku-status': { ok: true, account: 'same' }, 'todoku-calendar-sync': { ok: false, code: 'reauthorization-required' } }] as Replies[]) {
    const view = await mount({ state: 'pending', replies });
    try {
      expect(view.host.textContent).toContain('再接続が必要');
      expect(view.buttons()).toContain('Google カレンダーにつなぎ直す');
    } finally { await view.close(); }
  }
});

it('explains what to do on a PC when no extension answers, instead of a calendar button', async () => {
  for (const state of ['not-connected', 'reconnect'] as const) {
    const view = await mount({ state, replies: { 'todoku-status': null } });
    try {
      expect(view.host.textContent).toContain('PCのChromeにToDokuの拡張機能を入れて、この画面を開くと設定できます。');
      expect(view.buttons()).toEqual(['朝のメールを受け取る']);
      expect(view.asked('todoku-calendar-connect')).toEqual([]);
    } finally { await view.close(); }
  }
  const waiting = await mount({ state: 'pending', replies: { 'todoku-status': null } });
  try {
    expect(waiting.host.textContent).toContain('同期待ち');
    expect(waiting.host.textContent).toContain('PCのChromeでこの画面かLMSを開くと、カレンダーに入ります。');
    expect(waiting.asked('todoku-calendar-sync')).toEqual([]);
  } finally { await waiting.close(); }
});

it('stops and explains when the extension belongs to another account or the dialog was refused', async () => {
  const other = await mount({ replies: { 'todoku-status': { ok: true, account: 'other' } } });
  try {
    expect(other.host.textContent).toContain('拡張機能は別のGoogleアカウントで使われています。');
    expect(other.buttons()).toEqual(['朝のメールを受け取る']);
  } finally { await other.close(); }
  for (const [code, text] of [['account-mismatch', 'Googleアカウントが違うため、接続を止めました。'],
    ['authorization-denied', 'Googleの許可が終わりませんでした。もう一度ボタンを押すと、やり直せます。'],
    ['busy', '別の画面で接続が進んでいます。'], ['recovery-required', '自動では作り直しません。'], ['unknown-code', 'Google カレンダーにつなげませんでした。']]) {
    const view = await mount({ replies: { 'todoku-calendar-connect': { ok: false, code: code! } } });
    try {
      await view.click('Google カレンダーに予定を入れる');
      expect(view.host.querySelector('[role=alert]')!.textContent).toContain(text);
      // The same button stays, so the student can continue from here.
      expect(view.buttons()).toContain('Google カレンダーに予定を入れる');
    } finally { await view.close(); }
  }
});

it('never offers a real Google connection to a demo account, and shows nothing before the account is known', async () => {
  const demo = await mount({ demo: true, state: 'not-connected' });
  try {
    expect(demo.buttons()).toEqual([]);
    expect(demo.host.textContent).toBe('体験版では、実際のGoogle カレンダーとメールにはつなぎません。');
    expect(demo.ask).not.toHaveBeenCalled();
  } finally { await demo.close(); }
  const unknown = await mount({ link: undefined });
  try { expect(unknown.host.textContent).toBe(''); expect(unknown.ask).not.toHaveBeenCalled(); } finally { await unknown.close(); }
  const unreadable = await mount({ link: null });
  try {
    expect(unreadable.host.textContent).toContain('Google カレンダーの状態を確かめられませんでした。');
    expect(unreadable.buttons()).toEqual(['朝のメールを受け取る']);
  } finally { await unreadable.close(); }
});

it('shows the mail state: receiving, not ready with its reason, and a failed check', async () => {
  const receiving = await mount({ state: 'connected', mail: mailState({ saved: 'cutover' }, 'ready', true) });
  try {
    expect(receiving.buttons()).toEqual([]);
    expect(receiving.host.textContent).toContain('受け取り中');
    expect(receiving.host.textContent).toContain('課題がある朝は、メールが届きます。');
    expect(receiving.host.querySelector('[role=status]')!.textContent).toContain('朝のまとめは次の07:30から');
  } finally { await receiving.close(); }
  for (const [availability, reason] of [['preparing', '通知の送信元は準備中です。今は有効にできません。'],
    ['authorization-required', '送信元の接続をやり直す必要があります。'], ['recipient-unavailable', 'メールアドレスを確認できません。']]) {
    const view = await mount({ state: 'connected', mail: mailState({}, availability) });
    try {
      expect(view.buttons()).toEqual([]);
      expect(view.host.textContent).toContain('準備中');
      expect(view.host.textContent).toContain(reason);
    } finally { await view.close(); }
  }
  const failed = await mount({ state: 'connected', mail: mailState({ view: null, error: '通知の状態を開けませんでした。接続を確かめてください。' }) });
  try {
    await failed.click('もう一度確かめる');
    expect(failed.mail.request).toHaveBeenCalledWith();
  } finally { await failed.close(); }
});

it('does not say "receiving" while the setting is on but mail cannot go out', async () => {
  for (const [availability, reason] of [['preparing', '通知の送信元は準備中です。今はメールを送れません。'],
    ['authorization-required', '運営が確認するまで、メールを送れません。'], ['recipient-unavailable', '今はメールを送れません。']]) {
    const view = await mount({ state: 'connected', mail: mailState({}, availability, true) });
    try {
      expect(view.host.textContent).toContain('準備中');
      expect(view.host.textContent).toContain(reason);
      expect(view.host.textContent).not.toContain('受け取り中');
      expect(view.host.textContent).not.toContain('メールが届きます');
      expect(view.buttons()).toEqual([]);
    } finally { await view.close(); }
  }
  const status = { settingsVersion: 4, updatedAt: '2030-11-10T00:00:00.000Z', lastAcceptedAt: null };
  for (const failure of [{ ...status, state: 'failed', errorCode: 'not-accepted' }, { ...status, state: 'skipped', errorCode: 'authorization-required' }] as const) {
    const base = mailState({}, 'ready', true);
    const view = await mount({ state: 'connected', mail: { ...base, view: { ...base.view!, status: failure } } });
    try {
      expect(view.host.textContent).toContain('送れませんでした');
      expect(view.host.textContent).not.toContain('受け取り中');
    } finally { await view.close(); }
  }
  // An accepted or still unknown earlier send does not hide the normal state.
  const base = mailState({}, 'ready', true);
  const fine = await mount({ state: 'connected', mail: { ...base, view: { ...base.view!, status: { ...status, state: 'accepted', errorCode: null } } } });
  try { expect(fine.host.textContent).toContain('受け取り中'); } finally { await fine.close(); }
});
