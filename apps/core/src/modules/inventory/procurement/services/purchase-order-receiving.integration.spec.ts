import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { HttpStatus } from '@nestjs/common';
import { DbService } from '@app/db';
import { ApplicationException, BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx, makeInboundReceiptKernel } from '../../inbound/services/__fixtures__/inbound-harness';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { PurchaseOrderHeaderDeriver } from './purchase-order-header.deriver';
import { PurchaseOrderManager } from './purchase-order.manager';
import { PurchaseOrderReader } from './purchase-order.reader';
import { PurchaseOrderReceivingManager } from './purchase-order-receiving.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 발주가 수령을 소유한다 (설계 §12 #1a·#2·#3·#4·#5·#7). */
describeIfDb('PurchaseOrderReceivingManager (DB integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  const USER_ID = randomUUID();

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildManagers(trx: DbTx) {
    const dbService = boundDbService(trx);
    const reader = new PurchaseOrderReader(dbService);
    const deriver = new PurchaseOrderHeaderDeriver();
    return {
      reader,
      poManager: new PurchaseOrderManager(dbService, reader, deriver),
      receiving: new PurchaseOrderReceivingManager(
        dbService,
        makeInboundReceiptKernel(db),
        new InventoryIdempotencyService(dbService),
        deriver,
        reader,
      ),
    };
  }

  interface Fixture {
    poId: string;
    warehouseId: string;
    warehouseName: string;
    skuIds: string[];
  }

  async function seedPoWithThreeLines(trx: DbTx): Promise<Fixture> {
    const suffix = randomUUID().slice(0, 8);
    const warehouseName = `receive-wh-${suffix}`;
    const [warehouse] = await trx.insert(wmsTables.warehouses).values({ name: warehouseName }).returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `receive-supplier-${suffix}`, defaultWarehouseId: warehouse.id })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `receive-holder-${suffix}` })
      .returning();
    const skuIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `receive-sku-${index}`, code: `RECEIVE-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();
      skuIds.push(sku.id);
    }
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'domestic',
        supplierId: supplier.id,
        status: 'created',
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
        requiresTransfer: false,
      })
      .returning();
    await trx
      .insert(wmsTables.purchaseOrderLines)
      .values(skuIds.map((skuId) => ({ poId: po.id, skuId, quantity: 10 })));
    return { poId: po.id, warehouseId: warehouse.id, warehouseName, skuIds };
  }

  async function seedOrderedPo(trx: DbTx): Promise<Fixture> {
    const fixture = await seedPoWithThreeLines(trx);
    const { poManager } = buildManagers(trx);
    await poManager.orderLine(fixture.poId, fixture.skuIds[0], { orderedQty: 10 }, USER_ID);
    await poManager.orderLine(fixture.poId, fixture.skuIds[1], { orderedQty: 10 }, USER_ID);
    return fixture;
  }

  async function headerStatusOf(trx: DbTx, poId: string): Promise<string> {
    const [row] = await trx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId));
    return row.status;
  }

  async function receivedQtyOf(trx: DbTx, poId: string, skuId: string): Promise<number> {
    const [row] = await trx
      .select({ receivedQty: wmsTables.purchaseOrderLines.receivedQty })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
    return row.receivedQty;
  }

  async function linkedSum(trx: DbTx, poId: string, skuId: string): Promise<number> {
    const [row] = await trx
      .select({
        sum: sql<number>`COALESCE(SUM(${wmsTables.inboundReceiptLines.quantity} - ${wmsTables.inboundReceiptLines.canceledQty}), 0)::int`,
      })
      .from(wmsTables.purchaseOrderReceiptLines)
      .innerJoin(
        wmsTables.inboundReceiptLines,
        eq(wmsTables.inboundReceiptLines.id, wmsTables.purchaseOrderReceiptLines.receiptLineId),
      )
      .where(
        and(eq(wmsTables.purchaseOrderReceiptLines.poId, poId), eq(wmsTables.purchaseOrderReceiptLines.skuId, skuId)),
      );
    return Number(row.sum);
  }

  type DomainErrorConstructor = new (message: string) => ApplicationException;
  type Managers = ReturnType<typeof buildManagers>;

  interface RejectionRequest {
    poId: string;
    warehouseId: string;
    skuId: string;
    quantity: number;
    message: string;
  }

  interface ReceiveRejectionCase {
    name: string;
    errorType: DomainErrorConstructor;
    status: number;
    arrange: (trx: DbTx, fixture: Fixture, managers: Managers) => Promise<RejectionRequest>;
  }

  const RECEIVE_REJECTION_CASES: ReceiveRejectionCase[] = [
    {
      name: '창고 불일치',
      errorType: BadRequestError,
      status: HttpStatus.BAD_REQUEST,
      arrange: async (trx, fixture) => {
        const [otherWarehouse] = await trx
          .insert(wmsTables.warehouses)
          .values({ name: `receive-other-${randomUUID().slice(0, 8)}` })
          .returning();
        return {
          poId: fixture.poId,
          warehouseId: otherWarehouse.id,
          skuId: fixture.skuIds[0],
          quantity: 1,
          message: `이 발주는 ${fixture.warehouseName}에서 받습니다`,
        };
      },
    },
    {
      name: '없는 발주',
      errorType: NotFoundError,
      status: HttpStatus.NOT_FOUND,
      arrange: async (_trx, fixture) => {
        const poId = randomUUID();
        return {
          poId,
          warehouseId: fixture.warehouseId,
          skuId: fixture.skuIds[0],
          quantity: 1,
          message: `발주를 찾을 수 없습니다: ${poId}`,
        };
      },
    },
    {
      name: '취소된 발주',
      errorType: ConflictError,
      status: HttpStatus.CONFLICT,
      arrange: async (_trx, fixture, { poManager }) => {
        await poManager.cancelPurchaseOrder(fixture.poId, { reason: '운영 취소' }, USER_ID);
        return {
          poId: fixture.poId,
          warehouseId: fixture.warehouseId,
          skuId: fixture.skuIds[0],
          quantity: 1,
          message: '취소된 발주입니다',
        };
      },
    },
    {
      name: '발주에 없는 SKU',
      errorType: NotFoundError,
      status: HttpStatus.NOT_FOUND,
      arrange: async (_trx, fixture) => {
        const skuId = randomUUID();
        return {
          poId: fixture.poId,
          warehouseId: fixture.warehouseId,
          skuId,
          quantity: 1,
          message: `발주에 없는 품목입니다: ${skuId}`,
        };
      },
    },
    {
      name: '주문 전 라인',
      errorType: ConflictError,
      status: HttpStatus.CONFLICT,
      arrange: async (_trx, fixture) => ({
        poId: fixture.poId,
        warehouseId: fixture.warehouseId,
        skuId: fixture.skuIds[2],
        quantity: 1,
        message: `아직 주문 전인 품목입니다: ${fixture.skuIds[2]}`,
      }),
    },
    {
      name: '발주 불가 라인',
      errorType: ConflictError,
      status: HttpStatus.CONFLICT,
      arrange: async (_trx, fixture, { poManager }) => {
        await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[2], { reason: '단종' }, USER_ID);
        return {
          poId: fixture.poId,
          warehouseId: fixture.warehouseId,
          skuId: fixture.skuIds[2],
          quantity: 1,
          message: `발주 불가로 종결된 품목입니다: ${fixture.skuIds[2]}`,
        };
      },
    },
    {
      name: '잔량 포기 라인',
      errorType: ConflictError,
      status: HttpStatus.CONFLICT,
      arrange: async (_trx, fixture, { receiving }) => {
        await receiving.shortCloseLine(fixture.poId, fixture.skuIds[0], { reason: '미발송' }, USER_ID);
        return {
          poId: fixture.poId,
          warehouseId: fixture.warehouseId,
          skuId: fixture.skuIds[0],
          quantity: 1,
          message: `잔량 포기된 품목입니다: ${fixture.skuIds[0]}`,
        };
      },
    },
    {
      name: '전량 입고 라인',
      errorType: ConflictError,
      status: HttpStatus.CONFLICT,
      arrange: async (_trx, fixture, { receiving }) => {
        await receiving.receive(fixture.poId, {
          idempotencyKey: randomUUID(),
          warehouseId: fixture.warehouseId,
          lines: [{ skuId: fixture.skuIds[0], quantity: 10 }],
        });
        return {
          poId: fixture.poId,
          warehouseId: fixture.warehouseId,
          skuId: fixture.skuIds[0],
          quantity: 1,
          message: `이미 전량 입고된 품목입니다: ${fixture.skuIds[0]}`,
        };
      },
    },
    {
      name: '남은 수량 초과',
      errorType: ConflictError,
      status: HttpStatus.CONFLICT,
      arrange: async (_trx, fixture) => ({
        poId: fixture.poId,
        warehouseId: fixture.warehouseId,
        skuId: fixture.skuIds[0],
        quantity: 11,
        message: '남은 수량 10개를 넘습니다 — 넘는 분량은 간편입고로 받으세요',
      }),
    },
  ];

  async function expectDomainRejection(
    action: Promise<unknown>,
    errorType: DomainErrorConstructor,
    message: string,
    status: number,
  ): Promise<void> {
    let thrown: unknown;
    try {
      await action;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(errorType);
    if (!(thrown instanceof ApplicationException)) {
      throw thrown ?? new Error('요청이 거절되지 않았습니다');
    }
    expect(thrown.message).toBe(message);
    expect(thrown.getHttpStatus()).toBe(status);
  }

  it('수령 한 번이 회차·RECEIVE 이벤트·링크·receivedQty를 원자적으로 기록한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      const { receiving } = buildManagers(trx);
      const idempotencyKey = randomUUID();

      const result = await receiving.receive(fixture.poId, {
        idempotencyKey,
        warehouseId: fixture.warehouseId,
        lines: [
          { skuId: fixture.skuIds[0], quantity: 4 },
          { skuId: fixture.skuIds[1], quantity: 10 },
        ],
      });

      const [receipt] = await trx
        .select()
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.id, result.receiptId));
      const events = await trx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.journalId, receipt.journalId ?? ''));
      expect(result.lines).toHaveLength(2);
      expect(receipt).toMatchObject({ method: 'planned', status: 'posted', totalQuantity: 14 });
      expect(events.filter((event) => event.transitionType === 'RECEIVE')).toHaveLength(2);
      expect(events.map((event) => event.idempotencyKey).sort()).toEqual([
        `purchase_order.receive:${idempotencyKey}:0`,
        `purchase_order.receive:${idempotencyKey}:1`,
      ]);
      expect(await receivedQtyOf(trx, fixture.poId, fixture.skuIds[0])).toBe(4);
      expect(await linkedSum(trx, fixture.poId, fixture.skuIds[0])).toBe(4);
      expect(await headerStatusOf(trx, fixture.poId)).toBe('created');
    });
  });

  it('A 입고 뒤 나머지 requested 라인을 불가 종결하면 헤더가 received로 파생된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedPoWithThreeLines(trx);
      const { receiving, poManager } = buildManagers(trx);
      await poManager.orderLine(fixture.poId, fixture.skuIds[0], { orderedQty: 10 }, USER_ID);
      await receiving.receive(fixture.poId, {
        idempotencyKey: randomUUID(),
        warehouseId: fixture.warehouseId,
        lines: [{ skuId: fixture.skuIds[0], quantity: 10 }],
      });
      await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[1], {}, USER_ID);
      await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[2], {}, USER_ID);

      expect(await headerStatusOf(trx, fixture.poId)).toBe('received');
    });
  });

  it('전량 입고 뒤 남은 requested 라인을 실행하면 헤더가 confirmed로 파생된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedPoWithThreeLines(trx);
      const { receiving, poManager, reader } = buildManagers(trx);
      await poManager.orderLine(fixture.poId, fixture.skuIds[0], { orderedQty: 10 }, USER_ID);
      await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[2], {}, USER_ID);
      await receiving.receive(fixture.poId, {
        idempotencyKey: randomUUID(),
        warehouseId: fixture.warehouseId,
        lines: [{ skuId: fixture.skuIds[0], quantity: 10 }],
      });
      await poManager.orderLine(fixture.poId, fixture.skuIds[1], { orderedQty: 5 }, USER_ID);

      expect(await headerStatusOf(trx, fixture.poId)).toBe('confirmed');
      expect(
        (await reader.findById(fixture.poId)).lines.find((line) => line.skuId === fixture.skuIds[1]),
      ).toMatchObject({
        outstandingQty: 5,
        receivingProgress: 'awaiting',
      });
    });
  });

  it('received 발주의 수령 취소는 관문 없이 confirmed로 되돌리고 재전송은 멱등하다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      const { receiving, poManager } = buildManagers(trx);
      await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[2], {}, USER_ID);
      const received = await receiving.receive(fixture.poId, {
        idempotencyKey: randomUUID(),
        warehouseId: fixture.warehouseId,
        lines: [
          { skuId: fixture.skuIds[0], quantity: 10 },
          { skuId: fixture.skuIds[1], quantity: 10 },
        ],
      });
      expect(await headerStatusOf(trx, fixture.poId)).toBe('received');
      const dto = { idempotencyKey: randomUUID() };

      const first = await receiving.cancelReceiptLine(received.lines[0].receiptLineId, dto);
      const replay = await receiving.cancelReceiptLine(received.lines[0].receiptLineId, dto);

      expect(replay).toEqual(first);
      expect(first).toMatchObject({ poId: fixture.poId, skuId: fixture.skuIds[0], quantity: 10 });
      expect(await headerStatusOf(trx, fixture.poId)).toBe('confirmed');
      expect(await receivedQtyOf(trx, fixture.poId, fixture.skuIds[0])).toBe(0);
      expect(await linkedSum(trx, fixture.poId, fixture.skuIds[0])).toBe(0);
      const idempotencyRows = await trx
        .select({ endpoint: wmsTables.inventoryIdempotencyRequests.endpoint })
        .from(wmsTables.inventoryIdempotencyRequests)
        .where(eq(wmsTables.inventoryIdempotencyRequests.key, dto.idempotencyKey));
      expect(idempotencyRows).toEqual([{ endpoint: 'purchase_order.receipt.cancel' }]);
    });
  });

  it('잔량 포기는 받은 수가 0이어도 되고 모든 ordered 라인을 닫으면 received다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      const { receiving, poManager } = buildManagers(trx);
      await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[2], {}, USER_ID);
      const first = await receiving.shortCloseLine(
        fixture.poId,
        fixture.skuIds[0],
        { reason: '공급처 미발송' },
        USER_ID,
      );
      expect(first.status).toBe('confirmed');
      const second = await receiving.shortCloseLine(fixture.poId, fixture.skuIds[1], { reason: '단종' }, USER_ID);
      expect(second.status).toBe('received');
      expect(second.lines.find((line) => line.skuId === fixture.skuIds[1])).toMatchObject({
        receivingProgress: 'short_closed',
        outstandingQty: 0,
        closedReason: '단종',
      });
    });
  });

  it('잔량 포기된 라인의 수령을 취소해도 종결은 유지하고 받은 수만 줄인다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      const { receiving, reader } = buildManagers(trx);
      const received = await receiving.receive(fixture.poId, {
        idempotencyKey: randomUUID(),
        warehouseId: fixture.warehouseId,
        lines: [{ skuId: fixture.skuIds[0], quantity: 3 }],
      });
      await receiving.shortCloseLine(fixture.poId, fixture.skuIds[0], { reason: '미발송' }, USER_ID);

      await receiving.cancelReceiptLine(received.lines[0].receiptLineId, { idempotencyKey: randomUUID() });

      expect(
        (await reader.findById(fixture.poId)).lines.find((line) => line.skuId === fixture.skuIds[0]),
      ).toMatchObject({
        receivedQty: 0,
        outstandingQty: 0,
        receivingProgress: 'short_closed',
        closedReason: '미발송',
      });
    });
  });

  it.each(RECEIVE_REJECTION_CASES)(
    '수령 거절: $name은 구체 예외·정확한 한국어 메시지·HTTP $status를 돌려준다',
    async ({ arrange, errorType, status }) => {
      await inRollbackTx(db, async (trx) => {
        const fixture = await seedOrderedPo(trx);
        const managers = buildManagers(trx);
        const request = await arrange(trx, fixture, managers);

        await expectDomainRejection(
          managers.receiving.receive(request.poId, {
            idempotencyKey: randomUUID(),
            warehouseId: request.warehouseId,
            lines: [{ skuId: request.skuId, quantity: request.quantity }],
          }),
          errorType,
          request.message,
          status,
        );
      });
    },
  );

  it('DB CHECK도 발주 라인의 초과 수령을 23514로 거절한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      await trx.execute(sql`SAVEPOINT received_check`);
      await expect(
        trx
          .update(wmsTables.purchaseOrderLines)
          .set({ receivedQty: 11 })
          .where(
            and(
              eq(wmsTables.purchaseOrderLines.poId, fixture.poId),
              eq(wmsTables.purchaseOrderLines.skuId, fixture.skuIds[0]),
            ),
          ),
      ).rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'ck_po_lines_received' } });
      await trx.execute(sql`ROLLBACK TO SAVEPOINT received_check`);
    });
  });

  it('같은 수령 멱등키 재전송은 응답과 회차를 재사용한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      const { receiving } = buildManagers(trx);
      const dto = {
        idempotencyKey: randomUUID(),
        warehouseId: fixture.warehouseId,
        lines: [{ skuId: fixture.skuIds[0], quantity: 2 }],
      };

      const first = await receiving.receive(fixture.poId, dto);
      const replay = await receiving.receive(fixture.poId, dto);
      const receipts = await trx
        .select({ id: wmsTables.inboundReceipts.id })
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.id, first.receiptId));

      expect(replay).toEqual(first);
      expect(receipts).toHaveLength(1);
      expect(await receivedQtyOf(trx, fixture.poId, fixture.skuIds[0])).toBe(2);
      const idempotencyRows = await trx
        .select({ endpoint: wmsTables.inventoryIdempotencyRequests.endpoint })
        .from(wmsTables.inventoryIdempotencyRequests)
        .where(eq(wmsTables.inventoryIdempotencyRequests.key, dto.idempotencyKey));
      expect(idempotencyRows).toEqual([{ endpoint: 'purchase_order.receive' }]);
    });
  });

  it('예정일은 requested와 남은 수량이 있는 ordered에서 수정·삭제되고 received에서는 거절된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fixture = await seedOrderedPo(trx);
      const { receiving, poManager } = buildManagers(trx);
      expect(
        (
          await receiving.updateLineExpectedArrival(fixture.poId, fixture.skuIds[2], { expectedArrival: '2026-10-05' })
        ).lines.find((line) => line.skuId === fixture.skuIds[2])?.expectedArrival,
      ).toBe('2026-10-05');
      expect(
        (
          await receiving.updateLineExpectedArrival(fixture.poId, fixture.skuIds[0], { expectedArrival: null })
        ).lines.find((line) => line.skuId === fixture.skuIds[0])?.expectedArrival,
      ).toBeNull();
      await poManager.markLineUnavailable(fixture.poId, fixture.skuIds[2], {}, USER_ID);
      await receiving.receive(fixture.poId, {
        idempotencyKey: randomUUID(),
        warehouseId: fixture.warehouseId,
        lines: [
          { skuId: fixture.skuIds[0], quantity: 10 },
          { skuId: fixture.skuIds[1], quantity: 10 },
        ],
      });
      await expect(
        receiving.updateLineExpectedArrival(fixture.poId, fixture.skuIds[0], { expectedArrival: '2026-10-06' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
