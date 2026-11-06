import type { ProbeResult } from './auth-probe.js';
import type { DigestStatus } from './digest-browser.js';

const run = document.querySelector<HTMLButtonElement>('#run')!;
const restore = document.querySelector<HTMLButtonElement>('#restore')!;
const status = document.querySelector<HTMLElement>('#status')!;
const steps = document.querySelector<HTMLOListElement>('#steps')!;
const details = document.querySelector<HTMLDListElement>('#details')!;

export function renderResult(result: ProbeResult): void {
  steps.replaceChildren();
  details.replaceChildren();
  for (const step of result.steps) {
    const li = document.createElement('li');
    li.dataset.status = step.status;
    li.textContent = `${step.stage}：${step.status === 'ok' ? '成功' : '確認が必要です'} — ${step.message}`;
    steps.append(li);
  }
  const values: [string, string | undefined][] = [
    ['uid（先頭8文字）', result.uidPrefix],
    ['前回のuidとの比較', result.sameUid === undefined ? undefined : result.sameUid ? '同じuidです' : '一致はまだ確認できません'],
    ['service workerの再開', result.workerChanged === undefined ? undefined : result.workerChanged ? '前回の実行時とは別の起動です' : '前回と同じ起動です（再開の確認はこれから）'],
    ['カレンダーの名前', result.calendarName], ['予定ID', result.eventId],
  ];
  for (const [name, value] of values) {
    if (value === undefined) continue;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = name;
    dd.textContent = value;
    details.append(dt, dd);
  }
}

async function request(type: 'auth-probe-run' | 'auth-probe-status') {
  run.disabled = restore.disabled = true;
  status.textContent = type === 'auth-probe-run' ? '接続テスト中です。Googleの確認画面が開いたら、内容を確認してください。' : '保存したログインを確認しています。';
  steps.replaceChildren();
  details.replaceChildren();
  try {
    const result = await chrome.runtime.sendMessage<{ type: string }, ProbeResult>({ type });
    renderResult(result);
    status.textContent = result.steps.some((step) => step.status === 'error') ? '確認が必要なところがあります。' : '確認が終わりました。';
  } catch {
    status.textContent = '拡張機能から結果が届きませんでした。再読み込み後、同じボタンで確認してください。';
  } finally {
    run.disabled = restore.disabled = false;
  }
}

run.addEventListener('click', () => { void request('auth-probe-run'); });
restore.addEventListener('click', () => { void request('auth-probe-status'); });
void request('auth-probe-status');

const digestToggle = document.querySelector<HTMLInputElement>('#digest-enabled')!;
const digestStatus = document.querySelector<HTMLElement>('#digest-status')!;
async function digestSetting(enabled?: boolean) {
  digestToggle.disabled = true;
  digestStatus.textContent = enabled === true ? 'Googleの画面で、メール送信の許可を確認してください。' : 'メールの設定を確認しています。';
  try {
    const result = await chrome.runtime.sendMessage<unknown, DigestStatus>(enabled === undefined
      ? { type: 'digest-status' } : { type: 'digest-setting', enabled });
    digestToggle.checked = result.enabled;
    digestStatus.textContent = !result.ok ? 'メールの設定を確認できませんでした。Googleとの接続を確認して、もう一度操作してください。'
      : result.problem === 'send-unconfirmed' ? '届いたか確認できないメールがあります。Gmailを確認してください。同じメールは自動で送り直しません。'
      : result.problem === 'authorization-required' ? 'メール送信の許可を確認できません。切り替えを入れ直してください。'
      : result.problem ? 'メールを用意できませんでした。しばらくしてから設定画面を開き直してください。'
      : result.enabled ? '今日やることをメールで受け取ります。何もない日は送りません。' : 'メールは送りません。';
  } catch {
    digestStatus.textContent = 'メールの設定を確認できませんでした。設定画面を開き直してください。';
  } finally { digestToggle.disabled = false; }
}
digestToggle.addEventListener('change', () => { void digestSetting(digestToggle.checked); });
void digestSetting();
