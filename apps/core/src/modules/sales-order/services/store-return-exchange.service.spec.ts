import { BadRequestException, ConflictException } from '@nestjs/common';
import { inventoryTables, returnExchangeTables, wmsTables } from '../../inventory/schema/inventory.schema';
import { StoreReturnExchangeService } from './store-return-exchange.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CUSTOMER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LINE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const RR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const SHIPMENT_ID = '11111111-1111-4111-8111-111111111111';
const SHIPMENT_LINE_ID = '22222222-2222-4222-8222-222222222222';
const DISPATCH_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const FULFILLMENT_ORDER_ITEM_ID = '44444444-4444-4444-8444-444444444444';

function makeSo(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerId: CUSTOMER_ID,
    status: 'delivered',
    ...overrides,
  };
}

function makeReturnRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: RR_ID,
    salesOrderId: ORDER_ID,
    customerId: CUSTOMER_ID,
    status: 'requested',
    reasonCode: 'defective',
    reasonDetail: null,
    adminNote: null,
    decidedAt: null,
    collectedAt: null,
    completedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeExchangeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: ER_ID,
    salesOrderId: ORDER_ID,
    customerId: CUSTOMER_ID,
    status: 'requested',
    reasonCode: 'defective',
    reasonDetail: null,
    adminNote: null,
    decidedAt: null,
    completedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeWalletClient() {
  return { refundByIntent: jest.fn() };
}

function terminalRows(rows: unknown[]): Record<string, unknown> {
  const self: Record<string, unknown> = {
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    offset: () => terminalRows(rows),
    orderBy: () => terminalRows(rows),
    where: () => terminalRows(rows),
    innerJoin: () => terminalRows(rows),
    leftJoin: () => terminalRows(rows),
    groupBy: () => terminalRows(rows),
    for: () => terminalRows(rows),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return self;
}

function makeEligibleReturnTxSelect(
  createdItem: Record<string, unknown>,
  options: {
    attemptStatus?: string;
    delivered?: boolean;
    shippedQuantity?: number;
    claimedQuantity?: number;
    purchasedQuantity?: number;
    salesOrderId?: string;
    salesOrderLineId?: string;
    callOrder?: string[];
  } = {},
) {
  return jest.fn(() => ({
    from: (table: unknown) => {
      if (table === wmsTables.dispatchAttempts) options.callOrder?.push('attempt');
      if (table === wmsTables.shipmentLines) options.callOrder?.push('line');
      if (table === wmsTables.shipmentTracking) options.callOrder?.push('tracking');
      if (table === wmsTables.dispatchAttemptSources) options.callOrder?.push('sources');
      if (table === returnExchangeTables.returnRequestItems) options.callOrder?.push('claims/items');
      if (table === wmsTables.dispatchAttempts) {
        return terminalRows([
          { id: DISPATCH_ATTEMPT_ID, shipmentId: SHIPMENT_ID, status: options.attemptStatus ?? 'dispatched' },
        ]);
      }
      if (table === wmsTables.shipmentLines) {
        return terminalRows([
          {
            id: SHIPMENT_LINE_ID,
            shipmentId: SHIPMENT_ID,
            fulfillmentOrderItemId: FULFILLMENT_ORDER_ITEM_ID,
            salesOrderId: options.salesOrderId ?? ORDER_ID,
            salesOrderLineId: options.salesOrderLineId ?? LINE_ID,
          },
        ]);
      }
      if (table === wmsTables.fulfillmentOrderItems) {
        return terminalRows([{ id: FULFILLMENT_ORDER_ITEM_ID, fulfillmentOrderId: 'fo-1' }]);
      }
      if (table === wmsTables.salesOrderLines) {
        return terminalRows([{ id: LINE_ID, quantity: options.purchasedQuantity ?? 5 }]);
      }
      if (table === wmsTables.shipmentTracking) {
        return terminalRows(options.delivered === false ? [] : [{ id: 'delivered-event' }]);
      }
      if (table === wmsTables.dispatchAttemptSources) {
        return terminalRows([{ quantity: String(options.shippedQuantity ?? 1) }]);
      }
      if (table === returnExchangeTables.returnRequestItems) {
        return {
          ...terminalRows([createdItem]),
          // Eligibility aggregation sees no pre-existing exact-attempt claim.
          innerJoin: () => terminalRows(options.claimedQuantity ? [{ quantity: String(options.claimedQuantity) }] : []),
        };
      }
      return terminalRows([]);
    },
  }));
}

// ── Mock DB builder ───────────────────────────────────────────────────────────

/**
 * Builds a minimal Drizzle mock whose `select().from(table).where(...).limit(n)`
 * chain is driven by a per-table lookup function supplied by each test.
 *
 * Supports the `.innerJoin(...).where(...).groupBy(...)` chain used by
 * `assertReturnQuantitiesAvailable` / `assertExchangeQuantitiesAvailable`.
 *
 * The `transaction` mock simply calls `fn(tx)` so the inner transaction body
 * executes synchronously against the same mock surface.
 */
function makeMockDb(selectRowsFor: (table: unknown) => unknown[]) {
  // Terminal chain that holds a resolved row set and supports every tail call.
  // A chainable select mock.
  function makeSelect() {
    return jest.fn(() => ({
      from: (table: unknown) => terminalRows(selectRowsFor(table)),
    }));
  }

  // A minimal `update` mock.
  const makeUpdate = () =>
    jest.fn(() => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          returning: jest.fn().mockResolvedValue([]),
        }),
      }),
    }));

  // A minimal `insert` mock.
  const makeInsert = () =>
    jest.fn((/* table */) => ({
      values: jest.fn((vals: Record<string, unknown>) => ({
        returning: jest.fn().mockResolvedValue([{ id: 'attempt-generated', ...vals }]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      })),
    }));

  const tx: Record<string, unknown> = {
    select: makeSelect(),
    update: makeUpdate(),
    insert: makeInsert(),
    execute: jest.fn().mockResolvedValue([{ id: FULFILLMENT_ORDER_ITEM_ID }]),
  };

  const db = {
    db: {
      select: makeSelect(),
      update: makeUpdate(),
      insert: makeInsert(),
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    },
    _tx: tx,
  };

  return db;
}

