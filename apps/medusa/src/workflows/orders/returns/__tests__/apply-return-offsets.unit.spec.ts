import { applyReturnOffsets } from '../apply-return-offsets';
import type { ReturnSettlementDeduction } from '../plan-return-fees';

const fees = (returnShipping: number, freeShippingBreak = 0, roundTrip = 0): ReturnSettlementDeduction => ({
  returnShipping,
  freeShippingBreak,
  roundTrip,
});
const base = {
  owed: 60000,
  room: 60000,
  diffBeforeReceive: 0,
  prepaid: 0,
  externalRefund: 0,
  fees: fees(0),
  holdRequested: 0,
};

describe('applyReturnOffsets — 채우는 순서: 선환불·외부 상계 → 택배비(반품비 → 깨짐 → 왕복) → 보류 차감 (N3)', () => {
  it('선환불 24,000·owed 60,000·택배비 6,000 → 정산 환불 30,000', () => {
    const r = applyReturnOffsets({ ...base, prepaid: 24000, diffBeforeReceive: 24000, fees: fees(3000, 3000) });
    expect(r).toEqual({
      prepaidApplied: 24000,
      externalRefundApplied: 0,
      offsetCreditLine: 0,
      deduction: fees(3000, 3000),
      refundAmount: 30000,
    });
  });

  it('선환불이 owed − 택배비보다 크면 택배비가 깎인다', () => {
    const r = applyReturnOffsets({ ...base, prepaid: 58000, diffBeforeReceive: 58000, fees: fees(3000, 3000) });
    expect(r.prepaidApplied).toBe(58000);
    expect(r.deduction).toEqual(fees(2000, 0));
    expect(r.refundAmount).toBe(0);
  });

  it('택배비는 반품비 → 깨짐 → 왕복 순으로 남은 돈을 받는다', () => {
    const r = applyReturnOffsets({ ...base, owed: 10000, room: 10000, prepaid: 5000, diffBeforeReceive: 5000, fees: fees(3000, 3000, 3000) });
    expect(r.deduction).toEqual(fees(3000, 2000, 0));
    expect(r.refundAmount).toBe(0);
  });

  it('보류 100,000 요청 → 남은 만큼만 적용, 환불 0', () => {
    const r = applyReturnOffsets({ ...base, fees: fees(3000, 3000), holdRequested: 100000 });
    expect(r.deduction).toEqual({ ...fees(3000, 3000), hold: 54000 });
    expect(r.refundAmount).toBe(0);
  });

  it('보류 차감이 남은 돈 안이면 그대로, 환불이 그만큼 적다', () => {
    const r = applyReturnOffsets({ ...base, fees: fees(3000), holdRequested: 5000 });
    expect(r.deduction).toEqual({ ...fees(3000), hold: 5000 });
    expect(r.refundAmount).toBe(52000);
  });

  it('보류 요청이 없으면 deduction 에 hold 칸이 없다 — PR 6 기록과 같은 모양', () => {
    const r = applyReturnOffsets({ ...base, fees: fees(3000) });
    expect(r.deduction).toEqual(fees(3000));
    expect('hold' in r.deduction).toBe(false);
  });

  it('외부 상계는 선환불 다음, 택배비 앞', () => {
    const r = applyReturnOffsets({ ...base, prepaid: 50000, diffBeforeReceive: 50000, externalRefund: 20000, fees: fees(3000, 3000), holdRequested: 1000 });
    expect(r.prepaidApplied).toBe(50000);
    expect(r.externalRefundApplied).toBe(10000);
    expect(r.deduction).toEqual({ ...fees(0, 0), hold: 0 });
    expect(r.refundAmount).toBe(0);
  });

  it('전부 0 이면 환불 = owed, 상계 크레딧 0', () => {
    expect(applyReturnOffsets(base)).toEqual({
      prepaidApplied: 0,
      externalRefundApplied: 0,
      offsetCreditLine: 0,
      deduction: fees(0),
      refundAmount: 60000,
    });
  });

  it('owed 가 0 이하면 아무것도 적용하지 않는다', () => {
    const r = applyReturnOffsets({ ...base, owed: -5, room: 0, prepaid: 1000, externalRefund: 1000, fees: fees(3000), holdRequested: 1000 });
    expect(r).toEqual({ prepaidApplied: 0, externalRefundApplied: 0, offsetCreditLine: 0, deduction: { ...fees(0), hold: 0 }, refundAmount: 0 });
  });

  // ── 상계 크레딧 라인(N6): 크레딧이 붙은 몫만 = clamp(P + E − B, 0, P + E), 그리고 room 이하 ──
  it('선환불 24,000 이 수령 전 차액에 +24,000 으로 들어 있으면 상계 크레딧 0', () => {
    const r = applyReturnOffsets({ ...base, prepaid: 24000, diffBeforeReceive: 24000 });
    expect(r.offsetCreditLine).toBe(0);
  });

  it('크레딧이 붙은 외부 환불 10,000(수령 전 차액 0) → 상계 크레딧 10,000', () => {
    const r = applyReturnOffsets({ ...base, externalRefund: 10000, diffBeforeReceive: 0 });
    expect(r.externalRefundApplied).toBe(10000);
    expect(r.offsetCreditLine).toBe(10000);
    expect(r.refundAmount).toBe(50000);
  });

  it('크레딧 없는 선환불과 크레딧 붙은 외부 환불이 섞이면 붙은 몫만 상계한다', () => {
    const r = applyReturnOffsets({ ...base, prepaid: 24000, externalRefund: 10000, diffBeforeReceive: 24000 });
    expect(r.offsetCreditLine).toBe(10000);
  });

  it('수령 전 차액이 음수여도 상계 크레딧은 적용한 몫(P + E)을 넘지 않는다', () => {
    const r = applyReturnOffsets({ ...base, externalRefund: 10000, diffBeforeReceive: -3000 });
    expect(r.offsetCreditLine).toBe(10000);
  });

  it('상계 크레딧은 room 을 넘지 않는다', () => {
    const r = applyReturnOffsets({ ...base, room: 9999, externalRefund: 10000, diffBeforeReceive: 0 });
    expect(r.offsetCreditLine).toBe(9999);
  });

  it('상계 크레딧은 적용한 몫으로 잰다 — owed 를 넘어 못 쓴 외부 환불은 상계하지 않는다', () => {
    const r = applyReturnOffsets({ ...base, owed: 8000, room: 8000, externalRefund: 10000, diffBeforeReceive: 0 });
    expect(r.externalRefundApplied).toBe(8000);
    expect(r.offsetCreditLine).toBe(8000);
  });
});
