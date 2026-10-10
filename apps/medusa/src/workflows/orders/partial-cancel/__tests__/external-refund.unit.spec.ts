import { createHash } from 'crypto';
import {
  appliedExternalRefund,
  checkAlreadyRefunded,
  hashRequest,
  PartialCancelExternalRefundRejected,
  unresolvedExternalRefund,
} from '../external-refund';
import { PartialCancelRejected } from '../plan-partial-cancel';

describe('unresolvedExternalRefund', () => {
  it('wallet: 메모 환불 합에서 앞선 상계를 뺀다 — 우리 부분취소 환불·메모 없는 환불은 세지 않는다', () => {
    const refunds = [
      { amount: 10000, note: 'wallet:wr-1' },
      { amount: { numeric_: 5000 }, note: 'wallet:wr-2' },
      { amount: 30000, note: 'partial-cancel:req-1' },
      { amount: 7000, note: null },
    ];
    expect(unresolvedExternalRefund(refunds, [])).toBe(15000);
    expect(unresolvedExternalRefund(refunds, [{ externalRefundApplied: 10000 }, {}])).toBe(5000);
  });

  it('상계가 외부 환불보다 많아도 음수가 되지 않는다', () => {
    expect(unresolvedExternalRefund([{ amount: 1000, note: 'wallet:x' }], [{ externalRefundApplied: 3000 }])).toBe(0);
  });
});

describe('checkAlreadyRefunded (스펙 §4.2)', () => {
  const reasonOf = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(PartialCancelExternalRefundRejected);
      expect(e).toBeInstanceOf(PartialCancelRejected);
      const r = e as PartialCancelExternalRefundRejected;
      return { reason: r.reason, unresolvedAmount: r.unresolvedAmount };
    }
  };

  it.each([
    [0, undefined, null],
    [0, 0, null],
    [0, 5000, { reason: 'external_refund_absent', unresolvedAmount: 0 }],
    [10000, undefined, { reason: 'external_refund_unresolved', unresolvedAmount: 10000 }],
    [10000, 0, null],
    [10000, 10000, null],
    [10000, 10001, { reason: 'external_refund_exceeds', unresolvedAmount: 10000 }],
  ])('U=%p, a=%p', (u, a, expected) => {
    expect(reasonOf(() => checkAlreadyRefunded(u, a))).toEqual(expected);
  });
});

describe('appliedExternalRefund', () => {
  it('품목 차액까지만 상계한다', () => {
    expect(appliedExternalRefund(undefined, 30000)).toBe(0);
    expect(appliedExternalRefund(10000, 30000)).toBe(10000);
    expect(appliedExternalRefund(40000, 30000)).toBe(30000);
    expect(appliedExternalRefund(10000, -500)).toBe(0);
  });
});

describe('hashRequest', () => {
  const items = [{ itemId: 'b', quantity: 1 }, { itemId: 'a', quantity: 2 }];
  it('금액이 없으면 옛 해시(정렬된 품목만)와 같다 — 배포 중 옛 기록을 이어 간다', () => {
    const old = createHash('sha256')
      .update(JSON.stringify([{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }]))
      .digest('hex');
    expect(hashRequest(items, undefined)).toBe(old);
  });
  it('금액이 다르면 다른 요청이다', () => {
    expect(hashRequest(items, 0)).not.toBe(hashRequest(items, undefined));
    expect(hashRequest(items, 0)).not.toBe(hashRequest(items, 1000));
  });
});