// ── createReturnRequest tests ─────────────────────────────────────────────────

describe('StoreReturnExchangeService.createReturnRequest', () => {
  const baseDto = {
    lines: [
      {
        salesOrderLineId: LINE_ID,
        shipmentLineId: SHIPMENT_LINE_ID,
        dispatchAttemptId: DISPATCH_ATTEMPT_ID,
        quantity: 1,
      },
    ],
    reasonCode: 'defective' as const,
  };

  it('throws BadRequestException when salesOrderLineId does not belong to order', async () => {
    // The SO query returns the order.
    // The FO query is not needed (SO status is 'delivered').
    // The active-return-request check returns nothing.
    // The assertLinesBelongToOrder query returns [] (line not found).
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.returnRequests) return []; // no active requests
      if (table === wmsTables.salesOrderLines) return []; // line not found → ownership fails
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when requested quantity exceeds original line quantity', async () => {
    // Line exists with quantity 2; request asks for 5.
    // assertReturnQuantitiesAvailable: originalQty=2, claimedQty=0 → available=2 < 5 → throws.
    const dto = { ...baseDto, lines: [{ ...baseDto.lines[0], quantity: 5 }] };

    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.returnRequests) return []; // no active requests
      if (table === wmsTables.salesOrderLines) return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 2 }];
      // inner-join aggregation for claimed quantities returns nothing (no active claims)
      if (table === returnExchangeTables.returnRequestItems) return [];
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, dto)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when requested quantity exceeds remaining (original minus active claims)', async () => {
    // Original quantity 3; 2 already claimed; request asks for 2 → available=1 < 2.
    const dto = { ...baseDto, lines: [{ ...baseDto.lines[0], quantity: 2 }] };

    // The service makes two separate selects for assertReturnQuantitiesAvailable:
    //   1. from(salesOrderLines) → original quantities
    //   2. from(returnRequestItems).innerJoin(...) → aggregated claimed sums
    // Both queries go through `selectRowsFor`; the second one's table is returnRequestItems.
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.returnRequests) return [];
      if (table === wmsTables.salesOrderLines) {
        return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 3 }];
      }
      if (table === returnExchangeTables.returnRequestItems) {
        // Simulating the aggregated result from the innerJoin+groupBy.
        return [{ salesOrderLineId: LINE_ID, totalClaimed: '2' }];
      }
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, dto)).rejects.toThrow(BadRequestException);
  });

  it('still rejects a partial order when the requested line does not have exact delivered-attempt evidence', async () => {
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo({ status: 'shipped' })];
      if (table === inventoryTables.fulfillmentOrders)
        return [{ id: 'fo-1', salesOrderId: ORDER_ID, status: 'shipped' }];
      if (table === returnExchangeTables.returnRequests) return [];
      if (table === wmsTables.salesOrderLines) {
        return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 1 }];
      }
      return [];
    });
    const tx = (mockDb as any)._tx;
    tx.select = makeEligibleReturnTxSelect({}, { delivered: false });

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(BadRequestException);
  });

  it('succeeds when SO status is delivered', async () => {
    const createdReturnRequest = makeReturnRequest();
    const createdItem = {
      id: 'item-1',
      returnRequestId: RR_ID,
      salesOrderLineId: LINE_ID,
      shipmentLineId: SHIPMENT_LINE_ID,
      dispatchAttemptId: DISPATCH_ATTEMPT_ID,
      quantity: 1,
      reasonCode: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    // The outer db.db.select handles all pre-transaction queries.
    // The tx.select (inside transaction) handles the post-insert items fetch.
    // We build them separately so returnRequestItems returns [] outside tx (no active claims)
    // and [createdItem] inside tx (fetching newly inserted items).
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo({ status: 'delivered' })];
      if (table === returnExchangeTables.returnRequests) return []; // no active requests
      if (table === wmsTables.salesOrderLines) return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 5 }];
      // outer select for inner-join aggregation (claimed qty) → no active claims
      if (table === returnExchangeTables.returnRequestItems) return [];
      return [];
    });

    // Override tx mock to simulate the transaction body correctly.
    const tx = (mockDb as any)._tx;
    tx.insert = jest.fn((table: unknown) => ({
      values: jest.fn(() => {
        if (table === returnExchangeTables.returnRequests) {
          return { returning: jest.fn().mockResolvedValue([createdReturnRequest]) };
        }
        return { returning: jest.fn().mockResolvedValue([]) };
      }),
    }));
    tx.select = makeEligibleReturnTxSelect(createdItem);

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto);

    expect(result.id).toBe(RR_ID);
    expect(result.status).toBe('requested');
    expect(result.salesOrderId).toBe(ORDER_ID);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].salesOrderLineId).toBe(LINE_ID);
  });

  it('allows an exact delivered attempt while the aggregate order/FO is still partial', async () => {
    const createdReturnRequest = makeReturnRequest();
    const createdItem = {
      id: 'item-1',
      returnRequestId: RR_ID,
      salesOrderLineId: LINE_ID,
      shipmentLineId: SHIPMENT_LINE_ID,
      dispatchAttemptId: DISPATCH_ATTEMPT_ID,
      quantity: 1,
      reasonCode: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo({ status: 'processing' })];
      if (table === inventoryTables.fulfillmentOrders)
        return [{ id: 'fo-1', salesOrderId: ORDER_ID, status: 'shipped' }];
      if (table === returnExchangeTables.returnRequests) return [];
      if (table === wmsTables.salesOrderLines) return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 5 }];
      if (table === returnExchangeTables.returnRequestItems) return [];
      return [];
    });

    const tx = (mockDb as any)._tx;
    tx.insert = jest.fn((table: unknown) => ({
      values: jest.fn(() => {
        if (table === returnExchangeTables.returnRequests) {
          return { returning: jest.fn().mockResolvedValue([createdReturnRequest]) };
        }
        return { returning: jest.fn().mockResolvedValue([]) };
      }),
    }));
    tx.select = makeEligibleReturnTxSelect(createdItem);

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto);

    expect(result.id).toBe(RR_ID);
    expect(result.status).toBe('requested');
  });

  it('throws ConflictException when an active return request already exists', async () => {
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.returnRequests) return [{ id: 'existing-rr' }]; // active exists
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(ConflictException);
  });

  it('rejects a recalled exact dispatch attempt after locking its graph but before tracking state', async () => {
    const callOrder: string[] = [];
    const mockDb = makeMockDb(() => []);
    const tx = (mockDb as any)._tx;
    tx.select = makeEligibleReturnTxSelect({}, { attemptStatus: 'recalled', callOrder });
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect((service as any).assertAttemptBasedReturnEligibility(ORDER_ID, baseDto.lines, tx)).rejects.toThrow(
      /recalled/,
    );
    expect(callOrder[0]).toBe('line');
    expect(callOrder).toContain('attempt');
    expect(callOrder).not.toContain('tracking');
  });

  it('rejects an attempt without delivered tracking evidence for that exact attempt', async () => {
    const mockDb = makeMockDb(() => []);
    const tx = (mockDb as any)._tx;
    tx.select = makeEligibleReturnTxSelect({}, { delivered: false });
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect((service as any).assertAttemptBasedReturnEligibility(ORDER_ID, baseDto.lines, tx)).rejects.toThrow(
      /배송 완료된 시도/,
    );
  });

  it('rejects shipment-line ownership mismatches even when the shipment attempt is delivered', async () => {
    const mockDb = makeMockDb(() => []);
    const tx = (mockDb as any)._tx;
    tx.select = makeEligibleReturnTxSelect({}, { salesOrderId: 'other-order' });
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect((service as any).assertAttemptBasedReturnEligibility(ORDER_ID, baseDto.lines, tx)).rejects.toThrow(
      /소유 관계/,
    );
  });

  it('locks the graph and purchased cap, then the attempt, before exact-grain claims', async () => {
    const callOrder: string[] = [];
    const mockDb = makeMockDb(() => []);
    const tx = (mockDb as any)._tx;
    tx.select = makeEligibleReturnTxSelect({}, { shippedQuantity: 2, claimedQuantity: 2, callOrder });
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect((service as any).assertAttemptBasedReturnEligibility(ORDER_ID, baseDto.lines, tx)).rejects.toThrow(
      /반품 가능 수량\(0\)/,
    );
    expect(callOrder[0]).toBe('line');
    expect(callOrder.indexOf('line')).toBeLessThan(callOrder.indexOf('attempt'));
    expect(callOrder.indexOf('claims/items')).toBeLessThan(callOrder.indexOf('attempt'));
    expect(callOrder.indexOf('attempt')).toBeLessThan(callOrder.lastIndexOf('claims/items'));
  });

  it('keeps legacy active exchange claims in the SO-line shared availability gate', async () => {
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.returnRequests) return [];
      if (table === wmsTables.salesOrderLines) return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 1 }];
      if (table === returnExchangeTables.returnRequestItems) return [];
      if (table === returnExchangeTables.exchangeRequestItems) {
        return [{ salesOrderLineId: LINE_ID, totalClaimed: '1' }];
      }
      return [];
    });
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(/반품 가능 수량\(0\)/);
  });
});

