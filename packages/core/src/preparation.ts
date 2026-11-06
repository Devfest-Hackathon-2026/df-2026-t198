import type { Course, PreparationCandidate, PreparationPlan } from './types.js';

/** Same conservative candidate policy for the session screen and postponement. */
export function preparationSlots(assignment: PreparationCandidate['assignment'], dueDate: string,
  courses: Course[], now: Date, limit = 2, occupied: PreparationPlan[] = [], after?: PreparationCandidate): PreparationCandidate[] {
  const result: PreparationCandidate[] = [];
  const periods = Math.max(5, ...courses.flatMap(course => course.slots.map(slot => slot.period)));
  const cursor = new Date(`${now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}T00:00:00Z`);
  // At most a year of candidates; farther dates do not require an unbounded server loop.
  for (let days = 0; days < 366 && result.length < limit; days++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    if (date >= dueDate) break;
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let period = 1; period <= periods && result.length < limit; period++) {
      if (after && (date < after.date || (date === after.date && period <= after.period))) continue;
      if (courses.some(course => course.slots.some(slot => slot.weekday === weekday && slot.period === period)) ||
        occupied.some(plan => plan.status === 'active' && plan.date === date && plan.period === period)) continue;
      result.push({ assignment, date, period });
    }
  }
  return result;
}
