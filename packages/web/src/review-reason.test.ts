import { expect, it } from 'vitest';
import { reviewReasonText } from './review-reason';

it('explains an announcement date without exposing the internal receipt reference', () => {
  expect(reviewReasonText({ kind: 'conflicting-deadline', detail: 'notice-id (1): 2026-11-14T17:00:00+09:00' }))
    .toBe('お知らせでは締切が11/14 17:00に延びています。課題の欄と日付が違うので、LMSで確かめてください。');
  expect(reviewReasonText({ kind: 'conflicting-deadline', detail: 'older free-form reason' }))
    .toBe('課題とお知らせの日付が食い違っています。');
});
