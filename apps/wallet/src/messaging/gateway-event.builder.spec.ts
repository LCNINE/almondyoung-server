import { buildRefundEventPayload } from './gateway-event.builder';
import { RefundStatus } from '../schema';

describe('buildRefundEventPayload', () => {
  const base = {
    refundId: 'r1',
    chargeId: 'c1',
    intentId: 'i1',
    userId: 'u1',
    status: 'SUCCEEDED' as RefundStatus,
    amount: 1000,
    currency: 'KRW',
  };

  it('reasonCode 를 싣는다 — Medusa 가 자기가 낸 환불을 가리는 근거', () => {
    expect(buildRefundEventPayload({ ...base, reasonCode: 'MEDUSA_REFUND' }).reasonCode).toBe(
      'MEDUSA_REFUND',
    );
  });

  it('reasonCode 가 없으면 키를 만들지 않는다', () => {
    expect('reasonCode' in buildRefundEventPayload(base)).toBe(false);
  });
});
