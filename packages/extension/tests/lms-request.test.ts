import { afterEach, expect, it, vi } from 'vitest';
import { executeLmsRequest } from '../src/lms-request.js';

const sid = 'synthetic-session';
const url = `https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=${sid}`;
afterEach(() => vi.useRealTimers());

it('waits 1500 milliseconds before every LMS request with the default pacing', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, url, text: async () => '<main>synthetic</main>' });
  for (let request = 0; request < 2; request++) {
    const pending = executeLmsRequest({ kind: 'home' }, url, sid, fetcher);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetcher).toHaveBeenCalledTimes(request);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(request + 1);
  }
});

it('does not start a request if the student takes over during the 1500ms wait', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi.fn();
  const pending = executeLmsRequest({ kind: 'home' }, url, sid, fetcher, undefined, controller.signal);
  const rejected = expect(pending).rejects.toThrow('yielded');
  await vi.advanceTimersByTimeAsync(1499);
  controller.abort();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(fetcher).not.toHaveBeenCalled();
});
