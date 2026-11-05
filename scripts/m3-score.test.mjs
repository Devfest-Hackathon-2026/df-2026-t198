import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreM3, summarizeM3 } from './m3-score.mjs';
const expected = { assignmentKey: 'one', proposedDueAt: '2026-11-18T17:00:00+09:00' };
test('exact key and instant, including a different timezone spelling', () => {
  assert.equal(scoreM3(expected, { assignmentKey: 'one', proposedDueAt: '2026-11-18T08:00:00Z' }).tp, 1);
});
test('a wrong deadline or wrong key is both a false positive and a miss', () => {
  for (const actual of [{ ...expected, assignmentKey: 'two' }, { ...expected, proposedDueAt: '2026-11-19T17:00:00+09:00' }]) {
    assert.deepEqual(scoreM3(expected, actual), { tp: 0, fp: 1, fn: 1, tn: 0 });
  }
});
test('abstention, false alarm, and aggregate denominators', () => {
  const no = { assignmentKey: null, proposedDueAt: null };
  assert.deepEqual(scoreM3(expected, no), { tp: 0, fp: 0, fn: 1, tn: 0 });
  assert.deepEqual(scoreM3(no, expected), { tp: 0, fp: 1, fn: 0, tn: 0 });
  assert.deepEqual(summarizeM3([scoreM3(expected, expected), scoreM3(expected, no), scoreM3(no, expected)]),
    { tp: 1, fp: 1, fn: 1, tn: 0, recall: 0.5, precision: 0.5 });
  assert.equal(summarizeM3([scoreM3(no, no)]).precision, null);
});
