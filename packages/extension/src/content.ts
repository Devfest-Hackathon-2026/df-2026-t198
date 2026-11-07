import { sessionFromUrl } from './session.js';
import type { SessionFound } from './session.js';
import { executeLmsRequest } from './lms-request.js';
import { isHomePage, LmsReadError } from './collection-diagnostics.js';
import { showChangeNotice } from './change-notice.js';
import { protectStudentNavigation } from './student-navigation.js';

let student: ReturnType<typeof protectStudentNavigation> | undefined;

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  const request = message as { operation?: unknown; sid?: unknown; restore?: boolean };
  const current = sessionFromUrl(window.location.href);
  if (sender.id !== chrome.runtime.id || !current || request.sid !== current) { respond({ ok: false }); return false; }
  if (message.type === 'ynu-collection-claim') { respond({ ok: student?.claim() === true }); return false; }
  if (message.type === 'ynu-collection-release') { student?.release(); respond({ ok: true }); return false; }
  if (message.type !== 'ynu-read-page') return false;
  if (!student?.canRead(request.restore === true)
    || (request.restore === true && (request.operation as { kind?: string })?.kind !== 'home')) {
    respond({ ok: false, code: 'yielded' }); return false;
  }
  void executeLmsRequest(request.operation, window.location.href, current, fetch, undefined, student.signal,
    () => student?.canRead(request.restore === true) === true).then(
    page => respond({ ok: true, page }), error => respond({ ok: false,
      code: error instanceof Error && ['not-logged-in', 'lms-state', 'yielded'].includes(error.message) ? error.message : 'http-error',
      ...(error instanceof LmsReadError ? { diagnostic: error.diagnostic } : {}) }),
  );
  return true;
});

const sid = sessionFromUrl(window.location.href);
if (sid) {
  const message: SessionFound = { type: 'ynu-session-found', sid };
  student = protectStudentNavigation(document, window,
    departed => chrome.runtime.sendMessage({ type: 'ynu-collection-yield', sid, departed }),
    async () => {
      const response = await chrome.runtime.sendMessage<SessionFound, unknown>(message);
      showChangeNotice(response);
      return response;
    });
  if (!isHomePage(window.location.href)) void chrome.runtime.sendMessage(message).catch(() => {});
}
