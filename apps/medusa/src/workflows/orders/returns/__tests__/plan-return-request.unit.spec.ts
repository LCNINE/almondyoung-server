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
const core = (deliveredUnits = 2, id = 'i1'): CoreReturnEligibility => ({
  found: true,
  lines: [{ channelOrderItemId: id, deliveredUnits, lastDeliveredAt: DELIVERED }],
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
    expect(lines[0]).toEqual({ itemId: 'i1', returnableQuantity: 0, windowEndsAt: new Date('2026-10-27T14:59:59.999Z') });
    expect(lines[1]).toEqual({ itemId: 'i2', returnableQuantity: 0, windowEndsAt: null });
  });
});

describe('describeOrderReturnable', () => {
  it('취소된 주문은 core 를 묻지 않고 전 줄 0·기한 없음 — POST 의 order_canceled 와 같은 판정', async () => {
    const loadCore = jest.fn(async () => core());
    expect(await describeOrderReturnable('canceled', [item(), item({ id: 'i2' })], loadCore)).toEqual([
      { itemId: 'i1', returnableQuantity: 0, windowEndsAt: null },
      { itemId: 'i2', returnableQuantity: 0, windowEndsAt: null },
    ]);
    expect(loadCore).not.toHaveBeenCalled();
    expect(reasonOf(() => planReturnRequest({ ...base, orderStatus: 'canceled' }))).toBe('order_canceled');
  });

  it('취소되지 않은 주문은 describeReturnable 과 같다', async () => {
    expect(await describeOrderReturnable('pending', [item()], async () => core())).toEqual(describeReturnable([item()], core()));
  });
});
