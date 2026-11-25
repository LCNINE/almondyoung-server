import { describe, expect, it } from 'vitest';
import { confirmOutcome, putawayHint } from './outcome';

describe('confirmOutcome', () => {
  it('반품은 환불 요청', () => {
    expect(
      confirmOutcome({ kind: 'return', exchangeReleasedAt: null }).next
    ).toBe('환불을 요청해요');
  });

  it('교환은 교환품 출고 지시 — 환불이라고 하지 않는다', () => {
    const outcome = confirmOutcome({
      kind: 'exchange',
      exchangeReleasedAt: null,
    });
    expect(outcome).toEqual({
      next: '교환품 출고를 지시해요',
      done: '교환품 출고를 지시했어요',
    });
  });

  it('이미 교환품을 보낸 교환은 확정만', () => {
    const outcome = confirmOutcome({
      kind: 'exchange',
      exchangeReleasedAt: '2026-10-27T00:00:00.000Z',
    });
    expect(outcome.next).toBe(
      '검수를 확정해요 — 교환품은 이미 출고 지시됐어요'
    );
    expect(outcome.next).not.toMatch(/환불/);
  });
});

describe('putawayHint', () => {
  it('양품 수를 모아 F4 적치로 이어 준다', () => {
    expect(
      putawayHint([{ accepted: 2 }, { accepted: 1 }, { accepted: 0 }])
    ).toBe('양품 3개는 F4 적치에서 선반에 넣어 주세요.');
  });

  it('양품이 없으면 말하지 않는다', () => {
    expect(putawayHint([{ accepted: 0 }])).toBe('');
  });
});
