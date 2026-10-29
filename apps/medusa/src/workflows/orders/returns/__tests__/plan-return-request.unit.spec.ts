import {
  describeOrderReturnable,
  describeReturnable,
  planReturnRequest,
  ReturnRequestRejected,
  type ReturnableOrderItem,
} from '../plan-return-request';
import type { CoreReturnEligibility } from '../core-return-eligibility';

const DELIVERED = new Date('2026-10-20T03:00:00.000Z'); // 기한 끝: 10-27 23:59:59.999 KST
const INSIDE = new Date('2026-10-22T00:00:00.000Z');
const AFTER = new Date('2026-11-05T00:00:00.000Z');

const item = (o: Partial<ReturnableOrderItem> = {}): ReturnableOrderItem => ({
  id: 'i1', quantity: 2, fulfilled: 0, returnRequested: 0, returnReceived: 0, returnDismissed: 0, ...o,
});
const core = (deliveredUnits = 2, id = 'i1', exchangeable = true): CoreReturnEligibility => ({
  found: true,
  lines: [{ channelOrderItemId: id, deliveredUnits, lastDeliveredAt: DELIVERED, exchangeable }],
  customerReturns: [],
});
const changeOfMind = { value: 'change_of_mind', feeBearer: 'customer' as const, customerSelectable: true };
const defective = { value: 'defective', feeBearer: 'seller' as const, customerSelectable: true };
const other = { value: 'other', feeBearer: 'operator' as const, customerSelectable: false };

const base = {
  orderStatus: 'pending',
  items: [item()],
  core: core(),
  requested: [{ itemId: 'i1', quantity: 2 }],
  requestedBy: 'customer' as const,
  reason: changeOfMind,
  now: INSIDE,
};

function reasonOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReturnRequestRejected) return e.reason;
    throw e;
  }
  return null;
}

describe('planReturnRequest', () => {
  it('배송완료 2, 주문 수량 2, 반품 0 → 2개 요청 통과, topUp 2(fulfilled 0)', () => {
    const r = planReturnRequest(base);
    expect(r.items).toEqual([{ itemId: 'i1', quantity: 2 }]);
    expect(r.fulfillmentTopUp).toEqual([{ itemId: 'i1', quantity: 2 }]);
  });

  it('수령 1(received 1, requested 0, fulfilled 1) 뒤 2개 요청 → quantity_exceeds_returnable', () => {
    const items = [item({ fulfilled: 1, returnReceived: 1 })];
    expect(reasonOf(() => planReturnRequest({ ...base, items }))).toBe('quantity_exceeds_returnable');
  });

  it('배송 뒤 부분취소로 item.quantity 1, deliveredUnits 2 → 1 이 상한', () => {
    const items = [item({ quantity: 1 })];
    expect(describeReturnable(items, core(2))[0].returnableQuantity).toBe(1);
    expect(reasonOf(() => planReturnRequest({ ...base, items }))).toBe('quantity_exceeds_returnable');
  });

  it('core 줄 없음 또는 deliveredUnits 0 → not_delivered', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, core: { found: true, lines: [], customerReturns: [] } }))).toBe('not_delivered');
    expect(reasonOf(() => planReturnRequest({ ...base, core: core(0) }))).toBe('not_delivered');
  });

  it('주문이 취소됨 → order_canceled', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, orderStatus: 'canceled' }))).toBe('order_canceled');
  });

  it('주문에 없는 품목 → item_not_in_order', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, requested: [{ itemId: 'zz', quantity: 1 }] }))).toBe(
      'item_not_in_order',
    );
  });

  it('고객, 기한 지남 → window_closed', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, now: AFTER }))).toBe('window_closed');
  });

  it('CS, 기한 지남, 사유 없이 → window_override_reason_required', () => {
    const cs = { ...base, requestedBy: 'operator' as const, now: AFTER };
    expect(reasonOf(() => planReturnRequest(cs))).toBe('window_override_reason_required');
    expect(reasonOf(() => planReturnRequest({ ...cs, windowOverrideReason: '   ' }))).toBe(
      'window_override_reason_required',
    );
  });

  it('CS, 기한 지남, 사유와 함께 → windowOverridden true, 수량 상한은 그대로', () => {
    const cs = { ...base, requestedBy: 'operator' as const, now: AFTER, windowOverrideReason: '고객 입원' };
    expect(planReturnRequest(cs).windowOverridden).toBe(true);
    expect(reasonOf(() => planReturnRequest({ ...cs, requested: [{ itemId: 'i1', quantity: 3 }] }))).toBe(
      'quantity_exceeds_returnable',
    );
  });

  it('기한 안이면 windowOverridden false', () => {
    expect(planReturnRequest(base).windowOverridden).toBe(false);
  });

  it('고객이 기타 → reason_not_selectable', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, reason: other }))).toBe('reason_not_selectable');
  });

  it('CS 기타, operatorFeeBearer 없음 → fee_bearer_required', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, requestedBy: 'operator', reason: other }))).toBe(
      'fee_bearer_required',
    );
  });

  it('CS 기타 + seller → feeBearer seller', () => {
    const r = planReturnRequest({ ...base, requestedBy: 'operator', reason: other, operatorFeeBearer: 'seller' });
    expect(r.feeBearer).toBe('seller');
  });

  it('사유 없음·표 밖(feeBearer null) → reason_not_found', () => {
    expect(reasonOf(() => planReturnRequest({ ...base, reason: null }))).toBe('reason_not_found');
    expect(
      reasonOf(() => planReturnRequest({ ...base, reason: { value: 'x', feeBearer: null, customerSelectable: true } })),
    ).toBe('reason_not_found');
  });

  it('단순 변심 → feeBearer customer, 상품 하자 → seller', () => {
    expect(planReturnRequest(base).feeBearer).toBe('customer');
    expect(planReturnRequest({ ...base, reason: defective }).feeBearer).toBe('seller');
  });

  it('fulfilled 가 이미 반품 점유보다 크면 topUp 0 이고 목록에서 빠진다', () => {
    const items = [item({ fulfilled: 2 })];
    expect(planReturnRequest({ ...base, items }).fulfillmentTopUp).toEqual([]);
  });

  it('topUp = (점유 + 이번) − fulfilled', () => {
    const items = [item({ quantity: 4, fulfilled: 1, returnRequested: 1 })];
    const r = planReturnRequest({ ...base, items, core: core(4), requested: [{ itemId: 'i1', quantity: 2 }] });
    expect(r.fulfillmentTopUp).toEqual([{ itemId: 'i1', quantity: 2 }]);
  });
});

