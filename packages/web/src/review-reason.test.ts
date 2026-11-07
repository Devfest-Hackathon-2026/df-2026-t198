import { expect, it } from 'vitest';
import { reviewReasonText } from './review-reason';

it('explains an announcement date without exposing the internal receipt reference', () => {
  expect(reviewReasonText({ kind: 'conflicting-deadline', detail: 'notice-id (1): 2026-11-14T17:00:00+09:00' }))
    .toBe('お知らせでは締切が11/14 17:00に延びています。LMSの課題ページの締切と日付が違うので、確かめてください。');
  expect(reviewReasonText({ kind: 'conflicting-deadline', detail: 'older free-form reason' }))
    .toBe('課題とお知らせの日付が食い違っています。');
});

it('describes the literal LMS marker only when the latest deadline is unreadable', () => {
  const reason = { kind: 'unreadable-deadline' as const, detail: 'unreadable' };
  expect(reviewReasonText(reason, { kind: 'unreadable', dueText: ' - ', timeZone: 'Asia/Tokyo' }))
    .toBe('LMSに締切日時の記載がありません（表示「-」）');
  for (const dueText of ['', '--', '不明']) {
    expect(reviewReasonText(reason, { kind: 'unreadable', dueText, timeZone: 'Asia/Tokyo' }))
      .toBe('今回、課題の締切を読めませんでした。');
  }
  expect(reviewReasonText(reason, { kind: 'none', dueText: '-', timeZone: 'Asia/Tokyo' }))
    .toBe('今回、課題の締切を読めませんでした。');
});
