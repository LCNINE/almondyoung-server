import { wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrderAmendmentsService } from './sales-order-amendments.service';
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

    const db = { db: { ...tx, transaction: jest.fn((fn) => fn(tx)) } };
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

    const db = { db: { ...tx, transaction: jest.fn((fn) => fn(tx)) } };
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

describe('SalesOrderAmendmentsService.create', () => {
  const salesOrderId = '33333333-3333-4333-8333-333333333333';
  const lineId = '44444444-4444-4444-8444-444444444444';
  const amendmentId = '55555555-5555-4555-8555-555555555555';

  function rows<T>(value: T[]): T[] & { limit: (count: number) => Promise<T[]> } {
    const result = [...value] as T[] & { limit: (count: number) => Promise<T[]> };
    result.limit = (count: number) => Promise.resolve(result.slice(0, count));
    return result;
  }

  function makeService() {
    const now = new Date('2026-05-30T05:30:00.000Z');
    const state = {
      salesOrders: [{ id: salesOrderId, status: 'confirmed' }],
      salesOrderLines: [
        {
          id: lineId,
          salesOrderId,
          variantId: '66666666-6666-4666-8666-666666666666',
          productName: 'Accepted Product',
          quantity: 2,
          unitPrice: 5000,
          totalPrice: 10000,
        },
      ] as Array<Record<string, any>>,
      salesOrderAmendments: [] as Array<Record<string, any>>,
      businessLinks: [] as Array<Record<string, any>>,
    };

    const selectRowsFor = (table: unknown) => {
      if (table === wmsTables.salesOrders) return state.salesOrders;
      if (table === wmsTables.salesOrderLines) return state.salesOrderLines;
      if (table === wmsTables.salesOrderAmendments) return state.salesOrderAmendments;
      return [];
    };

    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => rows(selectRowsFor(table)),
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, any>) => {
          if (table === wmsTables.salesOrderAmendments) {
            const row = {
              id: amendmentId,
              ...values,
              occurredAt: values.occurredAt ?? now,
              createdAt: now,
              updatedAt: now,
            };
            state.salesOrderAmendments.push(row);
            return { returning: jest.fn().mockResolvedValue([row]) };
          }
          if (table === wmsTables.businessLinks) {
            state.businessLinks.push({ id: 'business-link-1', ...values });
            return Promise.resolve();
          }
          return { returning: jest.fn().mockResolvedValue([]) };
        },
      })),
      update: jest.fn(),
    };

    const db = { db: { ...tx, transaction: jest.fn((fn) => fn(tx)) } };
    const service = new SalesOrderAmendmentsService(db as any);

    return { service, state, tx };
  }

  it('records typed deltas and links the amendment without mutating original SalesOrder lines', async () => {
    const { service, state, tx } = makeService();
    const originalLines = state.salesOrderLines.map((line) => ({ ...line }));

    const amendment = await service.create({
      salesOrderId,
      amendmentKind: 'commercial',
      decision: 'approved',
      reasonCode: 'CS_PRODUCT_SWAP',
      deltas: [
        {
          type: 'quantity_correction',
          salesOrderLineId: lineId,
          quantityDelta: -1,
          reason: 'Customer requested quantity correction',
        },
      ],
    });

    expect(amendment).toMatchObject({
      id: amendmentId,
      salesOrderId,
      amendmentKind: 'commercial',
      decision: 'approved',
      deltas: [expect.objectContaining({ type: 'quantity_correction', salesOrderLineId: lineId })],
    });
    expect(state.salesOrderLines).toEqual(originalLines);
    expect(tx.update).not.toHaveBeenCalled();
    expect(state.businessLinks).toEqual([
      expect.objectContaining({
        sourceType: 'sales_order',
        sourceId: salesOrderId,
        targetType: 'sales_order_amendment',
        targetId: amendmentId,
        relationName: 'opened_amendment',
        metadata: expect.objectContaining({
          amendmentKind: 'commercial',
          deltaTypes: ['quantity_correction'],
        }),
      }),
    ]);
  });

  it('rejects commercial deltas in fulfillment-only amendments', async () => {
    const { service } = makeService();

    await expect(
      service.create({
        salesOrderId,
        amendmentKind: 'fulfillment_only',
        deltas: [
          {
            type: 'amount_correction',
            amountDelta: -1000,
          },
        ],
      }),
    ).rejects.toThrow('fulfillment_only amendments cannot include amount_correction deltas');
  });

  it('rejects commercial fields on fulfillment-only correction deltas', async () => {
    const { service } = makeService();

    await expect(
      service.create({
        salesOrderId,
        amendmentKind: 'fulfillment_only',
        deltas: [
          {
            type: 'fulfillment_only_correction',
            fulfillmentInstruction: 'Ship the accepted line separately',
            amountDelta: -1000,
          },
        ],
      }),
    ).rejects.toThrow('fulfillment_only amendments cannot include commercial fields: amountDelta');
  });
});