// ── createExchangeRequest tests ───────────────────────────────────────────────

describe('StoreReturnExchangeService.createExchangeRequest', () => {
  const baseDto = {
    lines: [{ salesOrderLineId: LINE_ID, quantity: 1 }],
    reasonCode: 'defective' as const,
  };

  it('throws ConflictException when an active exchange request already exists', async () => {
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.exchangeRequests) return [{ id: 'existing-er' }];
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.createExchangeRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(ConflictException);
  });
});

// ── approveReturnRequest tests ────────────────────────────────────────────────

describe('StoreReturnExchangeService.approveReturnRequest', () => {
  it('keeps historical nullable line/attempt links readable', () => {
    const service = new StoreReturnExchangeService({ db: {} } as any, makeWalletClient() as any);
    const response = (service as any).toReturnResponseDto(makeReturnRequest(), [
      {
        salesOrderLineId: LINE_ID,
        shipmentLineId: null,
        dispatchAttemptId: null,
        quantity: 1,
      },
    ]);

    expect(response.items).toEqual([
      expect.objectContaining({ shipmentLineId: null, dispatchAttemptId: null, quantity: 1 }),
    ]);
  });

  it('transitions from requested to approved and returns the updated row', async () => {
    const rr = makeReturnRequest({ status: 'requested' });
    const approvedRr = { ...rr, status: 'approved', decidedAt: new Date(), updatedAt: new Date() };

    const mockDb = makeMockDb((table) => {
      if (table === returnExchangeTables.returnRequests) return [rr];
      return [];
    });

    const tx = (mockDb as any)._tx;
    const receiptItem = {
      salesOrderLineId: LINE_ID,
      shipmentLineId: SHIPMENT_LINE_ID,
      dispatchAttemptId: DISPATCH_ATTEMPT_ID,
      quantity: 1,
    };
    tx.select = jest.fn(() => ({
      from: (table: unknown) => terminalRows(table === returnExchangeTables.returnRequests ? [rr] : [receiptItem]),
    }));
    tx.update = jest.fn(() => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          returning: jest.fn().mockResolvedValue([approvedRr]),
        }),
      }),
    }));
    const insertValues = jest.fn().mockResolvedValue(undefined);
    tx.insert = jest.fn(() => ({
      values: insertValues,
    }));

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.approveReturnRequest(RR_ID, 'admin-1', 'looks good');

    expect(result.status).toBe('approved');
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          returnReceiptItemsVersion: 1,
          returnReceiptItems: [receiptItem],
        }),
      }),
    );
  });

  it('throws ConflictException when status is already approved (not requested)', async () => {
    const rr = makeReturnRequest({ status: 'approved' });

    const mockDb = makeMockDb(() => []);

    const tx = (mockDb as any)._tx;
    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([rr].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([rr]).then(resolve),
        }),
      }),
    }));

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    await expect(service.approveReturnRequest(RR_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });
});

