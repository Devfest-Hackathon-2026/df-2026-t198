// Freeze the scoring contract independently of the model's output validation.
export function scoreM3(expected, actual) {
  const positive = expected.assignmentKey !== null;
  const predicted = actual?.assignmentKey != null && actual?.proposedDueAt != null;
  const correct = positive && predicted && expected.assignmentKey === actual.assignmentKey &&
    Date.parse(expected.proposedDueAt) === Date.parse(actual.proposedDueAt);
  return { tp: Number(correct), fp: Number(predicted && !correct), fn: Number(positive && !correct),
    tn: Number(!positive && !predicted) };
}

export function summarizeM3(scores) {
  const totals = scores.reduce((a, s) => ({ tp: a.tp + s.tp, fp: a.fp + s.fp,
    fn: a.fn + s.fn, tn: a.tn + s.tn }), { tp: 0, fp: 0, fn: 0, tn: 0 });
  return { ...totals, recall: totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : null,
    precision: totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : null };
}
