import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { start } = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../src/kulms-content.js', () => ({ startKyotoContent: start }));
beforeEach(() => { vi.resetModules(); start.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it.each(['https://www.k.kyoto-u.ac.jp', 'https://k.kyoto-u.ac.jp'])('starts KULASIS collection on %s', async origin => {
  const view = { location: { origin } }, doc = {};
  vi.stubGlobal('window', view); vi.stubGlobal('document', doc);
  await import('../src/kulasis-content.js');
  expect(start).toHaveBeenCalledExactlyOnceWith(doc, view, 'kulasis', origin, expect.any(Function));
});
it.each(['http://k.kyoto-u.ac.jp', 'https://k.kyoto-u.ac.jp:444', 'https://k.kyoto-u.ac.jp.example.test'])('does not start collection on %s', async origin => {
  vi.stubGlobal('window', { location: { origin } }); vi.stubGlobal('document', {});
  await import('../src/kulasis-content.js');
  expect(start).not.toHaveBeenCalled();
});
