import { isSessionFound, sessionFromUrl } from './session.js';

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!isSessionFound(message)
    || sender.id !== chrome.runtime.id
    || sender.frameId !== 0
    || sessionFromUrl(sender.url ?? '') !== message.sid) {
    respond({ ok: false });
    return false;
  }

  // session storage is memory-only and is not exposed to content scripts by default.
  void chrome.storage.session.set({ ynuSessionId: message.sid }).then(
    () => respond({ ok: true }),
    () => respond({ ok: false }),
  );
  // Keep the message channel open until storage has finished.
  return true;
});