describe('describeReturnable', () => {
  it('음수는 0, windowEndsAt 은 lastDeliveredAt 기준', () => {
    const items = [item({ id: 'i1', returnRequested: 3 }), item({ id: 'i2' })];
    const lines = describeReturnable(items, core(2));
    expect(lines[0]).toEqual({
      itemId: 'i1',
      returnableQuantity: 0,
      windowEndsAt: new Date('2026-10-27T14:59:59.999Z'),
      exchangeable: true,
    });
    expect(lines[1]).toEqual({ itemId: 'i2', returnableQuantity: 0, windowEndsAt: null, exchangeable: false });
  });

  it('exchangeable 은 core 줄을 따르고, core 줄이 없으면 false (K8 PR11b N3)', () => {
    const lines = describeReturnable([item({ id: 'i1' }), item({ id: 'i2' })], core(2, 'i1', false));
    expect(lines.map((l) => l.exchangeable)).toEqual([false, false]);
    expect(describeReturnable([item()], core(2, 'i1', true))[0].exchangeable).toBe(true);
  });
});

describe('describeOrderReturnable', () => {
  it('취소된 주문은 core 를 묻지 않고 전 줄 0·기한 없음 — POST 의 order_canceled 와 같은 판정', async () => {
    const loadCore = jest.fn(async () => core());
    expect(await describeOrderReturnable('canceled', [item(), item({ id: 'i2' })], loadCore)).toEqual([
      { itemId: 'i1', returnableQuantity: 0, windowEndsAt: null, exchangeable: false },
      { itemId: 'i2', returnableQuantity: 0, windowEndsAt: null, exchangeable: false },
    ]);
    expect(loadCore).not.toHaveBeenCalled();
    expect(reasonOf(() => planReturnRequest({ ...base, orderStatus: 'canceled' }))).toBe('order_canceled');
  });

  it('취소되지 않은 주문은 describeReturnable 과 같다', async () => {
    expect(await describeOrderReturnable('pending', [item()], async () => core())).toEqual(describeReturnable([item()], core()));
  });
});

