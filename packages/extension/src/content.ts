import { sessionFromUrl } from './session.js';
import type { SessionFound } from './session.js';
import { executeLmsRequest } from './lms-request.js';

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'ynu-read-page') return false;
  const request = message as { operation?: unknown; sid?: unknown };
  const current = sessionFromUrl(window.location.href);
  if (sender.id !== chrome.runtime.id || !current || request.sid !== current) { respond({ ok: false }); return false; }
  void executeLmsRequest(request.operation, window.location.href, current).then(
    page => respond({ ok: true, page }), error => respond({ ok: false,
      code: error instanceof Error && error.message === 'not-logged-in' ? 'not-logged-in' : 'http-error' }),
  );
  return true;
});

const sid = sessionFromUrl(window.location.href);
if (sid) {
  const message: SessionFound = { type: 'ynu-session-found', sid };
  void chrome.runtime.sendMessage<SessionFound, { ok: boolean }>(message).then(
    (response) => {
      if (!response?.ok) console.warn('課題の秘書: ログイン状態を受け取れませんでした。');
    },
    () => console.warn('課題の秘書: 拡張機能を再読み込みしてください。'),
  );
}
