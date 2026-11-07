import navigation from '../../../lms-definitions/coursepower/navigation.json' with { type: 'json' };

interface SessionPolicy { statefulSession: boolean; homePaths: readonly string[] }
export const STUDENT_WAIT_MS = 15_000;
export const STUDENT_IDLE_MS = 2_000;

/** A held action always has its own local escape route, independent of the worker. */
export function protectStudentNavigation(doc: Document, view: Window,
  yieldSession: (departed: boolean) => Promise<unknown>, collect: () => Promise<unknown>, policy: SessionPolicy = navigation) {
  let lastActivity = Date.now(), borrowed = false, departed = false, abandoned = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let departureRecovery: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;
  let navigating = false, replaying = false;
  let discardHeld: (() => void) | undefined;
  let controller = new AbortController();
  const pending: (() => void)[] = [];
  const replayed = new WeakSet<Event>();
  const home = () => policy.homePaths.includes(new URL(view.location.href).pathname.replace(/;[^/]*/g, ''));
  const schedule = (delay = STUDENT_IDLE_MS) => {
    clearTimeout(idle);
    if (departed || abandoned || navigating || borrowed || waiting || !home()) return;
    idle = setTimeout(() => {
      if (departed || abandoned || navigating || borrowed || waiting || !home()) return;
      const remaining = STUDENT_IDLE_MS - (Date.now() - lastActivity);
      if (remaining > 0) {
        schedule(remaining);
        return;
      }
      void collect().then(result => {
        const code = (result as { code?: string } | null)?.code;
        if (code === 'yielded' || code === 'not-idle') schedule();
      }).catch(() => { /* The next student action remains available. */ });
    }, delay);
  };
  const activity = () => {
    if (replaying) return;
    navigating = false; lastActivity = Date.now(); schedule();
  };
  const notifyYield = (gone: boolean) => {
    try { return Promise.resolve(yieldSession(gone)); }
    catch { return Promise.reject(new Error('worker-unavailable')); }
  };
  const abandon = () => {
    borrowed = false; abandoned = true; controller.abort();
    void notifyYield(true).catch(() => {});
  };
  const hold = (event: Event, resume: () => void) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    pending.push(resume);
    if (waiting) return;
    waiting = true;
    clearTimeout(idle);
    let resumed = false;
    const finish = (lostWorker = false) => {
      if (resumed) return;
      resumed = true;
      discardHeld = undefined;
      clearTimeout(deadline);
      borrowed = false; waiting = false;
      if (lostWorker) { abandoned = true; controller.abort(); }
      // The old home can remain visible while the student's request is in flight.
      // Nested click/submit events from replay must not count as new activity.
      navigating = true; replaying = true;
      const actions = pending.splice(0);
      try {
        for (const action of actions) {
          try { action(); } catch { /* One page handler must not suppress the next held action. */ }
        }
      } finally { replaying = false; }
    };
    // Install the escape timer before calling any extension API (which can throw).
    const deadline = setTimeout(() => finish(true), STUDENT_WAIT_MS);
    discardHeld = () => {
      resumed = true;
      discardHeld = undefined;
      clearTimeout(deadline);
      pending.length = 0; waiting = false;
    };
    void notifyYield(false).then(reply => finish(!(reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true)), () => finish(true));
  };
  const dispatch = (target: EventTarget, event: Event) => { replayed.add(event); target.dispatchEvent(event); };
  const click = (event: MouseEvent) => {
    if (replayed.has(event)) return;
    activity();
    if (event.type === 'auxclick' && event.button !== 1) return;
    const selector = 'a, button, input[type="button"], input[type="submit"], input[type="image"], [onclick]';
    const target = ((event.composedPath?.() ?? []).find(node => {
      const element = node as HTMLElement;
      return typeof element.matches === 'function' && (element.matches(selector) || typeof element.onclick === 'function');
    }) ?? (event.target as Element | null)?.closest?.(selector)) as HTMLElement | null;
    if (!borrowed || !target) return;
    // New windows/downloads need the original browser user activation. Let them
    // through immediately and abandon collection, without a late home request.
    if (!event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0
      || target.matches('a[target]:not([target="_self"]), a[download]')) {
      abandon();
      return;
    }
    hold(event, () => dispatch(target, new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: true, view, detail: event.detail,
      screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY,
      button: event.button, buttons: event.buttons, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey,
    })));
  };
  const submit = (event: SubmitEvent) => {
    if (replayed.has(event)) return;
    activity();
    if (!borrowed || !event.cancelable) return;
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter;
    hold(event, () => {
      HTMLFormElement.prototype.requestSubmit.call(form, submitter ?? undefined);
    });
  };
  const enter = (event: KeyboardEvent) => {
    if (replayed.has(event)) return;
    activity();
    if (!borrowed || event.key !== 'Enter' || event.isComposing || !event.cancelable) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.matches('textarea, select')) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { abandon(); return; }
    hold(event, () => {
      const replay = new KeyboardEvent(event.type, { key: 'Enter', code: event.code, bubbles: true, cancelable: true,
        keyCode: event.keyCode, charCode: event.charCode, location: event.location, repeat: event.repeat,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey });
      replayed.add(replay);
      if (!target.dispatchEvent(replay) || event.type !== 'keydown') return;
      if (target.matches('a, button, input[type="submit"], input[type="button"], input[type="image"]')) target.click();
      else {
        const form = (target as HTMLInputElement).form;
        if (form) {
          const button = form.querySelector<HTMLButtonElement | HTMLInputElement>('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]');
          if (button) button.click(); else HTMLFormElement.prototype.requestSubmit.call(form);
        }
      }
    });
  };
  if (policy.statefulSession) {
    doc.addEventListener('click', click, true);
    doc.addEventListener('auxclick', click, true);
    doc.addEventListener('submit', submit, true);
    for (const event of ['keydown', 'keypress', 'keyup']) doc.addEventListener(event, enter as EventListener, true);
    for (const event of ['pointerdown', 'input', 'scroll']) doc.addEventListener(event, activity, { capture: true, passive: true });
    const depart = () => {
      departed = true; borrowed = false; controller.abort(); clearTimeout(idle);
      clearTimeout(departureRecovery);
      discardHeld?.();
      void notifyYield(true).catch(() => {});
    };
    const resume = () => {
      clearTimeout(departureRecovery);
      departed = false; abandoned = false; activity();
    };
    view.addEventListener('beforeunload', () => {
      depart();
      // Request recovery if the document remains. The worker must still check
      // the tab's navigation state before granting another collection lease.
      departureRecovery = setTimeout(resume, STUDENT_WAIT_MS);
    });
    view.addEventListener('pagehide', depart);
    view.addEventListener('pageshow', resume);
    schedule();
  } else void collect().catch(() => {});
  return {
    claim: () => {
      if (!policy.statefulSession) return true;
      if (borrowed || departed || abandoned || navigating || waiting || !home() || Date.now() - lastActivity < STUDENT_IDLE_MS) return false;
      borrowed = true; controller = new AbortController(); clearTimeout(idle);
      return true;
    },
    canRead: (restore: boolean) => !policy.statefulSession || (borrowed && !departed && !abandoned && (!waiting || restore)),
    release: () => { borrowed = false; controller.abort(); },
    get signal() { return controller.signal; },
  };
}