describe('SalesOrdersService business links', () => {
  const salesOrderId = '33333333-3333-4333-8333-333333333333';
  const amendmentId = '44444444-4444-4444-8444-444444444444';

  function rows<T>(value: T[]): T[] & { limit: (count: number) => Promise<T[]> } {
    const result = [...value] as T[] & { limit: (count: number) => Promise<T[]> };
    result.limit = (count: number) => Promise.resolve(result.slice(0, count));
    return result;
  }

  function makeService() {
    const state = {
      salesOrders: [
        {
          id: salesOrderId,
          status: 'confirmed',
          salesChannel: 'medusa',
          channelOrderId: 'medusa_order_2',
          shippingAddress: {},
          orderDate: new Date('2026-05-30T00:00:00.000Z'),
        },
      ] as Array<Record<string, any>>,
      salesOrderLines: [] as Array<Record<string, any>>,
      businessLinks: [] as Array<Record<string, any>>,
    };

    const selectRowsFor = (table: unknown) => {
      if (table === wmsTables.salesOrders) return state.salesOrders;
      if (table === wmsTables.salesOrderLines) return state.salesOrderLines;
      if (table === wmsTables.businessLinks) return state.businessLinks;
      return [];
    };

    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => rows(selectRowsFor(table)),
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: () => {
            if (table !== wmsTables.businessLinks) return [];
            const inserted = {
              id: `business-link-${state.businessLinks.length + 1}`,
              ...values,
              createdAt: new Date(`2026-05-30T00:0${state.businessLinks.length}:00.000Z`),
              updatedAt: new Date(`2026-05-30T00:0${state.businessLinks.length}:00.000Z`),
            };
            state.businessLinks.push(inserted);
            return [inserted];
          },
        }),
      })),
    };

    const db = { db: { ...tx, transaction: jest.fn((fn) => fn(tx)) } };
    const service = new SalesOrdersService(db as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    return { service, state, tx };
  }

  it('links different entity types to the same SalesOrder without foreign-key ownership', async () => {
    const { service, state } = makeService();

    await service.createBusinessLink(salesOrderId, {
      relationName: 'opened_amendment',
      target: { type: 'sales_order_amendment', id: amendmentId },
      occurredAt: '2026-05-30T01:00:00.000Z',
      metadata: { reason: 'customer_request' },
    });
    await service.createBusinessLink(salesOrderId, {
      relationName: 'caused_refund',
      target: { type: 'wallet_refund', externalRef: 'wallet:refund:rf_123' },
      occurredAt: '2026-05-30T02:00:00.000Z',
      metadata: { amount: 3000 },
    });

    expect(state.businessLinks).toHaveLength(2);
    expect(state.businessLinks[0]).toMatchObject({
      sourceType: 'sales_order',
      sourceId: salesOrderId,
      targetType: 'sales_order_amendment',
      targetId: amendmentId,
      targetExternalRef: null,
    });
    expect(state.businessLinks[1]).toMatchObject({
      sourceType: 'sales_order',
      sourceId: salesOrderId,
      targetType: 'wallet_refund',
      targetId: null,
      targetExternalRef: 'wallet:refund:rf_123',
    });

    const detail = await service.getOne(salesOrderId);

    expect(detail?.businessTimeline).toEqual([
      expect.objectContaining({
        relationName: 'opened_amendment',
        direction: 'outbound',
        linkedEntity: { type: 'sales_order_amendment', id: amendmentId, externalRef: null },
      }),
      expect.objectContaining({
        relationName: 'caused_refund',
        direction: 'outbound',
        linkedEntity: { type: 'wallet_refund', id: null, externalRef: 'wallet:refund:rf_123' },
      }),
    ]);
  });
});
