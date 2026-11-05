import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPage } from '../src/html-reader.js';
import { loadSamples } from '../../../scripts/coursepower-samples.mjs';

const { definition, samples } = await loadSamples();
const root = new URL('../../../lms-definitions/coursepower/samples/', import.meta.url);
const failures = await Promise.all(['logged-out', 'session-expired'].map(async (name) => ({
  name,
  html: await readFile(new URL(`${name}.html`, root), 'utf8'),
  expected: JSON.parse(await readFile(new URL(`${name}.expected.json`, root), 'utf8')),
})));
const context = { utcOffset: '+09:00' };

describe('login state from saved samples', () => {
  for (const sample of failures) {
    it(sample.name, () => {
      expect(() => readPage(definition, sample.html, context)).toThrow(new Error(sample.expected.error));
    });
    it(`${sample.name} takes precedence over page content`, () => {
      expect(() => readPage(definition, sample.html + samples[0].html, context))
        .toThrow(new Error(sample.expected.error));
    });
  }
  it('keeps the existing signed-in samples readable', () => {
    expect(definition.pageChecks.loggedIn).not.toBeNull();
    for (const sample of samples) {
      expect(readPage(definition, sample.html, sample.context)).toStrictEqual(sample.expected);
    }
  });
  it('does not treat missing login evidence or a generic error as a login failure', () => {
    for (const html of ['<p>unknown</p>', '<div id="addMess4"><p>架空の一般エラー</p></div>',
      '<form name="lginLgirActionForm"><input type="submit"></form>']) {
      expect(() => readPage(definition, html, context)).toThrow(new Error('unreadable-page'));
    }
  });
  it('takes login markers from the definition', () => {
    const changed = globalThis.structuredClone(definition);
    changed.pageChecks.loggedOut = null;
    for (const sample of failures) {
      expect(() => readPage(changed, sample.html, context)).toThrow(new Error('unreadable-page'));
    }
  });
});
