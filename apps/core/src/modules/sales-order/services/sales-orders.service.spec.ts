import { wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from './sales-orders.service';

describe('SalesOrdersService.cancel fulfillment backlog lifecycle', () => {
  const salesOrderId = '11111111-1111-1111-1111-111111111111';

  function rows<T>(value: T[]): T[] & { limit: (count: number) => Promise<T[]> } {
    const result = [...value] as T[] & { limit: (count: number) => Promise<T[]> };
    result.limit = (count: number) => Promise.resolve(result.slice(0, count));
    return result;
  }

  function makeService(status: 'confirmed' | 'cancelled') {
    const state = {
      salesOrders: [{ id: salesOrderId, status, channelOrderId: 'channel-order-1' }],
      salesOrderLines: [] as Array<Record<string, any>>,
      fulfillmentOrders: [] as Array<Record<string, any>>,
    };

    const selectRowsFor = (table: unknown) => {
      if (table === wmsTables.salesOrders) return state.salesOrders;
      if (table === wmsTables.salesOrderLines) return state.salesOrderLines;
      if (table === wmsTables.fulfillmentOrders) return state.fulfillmentOrders;
      return [];
    };

    const tx: any = {
      execute: jest.fn().mockResolvedValue([]),
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => rows(selectRowsFor(table)),
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            if (table === wmsTables.salesOrders) {
              state.salesOrders = state.salesOrders.map((row) => ({ ...row, ...set }));
            }
            if (table === wmsTables.fulfillmentOrders) {
              state.fulfillmentOrders = state.fulfillmentOrders.map((row) => ({ ...row, ...set }));
            }
            return [];
          },
        }),
      })),
    };

    const db = { db: { transaction: jest.fn((fn) => fn(tx)) } };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const reservationLifecycle = {
      handleFulfillmentOrderStatusChange: jest.fn().mockResolvedValue(undefined),
    };
    const backlog = {
      closeOpenForSalesOrder: jest.fn().mockResolvedValue(1),
    };

    const service = new SalesOrdersService(
      db as any,
      {} as any,
      outbox as any,
      reservationLifecycle as any,
      {} as any,
      {} as any,
      backlog as any,
    );

    return { service, tx, state, outbox, backlog };
  }

  it('closes open fulfillment creation backlog when cancelling an active order', async () => {
    const { service, tx, state, backlog } = makeService('confirmed');

    await service.cancel(salesOrderId);

    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(state.salesOrders[0].status).toBe('cancelled');
    expect(backlog.closeOpenForSalesOrder).toHaveBeenCalledWith(salesOrderId, tx);
  });

  it('also closes open backlog when cancel is retried for an already-cancelled order', async () => {
    const { service, tx, backlog, outbox } = makeService('cancelled');

    await service.cancel(salesOrderId);

    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(backlog.closeOpenForSalesOrder).toHaveBeenCalledWith(salesOrderId, tx);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
