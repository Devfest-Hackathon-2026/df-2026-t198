import type { Deadline, LedgerAssignment } from '@kadai-hisho/core';

export function missingDeadlineText(deadline: Deadline | undefined) {
  return deadline?.kind === 'unreadable' && deadline.dueText.trim() === '-'
    ? 'LMSに締切日時の記載がありません（表示「-」）' : undefined;
}

export function reviewReasonText(reason: LedgerAssignment['reviewReasons'][number], deadline?: Deadline) {
  if (reason.kind === 'unreadable-deadline') return missingDeadlineText(deadline) ?? '今回、課題の締切を読めませんでした。';
  const proposed = /\): (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))$/.exec(reason.detail)?.[1];
  if (!proposed || !Number.isFinite(Date.parse(proposed))) return '課題とお知らせの日付が食い違っています。';
  const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(proposed));
  return `お知らせでは締切が${date}に延びています。LMSの課題ページの締切と日付が違うので、確かめてください。`;
}
