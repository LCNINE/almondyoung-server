import { BadRequestException, ConflictException } from '@nestjs/common';
import { inventoryTables, returnExchangeTables, wmsTables } from '../../inventory/schema/inventory.schema';
import { StoreReturnExchangeService } from './store-return-exchange.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CUSTOMER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LINE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const RR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

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
  function terminal(rows: unknown[]): Record<string, unknown> {
    const self: Record<string, unknown> = {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      offset: () => terminal(rows),
      orderBy: () => terminal(rows),
      where: () => terminal(rows),
      innerJoin: () => terminal(rows),
      groupBy: () => terminal(rows),
      then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return self;
  }

  // A chainable select mock.
  function makeSelect() {
    return jest.fn(() => ({
      from: (table: unknown) => terminal(selectRowsFor(table)),
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
    jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn().mockResolvedValue([]),
      })),
    }));

  const tx: Record<string, unknown> = {
    select: makeSelect(),
    update: makeUpdate(),
    insert: makeInsert(),
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
    lines: [{ salesOrderLineId: LINE_ID, quantity: 1 }],
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

    const service = new StoreReturnExchangeService(mockDb as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when requested quantity exceeds original line quantity', async () => {
    // Line exists with quantity 2; request asks for 5.
    // assertReturnQuantitiesAvailable: originalQty=2, claimedQty=0 → available=2 < 5 → throws.
    const dto = { ...baseDto, lines: [{ salesOrderLineId: LINE_ID, quantity: 5 }] };

    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo()];
      if (table === returnExchangeTables.returnRequests) return []; // no active requests
      if (table === wmsTables.salesOrderLines) return [{ id: LINE_ID, salesOrderId: ORDER_ID, quantity: 2 }];
      // inner-join aggregation for claimed quantities returns nothing (no active claims)
      if (table === returnExchangeTables.returnRequestItems) return [];
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when requested quantity exceeds remaining (original minus active claims)', async () => {
    // Original quantity 3; 2 already claimed; request asks for 2 → available=1 < 2.
    const dto = { ...baseDto, lines: [{ salesOrderLineId: LINE_ID, quantity: 2 }] };

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

    const service = new StoreReturnExchangeService(mockDb as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when FO exists but none has status completed (shipped-only)', async () => {
    // SO status is NOT 'delivered'; FO only has status 'shipped' (not 'completed').
    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo({ status: 'shipped' })];
      if (table === inventoryTables.fulfillmentOrders) return [{ id: 'fo-1', salesOrderId: ORDER_ID, status: 'shipped' }];
      return [];
    });

    const service = new StoreReturnExchangeService(mockDb as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('succeeds when SO status is delivered', async () => {
    const createdReturnRequest = makeReturnRequest();
    const createdItem = {
      id: 'item-1',
      returnRequestId: RR_ID,
      salesOrderLineId: LINE_ID,
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
    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([createdItem].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([createdItem]).then(resolve),
          orderBy: () => ({
            limit: (n: number) => Promise.resolve([createdItem].slice(0, n)),
            offset: () => ({ limit: (n: number) => Promise.resolve([createdItem].slice(0, n)) }),
          }),
        }),
        innerJoin: () => ({
          where: (_c: unknown) => ({
            groupBy: () => Promise.resolve([]),
            then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
          }),
        }),
        then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([createdItem]).then(resolve),
      }),
    }));

    const service = new StoreReturnExchangeService(mockDb as any);

    const result = await service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto);

    expect(result.id).toBe(RR_ID);
    expect(result.status).toBe('requested');
    expect(result.salesOrderId).toBe(ORDER_ID);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].salesOrderLineId).toBe(LINE_ID);
  });

  it('succeeds when SO status is not delivered but a FO has status completed', async () => {
    const createdReturnRequest = makeReturnRequest();
    const createdItem = {
      id: 'item-1',
      returnRequestId: RR_ID,
      salesOrderLineId: LINE_ID,
      quantity: 1,
      reasonCode: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    const mockDb = makeMockDb((table) => {
      if (table === inventoryTables.salesOrders) return [makeSo({ status: 'processing' })];
      if (table === inventoryTables.fulfillmentOrders)
        return [{ id: 'fo-1', salesOrderId: ORDER_ID, status: 'completed' }];
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
    tx.select = jest.fn(() => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (n: number) => Promise.resolve([createdItem].slice(0, n)),
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([createdItem]).then(resolve),
        }),
        innerJoin: () => ({
          where: (_c: unknown) => ({
            groupBy: () => Promise.resolve([]),
            then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
          }),
        }),
        then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([createdItem]).then(resolve),
      }),
    }));

    const service = new StoreReturnExchangeService(mockDb as any);

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

    const service = new StoreReturnExchangeService(mockDb as any);

    await expect(service.createReturnRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(
      ConflictException,
    );
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

    const service = new StoreReturnExchangeService(mockDb as any);

    await expect(service.createExchangeRequest(ORDER_ID, CUSTOMER_ID, baseDto)).rejects.toThrow(
      ConflictException,
    );
  });
});

