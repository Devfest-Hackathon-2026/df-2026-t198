import type {
  Assignment, AssignmentChange, Deadline, LedgerAssignment, Observation, ObservationReceipt,
} from './types.js';
export type { DemoAccount, DemoAssignment, DemoCourse, DemoData } from './demo.js';
export type { Assignment, AssignmentChange, Deadline, FetchState, LedgerAssignment, SessionContext,
  Observation, ObservationReceipt, ObservationResult } from './types.js';

function copyAssignment(value: Assignment): Assignment {
  return { ...value, deadline: { ...value.deadline } };
}

function deadlineValue(deadline: Deadline | undefined): string {
  if (!deadline) return 'unreadable';
  switch (deadline.kind) {
    case 'datetime': return `datetime:${Date.parse(deadline.dueAt)}`;
    case 'date': return `date:${deadline.date}:${deadline.timeZone}`;
    default: return deadline.kind;
  }
}

/** Apply one validated observation. Receipt and returned writes must be committed together. */
export function applyObservation(
  current: readonly LedgerAssignment[], observation: Observation, recordedAt: string,
  priorReceipt?: ObservationReceipt,
) {
  if (priorReceipt?.observationId === observation.observationId) {
    return { assignments: [...current], changes: [] as AssignmentChange[],
      receipt: priorReceipt, result: priorReceipt.result };
  }
  const assignments = current.map(item => ({ ...item, reviewReasons: item.reviewReasons.map(reason => ({ ...reason })) }));
  const changes: AssignmentChange[] = [];
  const change = (item: LedgerAssignment, kind: AssignmentChange['kind'],
    before: AssignmentChange['before'] = null, after: AssignmentChange['after'] = null) => {
    changes.push({ changeId: `${observation.observationId}-${changes.length}`,
      assignmentKey: item.key, kind, before, after, observationId: observation.observationId, recordedAt });
  };
  const byId = new Map(assignments.filter(a => a.key.system === observation.system)
    .map(a => [a.key.sourceId, a]));

  for (const incoming of observation.assignments) {
    let item = byId.get(incoming.sourceId);
    const isNew = !item;
    if (!item) {
      item = { key: { system: observation.system, sourceId: incoming.sourceId },
        latest: copyAssignment(incoming), officialDeadline: null, preparationStartsAt: null,
        submission: incoming.submission, submittedAt: incoming.submittedAt ?? null,
        presenceState: 'active', consecutiveMissingCount: 0,
        lastSeenObservationId: observation.observationId, lastSeenAt: observation.fetchedAt, reviewReasons: [] };
      assignments.push(item);
      byId.set(incoming.sourceId, item);
      change(item, 'new');
    } else if (item.latest.title !== incoming.title) {
      change(item, 'title-changed', item.latest.title, incoming.title);
    }
    if (incoming.deadline.kind === 'unreadable') {
      if (!item.reviewReasons.some(r => r.kind === 'unreadable-deadline')) {
        item.reviewReasons.push({ kind: 'unreadable-deadline', detail: 'unreadable-deadline' });
      }
    } else {
      if (!isNew && deadlineValue(item.officialDeadline?.deadline) !== deadlineValue(incoming.deadline)) {
        change(item, 'deadline-changed', item.officialDeadline?.deadline ?? null, incoming.deadline);
      }
      item.officialDeadline = { deadline: { ...incoming.deadline }, url: incoming.url,
        fetchedAt: observation.fetchedAt, observationId: observation.observationId };
      item.reviewReasons = item.reviewReasons.filter(r => r.kind !== 'unreadable-deadline');
    }
    if (!isNew && incoming.submission === 'submitted' && item.submission !== 'submitted') {
      change(item, 'submitted', item.submission, 'submitted');
    }
    if (incoming.submission !== 'unknown') {
      item.submission = incoming.submission;
      item.submittedAt = incoming.submission === 'submitted'
        ? incoming.submittedAt ?? item.submittedAt : null;
    }
    item.latest = copyAssignment(incoming);
  }

  const results = new Map(observation.courseResults.map(r => [r.courseId,
    { complete: r.listComplete, seen: new Set(r.seenSourceIds) }]));
  for (const item of byId.values()) {
    const result = results.get(item.latest.courseId);
    if (result?.seen.has(item.key.sourceId)) {
      if (item.presenceState !== 'active') change(item, 'restored', item.presenceState, 'active');
      item.presenceState = 'active';
      item.consecutiveMissingCount = 0;
      item.lastSeenObservationId = observation.observationId;
      item.lastSeenAt = observation.fetchedAt;
    } else if (result?.complete) {
      item.consecutiveMissingCount = Math.min(2, item.consecutiveMissingCount + 1);
      const next = item.consecutiveMissingCount === 1 ? 'cancellation-candidate' : 'cancelled';
      if (next !== item.presenceState) change(item, next, item.presenceState, next);
      item.presenceState = next;
    }
  }
  const result = { status: 'applied' as const, changed: changes.length > 0, changeCount: changes.length };
  return { assignments, changes, result, receipt: { observationId: observation.observationId, result } };
}
