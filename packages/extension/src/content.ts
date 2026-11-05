import { sessionFromUrl } from './session.js';
import type { SessionFound } from './session.js';

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