// ── rejectReturnRequest tests ─────────────────────────────────────────────────

describe('StoreReturnExchangeService.rejectReturnRequest', () => {
  it('transitions from requested to rejected', async () => {
    const rr = makeReturnRequest({ status: 'requested' });
    const rejectedRr = { ...rr, status: 'rejected', decidedAt: new Date(), updatedAt: new Date() };

    const mockDb = makeMockDb(() => []);

    const tx = (mockDb as any)._tx;
    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([rr].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([rr]).then(resolve),
        }),
      }),
    }));
    tx.update = jest.fn(() => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          returning: jest.fn().mockResolvedValue([rejectedRr]),
        }),
      }),
    }));
    tx.insert = jest.fn(() => ({
      values: jest.fn().mockResolvedValue(undefined),
    }));

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.rejectReturnRequest(RR_ID, 'admin-1', 'not eligible');

    expect(result.status).toBe('rejected');
  });
});

// ── markCollectionPending tests ───────────────────────────────────────────────

describe('StoreReturnExchangeService.markCollectionPending', () => {
  it('transitions from approved to collection_pending', async () => {
    const rr = makeReturnRequest({ status: 'approved' });
    const updatedRr = { ...rr, status: 'collection_pending', updatedAt: new Date() };

    const mockDb = makeMockDb(() => []);

    const tx = (mockDb as any)._tx;
    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([rr].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([rr]).then(resolve),
        }),
      }),
    }));
    tx.update = jest.fn(() => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          returning: jest.fn().mockResolvedValue([updatedRr]),
        }),
      }),
    }));
    tx.insert = jest.fn(() => ({
      values: jest.fn().mockResolvedValue(undefined),
    }));

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.markCollectionPending(RR_ID, 'admin-1');

    expect(result.status).toBe('collection_pending');
  });
});

// ── markCollected tests ───────────────────────────────────────────────────────

describe('StoreReturnExchangeService.markCollected', () => {
  it('transitions from collection_pending to collected and sets collectedAt', async () => {
    const rr = makeReturnRequest({ status: 'collection_pending' });
    const collectedAt = new Date('2026-06-01T12:00:00.000Z');
    const updatedRr = { ...rr, status: 'collected', collectedAt, updatedAt: new Date() };

    const mockDb = makeMockDb(() => []);

    const tx = (mockDb as any)._tx;
    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([rr].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([rr]).then(resolve),
        }),
      }),
    }));
    tx.update = jest.fn(() => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          returning: jest.fn().mockResolvedValue([updatedRr]),
        }),
      }),
    }));
    tx.insert = jest.fn(() => ({
      values: jest.fn().mockResolvedValue(undefined),
    }));

    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.markCollected(RR_ID, 'admin-1');

    expect(result.status).toBe('collected');
    expect(result.collectedAt).toEqual(collectedAt);
  });
});

