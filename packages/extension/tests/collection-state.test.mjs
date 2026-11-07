import { expect, it } from 'vitest';
import { fakeLms } from './helpers/stateful-lms.mjs';

for (const stage of ['course', 'detail']) for (const errorStatus of [200, 500]) {
  it(`stops immediately at a state error (${stage}, HTTP ${errorStatus})`, async () => {
    const f = await fakeLms({ stage, stateError: true, errorStatus, moveStudent: false });
    await expect(f.collect()).rejects.toThrow('lms-state');
    expect(f.fetcher.mock.calls.filter(([url]) => url.includes(stage === 'course' ? 'linkKougi' : 'linkKyozaiTitle'))).toHaveLength(1);
    expect(f.recovered).not.toHaveBeenCalled();
  });
}

it('recognizes the error screen without a redirect', async () => {
  const f = await fakeLms({ stateError: true, errorRedirect: false, moveStudent: false });
  await expect(f.collect()).rejects.toThrow('lms-state');
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
