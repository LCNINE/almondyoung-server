import { FulfillmentEventsConsumer } from './fulfillment-events.consumer';
import { inboxEvents } from '../schema';
import type { SalesOrderCancelledPayload } from '@packages/event-contracts/streams';

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
