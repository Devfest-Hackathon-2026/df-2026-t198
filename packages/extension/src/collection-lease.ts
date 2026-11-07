/** Wait for settlement, not success. A timed-out task must never start later work. */
async function settlesWithin(task: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task.then(() => true, () => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms); })]);
  } finally { clearTimeout(timer); }
}

export class CollectionLease {
  stopped = false;
  departed = false;
  restoreSucceeded = 0;
  restoreFailed = 0;
  private touched = false;
  private closed = false;
  private pending: Promise<unknown> | undefined;
  private cleanup?: Promise<boolean>;
  private controller = new AbortController();

  constructor(private stateful: boolean, private restore: (signal: AbortSignal) => Promise<void>) {}
  get signal(): AbortSignal { return this.controller.signal; }

  async read<T>(request: () => Promise<T>): Promise<T> {
    if (this.stopped || this.closed) throw new Error('yielded');
    this.touched = true;
    const task = request();
    this.pending = task;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('yielded'));
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
    });
    try {
      const result = await Promise.race([task, cancelled]);
      if (this.stopped) throw new Error('yielded');
      return result;
    } finally {
      this.signal.removeEventListener('abort', abort);
      if (this.pending === task) this.pending = undefined;
    }
  }

  stop(departed: boolean): Promise<boolean> {
    this.stopped = true;
    this.departed ||= departed;
    if (this.departed) this.controller.abort();
    return this.finish();
  }

  finish(): Promise<boolean> {
    this.closed = true;
    this.cleanup ??= this.restoreHome();
    return this.cleanup;
  }

  private async restoreHome(): Promise<boolean> {
    if (!this.stateful || !this.touched) return true;
    if (this.departed) return false;
    // Reserve four seconds for restoration and leave the student's own 15s
    // watchdog independent of this worker, even if a page read never replies.
    if (this.pending && !await settlesWithin(this.pending, 10_000)) {
      this.stopped = true; this.controller.abort(); this.restoreFailed++;
      return false;
    }
    if (this.departed) return false;
    const restoration = this.restore(this.signal);
    let restored = false;
    const attempt = restoration.then(() => { restored = true; }, () => {});
    if (!await settlesWithin(attempt, 4_000)) this.controller.abort();
    if (restored) this.restoreSucceeded++; else this.restoreFailed++;
    return restored;
  }
}
