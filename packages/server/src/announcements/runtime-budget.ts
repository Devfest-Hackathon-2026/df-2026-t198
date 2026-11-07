import type { Firestore } from 'firebase-admin/firestore';
import { estimatedYen } from './budget.js';
import { PublicDemoLimit, type Usage } from './extract.js';

// First 30-notice evaluation: 19,410 tokens (docs/records/2026-11-06-m3.md).
const MAX_CALL_TOKENS = 19_410 * 3;
export function createRuntimeBudget(db: Firestore, now = new Date(), publicDemo = false) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
  const ref = db.collection(publicDemo ? 'publicAnnouncementUsage' : 'announcementUsage').doc(day);
  const dailyLimit = publicDemo ? 3000 : 10000;
  let reservation: { input: number; output: number; yen: number } | undefined;
  const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
  return {
    async reserve(input: number, output: number) {
      if (reservation || !count(input) || !count(output) || input + output > MAX_CALL_TOKENS) throw new Error('budget-limit');
      const yen = estimatedYen(input, output);
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        const spent = data?.['yen'] ?? 0;
        const calls = data?.['calls'] ?? 0;
        if (!Number.isFinite(spent) || spent < 0 || !count(calls)) throw new Error('budget-limit');
        if (spent + yen > dailyLimit) {
          if (publicDemo) throw new PublicDemoLimit();
          throw new Error('budget-limit');
        }
        tx.set(ref, { yen: spent + yen, calls: calls + 1 });
      });
      reservation = { input, output, yen };
    },
    async settle(usage: Usage) {
      const r = reservation;
      if (!r || !count(usage.inputTokens) || !count(usage.outputTokens) || !count(usage.totalTokens) ||
          usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
          usage.inputTokens > r.input || usage.outputTokens > r.output) throw new Error('budget-usage-invalid');
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        const spent = data?.['yen'];
        if (!Number.isFinite(spent) || spent < r.yen) throw new Error('budget-state-invalid');
        tx.update(ref, { yen: spent - r.yen + estimatedYen(usage.inputTokens, usage.outputTokens) });
      });
      reservation = undefined;
    },
  };
}