// ── completeReturnRequest tests ───────────────────────────────────────────────

describe('StoreReturnExchangeService.completeReturnRequest', () => {
  /**
   * Phase 1(inspected→refund_pending/completed) + attemptReturnRefund(Phase A/B/C) 를
   * 모두 하나의 stateful tx 목으로 태운다. 실제 tx 처럼 update(returnRequests) 결과가
   * 다음 select 에도 반영되도록 currentRr 를 갱신한다(그래야 Phase A 가 Phase 1 의
   * 상태 전이를 보고 refund_pending 가드를 통과함).
   */
  function makeCompleteTx(opts: {
    rr: Record<string, unknown>;
    so: Record<string, unknown>;
    orderLines?: unknown[];
    returnItems?: unknown[];
    maxN?: number;
  }) {
    let currentRr: Record<string, unknown> = { ...opts.rr };
    let attemptSel = 0; // Phase A 의 attempts 조회 순서: 1=pending 조회, 2=max(N) 조회
    const rowsFor = (table: unknown): unknown[] => {
      if (table === returnExchangeTables.returnRequests) return [currentRr];
      if (table === wmsTables.salesOrders) return [opts.so];
      if (table === wmsTables.salesOrderLines) return opts.orderLines ?? [];
      if (table === returnExchangeTables.returnRequestItems) return opts.returnItems ?? [];
      if (table === returnExchangeTables.returnRefundAttempts) {
        attemptSel++;
        return attemptSel === 1 ? [] : [{ maxN: opts.maxN ?? 0 }];
      }
      return [];
    };
    function terminal(rows: unknown[]): Record<string, unknown> {
      const self: Record<string, unknown> = {
        limit: (n: number) => Promise.resolve(rows.slice(0, n)),
        where: () => terminal(rows),
        orderBy: () => terminal(rows),
        innerJoin: () => terminal(rows),
        leftJoin: () => terminal(rows),
        for: () => terminal(rows),
        then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
      };
      return self;
    }
    const tx = {
      select: jest.fn(() => ({ from: (t: unknown) => terminal(rowsFor(t)) })),
      insert: jest.fn((_t: unknown) => ({
        values: jest.fn((vals: Record<string, unknown>) => {
          const row = { id: 'attempt-1', ...vals };
          return {
            returning: jest.fn().mockResolvedValue([row]),
            then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r),
          };
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            if (table === returnExchangeTables.returnRequests) {
              currentRr = { ...currentRr, ...set };
              return { returning: jest.fn().mockResolvedValue([currentRr]) };
            }
            return { returning: jest.fn().mockResolvedValue([{ ...set }]) };
          },
        }),
      })),
    };
    return tx;
  }

  function makeDbFromCompleteTx(tx: ReturnType<typeof makeCompleteTx>) {
    return { db: { select: tx.select, transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } };
  }

  it('transitions from inspected to completed and sets completedAt', async () => {
    const rr = makeReturnRequest({ status: 'inspected' });
    // return items 없음 → refundAmount=0 → immediateComplete (Wallet 미호출, attemptReturnRefund 미위임).
    const tx = makeCompleteTx({ rr, so: { id: ORDER_ID, walletIntentId: null, totalAmount: 0, shippingFee: 0 } });
    const service = new StoreReturnExchangeService(makeDbFromCompleteTx(tx) as any, makeWalletClient() as any);

    const result = await service.completeReturnRequest(RR_ID, 'admin-1');

    expect(result.status).toBe('completed');
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('stays refund_pending when wallet returns partial_pending (무통장 비동기 처리)', async () => {
    const rr = makeReturnRequest({ status: 'inspected' });
    const tx = makeCompleteTx({
      rr,
      so: { id: ORDER_ID, walletIntentId: 'intent-123' },
      returnItems: [{ quantity: 2, unitPrice: 3000 }],
    });

    const walletClient = makeWalletClient();
    (walletClient.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'partial_pending',
      refunds: [{ refundId: 'refund-1', status: 'PENDING' }],
    });

    const service = new StoreReturnExchangeService(makeDbFromCompleteTx(tx) as any, walletClient as any);

    const result = await service.completeReturnRequest(RR_ID, 'admin-1');

    expect(result.status).toBe('refund_pending');
  });

  it('calls wallet with unitPrice × quantity sum (상품가 기준 환불 정책)', async () => {
    const rr = makeReturnRequest({ status: 'inspected' });
    // 라인1: 2개 × 10000원, 라인2: 1개 × 5000원 → 기대 환불액 25000원
    const tx = makeCompleteTx({
      rr,
      so: { id: ORDER_ID, walletIntentId: 'intent-abc' },
      returnItems: [
        { quantity: 2, unitPrice: 10000 },
        { quantity: 1, unitPrice: 5000 },
      ],
    });

    const walletClient = makeWalletClient();
    (walletClient.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'failed',
      errorCode: 'ERR',
      errorMessage: 'fail',
      determinate: true,
    });

    const service = new StoreReturnExchangeService(makeDbFromCompleteTx(tx) as any, walletClient as any);
    await service.completeReturnRequest(RR_ID, 'admin-1');

    expect(walletClient.refundByIntent).toHaveBeenCalledWith(
      'intent-abc',
      25000,
      expect.objectContaining({ reasonCode: 'RETURN_COMPLETED' }),
    );
  });

  it('transitions to refund_pending and stays there when wallet refund fails', async () => {
    const rr = makeReturnRequest({ status: 'inspected' });
    const tx = makeCompleteTx({
      rr,
      so: { id: ORDER_ID, walletIntentId: 'intent-123' },
      returnItems: [{ quantity: 1, unitPrice: 5000 }],
    });

    const walletClient = makeWalletClient();
    (walletClient.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'failed',
      errorCode: 'REFUND_FAILED',
      errorMessage: 'Wallet error',
      determinate: true,
    });

    const service = new StoreReturnExchangeService(makeDbFromCompleteTx(tx) as any, walletClient as any);

    const result = await service.completeReturnRequest(RR_ID, 'admin-1');

    expect(result.status).toBe('refund_pending');
    expect(walletClient.refundByIntent).toHaveBeenCalledWith(
      'intent-123',
      5000,
      expect.objectContaining({ reasonCode: 'RETURN_COMPLETED' }),
    );
  });
});

