import { syncCalendarInBackground } from './calendar-browser.js';
import { browserProbe } from './auth-probe-browser.js';
import type { ProbeResult } from './auth-probe.js';

let running = false;

export function handleAuthProbeMessage(
  message: unknown, sender: chrome.runtime.MessageSender, respond: (result: ProbeResult) => void,
): boolean | undefined {
  if (typeof message !== 'object' || message === null || !('type' in message)
    || (message.type !== 'auth-probe-run' && message.type !== 'auth-probe-status')) return undefined;

  const failure = (code: string, text: string): ProbeResult => ({ steps: [{ stage: '接続テスト', status: 'error', code, message: text }] });
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html')
    || (sender.frameId !== undefined && sender.frameId !== 0)) {
    respond(failure('untrusted-sender', '設定画面から操作してください。'));
    return false;
  }
  if (running) {
    respond(failure('busy', '別の接続テストが進んでいます。終わるまでお待ちください。'));
    return false;
  }
  running = true;
  void (async () => {
    try {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      const probe = browserProbe();
      const result = await (message.type === 'auth-probe-run' ? probe.run() : probe.status());
      respond(result);
      if (message.type === 'auth-probe-run' && result.steps.every(step => step.status === 'ok')) void syncCalendarInBackground();
    } catch {
      respond(failure('probe-unavailable', '接続テストを始められませんでした。拡張機能を再読み込みしてください。'));
    } finally {
      running = false;
    }
  })();
  return true;
}
