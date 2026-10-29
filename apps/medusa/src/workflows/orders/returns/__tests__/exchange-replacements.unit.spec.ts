import type { OrderView } from '../../settlement/load-order-view';
import { planExchangeReplacements } from '../exchange-replacements';
import {
  readReturnSettlementRecord,
  RETURN_SETTLEMENT_METADATA_KEY,
  type ReturnSettlementRecord,
} from '../return-settlement-record';

const line = (id: string, unitPrice: number, quantity: number, adjustments: number[] = []): OrderView['lines'][number] => ({
  id,
  title: `상품 ${id}`,
  variantId: `variant_${id}`,
  quantity,
  unitPrice,
  productId: `p_${id}`,
  requiresShipping: true,
  fulfilledQuantity: quantity,
  returnedQuantity: 0,
  exchangeReplacement: false,
  exchangedQuantity: 0,
  adjustments: adjustments.map((amount) => ({ amount })),
});

describe('planExchangeReplacements', () => {
  it('할인 없는 30,000 × 1 → unitPrice 30000', () => {
    expect(planExchangeReplacements([line('a', 30000, 1)], [{ itemId: 'a', received: 1, dismissed: 0 }])).toEqual([
      { sourceItemId: 'a', title: '상품 a', variantId: 'variant_a', quantity: 1, unitPrice: 30000 },
    ]);
  });

  it('30,000 × 3 에 할인 5,000, q=1 → unitPrice 28333.333333… — 원 단위로 자르지 않는다', () => {
    const [r] = planExchangeReplacements([line('a', 30000, 3, [5000])], [{ itemId: 'a', received: 0, dismissed: 1 }]);
    expect(r.quantity).toBe(1);
    expect(r.unitPrice).toBeCloseTo(30000 - 5000 / 3, 6);
    expect(Number.isInteger(r.unitPrice)).toBe(false);
  });

  it('received 1 + dismissed 1 → quantity 2', () => {
    const [r] = planExchangeReplacements([line('a', 30000, 3)], [{ itemId: 'a', received: 1, dismissed: 1 }]);
    expect(r.quantity).toBe(2);
    expect(r.unitPrice).toBe(30000);
  });

  it('received 0·dismissed 0 품목은 결과에 없다', () => {
    const out = planExchangeReplacements(
      [line('a', 30000, 1), line('b', 10000, 1)],
      [
        { itemId: 'a', received: 0, dismissed: 0 },
        { itemId: 'b', received: 1, dismissed: 0 },
      ],
    );
    expect(out.map((r) => r.sourceItemId)).toEqual(['b']);
  });

  it('주문 줄에 없는 품목 → throw', () => {
    expect(() => planExchangeReplacements([line('a', 30000, 1)], [{ itemId: 'zz', received: 1, dismissed: 0 }])).toThrow();
  });
});

describe('readReturnSettlementRecord — 교환 단계(exchanged)', () => {
  const exchanged = (): ReturnSettlementRecord => ({
    requestId: 'r1',
    requestHash: 'h',
    stage: 'exchanged',
    items: [{ itemId: 'i1', received: 1, dismissed: 0 }],
    owed: 30000,
    deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
    feeNotAdjusted: false,
    refundAmount: 0,
    groupFees: {},
    orderVersion: 3,
    receivedAt: '2026-10-29T00:00:00.000Z',
    chargeShippingOptionId: null,
    exchangedAt: '2026-10-29T00:01:00.000Z',
    exchangeItems: [{ sourceItemId: 'i1', itemId: 'i9', quantity: 1 }],
  });
  const meta = (r: unknown) => ({ [RETURN_SETTLEMENT_METADATA_KEY]: r });

  it('교환 기록이 왕복한다', () => {
    expect(readReturnSettlementRecord(JSON.parse(JSON.stringify(meta(exchanged()))))).toEqual(exchanged());
  });
  it.each([
    ['exchangedAt 누락', { exchangedAt: undefined }],
    ['exchangeItems 누락', { exchangeItems: undefined }],
    ['exchangeItems 빈 배열', { exchangeItems: [] }],
    ['exchangeItems 수량 0', { exchangeItems: [{ sourceItemId: 'i1', itemId: 'i9', quantity: 0 }] }],
    ['exchangeItems itemId 누락', { exchangeItems: [{ sourceItemId: 'i1', quantity: 1 }] }],
  ])('모양이 어긋나면 null — %s', (_n, patch) => {
    expect(readReturnSettlementRecord(meta({ ...exchanged(), ...patch }))).toBeNull();
  });
});
