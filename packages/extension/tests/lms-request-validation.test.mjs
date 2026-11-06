import { URL, URLSearchParams } from 'node:url';
import { expect, it, vi } from 'vitest';
import { executeLmsRequest, validOperation } from '../src/lms-request.js';

const pageUrl = 'https://lms.ynu.ac.jp/lms/corsColl/doIndex;SID=synthetic-session';
const detail = () => ({ kind: 'detail', fields: {
  jyugyoHiddenId: '', kyozaiId: 'REP0000000000001', kyozaiSyCdHidden: '02',
  teijiKikanGaiHyojiData: '', pankuzuHantei: '0',
} });

it('accepts an explicitly present empty hidden field and preserves all five fixed POST fields', async () => {
  const operation = detail();
  expect(validOperation(operation)).toBe(true);
  const fetcher = vi.fn(async url => ({ ok: true, url, text: async () => '<p>synthetic response</p>' }));
  await executeLmsRequest(operation, pageUrl, 'synthetic-session', fetcher, async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(new URL(url).pathname).toBe('/lms/corsColl/linkKyozaiTitle;SID=synthetic-session');
  expect(init.method).toBe('POST');
  expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual(operation.fields);
});

it('requires the hidden field to be an own string field even when its value may be empty', () => {
  const missing = detail();
  delete missing.fields.jyugyoHiddenId;
  expect(validOperation(missing)).toBe(false);
  const inherited = detail();
  delete inherited.fields.jyugyoHiddenId;
  Object.setPrototypeOf(inherited.fields, { jyugyoHiddenId: 'inherited' });
  expect(validOperation(inherited)).toBe(false);
  for (const value of [undefined, null, false, 0, {}, [], 'x'.repeat(2049)]) {
    expect(validOperation({ ...detail(), fields: { ...detail().fields, jyugyoHiddenId: value } })).toBe(false);
  }
});

it('still rejects invalid IDs, types and unapproved fields before requesting the detail path', async () => {
  const fetcher = vi.fn();
  for (const operation of [
    { ...detail(), kind: 'submit' },
    { ...detail(), path: '/arbitrary' },
    { ...detail(), fields: { ...detail().fields, kyozaiId: 'REP-invalid' } },
    { ...detail(), fields: { ...detail().fields, kyozaiSyCdHidden: 'invalid' } },
    { ...detail(), fields: { ...detail().fields, unapproved: '' } },
  ]) {
    await expect(executeLmsRequest(operation, pageUrl, 'synthetic-session', fetcher, async () => {})).rejects.toThrow('invalid-request');
  }
  await expect(executeLmsRequest(detail(), pageUrl, 'different-session', fetcher, async () => {})).rejects.toThrow('invalid-request');
  expect(fetcher).not.toHaveBeenCalled();
});
