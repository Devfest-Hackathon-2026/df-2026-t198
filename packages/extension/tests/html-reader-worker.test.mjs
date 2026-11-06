import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { expect, it } from 'vitest';
import { loadSamples } from '../../../scripts/coursepower-samples.mjs';

it('bundles and reads the same samples without browser DOM, Node globals, or code generation', async () => {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL('../../core/src/html-reader.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Reader', target: 'chrome102',
  });
  const worker = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  runInContext(outputFiles[0].text, worker, { timeout: 3000 });
  expect(runInContext('[typeof window, typeof document, typeof DOMParser, typeof process, typeof require, typeof fetch]', worker))
    .toEqual(Array(6).fill('undefined'));
  const { definition, samples } = await loadSamples();
  for (const sample of samples) {
    const input = JSON.stringify([definition, sample.html, sample.context]);
    const actual = runInContext(`JSON.stringify(Reader.readPage(...${input}))`, worker, { timeout: 3000 });
    expect(JSON.parse(actual)).toStrictEqual(sample.expected);
  }
  const root = new URL('../../../lms-definitions/coursepower/samples/', import.meta.url);
  for (const name of ['logged-out', 'session-expired']) {
    const html = await readFile(new URL(`${name}.html`, root), 'utf8');
    const expected = JSON.parse(await readFile(new URL(`${name}.expected.json`, root), 'utf8'));
    const input = JSON.stringify([definition, html, { utcOffset: '+09:00' }]);
    const actual = runInContext(`(() => {
      try { return JSON.stringify(Reader.readPage(...${input})); }
      catch (error) { return JSON.stringify({ error: error.message }); }
    })()`, worker, { timeout: 3000 });
    expect(JSON.parse(actual)).toStrictEqual(expected);
  }
});

it('reads synthetic mixed-case HTML attributes in the worker bundle without executing handlers', async () => {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL('../../core/src/html-reader.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Reader', target: 'chrome102',
  });
  const worker = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  runInContext(outputFiles[0].text, worker, { timeout: 3000 });
  const { definition } = await loadSamples();
  const html = `<div CLASS="weeklyCourseArea"><div class="dayBox"><span class="cpLabel">火曜日</span>
    <div class="courseCard"><div class="courseCardName"><a onClick="formSubmit('KOG911')">架空の演習Case</a></div>
    <div class="courseCardUser">架空の先生</div><div class="courseCardInfo">第4限</div></div>
    </div></div><script>throw new Error('must-not-execute')</script>`;
  const input = JSON.stringify([definition, html, { utcOffset: '+09:00' }]);
  const actual = runInContext(`JSON.stringify(Reader.readPage(...${input}))`, worker, { timeout: 3000 });
  expect(JSON.parse(actual)).toEqual({ pageType: 'home', assignments: [], courses: [
    { courseId: 'KOG911', name: '架空の演習Case', teacher: '架空の先生', slots: [{ dayOfWeek: 2, period: 4 }] },
  ] });
});
