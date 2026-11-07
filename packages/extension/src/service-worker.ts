import { startCalendarSync, handleCalendarMessage } from './calendar-browser.js';
import { isSessionFound, sessionFromUrl } from './session.js';
import { handleAuthProbeMessage } from './auth-probe-worker.js';
import { runCollection, yieldCollection } from './collection-worker.js';
import { startDigest, handleDigestMessage } from './digest-browser.js';
import { isHomePage } from './collection-diagnostics.js';

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'ynu-collection-yield') {
    const request = message as { sid?: unknown; departed?: unknown };
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || typeof request.sid !== 'string'
      || sessionFromUrl(sender.url ?? '') !== request.sid || typeof request.departed !== 'boolean') {
      respond({ ok: false }); return false;
    }
    void yieldCollection(request.sid, request.departed).then(respond, () => respond({ ok: false }));
    return true;
  }
  const digestHandled = handleDigestMessage(message, sender, respond);
  if (digestHandled !== undefined) return digestHandled;
  const calendarHandled = handleCalendarMessage(message, sender, respond);
  if (calendarHandled !== undefined) return calendarHandled;
  const handled = handleAuthProbeMessage(message, sender, respond);
  if (handled !== undefined) return handled;
  if (!isSessionFound(message)
    || sender.id !== chrome.runtime.id
    || sender.frameId !== 0
    || sessionFromUrl(sender.url ?? '') !== message.sid) {
    respond({ ok: false });
    return false;
  }

  // session storage is memory-only and is not exposed to content scripts by default.
  void chrome.storage.session.set({ ynuSessionId: message.sid }).then(
    async () => {
      if (sender.tab?.id !== undefined && isHomePage(sender.url!)) {
        respond(await runCollection(sender.url!, sender.tab.id, sender.documentId));
      } else {
        await yieldCollection(message.sid, true);
        respond({ ok: true });
      }
    },
    () => respond({ ok: false }),
  );
  // Keep the message channel open until storage has finished.
  return true;
});

startCalendarSync();
startDigest();
