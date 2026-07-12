import { classifyRefundOutcome } from './return-refund-classification';

describe('classifyRefundOutcome (규율 1·3)', () => {
  it('success → succeeded', () => {
    expect(classifyRefundOutcome({ kind: 'success', refunds: [] })).toBe('succeeded');
  });
  it('already_refunded → succeeded (2차 방어)', () => {
    expect(classifyRefundOutcome({ kind: 'already_refunded', errorCode: 'X', errorMessage: 'm' })).toBe('succeeded');
  });
  it('failed determinate=true → failed (다음 재시도 N+1)', () => {
    expect(classifyRefundOutcome({ kind: 'failed', errorCode: 'X', errorMessage: 'm', determinate: true })).toBe('failed');
  });
  it('failed determinate=false(5xx) → pending (같은 key 재생)', () => {
    expect(classifyRefundOutcome({ kind: 'failed', errorCode: 'X', errorMessage: 'm', determinate: false })).toBe('pending');
  });
  it('in_flight → pending (규율 3)', () => {
    expect(classifyRefundOutcome({ kind: 'in_flight', errorCode: 'X', errorMessage: 'm' })).toBe('pending');
  });
  it('wallet_unavailable → pending (불확정)', () => {
    expect(classifyRefundOutcome({ kind: 'wallet_unavailable', errorMessage: 'm' })).toBe('pending');
  });
  it('partial_pending → pending (진행중)', () => {
    expect(classifyRefundOutcome({ kind: 'partial_pending', refunds: [] })).toBe('pending');
  });
});
