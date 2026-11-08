import type { Deadline } from '../../../../core/src/types';
import { missingDeadlineText } from './review-reason';

export function dayInZone(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
export function formatMoment(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function formatDeadline(deadline: Deadline) {
  switch (deadline.kind) {
    case 'date': return `${deadline.date.replaceAll('-', '/')}（日付のみ）`;
    case 'datetime': return new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.timeZone,
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadline.dueAt));
    case 'none': return '締切なし';
    case 'unreadable': return missingDeadlineText(deadline) ?? '締切を確認できませんでした';
  }
}
