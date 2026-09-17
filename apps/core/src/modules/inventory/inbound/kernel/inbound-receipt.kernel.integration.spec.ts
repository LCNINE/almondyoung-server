import { seedShipmentLineFor } from '../../../fulfillment/services/__support__/logistics-fixtures';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from './inbound-receipt.kernel';
import { Database, inRollbackTx, makeInboundReceiptKernel } from '../services/__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 입고 커널의 계약. 동작 세부(이벤트·작업 로그 모양)는 InboundService 기준선 스펙이 고정한다 —
 * 여기서는 커널만의 약속을 본다: 호출자 트랜잭션 안에서만 쓴다 · eventKey 를 그대로 쓴다 ·
 * 회차 라인 행을 잠근다(Task 5·6).
 *
 *   npm run test:core:integration:local -- inbound-receipt.kernel
 */
describeIfDb('InboundReceiptKernel (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let kernel: InboundReceiptKernel;

  beforeAll(() => {
    // `max: 1` 은 판별력을 위한 설정이다 — 커널 하위 호출이 `tx` 를 안 넘기고 자기 커넥션을 새로 열면
    // (=호출자 트랜잭션 밖에 쓰면) 그 커넥션도 이 풀에서 빌려야 해서, 유일한 커넥션을 쥔 채 대기 중인
    // `tx` 때문에 즉시 걸린다. 그러면 조용히 트랜잭션 밖에 쓰는 대신 스펙이 멎어(hang) 타임아웃으로 드러난다.
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    kernel = makeInboundReceiptKernel(db);
  });

  afterAll(async () => {
    await client.end();
  });

  let probe: postgres.Sql;
  beforeAll(() => {
    probe = postgres(DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await probe.end();
  });

  class Rollback extends Error {}

  function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
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

  async function seedWarehouseAndSku(tx: DbTx, suffix: string) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `kernel-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `kernel-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'kernel sku', code: `KERNEL-${suffix}`, holderId: holder.id })
      .returning();
    return { warehouseId: warehouse.id, holderId: holder.id, skuId: sku.id };
  }

  describe('recordArrival', () => {
    it('source=purchase_order 도착은 method=planned 로 기록되고 라인 source 가 purchase_order 다', async () => {
      await inRollbackTx(db, async (tx) => {
        const fx = await seedWarehouseAndSku(tx, randomUUID());
        const result = await kernel.recordArrival(
          {
            source: 'purchase_order',
            warehouseId: fx.warehouseId,
            reason: 'planned_inbound',
            lines: [{ skuId: fx.skuId, quantity: 4, eventKey: `k-${randomUUID()}` }],
          },
          tx,
        );

        expect(result.receipt.method).toBe('planned');
        expect(result.lines[0]?.source).toBe('purchase_order');
      });
    });

    it('합계를 반영한 회차와 source 를 든 라인을 돌려주고, 라인별 eventKey 를 그대로 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);

        const result = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId,
            reason: 'kernel_spec',
            lines: [
              { skuId, quantity: 2, eventKey: `kernel-spec:${suffix}:a` },
              { skuId, quantity: 5, memo: 'm', eventKey: `kernel-spec:${suffix}:b` },
            ],
          },
          tx,
        );

        expect(result.receipt).toMatchObject({ method: 'simple', warehouseId, status: 'posted', totalQuantity: 7 });
        expect(result.lines.map((l) => [l.quantity, l.source, l.memo])).toEqual([
          [2, 'direct', null],
          [5, 'direct', 'm'],
        ]);
        const keys = await tx
          .select({ key: wmsTables.stockEvents.idempotencyKey, id: wmsTables.stockEvents.id })
          .from(wmsTables.stockEvents)
          .where(eq(wmsTables.stockEvents.journalId, result.receipt.journalId ?? ''));
        expect(keys.map((k) => k.key).sort()).toEqual([`kernel-spec:${suffix}:a`, `kernel-spec:${suffix}:b`]);
      });
    });

    it('지정 로케이션을 그대로 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);
        const [shelf] = await tx
          .insert(wmsTables.locations)
          .values({
            warehouseId,
            code: `K-${suffix.slice(0, 6)}`,
            locationType: 'zone',
            isSystem: false,
            systemRole: null,
            isActive: true,
          })
          .returning();

        const result = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'individual',
            warehouseId,
            locationId: shelf.id,
            reason: 'kernel_spec',
            lines: [{ skuId, quantity: 1, eventKey: `kernel-spec:${suffix}` }],
          },
          tx,
        );

        expect(result.receipt.locationId).toBe(shelf.id);
        expect(result.lines[0]?.originLocationId).toBe(shelf.id);
      });
    });

    it('호출자 트랜잭션 밖으로 쓰기가 새지 않는다 — 롤백하면 회차가 남지 않는다', async () => {
      const suffix = randomUUID();
      let warehouseId = '';
      await inRollbackTx(db, async (tx) => {
        const seeded = await seedWarehouseAndSku(tx, suffix);
        warehouseId = seeded.warehouseId;
        await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId,
            reason: 'kernel_spec',
            lines: [{ skuId: seeded.skuId, quantity: 1, eventKey: `kernel-spec:${suffix}` }],
          },
          tx,
        );
      });

      const leaked = await db
        .select({ id: wmsTables.inboundReceipts.id })
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.warehouseId, warehouseId));
      expect(leaked).toEqual([]);
    });
  });

  it('reservation rejection after releasing cancellation counters rolls back the entire caller transaction', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedWarehouseAndSku(tx, randomUUID());
      const arrival = await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: f.warehouseId,
          reason: 'reserved cancellation',
          lines: [{ skuId: f.skuId, quantity: 5, eventKey: randomUUID() }],
        },
        tx,
      );
      const shipmentLineId = await seedShipmentLineFor(tx, { skuId: f.skuId, warehouseId: f.warehouseId, qty: 1 });
      await tx
        .insert(wmsTables.stockReservations)
        .values({
          targetType: 'SHIPMENT_LINE',
          targetId: shipmentLineId,
          shipmentLineId,
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          quantity: 1,
          status: 'confirmed',
        });
      const before = {
        lines: await tx
          .select()
          .from(wmsTables.inboundReceiptLines)
          .where(eq(wmsTables.inboundReceiptLines.receiptId, arrival.receipt.id)),
        receipt: await tx
          .select()
          .from(wmsTables.inboundReceipts)
          .where(eq(wmsTables.inboundReceipts.id, arrival.receipt.id)),
        ledger: await tx.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId)),
        events: await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId)),
        logs: await tx
          .select()
          .from(wmsTables.inboundWorkLogs)
          .where(eq(wmsTables.inboundWorkLogs.receiptId, arrival.receipt.id)),
      };
      await expect(
        tx.transaction((sp) =>
          kernel.cancelLine({ receiptLineId: arrival.lines[0].id, expected: { source: 'direct' } }, sp),
        ),
      ).rejects.toThrow(/예약된 재고/);
      expect({
        lines: await tx
          .select()
          .from(wmsTables.inboundReceiptLines)
          .where(eq(wmsTables.inboundReceiptLines.receiptId, arrival.receipt.id)),
        receipt: await tx
          .select()
          .from(wmsTables.inboundReceipts)
          .where(eq(wmsTables.inboundReceipts.id, arrival.receipt.id)),
        ledger: await tx.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId)),
        events: await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId)),
        logs: await tx
          .select()
          .from(wmsTables.inboundWorkLogs)
          .where(eq(wmsTables.inboundWorkLogs.receiptId, arrival.receipt.id)),
      }).toEqual(before);
    });
  });

  describe('cancelLine source 가드', () => {
    it('expected.source 와 라인 source 가 다르면 source 에 맞는 409로 거절한다', async () => {
      await inRollbackTx(db, async (tx) => {
        const fx = await seedWarehouseAndSku(tx, randomUUID());
        const po = await kernel.recordArrival(
          {
            source: 'purchase_order',
            warehouseId: fx.warehouseId,
            reason: 'planned_inbound',
            lines: [{ skuId: fx.skuId, quantity: 1, eventKey: `k-${randomUUID()}` }],
          },
          tx,
        );
        await expect(
          kernel.cancelLine({ receiptLineId: po.lines[0]?.id ?? '', expected: { source: 'direct' } }, tx),
        ).rejects.toMatchObject({ status: 409, message: '발주 입고는 발주에서 취소하세요' });

        const direct = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId: fx.warehouseId,
            reason: 'simple_inbound',
            lines: [{ skuId: fx.skuId, quantity: 1, eventKey: `k-${randomUUID()}` }],
          },
          tx,
        );
        await expect(
          kernel.cancelLine({ receiptLineId: direct.lines[0]?.id ?? '', expected: { source: 'purchase_order' } }, tx),
        ).rejects.toMatchObject({ status: 409, message: '이 회차 라인은 직접 입고가 아닙니다' });
        await expect(
          kernel.cancelLine({ receiptLineId: direct.lines[0]?.id ?? '', expected: { source: 'direct' } }, tx),
        ).resolves.toMatchObject({ id: direct.lines[0]?.id });
      });
    });
  });

  /** 잠금 스펙용 커밋형 회차. 각 테스트가 FK 역순으로 직접 정리한다. */
  async function seedCommittedReceipt(lineCount = 1) {
    const suffix = randomUUID();
    return db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      const { warehouseId, holderId, skuId } = await seedWarehouseAndSku(tx, suffix);
      const skuIds = [skuId];
      if (lineCount > 1) {
        const [secondSku] = await tx
          .insert(wmsTables.skus)
          .values({ name: 'kernel sibling sku', code: `KERNEL-SIBLING-${suffix}`, holderId })
          .returning();
        skuIds.push(secondSku.id);
      }
      const [shelf] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId,
          code: `KL-${suffix.slice(0, 6)}`,
          locationType: 'zone',
          isSystem: false,
          systemRole: null,
          isActive: true,
        })
        .returning();
      const { receipt, lines } = await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId,
          reason: 'kernel_lock_spec',
          lines: skuIds.map((id, index) => ({
            skuId: id,
            quantity: 5,
            eventKey: `kernel-lock-spec:${suffix}:${index}`,
          })),
        },
        tx,
      );
      return {
        receiptId: receipt.id,
        journalId: receipt.journalId ?? '',
        lineIds: lines.map((line) => line.id),
        shelfId: shelf.id,
        warehouseId,
        holderId,
        skuIds,
      };
    });
  }

  type CommittedReceipt = Awaited<ReturnType<typeof seedCommittedReceipt>>;

  async function cleanupCommittedReceipt(fixture: CommittedReceipt) {
    await db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      await tx.delete(wmsTables.inboundWorkLogs).where(eq(wmsTables.inboundWorkLogs.receiptId, fixture.receiptId));
      await tx
        .delete(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.receiptId, fixture.receiptId));
      await tx.delete(wmsTables.inboundReceipts).where(eq(wmsTables.inboundReceipts.id, fixture.receiptId));
      await tx.delete(wmsTables.stockLedgers).where(inArray(wmsTables.stockLedgers.skuId, fixture.skuIds));
      await tx.delete(wmsTables.stockEvents).where(inArray(wmsTables.stockEvents.skuId, fixture.skuIds));
      await tx.delete(wmsTables.stockJournals).where(eq(wmsTables.stockJournals.id, fixture.journalId));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, fixture.warehouseId));
      await tx.delete(wmsTables.skus).where(inArray(wmsTables.skus.id, fixture.skuIds));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holderId));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouseId));
    });
  }

  async function expectHeaderLockedDuring(fixture: CommittedReceipt) {
    const acquired = deferred();
    const release = deferred();
    const held = db.transaction(async (trx) => {
      await kernel.cancelLine(
        { receiptLineId: fixture.lineIds[0] ?? '', expected: { source: 'direct' } },
        trx as unknown as DbTx,
      );
      acquired.resolve();
      await release.promise;
      throw new Rollback('intentional rollback');
    });

    await withTimeout(
      Promise.race([
        acquired.promise,
        held.then(() => {
          throw new Error('held cancel completed before acquiring the test barrier');
        }),
      ]),
      'held cancel acquisition',
    );
    try {
      await expect(
        probe`SELECT id FROM inbound_receipts WHERE id = ${fixture.receiptId} FOR NO KEY UPDATE NOWAIT`,
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      release.resolve();
      await withTimeout(
        held.catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        }),
        'held cancel release',
      );
    }
    await expect(held).rejects.toThrow(Rollback);
  }

  async function waitUntilBlockedBy(pids: number[], blockerPid: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await probe<
        { pid: number; blockers: number[]; waitEventType: string | null; query: string }[]
      >`SELECT pid,
               pg_blocking_pids(pid) AS blockers,
               wait_event_type AS "waitEventType",
               query
          FROM pg_stat_activity
         WHERE pid IN ${probe(pids)}`;
      const bothWaitingOnReceiptHeader =
        rows.length === pids.length &&
        rows.every(
          (row) =>
            row.waitEventType === 'Lock' &&
            row.blockers.length > 0 &&
            row.query.includes('inbound_receipts') &&
            row.query.toLowerCase().includes('for no key update'),
        );
      if (bothWaitingOnReceiptHeader && rows.some((row) => row.blockers.includes(blockerPid))) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`cancel workers did not both block behind pid ${blockerPid}`);
  }

  /**
   * `hold` 를 연 트랜잭션 안에서 실행해 둔 채로, 다른 커넥션이 같은 회차 라인을 NOWAIT 로 잠가 본다.
   * `cancelLine`·`putaway`·`returnLine` 세 호출 모두 이 헬퍼로 잰다. 탐침은 `FOR UPDATE` 가 아니라
   * `FOR KEY SHARE` 를 쓴다 — held 호출은 명시적 잠금 말고도 자신의 수량 카운터 UPDATE(`canceled_qty`·
   * `putaway_from_origin_qty`·`returned_qty` 는 key 컬럼이 아니라 FOR NO KEY UPDATE 암묵 락)와 라인을
   * FK 로 참조하는 작업 로그 INSERT(FOR KEY SHARE 암묵 락)를 하는데, 이 둘은 `FOR KEY SHARE` 탐침과
   * 충돌하지 않는다. 그래서 `FOR UPDATE NOWAIT` 탐침을 썼다면 `.for('update')` 유무와 무관하게 항상
   * 55P03 이 나서 판별력이 없었을 것이다. `FOR KEY SHARE` 는 `FOR UPDATE` 하고만 충돌하므로, 55P03 이면
   * 그건 오직 커널이 명시적으로 잡은 행 잠금 탓이다. 끝나면 롤백한다.
   */
  async function expectLineLockedDuring(lineId: string, hold: (tx: DbTx) => Promise<unknown>) {
    let entered: () => void = () => undefined;
    const enteredSignal = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const releaseSignal = new Promise<void>((resolve) => {
      release = resolve;
    });

    const held = db.transaction(async (trx) => {
      await hold(trx as unknown as DbTx);
      entered();
      await releaseSignal;
      throw new Rollback('intentional rollback');
    });

    // hold 가 먼저 실패하면 신호를 기다리지 말고 바로 드러낸다.
    await Promise.race([enteredSignal, held]);
    try {
      await expect(
        probe`SELECT id FROM inbound_receipt_lines WHERE id = ${lineId} FOR KEY SHARE NOWAIT`,
      ).rejects.toMatchObject({
        code: '55P03',
      });
    } finally {
      // 탐침 단언이 실패해도(=잠그지 않음) hold 를 반드시 풀어준다 — 안 풀면 잡고 있던 커넥션이
      // 다음 훅까지 안 끝나 러너가 상한 시간까지 멎는다(잠금 없는 뮤테이션에서 실측: 121s 타임아웃).
      release();
      await withTimeout(
        held.catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        }),
        'held line release',
      );
    }
    await expect(held).rejects.toThrow(Rollback);
  }

  describe('회차 라인 잠금 (스펙 §7.1)', () => {
    it('cancelLine 은 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const fixture = await seedCommittedReceipt();
      try {
        await expectLineLockedDuring(fixture.lineIds[0] ?? '', (tx) =>
          kernel.cancelLine({ receiptLineId: fixture.lineIds[0] ?? '', expected: { source: 'direct' } }, tx),
        );
      } finally {
        await cleanupCommittedReceipt(fixture);
      }
    });

    it('putaway 는 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const fixture = await seedCommittedReceipt();
      try {
        await expectLineLockedDuring(fixture.lineIds[0] ?? '', (tx) =>
          kernel.putaway(
            {
              receiptLineId: fixture.lineIds[0] ?? '',
              toLocationId: fixture.shelfId,
              quantity: 1,
              eventKey: `kernel-lock-spec:putaway:${randomUUID()}`,
            },
            tx,
          ),
        );
      } finally {
        await cleanupCommittedReceipt(fixture);
      }
    });

    it('returnLine 은 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const fixture = await seedCommittedReceipt();
      try {
        await expectLineLockedDuring(fixture.lineIds[0] ?? '', (tx) =>
          kernel.returnLine(
            {
              receiptLineId: fixture.lineIds[0] ?? '',
              quantity: 1,
              eventKey: `kernel-lock-spec:return:${randomUUID()}`,
            },
            tx,
          ),
        );
      } finally {
        await cleanupCommittedReceipt(fixture);
      }
    });
  });

  describe('회차 헤더 잠금 (스펙 §7.1)', () => {
    it('cancelLine 은 형제 라인이 남아 있어도 헤더를 FOR NO KEY UPDATE 로 잠근다', async () => {
      const fixture = await seedCommittedReceipt(2);
      try {
        await expectHeaderLockedDuring(fixture);
      } finally {
        await cleanupCommittedReceipt(fixture);
      }
    });

    it('서로 다른 형제 라인의 동시 취소를 직렬화해 헤더를 voided 로 만든다', async () => {
      const fixture = await seedCommittedReceipt(2);
      const blockerClient = postgres(DATABASE_URL as string, { max: 1 });
      const workerAClient = postgres(DATABASE_URL as string, { max: 1 });
      const workerBClient = postgres(DATABASE_URL as string, { max: 1 });
      const blockerDb = drizzle(blockerClient, { schema: wmsSchema });
      const workerADb = drizzle(workerAClient, { schema: wmsSchema });
      const workerBDb = drizzle(workerBClient, { schema: wmsSchema });
      const blockerAcquired = deferred();
      const blockerRelease = deferred();
      let blocker: Promise<unknown> | undefined;
      let cancelA: Promise<unknown> | undefined;
      let cancelB: Promise<unknown> | undefined;
      try {
        const [{ pid: blockerPid }] = await blockerClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        const [{ pid: workerAPid }] = await workerAClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        const [{ pid: workerBPid }] = await workerBClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;

        blocker = blockerDb.transaction(async (trx) => {
          await trx
            .select({ id: wmsTables.inboundReceipts.id })
            .from(wmsTables.inboundReceipts)
            .where(eq(wmsTables.inboundReceipts.id, fixture.receiptId))
            .for('no key update');
          blockerAcquired.resolve();
          await blockerRelease.promise;
        });
        await withTimeout(blockerAcquired.promise, 'header blocker acquisition');

        cancelA = workerADb.transaction((trx) =>
          kernel.cancelLine(
            { receiptLineId: fixture.lineIds[0] ?? '', expected: { source: 'direct' } },
            trx as unknown as DbTx,
          ),
        );
        cancelB = workerBDb.transaction((trx) =>
          kernel.cancelLine(
            { receiptLineId: fixture.lineIds[1] ?? '', expected: { source: 'direct' } },
            trx as unknown as DbTx,
          ),
        );

        let waitFailure: unknown;
        try {
          await waitUntilBlockedBy([workerAPid, workerBPid], blockerPid);
        } catch (error) {
          waitFailure = error;
        } finally {
          blockerRelease.resolve();
          await withTimeout(blocker, 'header blocker release');
        }
        const cancelOutcomes = await withTimeout(
          Promise.allSettled([cancelA, cancelB]),
          'concurrent sibling cancellation',
        );
        if (waitFailure) throw waitFailure;
        const rejected = cancelOutcomes.find(
          (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
        );
        if (rejected) throw rejected.reason;

        const [receipt] = await db
          .select({ status: wmsTables.inboundReceipts.status, totalQuantity: wmsTables.inboundReceipts.totalQuantity })
          .from(wmsTables.inboundReceipts)
          .where(eq(wmsTables.inboundReceipts.id, fixture.receiptId));
        const [{ canceledQuantity }] = await db
          .select({ canceledQuantity: sql<number>`sum(${wmsTables.inboundReceiptLines.canceledQty})::int` })
          .from(wmsTables.inboundReceiptLines)
          .where(eq(wmsTables.inboundReceiptLines.receiptId, fixture.receiptId));
        expect(receipt).toEqual({ status: 'voided', totalQuantity: 0 });
        expect(canceledQuantity).toBe(10);
      } finally {
        blockerRelease.resolve();
        await withTimeout(
          Promise.allSettled([blocker, cancelA, cancelB].filter((promise): promise is Promise<unknown> => !!promise)),
          'concurrency worker cleanup',
        );
        await Promise.all([blockerClient.end(), workerAClient.end(), workerBClient.end()]);
        await cleanupCommittedReceipt(fixture);
      }
    });
  });
});
