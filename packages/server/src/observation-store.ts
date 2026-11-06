import { createHash } from 'node:crypto';
import { applyObservation, type FetchState, type LedgerAssignment, type Observation,
  type ObservationReceipt, type ObservationResult } from '@kadai-hisho/core/ledger';
import type { Firestore } from 'firebase-admin/firestore';
import { DemoForbidden, isDemoStudent } from './demo-store.js';

/** Encode the tuple, not a delimiter-joined string; IDs cannot escape the collection. */
export function documentKey(system: string, sourceId: string): string {
  return createHash('sha256').update(JSON.stringify([system, sourceId])).digest('hex');
}

export function createObservationStore(db: Firestore) {
  return async (uid: string, observation: Observation): Promise<ObservationResult> => {
    const student = db.collection('students').doc(uid);
    const receiptRef = student.collection('observationReceipts').doc(observation.observationId);
    const stateRef = student.collection('fetchStates').doc(observation.system);
    const recordedAt = new Date().toISOString();
    return db.runTransaction(async tx => {
      // Read alongside the receipt so changing the profile cannot race a write.
      const profile = await tx.get(db.doc(`demoAccounts/${uid}`));
      if (profile.exists && (!isDemoStudent(profile.data(), uid) || observation.system !== 'demo-lms' ||
        observation.definitionId !== 'demo-lms')) throw new DemoForbidden();
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) return (receipt.data() as ObservationReceipt).result;
      // Reading the shared state document serializes observations even for an empty ledger.
      const priorState = (await tx.get(stateRef)).data() as FetchState | undefined;
      const rows = await tx.get(student.collection('assignments').where('key.system', '==', observation.system));
      const previous = rows.docs.map(doc => doc.data() as LedgerAssignment);
      const applied = applyObservation(previous, observation, recordedAt);
      const priorById = new Map(previous.map(item => [item.key.sourceId, item]));
      for (const item of applied.assignments) {
        if (JSON.stringify(priorById.get(item.key.sourceId)) !== JSON.stringify(item)) {
          tx.set(student.collection('assignments').doc(documentKey(item.key.system, item.key.sourceId)), item);
        }
      }
      for (const change of applied.changes) tx.create(student.collection('changes').doc(change.changeId), change);
      for (const course of observation.catalogCourses) {
        tx.set(student.collection('courses').doc(documentKey(observation.system, course.courseId)),
          { ...course, system: observation.system });
      }
      const complete = observation.failures.length === 0 &&
        observation.catalogCourses.length === observation.courseResults.length &&
        observation.courseResults.every(result => result.listComplete) &&
        observation.courseResults.flatMap(result => result.seenSourceIds).length === observation.assignments.length;
      const state: FetchState = {
        studentId: uid, system: observation.system, lastAttemptedAt: observation.fetchedAt,
        lastSucceededAt: complete ? observation.fetchedAt : priorState?.lastSucceededAt ?? null,
        lastFailureKind: observation.failures[0]?.kind ?? null,
        lastResult: complete ? 'success' : observation.courseResults.some(r => r.listComplete) ||
          observation.assignments.length > 0 ? 'partial' : 'failed',
        lastAppliedObservationId: observation.observationId,
      };
      tx.set(stateRef, state);
      tx.create(receiptRef, applied.receipt);
      return applied.result;
    });
  };
}
