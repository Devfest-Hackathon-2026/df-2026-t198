import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { LedgerAssignment } from '@kadai-hisho/core/ledger';
import { documentKey } from '../observation-store.js';
import { createAnnouncementExtractor, PublicDemoLimit, type AnnouncementModel } from './extract.js';
import { announcementCandidates, announcementReviewReason } from './ledger.js';
import type { AnnouncementInput } from './input.js';

export class AnnouncementForbidden extends Error {
  constructor() { super('announcement-forbidden'); }
}
export function createAnnouncementStore(db: Firestore, model: AnnouncementModel | ((publicDemo: boolean) => AnnouncementModel)) {
  return async (uid: string, input: AnnouncementInput) => {
    // A caller-supplied system flag alone cannot enable real text processing.
    const account = (await db.doc(`demoAccounts/${uid}`).get()).data();
    if (input.system !== 'demo-lms' || account?.['role'] !== 'student' || account['studentId'] !== uid) {
      throw new AnnouncementForbidden();
    }
    const student = db.collection('students').doc(uid);
    const rows = await student.collection('assignments').where('key.system', '==', input.system).get();
    const candidates = announcementCandidates(rows.docs.map(row => row.data() as LedgerAssignment), input.system, input.courseId);
    const a = input.announcement;
    const receiptId = createHash('sha256').update(JSON.stringify([input.system, input.courseId, a.announcementId, a.version])).digest('hex');
    const receiptRef = student.collection('announcementReceipts').doc(receiptId);
    let publicDemo = false;
    const extractor = createAnnouncementExtractor({
      generate: (announcement, candidates) =>
        (typeof model === 'function' ? model(publicDemo) : model).generate(announcement, candidates),
    }, async () => db.runTransaction(async tx => {
      const profile = (await tx.get(db.doc(`demoAccounts/${uid}`))).data();
      if (profile?.['role'] !== 'student' || profile['studentId'] !== uid) throw new AnnouncementForbidden();
      if ((await tx.get(receiptRef)).exists) return false;
      // Select the budget from the trusted profile, never from request fields.
      publicDemo = profile['public'] === true;
      // A crash leaves a claim, never the text. Do not retry an uncertain provider call.
      tx.create(receiptRef, { status: 'processing' });
      return true;
    }));
    const extraction = await extractor.extract(a, candidates).catch(async error => {
      // A refused reservation never calls Gemini; allow this notice again after the day changes.
      if (error instanceof PublicDemoLimit) await receiptRef.delete();
      throw error;
    });
    if (extraction.status === 'duplicate' || extraction.status === 'invalid-input') return { status: extraction.status, changed: false };
    return db.runTransaction(async tx => {
      let changed = false;
      if (extraction.status === 'proposal') {
        const p = extraction.proposal;
        const [, sourceId] = JSON.parse(p.assignmentKey) as [string, string];
        const ref = student.collection('assignments').doc(documentKey(input.system, sourceId));
        const current = (await tx.get(ref)).data() as LedgerAssignment | undefined;
        const reason = announcementReviewReason(p);
        if (current && announcementCandidates([current], input.system, input.courseId).length > 0 &&
            !(current.officialDeadline?.deadline.kind === 'datetime' && Date.parse(current.officialDeadline.deadline.dueAt) === Date.parse(p.proposedDueAt)) &&
            !current.reviewReasons.some(r => r.kind === reason.kind && r.detail === reason.detail)) {
          // Re-read and update only reviewReasons: concurrent observations keep their official facts.
          tx.update(ref, { reviewReasons: [...current.reviewReasons, reason] });
          changed = true;
        }
      }
      tx.set(receiptRef, { status: extraction.status, changed });
      return { status: extraction.status, changed };
    });
  };
}
