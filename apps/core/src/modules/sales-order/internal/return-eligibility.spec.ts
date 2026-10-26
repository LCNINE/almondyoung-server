import type { LineQuantities, LineSkuQuantities } from '../line-quantities/line-quantities.reader';
import type { ParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';
import { toReturnEligibilityLines } from './return-eligibility';

function line(
  lineId: string,
  skus: Array<{ sku: string; qtyPerUnit: number | null; delivered: number }>,
): LineQuantities {
  return {
    salesOrderLineId: lineId,
    ordered: 0,
    canceledBeforeShipment: 0,
    canceledAfterShipment: 0,
    canceled: 0,
    demand: 0,
    remaining: 0,
    skus: skus.map(
      (s): LineSkuQuantities => ({
        skuId: s.sku,
        qtyPerUnit: s.qtyPerUnit,
        required: 0,
        shipped: 0,
        forwarded: 0,
        delivered: s.delivered,
        partnerCompleted: 0,
        outstanding: 0,
        returnActive: 0,
        returnConsumed: 0,
        exchangeActive: 0,
        claimable: 0,
      }),
    ),
  };
}

function parcel(lineId: string, deliveredAt: string): ParcelClaimEligibility {
  return {
    salesOrderLineId: lineId,
    skuId: 'S1',
    shipmentId: 'sh',
    shipmentLineId: 'shl',
    dispatchAttemptId: 'da',
    deliveredAt: new Date(deliveredAt),
    deliveredQty: 1,
    claimedQty: 0,
    skuClaimable: 1,
    claimable: 1,
  };
}

describe('toReturnEligibilityLines', () => {
  it('단품 3개 중 2개 배송완료 → deliveredUnits 2, 마지막 배송완료 시각', () => {
    expect(
      toReturnEligibilityLines(
        [{ channelOrderItemId: 'ordli_1', quantities: line('L1', [{ sku: 'S1', qtyPerUnit: 1, delivered: 2 }]) }],
        [parcel('L1', '2026-10-20T01:00:00.000Z'), parcel('L1', '2026-10-22T05:00:00.000Z')],
      ),
    ).toEqual([{ channelOrderItemId: 'ordli_1', deliveredUnits: 2, lastDeliveredAt: '2026-10-22T05:00:00.000Z' }]);
  });

  it('세트(구성품 둘, 1개당 1·2) 중 한 구성품만 배송완료 → 0', () => {
    const [result] = toReturnEligibilityLines(
      [
        {
          channelOrderItemId: 'ordli_1',
          quantities: line('L1', [
            { sku: 'S1', qtyPerUnit: 1, delivered: 1 },
            { sku: 'S2', qtyPerUnit: 2, delivered: 0 },
          ]),
        },
      ],
      [parcel('L1', '2026-10-20T01:00:00.000Z')],
    );
    expect(result.deliveredUnits).toBe(0);
  });

  it('구성이 안 굳은 줄(qtyPerUnit null) → 0', () => {
    const [result] = toReturnEligibilityLines(
      [{ channelOrderItemId: 'ordli_1', quantities: line('L1', [{ sku: 'S1', qtyPerUnit: null, delivered: 3 }]) }],
      [],
    );
    expect(result.deliveredUnits).toBe(0);
  });

  it('channelOrderItemId 가 null 인 줄은 빠진다', () => {
    expect(
      toReturnEligibilityLines(
        [
          { channelOrderItemId: null, quantities: line('L1', [{ sku: 'S1', qtyPerUnit: 1, delivered: 1 }]) },
          { channelOrderItemId: 'ordli_2', quantities: line('L2', [{ sku: 'S1', qtyPerUnit: 1, delivered: 1 }]) },
        ],
        [],
      ).map((l) => l.channelOrderItemId),
    ).toEqual(['ordli_2']);
  });

  it('소포가 없는 줄은 lastDeliveredAt null', () => {
    const [result] = toReturnEligibilityLines(
      [{ channelOrderItemId: 'ordli_1', quantities: line('L1', [{ sku: 'S1', qtyPerUnit: 1, delivered: 0 }]) }],
      [parcel('L2', '2026-10-20T01:00:00.000Z')],
    );
    expect(result).toEqual({ channelOrderItemId: 'ordli_1', deliveredUnits: 0, lastDeliveredAt: null });
  });
});
