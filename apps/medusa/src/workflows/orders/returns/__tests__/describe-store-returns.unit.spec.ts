import { describeStoreReturns, type StoreReturnSource } from '../describe-store-returns';

const request = (over: Record<string, unknown> = {}) => ({
  requestId: 'req_1',
  requestHash: 'h',
  requestedBy: 'customer',
  reasonValue: 'change_of_mind',
  feeBearer: 'customer',
  windowOverride: null,
  fulfillmentTopUp: [],
  ...over,
});
const settlement = (stage: string) => ({
  requestId: 'r1',
  requestHash: 'h',
  stage,
  items: [{ itemId: 'i1', received: 1, dismissed: 0 }],
  owed: 30000,
  deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
  feeNotAdjusted: false,
  refundAmount: 24000,
  groupFees: { sp: 3000 },
  orderVersion: 3,
  receivedAt: '2026-10-27T00:00:00.000Z',
  chargeShippingOptionId: 'so_1',
});
const prepay = (stage: string) => ({
  requestId: 'cr_1',
  requestHash: 'h',
  stage,
  amount: 54000,
  itemValue: 60000,
  feeEstimate: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
  memo: '선환불',
  requestedAt: '2026-10-27T00:00:00.000Z',
  ...(stage === 'refunded' ? { refundedAt: '2026-10-27T01:00:00.000Z', refundMode: 'manual' } : {}),
});

const src = (over: Partial<StoreReturnSource> & { extra?: Record<string, unknown> } = {}): StoreReturnSource => {
  const { extra, ...rest } = over;
  return {
    id: 'ret_1',
    status: 'requested',
    requestedAt: '2026-10-27T00:00:00.000Z',
    createdAt: '2026-10-26T00:00:00.000Z',
    metadata: { almondReturn: request(), ...extra },
    items: [{ itemId: 'i1', quantity: 1 }],
    ...rest,
  };
};

describe('describeStoreReturns', () => {
  it('우리 기록이 없는 반품과 open 반품은 뺀다', () => {
    const out = describeStoreReturns([
      src({ id: 'a', metadata: {} }),
      src({ id: 'b', status: 'open' }),
      src({ id: 'c' }),
    ]);
    expect(out.map((r) => r.returnId)).toEqual(['c']);
  });
  it('requested 반품 → stage requested, canCancel true, 사유·부담 주체는 almondReturn 에서', () => {
    const [r] = describeStoreReturns([
      src({ extra: { almondReturn: request({ reasonValue: 'defective', feeBearer: 'seller' }) }, items: [{ itemId: 'i1', quantity: 2 }] }),
    ]);
    expect(r).toEqual({
      returnId: 'ret_1',
      stage: 'requested',
      requestedAt: '2026-10-27T00:00:00.000Z',
      reason: 'defective',
      feeBearer: 'seller',
      items: [{ itemId: 'i1', quantity: 2 }],
      canCancel: true,
    });
  });
  it.each(['received', 'partially_received'])('%s → processing, canCancel false', (status) => {
    const [r] = describeStoreReturns([src({ status })]);
    expect(r).toMatchObject({ stage: 'processing', canCancel: false });
  });
  it('정산 기록 stage charged → processing, refunded → refunded', () => {
    const [a] = describeStoreReturns([src({ status: 'received', extra: { almondReturnSettlement: settlement('charged') } })]);
    const [b] = describeStoreReturns([src({ status: 'received', extra: { almondReturnSettlement: settlement('refunded') } })]);
    expect(a).toMatchObject({ stage: 'processing', canCancel: false });
    expect(b).toMatchObject({ stage: 'refunded', canCancel: false });
  });
  it('정산 기록이 있으면 Medusa 상태가 requested 여도 processing', () => {
    const [r] = describeStoreReturns([src({ extra: { almondReturnSettlement: settlement('received') } })]);
    expect(r).toMatchObject({ stage: 'processing', canCancel: false });
  });
  it('선환불 기록 stage refunded 이고 Medusa 는 requested → refunded, canCancel false', () => {
    const [r] = describeStoreReturns([src({ extra: { almondReturnPrepay: prepay('refunded') } })]);
    expect(r).toMatchObject({ stage: 'refunded', canCancel: false });
  });
  it('선환불 기록 stage requested 는 단계를 바꾸지 않는다', () => {
    const [r] = describeStoreReturns([src({ extra: { almondReturnPrepay: prepay('requested') } })]);
    expect(r).toMatchObject({ stage: 'requested', canCancel: true });
  });
  it('canceled → canceled, 정산 기록이 있어도 canceled', () => {
    const [r] = describeStoreReturns([src({ status: 'canceled', extra: { almondReturnSettlement: settlement('refunded') } })]);
    expect(r).toMatchObject({ stage: 'canceled', canCancel: false });
  });
  it('requested_at 늦은 순, requested_at 이 없으면 created_at', () => {
    const out = describeStoreReturns([
      src({ id: 'old', requestedAt: '2026-10-01T00:00:00.000Z' }),
      src({ id: 'noreq', requestedAt: null, createdAt: '2026-10-20T00:00:00.000Z' }),
      src({ id: 'new', requestedAt: '2026-10-27T00:00:00.000Z' }),
    ]);
    expect(out.map((r) => r.returnId)).toEqual(['new', 'noreq', 'old']);
    expect(out[1].requestedAt).toBe('2026-10-20T00:00:00.000Z');
  });
  it('operator 가 접수한 other 사유 반품도 싣는다', () => {
    const [r] = describeStoreReturns([
      src({ extra: { almondReturn: request({ requestedBy: 'operator', reasonValue: 'other', feeBearer: 'seller' }) } }),
    ]);
    expect(r).toMatchObject({ reason: 'other', feeBearer: 'seller' });
  });
});