describe('planReturnRequest — 교환 (K8 PR11 N2)', () => {
  const exchange = { ...base, kind: 'exchange' as const, requestedBy: 'operator' as const };

  it('교환 + change_of_mind → exchange_requires_seller_fault', () => {
    expect(reasonOf(() => planReturnRequest({ ...exchange, reason: changeOfMind }))).toBe('exchange_requires_seller_fault');
  });

  it('교환 + other + operatorFeeBearer customer → exchange_requires_seller_fault', () => {
    expect(
      reasonOf(() => planReturnRequest({ ...exchange, reason: other, operatorFeeBearer: 'customer' })),
    ).toBe('exchange_requires_seller_fault');
  });

  it('교환 + other + operatorFeeBearer seller → 통과', () => {
    const r = planReturnRequest({ ...exchange, reason: other, operatorFeeBearer: 'seller' });
    expect(r.feeBearer).toBe('seller');
  });

  it('교환 + defective → 통과', () => {
    expect(planReturnRequest({ ...exchange, reason: defective }).feeBearer).toBe('seller');
  });

  it('kind 가 없거나 return 이면 change_of_mind 도 그대로 통과(반품 동작 불변)', () => {
    expect(planReturnRequest(base).feeBearer).toBe('customer');
    expect(planReturnRequest({ ...base, kind: 'return' }).feeBearer).toBe('customer');
  });
});

describe('planReturnRequest — 인쇄 상품 교환 거절 (K8 PR11b N3)', () => {
  const exchange = { ...base, kind: 'exchange' as const, requestedBy: 'operator' as const, reason: defective };
  const twoLines = (exchangeable: { i1: boolean; i2: boolean }): CoreReturnEligibility => ({
    found: true,
    lines: [
      { channelOrderItemId: 'i1', deliveredUnits: 2, lastDeliveredAt: DELIVERED, exchangeable: exchangeable.i1 },
      { channelOrderItemId: 'i2', deliveredUnits: 2, lastDeliveredAt: DELIVERED, exchangeable: exchangeable.i2 },
    ],
    customerReturns: [],
  });
  const items = [item({ id: 'i1' }), item({ id: 'i2' })];

  it('교환 + exchangeable false 줄 → exchange_item_unsupported', () => {
    expect(reasonOf(() => planReturnRequest({ ...exchange, core: core(2, 'i1', false) }))).toBe('exchange_item_unsupported');
  });

  it('반품 + exchangeable false 줄 → 통과(인쇄 상품도 반품은 된다)', () => {
    expect(planReturnRequest({ ...base, kind: 'return', core: core(2, 'i1', false) }).items).toEqual([
      { itemId: 'i1', quantity: 2 },
    ]);
    expect(planReturnRequest({ ...base, core: core(2, 'i1', false) }).items).toEqual([{ itemId: 'i1', quantity: 2 }]);
  });

  it('교환 — 두 줄 중 false 줄을 고르면 거절, 다른 줄만 고르면 통과', () => {
    const c = twoLines({ i1: true, i2: false });
    expect(
      reasonOf(() =>
        planReturnRequest({ ...exchange, items, core: c, requested: [{ itemId: 'i1', quantity: 1 }, { itemId: 'i2', quantity: 1 }] }),
      ),
    ).toBe('exchange_item_unsupported');
    expect(planReturnRequest({ ...exchange, items, core: c, requested: [{ itemId: 'i1', quantity: 1 }] }).items).toEqual([
      { itemId: 'i1', quantity: 1 },
    ]);
  });

  it('교환 + core 줄 없음 → not_delivered(인쇄인지는 core 줄이 있을 때만 판정한다)', () => {
    expect(reasonOf(() => planReturnRequest({ ...exchange, core: { found: true, lines: [], customerReturns: [] } }))).toBe(
      'not_delivered',
    );
  });

  it('교환 판정은 수량·기한보다 먼저다 — false 줄이면 수량 초과·기한 지남이어도 exchange_item_unsupported', () => {
    const c = core(2, 'i1', false);
    expect(reasonOf(() => planReturnRequest({ ...exchange, core: c, requested: [{ itemId: 'i1', quantity: 9 }] }))).toBe(
      'exchange_item_unsupported',
    );
    expect(reasonOf(() => planReturnRequest({ ...exchange, core: c, now: AFTER }))).toBe('exchange_item_unsupported');
  });
});
