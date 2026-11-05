import process from 'node:process';
import { readPage } from '../packages/core/dist/index.js';
import { loadSamples, scoreM1 } from './coursepower-samples.mjs';

const { definition, samples } = await loadSamples();
let correct = 0, total = 0, unexpected = 0;
for (const sample of samples) {
  // The README identifies assignment-list as a duplicate of course-top.
  if (!['course-top', 'assignment-detail-open'].includes(sample.name)) continue;
  let actual;
  try { actual = readPage(definition, sample.html, sample.context); }
  catch { console.error(`${sample.name}: reading failed`); }
  const score = scoreM1(sample.expected, actual);
  correct += score.correct; total += score.total; unexpected += score.unexpected;
  console.log(`${sample.name}: ${score.correct}/${score.total}`);
}
console.log(`M1: ${correct}/${total} (${(100 * correct / total).toFixed(2)}%); unexpected assignments: ${unexpected}`);
if (correct !== total || unexpected) process.exitCode = 1;