// ── approveReturnRequest tests ────────────────────────────────────────────────

describe('StoreReturnExchangeService.approveReturnRequest', () => {
  it('transitions from requested to approved and returns the updated row', async () => {
    const rr = makeReturnRequest({ status: 'requested' });
    const approvedRr = { ...rr, status: 'approved', decidedAt: new Date(), updatedAt: new Date() };

    const mockDb = makeMockDb((table) => {
      if (table === returnExchangeTables.returnRequests) return [rr];
      return [];
    });

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
          returning: jest.fn().mockResolvedValue([approvedRr]),
        }),
      }),
    }));
    tx.insert = jest.fn(() => ({
      values: jest.fn().mockResolvedValue(undefined),
    }));

    const service = new StoreReturnExchangeService(mockDb as any);

    const result = await service.approveReturnRequest(RR_ID, 'admin-1', 'looks good');

    expect(result.status).toBe('approved');
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

    const service = new StoreReturnExchangeService(mockDb as any);

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

    const service = new StoreReturnExchangeService(mockDb as any);

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

    const service = new StoreReturnExchangeService(mockDb as any);

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

    const service = new StoreReturnExchangeService(mockDb as any);

    const result = await service.markCollected(RR_ID, 'admin-1');

    expect(result.status).toBe('collected');
    expect(result.collectedAt).toEqual(collectedAt);
  });
});

// ── completeReturnRequest tests ───────────────────────────────────────────────

describe('StoreReturnExchangeService.completeReturnRequest', () => {
  it('transitions from inspected to completed and sets completedAt', async () => {
    const rr = makeReturnRequest({ status: 'inspected' });
    const completedAt = new Date('2026-06-01T15:00:00.000Z');
    const updatedRr = { ...rr, status: 'completed', completedAt, updatedAt: new Date() };

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

    const service = new StoreReturnExchangeService(mockDb as any);

    const result = await service.completeReturnRequest(RR_ID, 'admin-1');

    expect(result.status).toBe('completed');
    expect(result.completedAt).toEqual(completedAt);
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
    const service = new StoreReturnExchangeService(mockDb as any);

    const result = await service.approveExchangeRequest(ER_ID, 'admin-1', 'ok');

    expect(result.status).toBe('approved');
  });

  it('completeExchangeRequest: transitions from inspected to completed and sets completedAt', async () => {
    const er = makeExchangeRequest({ status: 'inspected' });
    const completedAt = new Date('2026-06-01T18:00:00.000Z');
    const completedEr = { ...er, status: 'completed', completedAt, updatedAt: new Date() };

    const mockDb = makeTxWithRow(er, completedEr);
    const service = new StoreReturnExchangeService(mockDb as any);

    const result = await service.completeExchangeRequest(ER_ID, 'admin-1');

    expect(result.status).toBe('completed');
    expect(result.completedAt).toEqual(completedAt);
  });
});
