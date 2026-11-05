import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
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
});
