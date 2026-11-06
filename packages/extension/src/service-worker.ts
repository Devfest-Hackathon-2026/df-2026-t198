import { startCalendarSync, handleCalendarMessage } from './calendar-browser.js';
import { isSessionFound, sessionFromUrl } from './session.js';
import { handleAuthProbeMessage } from './auth-probe-worker.js';
import { runCollection } from './collection-worker.js';
import { startDigest, handleDigestMessage } from './digest-browser.js';

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
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
      const path = new URL(sender.url!).pathname.replace(/;SID=[^/;]*/gi, '');
      if (sender.tab?.id !== undefined && (path === '/lms/homeHoml/' || path === '/lms/homeHoml/doIndex')) {
        respond(await runCollection(sender.url!, sender.tab.id, sender.documentId));
      } else respond({ ok: true });
    },
    () => respond({ ok: false }),
  );
  // Keep the message channel open until storage has finished.
  return true;
});

startCalendarSync();
startDigest();
