import { FULFILLMENT_STREAM, FulfillmentShippedPayload } from '@packages/event-contracts/streams';
import { fulfillmentShippedV1OutboxEvent } from '../events';
import { shippedItemsForCompletion } from './shipment-dispatch.service';

const FO = '00000000-0000-4000-8000-000000000001';
const SO = '00000000-0000-4000-8000-000000000002';

// 구성 변경(#1063 스펙 §6.3)으로 SKU 가 바뀐 FO: 옛 항목은 qty 0·shippedQty 0 으로 남고 새 항목만 나간다
const items = [
  { id: 'item-replaced', skuId: 'sku-a', shippedQty: 0 },
  { id: 'item-new', skuId: 'sku-b', shippedQty: 2 },
];

function payloadWith(shippedItems: FulfillmentShippedPayload['shippedItems']): FulfillmentShippedPayload {
  return {
    fulfillmentId: FO,
    orderId: SO,
    trackingInfo: { carrier: 'HANJIN', trackingNumber: 'T-1' },
    shippedAt: new Date('2026-10-13T00:00:00Z').toISOString(),
    shippedItems,
  };
}

const completion = { fulfillmentOrderId: FO, salesOrderId: SO, shippedQty: 2, canceledQty: 0, outstandingQty: 0 };

describe('shippedItemsForCompletion', () => {
  it('나간 수량이 없는 항목(구성 변경으로 대체된 qty 0 항목)은 빼고, 합계는 그대로다', () => {
    expect(shippedItemsForCompletion(items)).toEqual([
      { fulfillmentItemId: 'item-new', skuId: 'sku-b', shippedQty: 2 },
    ]);
  });

  it('걸러낸 페이로드는 FulfillmentShipped 계약과 완료 투영을 통과한다', () => {
    const payload = payloadWith(shippedItemsForCompletion(items));
    expect(() => FULFILLMENT_STREAM.events.FulfillmentShipped.schema!.parse(payload)).not.toThrow();
    expect(fulfillmentShippedV1OutboxEvent(payload, completion).payload.shippedItems).toEqual([
      { fulfillmentItemId: 'item-new', skuId: 'sku-b', shippedQty: 2 },
    ]);
  });

  it('qty 0 항목을 그대로 실으면 계약(shippedQty 양수)이 거절한다 — 출고 트랜잭션이 깨지던 모양', () => {
    const unfiltered = payloadWith(
      items.map((item) => ({ fulfillmentItemId: item.id, skuId: item.skuId, shippedQty: item.shippedQty })),
    );
    expect(() => fulfillmentShippedV1OutboxEvent(unfiltered, completion)).toThrow();
  });
});