// ── approveExchangeRequest + completeExchangeRequest happy path ───────────────

describe('StoreReturnExchangeService exchange happy path', () => {
  function makeTxWithRow(row: Record<string, unknown>, updatedRow: Record<string, unknown>) {
    const mockDb = makeMockDb(() => []);
    const tx = (mockDb as any)._tx;

    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([row].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([row]).then(resolve),
        }),
      }),
    }));
    tx.update = jest.fn(() => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          returning: jest.fn().mockResolvedValue([updatedRow]),
        }),
      }),
    }));
    tx.insert = jest.fn(() => ({
      values: jest.fn().mockResolvedValue(undefined),
    }));

    return mockDb;
  }

  it('approveExchangeRequest: transitions from requested to approved', async () => {
    const er = makeExchangeRequest({ status: 'requested' });
    const approvedEr = { ...er, status: 'approved', decidedAt: new Date(), updatedAt: new Date() };

    const mockDb = makeTxWithRow(er, approvedEr);
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.approveExchangeRequest(ER_ID, 'admin-1', 'ok');

    expect(result.status).toBe('approved');
  });

  it('completeExchangeRequest: transitions from inspected to completed and sets completedAt', async () => {
    const er = makeExchangeRequest({ status: 'inspected' });
    const completedAt = new Date('2026-06-01T18:00:00.000Z');
    const completedEr = { ...er, status: 'completed', completedAt, updatedAt: new Date() };

    const mockDb = makeTxWithRow(er, completedEr);
    const service = new StoreReturnExchangeService(mockDb as any, makeWalletClient() as any);

    const result = await service.completeExchangeRequest(ER_ID, 'admin-1');

    expect(result.status).toBe('completed');
    expect(result.completedAt).toEqual(completedAt);
  });
});

