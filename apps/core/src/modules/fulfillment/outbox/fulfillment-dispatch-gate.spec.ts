import { ConfigService } from '@nestjs/config';
import { FULFILLMENT_V2_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { FulfillmentOutboxDispatchGate } from './fulfillment-dispatch-gate.module';

/**
 * 정비 중 발행 보류가 회수를 넘어 살아남는지 고정한다 (ADR-0029 §5-1, Task 6-C-2).
 *
 * 옛 core 디스패처는 `FULFILLMENT_WORKFLOW_MODE=maintenance` 동안 fulfillment·shipment 계열
 * 행을 SQL 필터로 선택에서 뺐다. 공용 디스패처로 옮기면서 이 성질을 빠뜨리면 정비 중에 이벤트가
 * 나가기 시작하고, 그건 **재시도 의미론 말고는 아무것도 바뀌지 않는다**는 이 조각의 약속을
 * 깨뜨린다. 게이트가 서술자를 돌려주므로 DB 없이 여기서 확인할 수 있다.
 */
describe('FulfillmentOutboxDispatchGate', () => {
  const gateFor = (mode: 'v2' | 'maintenance') =>
    new FulfillmentOutboxDispatchGate(
      new FulfillmentWorkflowGate(
        new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '2026-01-01T00:00:00.000Z' }),
      ),
    );

  it('v2 에서는 아무것도 보류하지 않는다 (대조군)', () => {
    // 이것이 라이브 상태다. 여기서 null 이 아니면 정상 운영 중에 발행이 멈춘다 — 보류 로직이
    // 있다는 것보다 **평소에 꺼져 있다**는 것이 먼저 참이어야 한다.
    expect(gateFor('v2').pausedRows()).toBeNull();
  });

  it('maintenance 에서는 shipment·fulfillment 계열을 보류한다', () => {
    const paused = gateFor('maintenance').pausedRows();

    expect(paused).not.toBeNull();
    expect(paused?.topics).toEqual([SHIPMENT_STREAM.topic.topic, FULFILLMENT_V2_STREAM.topic.topic]);
    expect(paused?.eventTypePrefixes).toEqual(['Fulfillment', 'Shipment']);
  });

  it('보류 서술이 옛 SQL 필터와 같은 행 집합을 고른다', () => {
    // 옛 필터: topic ∈ {shipments.v1, fulfillments.v2} 이거나 event_type LIKE 'fulfillment%'/'shipment%'.
    // 새 서술로 같은 판정이 나오는지 대표 행으로 확인한다 — 특히 **보류되지 않아야 할** 행들이
    // 중요하다(주문 통지·재고·주문취소·상품). 그것들이 함께 멈추면 정비가 무관한 도메인을 세운다.
    const paused = gateFor('maintenance').pausedRows()!;
    const isPaused = (topic: string, eventType: string) =>
      (paused.topics ?? []).includes(topic) ||
      (paused.eventTypePrefixes ?? []).some((p) => eventType.toLowerCase().startsWith(p.toLowerCase()));

    expect(isPaused('shipments.events.v1', 'ShipmentShipped')).toBe(true);
    expect(isPaused('shipments.events.v1', 'ShipmentDispatchRecalled')).toBe(true);
    expect(isPaused('fulfillments.events.v2', 'FulfillmentProgressed')).toBe(true);
    expect(isPaused('fulfillments.events.v1', 'FulfillmentShipped')).toBe(true);
    expect(isPaused('fulfillments.events.v1', 'FulfillmentDelivered')).toBe(true);

    expect(isPaused('fulfillments.events.v1', 'ORDER_CREATED')).toBe(false);
    expect(isPaused('fulfillments.events.v1', 'ORDER_MODIFIED')).toBe(false);
    expect(isPaused('core.orders.events.v1', 'SalesOrderCancelled')).toBe(false);
    expect(isPaused('inventory.events.v1', 'StockShipped')).toBe(false);
    expect(isPaused('inventory.events.v1', 'ProductSellableQuantityChanged')).toBe(false);
    expect(isPaused('products.events.v1', 'ProductMasterDeleted')).toBe(false);
  });
});
