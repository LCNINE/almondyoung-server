import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, returnExchangeTables, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  seedHolder,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
} from '../../fulfillment/services/__support__';
import { lockShipmentConnectedComponentGraph } from '../../fulfillment/services/shipment-reservation.service';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { StoreReturnExchangeService } from './store-return-exchange.service';

/** 반품 완료 종점이 아웃박스에 적재하는 발행자. 스펙에서는 적재 호출만 세면 된다. */
const makeCoreOrdersPublisher = () => ({ enqueue: jest.fn().mockResolvedValue(undefined) });

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('Store return exact dispatch-attempt eligibility (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 5 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedDeliveredAttemptGraph(tx: DbTx, attemptCount = 1) {
    const customerId = randomUUID();
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: [{ variantId: randomUUID(), quantity: attemptCount }],
    });
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId, status: 'delivered' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId, warehouseId, status: 'completed', totalItems: 1, totalQty: attemptCount })
      .returning();
    const [fulfillmentOrderItem] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        salesOrderId,
        salesOrderLineId: lineIds[0],
        skuId,
        qty: attemptCount,
        shippedQty: attemptCount,
      })
      .returning();
    // 실제 FO 생성이 굳히는 구성 — 청구 자격(K6 PR3a)은 구성 밖 SKU 를 청구할 수 없다고 본다(N4)
    await tx
      .insert(wmsTables.salesOrderLineCompositions)
      .values({ salesOrderLineId: lineIds[0], skuId, qtyPerUnit: 1 });
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'delivered',
        shippedAt: new Date('2026-07-15T01:00:00.000Z'),
        deliveredAt: new Date('2026-07-15T02:00:00.000Z'),
      })
      .returning();
    const [shipmentLine] = await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId: shipment.id, fulfillmentOrderItemId: fulfillmentOrderItem.id, skuId, qty: attemptCount })
      .returning();

    const attempts: Array<typeof wmsTables.dispatchAttempts.$inferSelect> = [];
    for (let index = 0; index < attemptCount; index += 1) {
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'SHIPMENT', sourceId: shipment.id, idempotencyKey: `return-it-journal-${randomUUID()}` })
        .returning();
      const [attempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          shipmentId: shipment.id,
          attemptNo: index + 1,
          status: 'dispatched',
          idempotencyKey: `return-it-attempt-${randomUUID()}`,
          stockJournalId: journal.id,
          dispatchedAt: new Date(`2026-07-15T0${index + 1}:00:00.000Z`),
        })
        .returning();
      await tx.insert(wmsTables.dispatchAttemptSources).values({
        dispatchAttemptId: attempt.id,
        shipmentLineId: shipmentLine.id,
        sourceLocationId: locationId,
        qty: 1,
      });
      await tx.insert(wmsTables.shipmentTracking).values({
        shipmentId: shipment.id,
        dispatchAttemptId: attempt.id,
        providerEventId: `return-it-delivered-${randomUUID()}`,
        status: 'delivered',
        timestamp: new Date(`2026-07-15T0${index + 2}:00:00.000Z`),
      });
      attempts.push(attempt);
    }

    return {
      customerId,
      warehouseId,
      locationId,
      holderId,
      skuId,
      salesOrderId,
      salesOrderLineId: lineIds[0],
      shipment,
      shipmentLine,
      attempts,
    };
  }

  function createDto(graph: Awaited<ReturnType<typeof seedDeliveredAttemptGraph>>, attemptIndex = 0) {
    return {
      reasonCode: 'defective' as const,
      lines: [
        {
          salesOrderLineId: graph.salesOrderLineId,
          shipmentLineId: graph.shipmentLine.id,
          dispatchAttemptId: graph.attempts[attemptIndex].id,
          quantity: 1,
        },
      ],
    };
  }

  async function cleanupCommittedGraph(graph: Awaited<ReturnType<typeof seedDeliveredAttemptGraph>>) {
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const returnRequests = await tx
        .select({ id: returnExchangeTables.returnRequests.id })
        .from(returnExchangeTables.returnRequests)
        .where(eq(returnExchangeTables.returnRequests.salesOrderId, graph.salesOrderId));
      const exchangeRequests = await tx
        .select({ id: returnExchangeTables.exchangeRequests.id })
        .from(returnExchangeTables.exchangeRequests)
        .where(eq(returnExchangeTables.exchangeRequests.salesOrderId, graph.salesOrderId));
      const requests = [...returnRequests, ...exchangeRequests];
      await tx.delete(wmsTables.businessLinks).where(eq(wmsTables.businessLinks.targetId, graph.salesOrderId));
      if (requests.length > 0) {
        await tx.delete(wmsTables.businessLinks).where(
          inArray(
            wmsTables.businessLinks.sourceId,
            requests.map((row) => row.id),
          ),
        );
      }
      await tx
        .delete(returnExchangeTables.returnRequests)
        .where(eq(returnExchangeTables.returnRequests.salesOrderId, graph.salesOrderId));
      // 교환 항목은 요청 cascade 로 지워진다 — 소포 칸(restrict)이 아래 배송 행 삭제를 막지 않게 먼저 지운다
      await tx
        .delete(returnExchangeTables.exchangeRequests)
        .where(eq(returnExchangeTables.exchangeRequests.salesOrderId, graph.salesOrderId));
      await tx.delete(wmsTables.shipmentTracking).where(eq(wmsTables.shipmentTracking.shipmentId, graph.shipment.id));
      await tx.delete(wmsTables.dispatchAttemptSources).where(
        inArray(
          wmsTables.dispatchAttemptSources.dispatchAttemptId,
          graph.attempts.map((row) => row.id),
        ),
      );
      await tx.delete(wmsTables.dispatchAttempts).where(
        inArray(
          wmsTables.dispatchAttempts.id,
          graph.attempts.map((row) => row.id),
        ),
      );
      await tx.delete(wmsTables.stockJournals).where(eq(wmsTables.stockJournals.sourceId, graph.shipment.id));
      await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, graph.shipment.id));
      await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, graph.shipment.id));
      await tx
        .delete(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, graph.shipment.openedForFulfillmentOrderId!));
      await tx
        .delete(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, graph.shipment.openedForFulfillmentOrderId!));
      await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, graph.salesOrderId));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, graph.locationId));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, graph.skuId));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, graph.holderId));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, graph.warehouseId));
    });
  }

  it('keeps customer ownership on Store reads while allowing the scoped Admin read path', async () => {
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx);
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      await expect(service.getReturnEligibility(graph.salesOrderId, randomUUID())).rejects.toThrow(
        /본인 주문만 접근할 수 있습니다/,
      );
      await expect(service.adminGetReturnEligibility(graph.salesOrderId)).resolves.toMatchObject({
        orderId: graph.salesOrderId,
        items: [
          expect.objectContaining({
            dispatchAttemptId: graph.attempts[0].id,
            remainingEligibleQty: 1,
          }),
        ],
      });
    });
  });

  it('subtracts active exchange claims from the displayed sales-line return eligibility', async () => {
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx);
      const [exchange] = await tx
        .insert(returnExchangeTables.exchangeRequests)
        .values({
          salesOrderId: graph.salesOrderId,
          customerId: graph.customerId,
          status: 'approved',
          reasonCode: 'other',
        })
        .returning();
      await tx.insert(returnExchangeTables.exchangeRequestItems).values({
        exchangeRequestId: exchange.id,
        salesOrderLineId: graph.salesOrderLineId,
        shipmentLineId: graph.shipmentLine.id,
        dispatchAttemptId: graph.attempts[0].id,
        quantity: 1,
      });
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      const eligibility = await service.adminGetReturnEligibility(graph.salesOrderId);

      expect(eligibility.items[0]).toMatchObject({
        claimedQty: 1,
        remainingEligibleQty: 0,
        salesOrderLineRemainingEligibleQty: 0,
      });
      await expect(
        service.adminCreateReturnRequest(graph.salesOrderId, 'admin-operator-1', createDto(graph)),
      ).rejects.toThrow(/반품 가능 수량\(0\)/);
    });
  });

  it('permanently subtracts completed claims, while rejected/cancelled claims release eligibility', async () => {
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx);
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );
      const first = await service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph));
      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, first.id));

      await expect(
        service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
      ).rejects.toBeInstanceOf(BadRequestException);

      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'cancelled' })
        .where(eq(returnExchangeTables.returnRequests.id, first.id));
      const afterCancellation = await service.createReturnRequest(
        graph.salesOrderId,
        graph.customerId,
        createDto(graph),
      );
      expect(afterCancellation.items[0]).toMatchObject({
        shipmentLineId: graph.shipmentLine.id,
        dispatchAttemptId: graph.attempts[0].id,
      });
      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'rejected' })
        .where(eq(returnExchangeTables.returnRequests.id, afterCancellation.id));
      await expect(
        service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
      ).resolves.toMatchObject({ status: 'requested' });
    });
  });

  it('legacy item without a parcel does not count', async () => {
    // N1 — 소포 칸이 빈 항목은 SKU 를 알 길이 없어 커널이 세지 않는다. 라이브 0행이 배포 게이트(D5)다
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx);
      const [legacyRequest] = await tx
        .insert(returnExchangeTables.returnRequests)
        .values({
          salesOrderId: graph.salesOrderId,
          customerId: graph.customerId,
          status: 'completed',
          reasonCode: 'defective',
          completedAt: new Date('2026-07-15T04:00:00.000Z'),
        })
        .returning();
      await tx.insert(returnExchangeTables.returnRequestItems).values({
        returnRequestId: legacyRequest.id,
        salesOrderLineId: graph.salesOrderLineId,
        shipmentLineId: null,
        dispatchAttemptId: null,
        quantity: 1,
      });
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      await expect(service.getReturnEligibility(graph.salesOrderId, graph.customerId)).resolves.toEqual({
        orderId: graph.salesOrderId,
        items: [
          expect.objectContaining({
            salesOrderLineId: graph.salesOrderLineId,
            shipmentLineId: graph.shipmentLine.id,
            dispatchAttemptId: graph.attempts[0].id,
            shippedQty: 1,
            claimedQty: 0,
            remainingEligibleQty: 1,
            salesOrderLineRemainingEligibleQty: 1,
          }),
        ],
      });

      await expect(
        service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
      ).resolves.toMatchObject({ status: 'requested' });
    });
  });

  it('exposes the shared sales-line cap across attempts and rejects an aggregate over-selection', async () => {
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx, 2);
      // 출고 뒤 취소(V1 사후취소) 1 — 돈을 돌려준 수량은 다시 청구할 수 없다(C9). 두 소포가 SKU 몫 1 을 나눠 쓴다.
      // 엔진은 다 나간 라인의 부분취소를 거절하므로(R1) 엔진이 남기는 모양을 쓰기 문에 직접 넘긴다
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId: graph.salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'customer',
          effects: [
            {
              type: 'preserved_shipped_fulfillment_order_item',
              metadata: {
                salesOrderLineId: graph.salesOrderLineId,
                skuId: graph.skuId,
                requestedFulfillmentQuantity: 1,
                affectedShippedQuantity: 1,
              },
            },
          ],
        },
        [{ salesOrderLineId: graph.salesOrderLineId, quantity: 1 }],
      );
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      const eligibility = await service.getReturnEligibility(graph.salesOrderId, graph.customerId);
      expect(eligibility.items).toHaveLength(2);
      expect(eligibility.items).toEqual(
        expect.arrayContaining(
          graph.attempts.map((attempt) =>
            expect.objectContaining({
              dispatchAttemptId: attempt.id,
              shippedQty: 1,
              claimedQty: 0,
              remainingEligibleQty: 1,
              salesOrderLineRemainingEligibleQty: 1,
            }),
          ),
        ),
      );

      await expect(
        service.createReturnRequest(graph.salesOrderId, graph.customerId, {
          reasonCode: 'defective',
          lines: graph.attempts.map((attempt) => ({
            salesOrderLineId: graph.salesOrderLineId,
            shipmentLineId: graph.shipmentLine.id,
            dispatchAttemptId: attempt.id,
            quantity: 1,
          })),
        }),
      ).rejects.toThrow(
        `주문 라인 ${graph.salesOrderLineId} 구성품 ${graph.skuId}의 반품 가능 수량(1)을 초과하였습니다. (요청: 2)`,
      );
    });
  });

  it('keeps eligibility pools separate across delivered redispatch attempts', async () => {
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx, 2);
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );
      const first = await service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph, 0));
      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, first.id));

      const secondAttemptReturn = await service.createReturnRequest(
        graph.salesOrderId,
        graph.customerId,
        createDto(graph, 1),
      );
      expect(secondAttemptReturn.items[0].dispatchAttemptId).toBe(graph.attempts[1].id);
    });
  });

  it('rejects a delivered tracking history after its exact attempt is recalled', async () => {
    await inRollbackTx(db, async (tx) => {
      const graph = await seedDeliveredAttemptGraph(tx);
      const [reversalJournal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'SHIPMENT_RECALL',
          sourceId: graph.shipment.id,
          idempotencyKey: `return-it-recall-${randomUUID()}`,
        })
        .returning();
      await tx
        .update(wmsTables.dispatchAttempts)
        .set({
          status: 'recalled',
          reversalJournalId: reversalJournal.id,
          recalledAt: new Date('2026-07-15T03:00:00.000Z'),
        })
        .where(eq(wmsTables.dispatchAttempts.id, graph.attempts[0].id));
      const service = new StoreReturnExchangeService(
        { db: tx } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      // 회수된 시도는 배송완료 소포가 아니다 — 배송완료 추적 기록이 남아 있어도 자격 목록에 없다
      await expect(service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph))).rejects.toThrow(
        `배송 완료된 소포가 아니거나 이 주문 라인의 것이 아닙니다: ${graph.attempts[0].id}/${graph.shipmentLine.id}`,
      );
    });
  });

  it('serializes concurrent claims so exact attempt/line qty=1 succeeds only once', async () => {
    const graph = await db.transaction((tx) => seedDeliveredAttemptGraph(tx as unknown as DbTx));
    try {
      const service = new StoreReturnExchangeService(
        { db } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );
      const results = await Promise.allSettled([
        service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
        service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const claims = await db
        .select({ id: returnExchangeTables.returnRequestItems.id })
        .from(returnExchangeTables.returnRequestItems)
        .where(eq(returnExchangeTables.returnRequestItems.dispatchAttemptId, graph.attempts[0].id));
      expect(claims).toHaveLength(1);
    } finally {
      await cleanupCommittedGraph(graph);
    }
  });

  it('concurrent return and exchange on one parcel succeed only once', async () => {
    const graph = await db.transaction((tx) => seedDeliveredAttemptGraph(tx as unknown as DbTx));
    try {
      const service = new StoreReturnExchangeService(
        { db } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );
      // 반품과 교환은 «진행 중 요청» 확인이 서로 다르다 — 둘째를 막는 것은 그래프·라인 잠금 뒤에 읽는 같은 claimable 이다
      const results = await Promise.allSettled([
        service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
        service.createExchangeRequest(graph.salesOrderId, graph.customerId, createDto(graph)),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      const [returnItems, exchangeItems] = await Promise.all([
        db
          .select({ id: returnExchangeTables.returnRequestItems.id })
          .from(returnExchangeTables.returnRequestItems)
          .where(eq(returnExchangeTables.returnRequestItems.dispatchAttemptId, graph.attempts[0].id)),
        db
          .select({ id: returnExchangeTables.exchangeRequestItems.id })
          .from(returnExchangeTables.exchangeRequestItems)
          .where(eq(returnExchangeTables.exchangeRequestItems.dispatchAttemptId, graph.attempts[0].id)),
      ]);
      expect(returnItems.length + exchangeItems.length).toBe(1);
    } finally {
      await cleanupCommittedGraph(graph);
    }
  });

  it('allows an authenticated admin to create an exact-attempt return without customer impersonation', async () => {
    const graph = await db.transaction((tx) => seedDeliveredAttemptGraph(tx as unknown as DbTx));
    try {
      const service = new StoreReturnExchangeService(
        { db } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      const created = await service.adminCreateReturnRequest(graph.salesOrderId, 'admin-operator-1', createDto(graph));

      expect(created).toMatchObject({
        salesOrderId: graph.salesOrderId,
        items: [
          {
            shipmentLineId: graph.shipmentLine.id,
            dispatchAttemptId: graph.attempts[0].id,
            quantity: 1,
          },
        ],
      });
    } finally {
      await cleanupCommittedGraph(graph);
    }
  });

  it('uses graph-before-attempt locks against a concurrent recall without deadlock', async () => {
    const graph = await db.transaction((tx) => seedDeliveredAttemptGraph(tx as unknown as DbTx));
    try {
      let announceGraphLocked!: () => void;
      const graphLocked = new Promise<void>((resolve) => {
        announceGraphLocked = resolve;
      });
      let announceReturnTxEntered!: () => void;
      const returnTxEntered = new Promise<void>((resolve) => {
        announceReturnTxEntered = resolve;
      });

      const instrumentedDb = {
        select: (...args: Parameters<typeof db.select>) => db.select(...args),
        transaction: <T>(callback: (tx: DbTx) => Promise<T>) =>
          db.transaction(async (rawTx) => {
            announceReturnTxEntered();
            return callback(rawTx as unknown as DbTx);
          }),
      };
      const service = new StoreReturnExchangeService(
        { db: instrumentedDb } as never,
        { refundByIntent: jest.fn() } as never,
        makeCoreOrdersPublisher() as never,
      );

      const recallPath = db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        await lockShipmentConnectedComponentGraph(tx, [graph.shipmentLine.fulfillmentOrderItemId]);
        announceGraphLocked();
        await returnTxEntered;
        const [attempt] = await tx
          .select({ id: wmsTables.dispatchAttempts.id })
          .from(wmsTables.dispatchAttempts)
          .where(eq(wmsTables.dispatchAttempts.id, graph.attempts[0].id))
          .for('update')
          .limit(1);
        expect(attempt?.id).toBe(graph.attempts[0].id);
      });

      await graphLocked;
      const returnPath = service.createReturnRequest(graph.salesOrderId, graph.customerId, createDto(graph));
      const [, created] = await Promise.all([recallPath, returnPath]);
      expect(created.items[0]).toMatchObject({
        shipmentLineId: graph.shipmentLine.id,
        dispatchAttemptId: graph.attempts[0].id,
      });
    } finally {
      await cleanupCommittedGraph(graph);
    }
  });
});