// ── attemptReturnRefund state machine (작업 14) ──────────────────────────────
describe('StoreReturnExchangeService.attemptReturnRefund (상태기계)', () => {
  const INTENT = 'intent-123';
  const SO = { id: ORDER_ID, walletIntentId: INTENT, totalAmount: 5000, shippingFee: 0 };
  const RETURN_ITEMS = [{ salesOrderLineId: LINE_ID, quantity: 1, unitPrice: 5000 }];
  const ORDER_LINES = [{ id: LINE_ID, quantity: 1, unitPrice: 5000, totalPrice: 5000 }];

  // 반품/주문/라인/attempt 테이블별 행을 주입하는 tx 목 (Phase A·C 공용).
  function makeTx(opts: {
    rr: Record<string, unknown>;
    pendingAttempt?: Record<string, unknown> | null;
    maxN?: number;
    onUpdate?: (table: unknown, set: Record<string, unknown>) => void;
    completedRr?: Record<string, unknown>;
    // 경합 시뮬레이션: returnRequests 의 2번째 이후 select(Phase C)에 다른 행을 반환.
    // 미지정 시 기존 동작(항상 opts.rr) 유지 — 기존 테스트 영향 없음.
    rrPhaseC?: Record<string, unknown>;
  }) {
    const insertedAttempts: Record<string, unknown>[] = [];
    let attemptSel = 0; // Phase A 의 attempts 조회 순서: 1=pending 조회, 2=max(N) 조회
    let rrSel = 0; // returnRequests 조회 순서: 1=Phase A, 2번째 이후=Phase C
    const rowsFor = (table: unknown): unknown[] => {
      if (table === returnExchangeTables.returnRequests) {
        rrSel++;
        if (rrSel > 1 && opts.rrPhaseC) return [opts.rrPhaseC];
        return [opts.rr];
      }
      if (table === wmsTables.salesOrders) return [SO];
      if (table === wmsTables.salesOrderLines) return ORDER_LINES;
      if (table === returnExchangeTables.returnRequestItems) return RETURN_ITEMS;
      if (table === returnExchangeTables.returnRefundAttempts) {
        attemptSel++;
        if (opts.pendingAttempt) return [opts.pendingAttempt]; // pending 존재 → 재사용(max 조회 미도달)
        return attemptSel === 1 ? [] : [{ maxN: opts.maxN ?? 0 }]; // 1st=pending 없음, 2nd=max(N)
      }
      return [];
    };
    function terminal(rows: unknown[]): Record<string, unknown> {
      const self: Record<string, unknown> = {
        limit: (n: number) => Promise.resolve(rows.slice(0, n)),
        where: () => terminal(rows),
        orderBy: () => terminal(rows),
        innerJoin: () => terminal(rows),
        leftJoin: () => terminal(rows),
        for: () => terminal(rows),
        then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
      };
      return self;
    }
    return {
      select: jest.fn(() => ({ from: (t: unknown) => terminal(rowsFor(t)) })),
      // _insertedAttempts 는 returnRefundAttempts 테이블 INSERT 만 추적 (규율 1 검증용).
      // businessLinks 감사로그 insert(Phase C, 모든 decision 에서 발생)는 별개 — 섞이면 "N 증가 없음" 단언이 깨짐.
      insert: jest.fn((table: unknown) => ({
        values: jest.fn((vals: Record<string, unknown>) => {
          if (table === returnExchangeTables.returnRefundAttempts) {
            const row = { id: `attempt-${insertedAttempts.length + 1}`, ...vals };
            insertedAttempts.push(row);
            return {
              returning: jest.fn().mockResolvedValue([row]),
              then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r),
            };
          }
          return {
            returning: jest.fn().mockResolvedValue([{ id: 'link-1', ...vals }]),
            then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r),
          };
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          opts.onUpdate?.(table, set);
          return {
            where: () => ({ returning: jest.fn().mockResolvedValue([opts.completedRr ?? { ...opts.rr, ...set }]) }),
          };
        },
      })),
      _insertedAttempts: insertedAttempts,
    };
  }

  function makeDbFrom(tx: Record<string, unknown>) {
    // retryReturnRefund 초기 조회는 top-level this.db.db.select 를 씀 → tx.select 위임.
    return { db: { select: tx.select, transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } };
  }

  it('신규 attempt: 결정적 key return:{id}:refund:1 로 Wallet 호출', async () => {
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: null, maxN: 0 });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'failed',
      errorCode: 'X',
      errorMessage: 'm',
      determinate: true,
    });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    await service.retryReturnRefund(RR_ID, 'admin-1');

    expect(wallet.refundByIntent).toHaveBeenCalledWith(
      INTENT,
      5000,
      expect.objectContaining({ correlationId: `return:${RR_ID}:refund:1` }),
    );
  });

  it('pending attempt 재사용(복구): 같은 key 재생, N 증가 없음', async () => {
    const pending = {
      id: 'att-1',
      returnRequestId: RR_ID,
      attemptNumber: 1,
      idempotencyKey: `return:${RR_ID}:refund:1`,
      amount: 5000,
      status: 'pending',
    };
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: pending });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'success',
      refunds: [{ refundId: 'r1', status: 'SUCCEEDED' }],
    });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    const result = await service.retryReturnRefund(RR_ID, 'admin-1');

    // 재사용 → 같은 key, 저장된 amount(5000). 신규 INSERT 없음.
    expect(wallet.refundByIntent).toHaveBeenCalledWith(
      INTENT,
      5000,
      expect.objectContaining({ correlationId: `return:${RR_ID}:refund:1` }),
    );
    expect((tx as { _insertedAttempts: unknown[] })._insertedAttempts).toHaveLength(0);
    expect(result.status).toBe('completed');
  });

  it('already_refunded → completed (P1-8 2차 방어)', async () => {
    const pending = {
      id: 'att-1',
      returnRequestId: RR_ID,
      attemptNumber: 1,
      idempotencyKey: `return:${RR_ID}:refund:1`,
      amount: 5000,
      status: 'pending',
    };
    const completedRr = { ...makeReturnRequest({ status: 'completed' }) };
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: pending, completedRr });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'already_refunded',
      errorCode: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
      errorMessage: 'm',
    });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    const result = await service.retryReturnRefund(RR_ID, 'admin-1');
    expect(result.status).toBe('completed');
  });

  it('in_flight(불확정) → refund_pending 유지, attempt pending 유지 (규율 3)', async () => {
    const pending = {
      id: 'att-1',
      returnRequestId: RR_ID,
      attemptNumber: 1,
      idempotencyKey: `return:${RR_ID}:refund:1`,
      amount: 5000,
      status: 'pending',
    };
    const setCalls: Record<string, unknown>[] = [];
    const tx = makeTx({
      rr: makeReturnRequest({ status: 'refund_pending' }),
      pendingAttempt: pending,
      onUpdate: (t, set) => {
        if (t === returnExchangeTables.returnRefundAttempts) setCalls.push(set);
      },
    });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'in_flight',
      errorCode: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      errorMessage: 'm',
    });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    const result = await service.retryReturnRefund(RR_ID, 'admin-1');
    expect(result.status).toBe('refund_pending');
    // attempt status 는 pending 유지 (set 에 status 미포함)
    expect(setCalls.every((s) => s.status === undefined)).toBe(true);
  });

  it('경합: Phase C 진입 시 RR 이 이미 completed 면 stale failed 분류가 attempt 를 뒤집지 않음', async () => {
    // Phase A 시점엔 refund_pending(+pending attempt 재사용)이지만, Wallet 호출(Phase B) 동안
    // 동시 success 가 이미 RR 을 completed 로 만들었다고 가정 → Phase C select 는 completed 를 본다.
    // 가드가 없으면 stale determinate-failed 분류가 attempt 를 failed 로 뒤집어 이중환불 경로(N+1)를 연다.
    const pending = {
      id: 'att-1',
      returnRequestId: RR_ID,
      attemptNumber: 1,
      idempotencyKey: `return:${RR_ID}:refund:1`,
      amount: 5000,
      status: 'pending',
    };
    const setCalls: Record<string, unknown>[] = [];
    const tx = makeTx({
      rr: makeReturnRequest({ status: 'refund_pending' }),
      pendingAttempt: pending,
      rrPhaseC: makeReturnRequest({ status: 'completed' }),
      onUpdate: (t, set) => {
        if (t === returnExchangeTables.returnRefundAttempts) setCalls.push(set);
      },
    });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({
      kind: 'failed',
      errorCode: 'ERR',
      errorMessage: 'm',
      determinate: true,
    });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    // attemptReturnRefund 는 private — retryReturnRefund 의 outer refund_pending 가드(추가 select 1회)를
    // 거치지 않고 Phase A/B/C 만 정확히 재현하기 위해 직접 호출.
    const result = await (
      service as unknown as {
        attemptReturnRefund: (id: string, adminId: string) => Promise<{ status: string }>;
      }
    ).attemptReturnRefund(RR_ID, 'admin-1');

    expect(result.status).toBe('completed');
    // 경합 가드로 인해 attempt 를 failed 로 뒤집는 update(set.status==='failed')가 호출되지 않아야 함.
    expect(setCalls.some((s) => s.status === 'failed')).toBe(false);
  });

  it('walletIntentId 없으면 BadRequestException', async () => {
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }) });
    (tx.select as jest.Mock).mockImplementation(() => ({
      from: (t: unknown) => {
        const rows =
          t === wmsTables.salesOrders
            ? [{ id: ORDER_ID, walletIntentId: null }]
            : [makeReturnRequest({ status: 'refund_pending' })];
        const term = (r: unknown[]): Record<string, unknown> => ({
          limit: (n: number) => Promise.resolve(r.slice(0, n)),
          where: () => term(r),
          for: () => term(r),
          orderBy: () => term(r),
          then: (res: (v: unknown[]) => unknown) => Promise.resolve(r).then(res),
        });
        return term(rows);
      },
    }));
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, makeWalletClient() as never);
    await expect(service.retryReturnRefund(RR_ID, 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('refund_pending 아니면 ConflictException', async () => {
    const tx = makeTx({ rr: makeReturnRequest({ status: 'inspected' }) });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, makeWalletClient() as never);
    await expect(service.retryReturnRefund(RR_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });
});

// ── calculateReturnRefund (P1-10) tests ───────────────────────────────────────
describe('StoreReturnExchangeService.calculateReturnRefund (P1-10 기준 통일)', () => {
  // private 메서드 → 인스턴스 통해 호출 (기존 스펙의 private 접근 관행과 동일)
  function calc(service: StoreReturnExchangeService, ...args: unknown[]): number {
    return (service as unknown as { calculateReturnRefund: (...a: unknown[]) => number }).calculateReturnRefund(
      ...args,
    );
  }

  it('할인 라인 부분반품 시 분자도 totalPrice 기준으로 비례(과대환불 없음)', () => {
    const service = new StoreReturnExchangeService({ db: {} } as never, {} as never);
    // 라인A: qty2 unitPrice 10000 이나 totalPrice 12000(주문할인 반영, 8000 할인)
    // 라인B: qty1 unitPrice 5000 totalPrice 5000
    // 주문 totalAmount 17000, 배송비 0 → productSubtotal 17000
    // 라인A 1개만 반품: 분모=12000+5000=17000, 라인A 무게=12000, 반품비중=1/2 → 6000
    // 반품액 = round(6000 * 17000 / 17000) = 6000
    const returnItems = [{ salesOrderLineId: 'A', quantity: 1, unitPrice: 10000 }];
    const allLines = [
      { id: 'A', quantity: 2, unitPrice: 10000, totalPrice: 12000 },
      { id: 'B', quantity: 1, unitPrice: 5000, totalPrice: 5000 },
    ];
    expect(calc(service, returnItems, allLines, 17000, 0)).toBe(6000);
  });

  it('할인 없는 라인은 기존과 동일(unitPrice×qty = totalPrice)', () => {
    const service = new StoreReturnExchangeService({ db: {} } as never, {} as never);
    const returnItems = [{ salesOrderLineId: 'A', quantity: 1, unitPrice: 10000 }];
    const allLines = [
      { id: 'A', quantity: 2, unitPrice: 10000, totalPrice: 20000 },
      { id: 'B', quantity: 1, unitPrice: 5000, totalPrice: 5000 },
    ];
    // 분모 25000, 라인A 무게 20000, 반품비중 1/2 → 10000; productSubtotal 25000
    // round(10000 * 25000 / 25000) = 10000
    expect(calc(service, returnItems, allLines, 25000, 0)).toBe(10000);
  });
});
