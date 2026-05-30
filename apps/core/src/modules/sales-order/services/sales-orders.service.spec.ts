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

describe('SalesOrdersService.update accepted contract immutability', () => {
  const salesOrderId = '22222222-2222-4222-8222-222222222222';

  function rows<T>(value: T[]): T[] & { limit: (count: number) => Promise<T[]> } {
    const result = [...value] as T[] & { limit: (count: number) => Promise<T[]> };
    result.limit = (count: number) => Promise.resolve(result.slice(0, count));
    return result;
  }

  function makeService() {
    const originalShippingAddress = {
      recipientName: 'Jane Kim',
      phone: '010-0000-0000',
      postalCode: '12345',
      roadAddress: 'Seoul',
      detailAddress: '101',
    };
    const state = {
      salesOrders: [
        {
          id: salesOrderId,
          status: 'pending',
          salesChannel: 'medusa',
          channelOrderId: 'medusa_order_1',
          customerName: 'Jane Kim',
          customerEmail: 'jane@example.com',
          customerPhone: '010-0000-0000',
          shippingAddress: originalShippingAddress,
          totalAmount: 10000,
          shippingFee: 3000,
          memo: null,
          processedAt: null,
        },
      ] as Array<Record<string, any>>,
      salesOrderLines: [
        {
          id: 'line-1',
          salesOrderId,
          variantId: 'variant-1',
          productName: 'Original Product',
          quantity: 1,
          unitPrice: 10000,
          totalPrice: 10000,
        },
      ] as Array<Record<string, any>>,
    };

    const selectRowsFor = (table: unknown) => {
      if (table === wmsTables.salesOrders) return state.salesOrders;
      if (table === wmsTables.salesOrderLines) return state.salesOrderLines;
      return [];
    };

    const tx: any = {
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
            return [];
          },
        }),
      })),
    };

    const db = { db: { transaction: jest.fn((fn) => fn(tx)) } };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const service = new SalesOrdersService(
      db as any,
      {} as any,
      outbox as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, state, outbox };
  }

  it('rejects contract field mutation for an accepted channel sales order', async () => {
    const { service, state, outbox } = makeService();

    await expect(service.update(salesOrderId, { totalAmount: 12000 })).rejects.toThrow(
      'Accepted SalesOrder contract fields are immutable: totalAmount',
    );

    expect(state.salesOrders[0].totalAmount).toBe(10000);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects direct line replacement shortcuts for an accepted channel sales order', async () => {
    const { service, state, outbox } = makeService();

    await expect(
      service.update(salesOrderId, { items: [{ skuId: 'sku-1', quantity: 2, unitPrice: 5000 }] } as any),
    ).rejects.toThrow('Accepted SalesOrder contract fields are immutable: items');

    expect(state.salesOrderLines[0].quantity).toBe(1);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('allows memo updates without clearing accepted contract fields', async () => {
    const { service, state, outbox } = makeService();

    const updated = await service.update(salesOrderId, { memo: 'operator note' });

    expect(updated).toMatchObject({
      id: salesOrderId,
      totalAmount: 10000,
      shippingFee: 3000,
      memo: 'operator note',
      lines: expect.arrayContaining([expect.objectContaining({ quantity: 1 })]),
    });
    expect(state.salesOrders[0]).toMatchObject({
      customerName: 'Jane Kim',
      shippingAddress: expect.objectContaining({ roadAddress: 'Seoul' }),
      totalAmount: 10000,
      shippingFee: 3000,
      memo: 'operator note',
    });
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it('ignores OrderModified contract changes at the service boundary', async () => {
    const { service, state, outbox } = makeService();

    const updated = await service.updateFromEvent(salesOrderId, {
      totalAmount: 12000,
      shippingAddress: {
        recipientName: 'Jane Kim',
        phone: '010-0000-0000',
        postalCode: '54321',
        roadAddress: 'Changed',
        detailAddress: '202',
      },
      items: [
        {
          orderItemId: 'line-1',
          skuId: 'variant-1',
          masterId: 'master-1',
          versionId: 'version-1',
          variantId: 'variant-1',
          productName: 'Changed Product',
          channelProductId: 'variant-1',
          quantity: 2,
          unitPrice: 6000,
          totalPrice: 12000,
        },
      ],
    });

    expect(updated).toMatchObject({
      id: salesOrderId,
      totalAmount: 10000,
      shippingAddress: expect.objectContaining({ roadAddress: 'Seoul' }),
      lines: expect.arrayContaining([expect.objectContaining({ quantity: 1 })]),
    });
    expect(state.salesOrders[0].totalAmount).toBe(10000);
    expect(state.salesOrderLines[0].quantity).toBe(1);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
