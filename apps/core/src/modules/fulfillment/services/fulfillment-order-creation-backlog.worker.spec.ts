import { BadRequestException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentOrderCreationBacklogWorker } from './fulfillment-order-creation-backlog.worker';

describe('FulfillmentOrderCreationBacklogWorker', () => {
  const salesOrderId = '11111111-1111-1111-1111-111111111111';
  const backlogId = '22222222-2222-2222-2222-222222222222';
  const warehouseId = '33333333-3333-3333-3333-333333333333';

  function makeTx(options: { salesOrder?: Record<string, any>; fulfillmentOrder?: Record<string, any> } = {}) {
    const salesOrder = options.salesOrder ?? {
      id: salesOrderId,
      shippingAddress: { recipientName: 'R' },
    };

    const selectRowsFor = (table: unknown) => {
      if (table === wmsTables.salesOrders) return salesOrder ? [salesOrder] : [];
      if (table === wmsTables.fulfillmentOrders) {
        return options.fulfillmentOrder ? [options.fulfillmentOrder] : [];
      }
      return [];
    };

    return {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => {
            const rows = selectRowsFor(table);
            return {
              limit: () => rows,
              orderBy: () => ({
                limit: () => rows,
              }),
            };
          },
        }),
      })),
    };
  }

  function makeWorker(
    options: {
      tx?: any;
      backlog?: Record<string, any>;
      fulfillmentOrder?: Record<string, any>;
      createError?: Error;
      requiresPhysicalFulfillmentOrder?: boolean;
      requiresPhysicalFulfillmentOrderError?: Error;
    } = {},
  ) {
    const tx = options.tx ?? makeTx();
    const db = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const backlog = {
      claimPending: jest.fn(),
      findById: jest.fn().mockResolvedValue({
        id: backlogId,
        salesOrderId,
        status: 'processing',
        attempts: 1,
        ...(options.backlog ?? {}),
      }),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markNotRequired: jest.fn().mockResolvedValue(undefined),
      markAwaitingMatching: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const fulfillments = {
      requiresPhysicalFulfillmentOrder: jest.fn().mockImplementation(async () => {
        if (options.requiresPhysicalFulfillmentOrderError) throw options.requiresPhysicalFulfillmentOrderError;
        return options.requiresPhysicalFulfillmentOrder ?? true;
      }),
      create: jest.fn().mockImplementation(async () => {
        if (options.createError) throw options.createError;
        return options.fulfillmentOrder ?? { id: 'fo-1', status: 'ready' };
      }),
    };
    const warehouses = {
      getDefaultId: jest.fn(() => warehouseId),
    };

    const worker = new FulfillmentOrderCreationBacklogWorker(
      db as any,
      backlog as any,
      fulfillments as any,
      warehouses as any,
    );

    return { worker, tx, db, backlog, fulfillments, warehouses };
  }

  it('creates a fulfillment order and completes the backlog', async () => {
    const { worker, backlog, fulfillments, warehouses } = makeWorker();

    await worker.processOne(backlogId);

    expect(fulfillments.create).toHaveBeenCalledWith(
      {
        salesOrderId,
        warehouseId,
        shippingAddress: { recipientName: 'R' },
      },
      expect.anything(),
    );
    expect(warehouses.getDefaultId).toHaveBeenCalledTimes(1);
    expect(backlog.markCompleted).toHaveBeenCalledWith(backlogId, 'fo-1', expect.anything());
  });

  it('marks void-only backlog as not_required without creating a zero-item fulfillment order', async () => {
    const { worker, backlog, fulfillments } = makeWorker({
      requiresPhysicalFulfillmentOrder: false,
    });

    await worker.processOne(backlogId);

    expect(fulfillments.requiresPhysicalFulfillmentOrder).toHaveBeenCalledWith(salesOrderId, expect.anything());
    expect(fulfillments.create).not.toHaveBeenCalled();
    expect(backlog.markNotRequired).toHaveBeenCalledWith(backlogId, expect.anything());
    expect(backlog.markCompleted).not.toHaveBeenCalled();
  });

  it('leaves matching failures in awaiting_matching state', async () => {
    const missingLines = [
      {
        salesOrderLineId: 'line-1',
        variantId: 'variant-1',
        reason: 'NO_PRODUCT_SKU_MATCHING',
      },
    ];
    const { worker, backlog } = makeWorker({
      createError: new BadRequestException({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        missingLines,
      }),
    });

    await worker.processOne(backlogId);

    expect(backlog.markAwaitingMatching).toHaveBeenCalledWith(backlogId, missingLines, expect.anything());
    expect(backlog.markFailed).not.toHaveBeenCalled();
  });

  it('does not create a duplicate fulfillment order when one already exists', async () => {
    const { worker, backlog, fulfillments } = makeWorker({
      tx: makeTx({ fulfillmentOrder: { id: 'fo-existing', salesOrderId } }),
    });

    await worker.processOne(backlogId);

    expect(fulfillments.create).not.toHaveBeenCalled();
    expect(backlog.markCompleted).toHaveBeenCalledWith(backlogId, 'fo-existing', expect.anything());
  });

  it('marks cancelled sales-order backlog as not_required without retrying', async () => {
    const { worker, backlog, fulfillments } = makeWorker({
      tx: makeTx({
        salesOrder: {
          id: salesOrderId,
          status: 'cancelled',
          shippingAddress: { recipientName: 'R' },
        },
      }),
    });

    await worker.processOne(backlogId);

    expect(fulfillments.create).not.toHaveBeenCalled();
    expect(backlog.markNotRequired).toHaveBeenCalledWith(backlogId, expect.anything());
    expect(backlog.markFailed).not.toHaveBeenCalled();
  });

  it('marks a crashed claimed row failed and continues with the rest of the batch', async () => {
    const { worker, backlog, fulfillments } = makeWorker();
    const first = { id: backlogId, attempts: 2 };
    const second = { id: '44444444-4444-4444-4444-444444444444', attempts: 1 };
    const crash = new Error('select boom');

    backlog.claimPending.mockResolvedValue([first, second]);
    backlog.findById.mockImplementation(async (id: string) => {
      if (id === first.id) {
        throw crash;
      }

      return {
        id,
        salesOrderId,
        status: 'processing',
        attempts: 1,
      };
    });

    await worker.processPending();

    expect(backlog.markFailed).toHaveBeenCalledWith(first.id, first.attempts, crash);
    expect(fulfillments.create).toHaveBeenCalledTimes(1);
    expect(backlog.markCompleted).toHaveBeenCalledWith(second.id, 'fo-1', expect.anything());
  });
});
