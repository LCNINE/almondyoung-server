import {
  IntentSnapshotValidationError,
  calculateIntentPricing,
  parseIntentSnapshotPayload,
} from './intent-pricing';

describe('Intent pricing', () => {
  it('calculates discounts in fixed order and applies item-level clamp', () => {
    const parsed = parseIntentSnapshotPayload({
      schemaVersion: 'INTENT_SNAPSHOT_V1',
      items: [
        {
          lineId: 'line-a',
          name: 'A',
          unitPrice: 3000,
          quantity: 1,
          discounts: [
            {
              kind: 'ITEM_PER_UNIT',
              amount: 1000,
            },
            {
              kind: 'ITEM_FLAT',
              amount: 10000,
            },
          ],
        },
        {
          lineId: 'line-b',
          name: 'B',
          unitPrice: 2000,
          quantity: 1,
          discounts: [],
        },
      ],
      orderDiscounts: [],
    });

    const pricing = calculateIntentPricing(parsed);
    expect(pricing.items).toHaveLength(2);
    expect(pricing.items[0]?.payableAmount).toBe(0);
    expect(pricing.items[1]?.payableAmount).toBe(2000);
    expect(pricing.intentPayable).toBe(2000);
  });

  it('supports per-unit and flat item discounts with order discount', () => {
    const parsed = parseIntentSnapshotPayload({
      schemaVersion: 'INTENT_SNAPSHOT_V1',
      items: [
        {
          lineId: 'line-1',
          name: 'item-1',
          unitPrice: 3000,
          quantity: 2,
          discounts: [
            { kind: 'ITEM_PER_UNIT', amount: 500 },
            { kind: 'ITEM_FLAT', amount: 1000 },
          ],
        },
      ],
      orderDiscounts: [{ kind: 'ORDER', amount: 2000 }],
    });

    const pricing = calculateIntentPricing(parsed);

    expect(pricing.items[0]?.baseAmount).toBe(6000);
    expect(pricing.items[0]?.itemDiscountPerUnitTotal).toBe(1000);
    expect(pricing.items[0]?.itemDiscountFlatTotal).toBe(1000);
    expect(pricing.items[0]?.payableAmount).toBe(4000);
    expect(pricing.orderDiscountTotal).toBe(2000);
    expect(pricing.intentPayable).toBe(2000);
  });

  it('rejects snapshot without items', () => {
    expect(() =>
      parseIntentSnapshotPayload({
        schemaVersion: 'INTENT_SNAPSHOT_V1',
        items: [],
      }),
    ).toThrow(IntentSnapshotValidationError);
  });

  it('rejects item id when type is missing', () => {
    expect(() =>
      parseIntentSnapshotPayload({
        schemaVersion: 'INTENT_SNAPSHOT_V1',
        items: [
          {
            lineId: 'line-1',
            name: 'item-1',
            unitPrice: 1000,
            quantity: 1,
            id: 'prod_1',
          },
        ],
      }),
    ).toThrow(IntentSnapshotValidationError);
  });

  it('rejects shipping fee item ref id', () => {
    expect(() =>
      parseIntentSnapshotPayload({
        schemaVersion: 'INTENT_SNAPSHOT_V1',
        items: [
          {
            lineId: 'line-1',
            name: 'shipping',
            unitPrice: 3000,
            quantity: 1,
            type: 'SHIPPING_FEE',
            id: 'ship_1',
          },
        ],
      }),
    ).toThrow(IntentSnapshotValidationError);
  });
});
