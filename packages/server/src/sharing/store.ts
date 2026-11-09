import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { isDemoStudent } from '../demo/store.js';

export class SharingForbidden extends Error {
  constructor() { super('forbidden'); }
}
export interface SharingStore {
  list: (student: string) => Promise<{ supporters: { uid: string; displayName?: string; revoked: boolean }[]; canManage: boolean }>;
  change: (student: string, supporter: string, revoked: boolean) => Promise<void>;
}
export function createSharingStore(db: Firestore, displayName: (uid: string) => Promise<string | undefined>): SharingStore {
  return {
    async list(student) {
      const [grants, profile] = await Promise.all([
        db.collection(`students/${student}/supporters`).get(), db.doc(`demoAccounts/${student}`).get(),
      ]);
      const supporters = await Promise.all(grants.docs.filter(grant => {
        const data = grant.data();
        return Object.hasOwn(data, 'revokedAt') && Array.isArray(data['scopes']) && data['scopes'].includes('all');
      }).map(async grant => {
        const name = await displayName(grant.id);
        return { uid: grant.id, ...(name ? { displayName: name } : {}), revoked: grant.data()['revokedAt'] !== null };
      }));
      return { supporters, canManage: profile.data()?.['public'] !== true };
    },
    async change(student, supporter, revoked) {
      await db.runTransaction(async tx => {
        const profile = await tx.get(db.doc(`demoAccounts/${student}`));
        const grant = await tx.get(db.doc(`students/${student}/supporters/${supporter}`));
        const data = grant.data();
        if (profile.data()?.['public'] === true || (profile.exists && !isDemoStudent(profile.data(), student)) ||
          !data || !Object.hasOwn(data, 'revokedAt') || !Array.isArray(data['scopes']) || !data['scopes'].includes('all')) {
          throw new SharingForbidden();
        }
        if ((data['revokedAt'] !== null) === revoked) return;
        tx.update(grant.ref, { revokedAt: revoked ? FieldValue.serverTimestamp() : null });
      });
    },
  };
}
