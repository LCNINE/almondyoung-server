import { randomUUID } from 'crypto';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, makeInboundReceiptKernel } from '../../inbound/services/__fixtures__/inbound-harness';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { PurchaseOrderHeaderDeriver } from './purchase-order-header.deriver';
import { PurchaseOrderManager } from './purchase-order.manager';
import { PurchaseOrderReader } from './purchase-order.reader';
import { PurchaseOrderReceivingManager } from './purchase-order-receiving.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 발주 수령의 커밋형 두 커넥션 경합 계약 (설계 §12 #6). */
describeIfDb('PurchaseOrderReceivingManager (PostgreSQL concurrency)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let probe: postgres.Sql;
  let db: Database;
  let mgrA: PurchaseOrderReceivingManager;
  let mgrB: PurchaseOrderReceivingManager;
  let poManager: PurchaseOrderManager;
  const fixtures: Fixture[] = [];
  const ACTOR_ID = randomUUID();

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4 });
    probe = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    mgrA = buildReceivingManager(db);
    mgrB = buildReceivingManager(db);
    poManager = buildPurchaseOrderManager(db);
  });

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture) await cleanupFixture(fixture);
    }
  });

  afterAll(async () => {
    await Promise.all([client.end(), probe.end()]);
  });

  function dbServiceFor(database: Database): DbService<typeof wmsSchema> {
    return {
      db: database,
      run: (<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) =>
        tx ? fn(tx) : database.transaction((trx) => fn(trx as unknown as DbTx))) as never,
      // DbService 는 Nest 생명주기 메서드도 갖지만 이 통합 스펙은 db/run 포트만 사용한다.
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildReceivingManager(database: Database): PurchaseOrderReceivingManager {
    const dbService = dbServiceFor(database);
    const reader = new PurchaseOrderReader(dbService);
    return new PurchaseOrderReceivingManager(
      dbService,
      makeInboundReceiptKernel(database),
      new InventoryIdempotencyService(dbService),
      new PurchaseOrderHeaderDeriver(),
      reader,
    );
  }

  function buildPurchaseOrderManager(database: Database): PurchaseOrderManager {
    const dbService = dbServiceFor(database);
    const reader = new PurchaseOrderReader(dbService);
    return new PurchaseOrderManager(dbService, reader, new PurchaseOrderHeaderDeriver());
  }

  interface Fixture {
    poId: string;
    warehouseId: string;
    supplierId: string;
    holderId: string;
    skuA: string;
    skuB: string;
    putawayLocationId: string;
    idempotencyKeys: string[];
  }

  async function seedCommitted(): Promise<Fixture> {
    const suffix = randomUUID();
    const fixture = await db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `cc-po-warehouse-${suffix}` })
        .returning();
      const [supplier] = await tx
        .insert(wmsTables.suppliers)
        .values({ name: `cc-po-supplier-${suffix}`, defaultWarehouseId: warehouse.id })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `cc-po-holder-${suffix}` })
        .returning();
      const [skuA, skuB] = await tx
        .insert(wmsTables.skus)
        .values([
          { name: `cc-po-sku-a-${suffix}`, code: `CC-PO-A-${suffix}`, holderId: holder.id },
          { name: `cc-po-sku-b-${suffix}`, code: `CC-PO-B-${suffix}`, holderId: holder.id },
        ])
        .returning();
      const [putawayLocation] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId: warehouse.id,
          code: `CC-PO-PUT-${suffix.slice(0, 8)}`,
          locationType: 'zone',
          isSystem: false,
          systemRole: null,
          isActive: true,
        })
        .returning();
      const [po] = await tx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: 'domestic',
          supplierId: supplier.id,
          status: 'confirmed',
          sourceWarehouseId: warehouse.id,
          destinationWarehouseId: warehouse.id,
          requiresTransfer: false,
        })
        .returning();
      await tx.insert(wmsTables.purchaseOrderLines).values([
        { poId: po.id, skuId: skuA.id, quantity: 10, status: 'ordered', orderedQty: 10 },
        { poId: po.id, skuId: skuB.id, quantity: 10, status: 'requested' },
      ]);
      return {
        poId: po.id,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        holderId: holder.id,
        skuA: skuA.id,
        skuB: skuB.id,
        putawayLocationId: putawayLocation.id,
        idempotencyKeys: [],
      };
    });
    fixtures.push(fixture);
    return fixture;
  }

  function nextIdempotencyKey(fixture: Fixture): string {
    const key = `cc-po-${randomUUID()}`;
    fixture.idempotencyKeys.push(key);
    return key;
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    await db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      const receipts = await tx
        .select({ id: wmsTables.inboundReceipts.id, journalId: wmsTables.inboundReceipts.journalId })
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.warehouseId, fixture.warehouseId));
      const receiptIds = receipts.map((receipt) => receipt.id);
      const events = await tx
        .select({ journalId: wmsTables.stockEvents.journalId })
        .from(wmsTables.stockEvents)
        .where(
          or(
            eq(wmsTables.stockEvents.fromWarehouseId, fixture.warehouseId),
            eq(wmsTables.stockEvents.toWarehouseId, fixture.warehouseId),
          ),
        );
      const journalIds = [
        ...new Set(
          [...receipts.map((receipt) => receipt.journalId), ...events.map((event) => event.journalId)].filter(
            (id): id is string => id !== null,
          ),
        ),
      ];

      await tx.delete(wmsTables.inboundWorkLogs).where(eq(wmsTables.inboundWorkLogs.warehouseId, fixture.warehouseId));
      await tx
        .delete(wmsTables.purchaseOrderReceiptLines)
        .where(eq(wmsTables.purchaseOrderReceiptLines.poId, fixture.poId));
      if (receiptIds.length > 0) {
        await tx
          .delete(wmsTables.inboundReceiptLines)
          .where(inArray(wmsTables.inboundReceiptLines.receiptId, receiptIds));
      }
      await tx.delete(wmsTables.inboundReceipts).where(eq(wmsTables.inboundReceipts.warehouseId, fixture.warehouseId));
      if (fixture.idempotencyKeys.length > 0) {
        await tx
          .delete(wmsTables.inventoryIdempotencyRequests)
          .where(inArray(wmsTables.inventoryIdempotencyRequests.key, fixture.idempotencyKeys));
      }
      await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.warehouseId, fixture.warehouseId));
      await tx
        .delete(wmsTables.stockEvents)
        .where(
          or(
            eq(wmsTables.stockEvents.fromWarehouseId, fixture.warehouseId),
            eq(wmsTables.stockEvents.toWarehouseId, fixture.warehouseId),
          ),
        );
      if (journalIds.length > 0) {
        await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journalIds));
      }
      await tx.delete(wmsTables.purchaseOrderLines).where(eq(wmsTables.purchaseOrderLines.poId, fixture.poId));
      await tx.delete(wmsTables.purchaseOrders).where(eq(wmsTables.purchaseOrders.id, fixture.poId));
      await tx.delete(wmsTables.suppliers).where(eq(wmsTables.suppliers.id, fixture.supplierId));
      await tx.delete(wmsTables.skus).where(inArray(wmsTables.skus.id, [fixture.skuA, fixture.skuB]));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holderId));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, fixture.warehouseId));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouseId));
    });
  }

  function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function waitUntilBlockedBy(blockerPid: number, expectedWorkers: number, tableName: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    let lastRows: { pid: number; blockers: number[]; waitEventType: string | null; query: string }[] = [];
    while (Date.now() < deadline) {
      const rows = await probe<
        { pid: number; blockers: number[]; waitEventType: string | null; query: string }[]
      >`SELECT pid,
               pg_blocking_pids(pid) AS blockers,
               wait_event_type AS "waitEventType",
               query
          FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND state <> 'idle'`;
      lastRows = rows;
      const rowByPid = new Map(rows.map((row) => [row.pid, row]));
      const isBehindBlocker = (pid: number, visited = new Set<number>()): boolean => {
        if (visited.has(pid)) return false;
        visited.add(pid);
        const row = rowByPid.get(pid);
        if (!row) return false;
        if (row.blockers.includes(blockerPid)) return true;
        return row.blockers.some((blockingPid) => isBehindBlocker(blockingPid, visited));
      };
      const matching = rows.filter(
        (row) =>
          row.waitEventType === 'Lock' &&
          isBehindBlocker(row.pid) &&
          row.query.includes(tableName) &&
          row.query.toLowerCase().includes('for update'),
      );
      if (matching.length >= expectedWorkers) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      `${expectedWorkers} worker(s) did not block on ${tableName} behind pid ${blockerPid}: ${JSON.stringify(lastRows)}`,
    );
  }

  async function runBehindPoBarrier<T, U>(
    fixture: Fixture,
    operationA: () => Promise<T>,
    operationB: () => Promise<U>,
  ): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> {
    const blockerClient = postgres(DATABASE_URL as string, { max: 1 });
    const acquired = deferred();
    const release = deferred();
    const [{ pid: blockerPid }] = await blockerClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
    let operations: [Promise<T>, Promise<U>] | undefined;
    const blocker = blockerClient.begin(async (tx) => {
      await tx`SELECT id FROM purchase_orders WHERE id = ${fixture.poId} FOR UPDATE`;
      acquired.resolve();
      await release.promise;
    });

    try {
      await withTimeout(
        Promise.race([
          acquired.promise,
          blocker.then(() => {
            throw new Error('purchase order blocker completed before the barrier was acquired');
          }),
        ]),
        'purchase order blocker acquisition',
      );
      operations = [operationA(), operationB()];
      let waitFailure: unknown;
      try {
        await waitUntilBlockedBy(blockerPid, 2, 'purchase_orders');
      } catch (error) {
        waitFailure = error;
      } finally {
        release.resolve();
        await withTimeout(blocker, 'purchase order blocker release');
      }
      const outcomes = await withTimeout(Promise.allSettled(operations), 'purchase order contention');
      if (waitFailure instanceof Error) throw waitFailure;
      if (waitFailure) throw new Error('purchase order wait observer rejected with a non-Error value');
      return outcomes;
    } finally {
      release.resolve();
      if (operations) await withTimeout(Promise.allSettled(operations), 'purchase order worker cleanup');
      await withTimeout(blocker, 'purchase order blocker cleanup');
      await blockerClient.end();
    }
  }

  async function runHeldFirst<T, U>(
    heldAction: (tx: DbTx, heldDb: Database) => Promise<T>,
    waitingAction: () => Promise<U>,
  ): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> {
    const heldClient = postgres(DATABASE_URL as string, { max: 1 });
    const heldDb = drizzle(heldClient, { schema: wmsSchema });
    const acquired = deferred();
    const release = deferred();
    const [{ pid: heldPid }] = await heldClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
    let waiting: Promise<U> | undefined;
    const held = heldDb.transaction(async (trx) => {
      const result = await heldAction(trx as unknown as DbTx, heldDb);
      acquired.resolve();
      await release.promise;
      return result;
    });

    try {
      await withTimeout(
        Promise.race([
          acquired.promise,
          held.then(() => {
            throw new Error('held operation completed before the barrier was acquired');
          }),
        ]),
        'held operation acquisition',
      );
      waiting = waitingAction();
      let waitFailure: unknown;
      try {
        await waitUntilBlockedBy(heldPid, 1, 'inbound_receipt_lines');
      } catch (error) {
        waitFailure = error;
      } finally {
        release.resolve();
      }
      const outcomes = await withTimeout(Promise.allSettled([held, waiting]), 'receipt line contention');
      if (waitFailure instanceof Error) throw waitFailure;
      if (waitFailure) throw new Error('receipt line wait observer rejected with a non-Error value');
      return outcomes;
    } finally {
      release.resolve();
      const cleanup: Promise<unknown>[] = [held];
      if (waiting) cleanup.push(waiting);
      await withTimeout(Promise.allSettled(cleanup), 'receipt line worker cleanup');
      await heldClient.end();
    }
  }

  function collectPgCodes(results: PromiseSettledResult<unknown>[]): string[] {
    const codes: string[] = [];
    const collect = (reason: unknown): void => {
      if (typeof reason !== 'object' || reason === null) return;
      if ('code' in reason && typeof reason.code === 'string') codes.push(reason.code);
      if ('cause' in reason) collect(reason.cause);
    };
    for (const result of results) {
      if (result.status === 'rejected') collect(result.reason);
    }
    return codes;
  }

  function expectConflict(reason: unknown): void {
    expect(reason).toBeInstanceOf(ConflictError);
    if (!(reason instanceof ConflictError)) throw reason;
    expect(reason.getHttpStatus()).toBe(HttpStatus.CONFLICT);
  }

  function expectBadRequest(reason: unknown, message: string): void {
    expect(reason).toBeInstanceOf(BadRequestException);
    if (!(reason instanceof BadRequestException)) throw reason;
    expect(reason.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(reason.message).toBe(message);
  }

  async function lineState(fixture: Fixture, skuId = fixture.skuA) {
    const [line] = await db
      .select({
        status: wmsTables.purchaseOrderLines.status,
        orderedQty: wmsTables.purchaseOrderLines.orderedQty,
        receivedQty: wmsTables.purchaseOrderLines.receivedQty,
        closedAt: wmsTables.purchaseOrderLines.closedAt,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, fixture.poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
    return line;
  }

  async function linkedSum(fixture: Fixture): Promise<number> {
    const [row] = await db
      .select({
        quantity: sql<number>`COALESCE(SUM(${wmsTables.inboundReceiptLines.quantity} - ${wmsTables.inboundReceiptLines.canceledQty}), 0)::int`,
      })
      .from(wmsTables.purchaseOrderReceiptLines)
      .innerJoin(
        wmsTables.inboundReceiptLines,
        eq(wmsTables.inboundReceiptLines.id, wmsTables.purchaseOrderReceiptLines.receiptLineId),
      )
      .where(eq(wmsTables.purchaseOrderReceiptLines.poId, fixture.poId));
    return Number(row.quantity);
  }

  async function ledgerQty(fixture: Fixture, locationId?: string): Promise<number> {
    const predicates = [
      eq(wmsTables.stockLedgers.skuId, fixture.skuA),
      eq(wmsTables.stockLedgers.warehouseId, fixture.warehouseId),
    ];
    if (locationId) predicates.push(eq(wmsTables.stockLedgers.locationId, locationId));
    const [row] = await db
      .select({ quantity: sql<number>`COALESCE(SUM(${wmsTables.stockLedgers.qty}), 0)::int` })
      .from(wmsTables.stockLedgers)
      .where(and(...predicates));
    return Number(row.quantity);
  }

  async function receive(manager: PurchaseOrderReceivingManager, fixture: Fixture, quantity: number) {
    return manager.receive(fixture.poId, {
      idempotencyKey: nextIdempotencyKey(fixture),
      warehouseId: fixture.warehouseId,
      lines: [{ skuId: fixture.skuA, quantity }],
    });
  }

  it('같은 라인 동시 수령 2건(7+7 vs 남은 10) — 하나는 409, 합계 초과 없음, 40P01 없음', async () => {
    const fixture = await seedCommitted();
    const results = await runBehindPoBarrier(
      fixture,
      () => receive(mgrA, fixture, 7),
      () => receive(mgrB, fixture, 7),
    );
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(rejected).toHaveLength(1);
    expectConflict(rejected[0]?.reason);
    expect((await lineState(fixture)).receivedQty).toBe(7);
    expect(await linkedSum(fixture)).toBe(7);
    expect(await ledgerQty(fixture)).toBe(7);
    const logs = await db
      .select({ type: wmsTables.inboundWorkLogs.type })
      .from(wmsTables.inboundWorkLogs)
      .where(eq(wmsTables.inboundWorkLogs.warehouseId, fixture.warehouseId));
    expect(logs).toEqual([{ type: 'INBOUND' }]);
    expect(collectPgCodes(results)).not.toContain('40P01');
  });

  it('수령 vs 잔량 포기 — 둘 다 성공하지 않는다(한쪽이 409), 결과 정합', async () => {
    const fixture = await seedCommitted();
    const results = await runBehindPoBarrier(
      fixture,
      () => receive(mgrA, fixture, 10),
      () => mgrB.shortCloseLine(fixture.poId, fixture.skuA, { reason: '공급처 미발송' }, ACTOR_ID),
    );
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expectConflict(rejected[0]?.reason);

    const line = await lineState(fixture);
    if (results[0].status === 'fulfilled') {
      expect(results[1].status).toBe('rejected');
      expect(line).toMatchObject({ receivedQty: 10, closedAt: null });
      expect(await linkedSum(fixture)).toBe(10);
    } else {
      expect(results[1].status).toBe('fulfilled');
      expect(line.receivedQty).toBe(0);
      expect(line.closedAt).toBeInstanceOf(Date);
      expect(await linkedSum(fixture)).toBe(0);
    }
    const [{ receiptCount }] = await db
      .select({ receiptCount: sql<number>`count(*)::int` })
      .from(wmsTables.inboundReceipts)
      .where(eq(wmsTables.inboundReceipts.warehouseId, fixture.warehouseId));
    expect(receiptCount).toBe(results[0].status === 'fulfilled' ? 1 : 0);
    expect(await ledgerQty(fixture)).toBe(results[0].status === 'fulfilled' ? 10 : 0);
    const logs = await db
      .select({ type: wmsTables.inboundWorkLogs.type })
      .from(wmsTables.inboundWorkLogs)
      .where(eq(wmsTables.inboundWorkLogs.warehouseId, fixture.warehouseId));
    expect(logs).toEqual(results[0].status === 'fulfilled' ? [{ type: 'INBOUND' }] : []);
    expect(collectPgCodes(results)).not.toContain('40P01');
  });

  it('수령 vs 라인 실행(다른 SKU) — 둘 다 성공하고 헤더는 confirmed', async () => {
    const fixture = await seedCommitted();
    const results = await runBehindPoBarrier(
      fixture,
      () => receive(mgrA, fixture, 10),
      () => poManager.orderLine(fixture.poId, fixture.skuB, { orderedQty: 5 }, ACTOR_ID),
    );
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) throw rejected.reason;

    const [header] = await db
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, fixture.poId));
    expect(header.status).toBe('confirmed');
    expect(await lineState(fixture)).toMatchObject({ receivedQty: 10, orderedQty: 10 });
    expect(await lineState(fixture, fixture.skuB)).toMatchObject({ status: 'ordered', orderedQty: 5, receivedQty: 0 });
    expect(await linkedSum(fixture)).toBe(10);
    expect(await ledgerQty(fixture)).toBe(10);
    const logs = await db
      .select({ type: wmsTables.inboundWorkLogs.type })
      .from(wmsTables.inboundWorkLogs)
      .where(eq(wmsTables.inboundWorkLogs.warehouseId, fixture.warehouseId));
    expect(logs).toEqual([{ type: 'INBOUND' }]);
    expect(collectPgCodes(results)).not.toContain('40P01');
  });

  it('적치 vs 발주 수령 취소 — 두 선행 순서 모두 회차 라인에서 직렬화되고 카운터가 맞다', async () => {
    for (const first of ['putaway', 'cancel'] as const) {
      const fixture = await seedCommitted();
      const received = await receive(mgrA, fixture, 10);
      const receiptLineId = received.lines[0]?.receiptLineId;
      if (!receiptLineId) throw new Error('seed receive did not return a receipt line');
      const putawayKey = `cc-po-putaway-${randomUUID()}`;
      const cancelKey = nextIdempotencyKey(fixture);

      const putaway = (database: Database, tx: DbTx) =>
        makeInboundReceiptKernel(database).putaway(
          { receiptLineId, toLocationId: fixture.putawayLocationId, quantity: 3, eventKey: putawayKey },
          tx,
        );
      const results =
        first === 'putaway'
          ? await runHeldFirst(
              (tx, heldDb) => putaway(heldDb, tx),
              () => mgrB.cancelReceiptLine(receiptLineId, { idempotencyKey: cancelKey }),
            )
          : await runHeldFirst(
              (tx) => mgrA.cancelReceiptLine(receiptLineId, { idempotencyKey: cancelKey }, tx),
              () => db.transaction((trx) => putaway(db, trx as unknown as DbTx)),
            );

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      if (results[1].status !== 'rejected') throw new Error(`${first}-first contender unexpectedly succeeded`);
      expectBadRequest(
        results[1].reason,
        first === 'putaway'
          ? 'cannot cancel: putaway exists; move all back to origin first'
          : 'quantity exceeds origin available',
      );

      const [receiptLine] = await db
        .select({
          quantity: wmsTables.inboundReceiptLines.quantity,
          canceledQty: wmsTables.inboundReceiptLines.canceledQty,
          putawayQty: wmsTables.inboundReceiptLines.putawayFromOriginQty,
        })
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, receiptLineId));
      const [receipt] = await db
        .select({ status: wmsTables.inboundReceipts.status, totalQuantity: wmsTables.inboundReceipts.totalQuantity })
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.id, received.receiptId));
      const workLogs = await db
        .select({ type: wmsTables.inboundWorkLogs.type })
        .from(wmsTables.inboundWorkLogs)
        .where(eq(wmsTables.inboundWorkLogs.warehouseId, fixture.warehouseId));
      const operationLogs = workLogs.filter((log) => log.type === 'PUTAWAY' || log.type === 'CANCEL');

      if (first === 'putaway') {
        expect(receiptLine).toEqual({ quantity: 10, canceledQty: 0, putawayQty: 3 });
        expect(receipt).toEqual({ status: 'posted', totalQuantity: 10 });
        expect((await lineState(fixture)).receivedQty).toBe(10);
        expect(await linkedSum(fixture)).toBe(10);
        expect(await ledgerQty(fixture)).toBe(10);
        expect(await ledgerQty(fixture, fixture.putawayLocationId)).toBe(3);
        expect(operationLogs).toEqual([{ type: 'PUTAWAY' }]);
      } else {
        expect(receiptLine).toEqual({ quantity: 10, canceledQty: 10, putawayQty: 0 });
        expect(receipt).toEqual({ status: 'voided', totalQuantity: 0 });
        expect((await lineState(fixture)).receivedQty).toBe(0);
        expect(await linkedSum(fixture)).toBe(0);
        expect(await ledgerQty(fixture)).toBe(0);
        expect(await ledgerQty(fixture, fixture.putawayLocationId)).toBe(0);
        expect(operationLogs).toEqual([{ type: 'CANCEL' }]);
      }
      expect(collectPgCodes(results)).not.toContain('40P01');
    }
  });
});
