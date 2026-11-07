import { collectKulmsObservation } from './kulms-collection.js';
import { KULMS_ORIGIN } from '../../core/src/sakai-reader.js';
import { showChangeNotice } from './change-notice.js';

/** GETs never hold the student's navigation; activity aborts this read instead. */
export function startKulmsContent(doc: Document, view: Window) {
  if (view.location.origin !== KULMS_ORIGIN) return;
  let active: AbortController | undefined, departed = false, lastActivity = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    if (departed || doc.visibilityState === 'hidden') return;
    timer = setTimeout(() => {
      void chrome.runtime.sendMessage({ type: 'kulms-page-ready' }).then(reply => {
        showChangeNotice(reply);
        if (['busy', 'yielded'].includes(reply?.code)) schedule();
      }).catch(() => {});
    }, 2000);
  };
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'kulms-collect') return false;
    const request = message as { observationId?: unknown; fetchedAt?: unknown };
    if (sender.id !== chrome.runtime.id || departed || doc.visibilityState === 'hidden' || active || Date.now() - lastActivity < 2000
      || typeof request.observationId !== 'string' || typeof request.fetchedAt !== 'string') {
      respond({ ok: false, code: 'yielded' }); return false;
    }
    const controller = new AbortController(); active = controller;
    void collectKulmsObservation({ fetcher: fetch, observationId: request.observationId, fetchedAt: request.fetchedAt,
      signal: controller.signal }).then(observation => {
      if (controller.signal.aborted) respond({ ok: false, code: 'yielded' });
      else respond({ ok: true, observation });
    }, () => respond({ ok: false, code: controller.signal.aborted ? 'yielded' : 'collection-unavailable' }))
      .finally(() => { if (active === controller) active = undefined; });
    return true;
  });
  for (const event of ['pointerdown', 'keydown', 'input', 'scroll']) doc.addEventListener(event, () => {
    lastActivity = Date.now(); active?.abort(); schedule();
  }, { capture: true, passive: true });
  view.addEventListener('pagehide', () => { departed = true; clearTimeout(timer); active?.abort(); });
  view.addEventListener('pageshow', () => { departed = false; schedule(); });
  doc.addEventListener('visibilitychange', () => { active?.abort(); schedule(); });
  schedule();
}
if (typeof window !== 'undefined') startKulmsContent(document, window);
