import { FulfillmentEventsConsumer } from './fulfillment-events.consumer';
import { inboxEvents } from '../schema';
import type { FulfillmentShippedPayload, FulfillmentDeliveredPayload, SalesOrderCancelledPayload } from '@packages/event-contracts/streams';

const SHIPPED_PAYLOAD: FulfillmentShippedPayload = {
  fulfillmentId: 'fo-001',
  orderId: 'order-001',
  channelOrderId: 'ch-001',
  trackingInfo: { carrier: 'CJ', trackingNumber: 'TRK-001' },
  shippedAt: '2026-06-09T00:00:00.000Z',
  shippedItems: [{ fulfillmentItemId: 'foi-001', skuId: 'sku-001', shippedQty: 2 }],
};

const DELIVERED_PAYLOAD: FulfillmentDeliveredPayload = {
  fulfillmentId: 'fo-001',
  orderId: 'order-001',
  channelOrderId: 'ch-001',
  deliveredAt: '2026-06-09T12:00:00.000Z',
};

const BASE_PAYLOAD: SalesOrderCancelledPayload = {
  orderId: 'order-001',
  reason: 'ADMIN_CANCEL',
  cancelledBy: 'admin',
  cancelledAt: '2026-06-02T00:00:00.000Z',
  cancellationScope: 'full',
  refundRequired: true,
  refundAmount: 50000,
};

const ENVELOPE = { correlationId: 'corr-1', messageId: 'msg-1' } as any;

function makeService() {
  const valuesMock = jest.fn().mockResolvedValue(undefined);
  const insertMock = jest.fn().mockReturnValue({ values: valuesMock });
  const dbService = { db: { insert: insertMock } };

  const service = new FulfillmentEventsConsumer(
    {} as any, // channelAdapterFactory — 이 테스트에선 미사용
    dbService as any,
  );

  return { service, insertMock, valuesMock };
}

function makeServiceWithAdapter() {
  const valuesMock = jest.fn().mockResolvedValue(undefined);
  const insertMock = jest.fn().mockReturnValue({ values: valuesMock });
  const dbService = { db: { insert: insertMock } };

  const executeCommandMock = jest.fn().mockResolvedValue({ success: true });
  const channelAdapterFactory = {
    getAdapter: jest.fn().mockReturnValue({ executeCommand: executeCommandMock }),
  };

  const service = new FulfillmentEventsConsumer(channelAdapterFactory as any, dbService as any);
  return { service, insertMock, valuesMock, executeCommandMock };
}

describe('FulfillmentEventsConsumer.handleFulfillmentShipped', () => {
  it('채널 동기화 후 inbox_events에 CoreFulfillmentShipped 저장', async () => {
    const { service, insertMock, valuesMock, executeCommandMock } = makeServiceWithAdapter();
    await service.handleFulfillmentShipped(SHIPPED_PAYLOAD, ENVELOPE);

    expect(executeCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dispatch.ship', orderId: 'order-001' }),
    );
    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CoreFulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: 'fo-001',
        status: 'pending',
      }),
    );
  });

  it('채널 어댑터 오류 시에도 inbox insert는 수행된다', async () => {
    const { service, insertMock } = makeServiceWithAdapter();
    // getAdapter를 throw하게 만들어도 내부에서 catch → inbox insert는 여전히 실행
    const brokenService = new FulfillmentEventsConsumer({} as any, { db: { insert: insertMock } } as any);
    await brokenService.handleFulfillmentShipped(SHIPPED_PAYLOAD, ENVELOPE);
    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
  });
});

describe('FulfillmentEventsConsumer.handleFulfillmentDelivered', () => {
  it('inbox_events에 CoreFulfillmentDelivered 저장', async () => {
    const { service, insertMock, valuesMock } = makeServiceWithAdapter();
    await service.handleFulfillmentDelivered(DELIVERED_PAYLOAD, ENVELOPE);

    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CoreFulfillmentDelivered',
        aggregateType: 'Fulfillment',
        aggregateId: 'fo-001',
        status: 'pending',
      }),
    );
  });
});

describe('FulfillmentEventsConsumer.handleCoreOrderCancelled', () => {
  it('cancellationScope=partial → 즉시 return, DB insert 없음', async () => {
    const { service, insertMock } = makeService();
    const payload = { ...BASE_PAYLOAD, cancellationScope: 'partial' as const };
    await service.handleCoreOrderCancelled(payload, ENVELOPE);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('cancellationScope=full → inbox_events에 CoreOrderCancelled 저장', async () => {
    const { service, insertMock, valuesMock } = makeService();
    await service.handleCoreOrderCancelled(BASE_PAYLOAD, ENVELOPE);
    expect(insertMock).toHaveBeenCalledWith(inboxEvents);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CoreOrderCancelled',
        aggregateType: 'Order',
        aggregateId: 'order-001',
        status: 'pending',
      }),
    );
  });

  it('cancellationScope=full + DB insert 실패 → 예외 re-throw', async () => {
    const { service, insertMock } = makeService();
    insertMock.mockReturnValue({ values: jest.fn().mockRejectedValue(new Error('DB unavailable')) });
    await expect(service.handleCoreOrderCancelled(BASE_PAYLOAD, ENVELOPE)).rejects.toThrow('DB unavailable');
  });

  it('partial cancel에 cancelledLines 있어도 DB insert 없음', async () => {
    const { service, insertMock } = makeService();
    const payload = {
      ...BASE_PAYLOAD,
      cancellationScope: 'partial' as const,
      cancelledLines: [{ salesOrderLineId: 'line-1', quantity: 2 }],
    };
    await service.handleCoreOrderCancelled(payload, ENVELOPE);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
