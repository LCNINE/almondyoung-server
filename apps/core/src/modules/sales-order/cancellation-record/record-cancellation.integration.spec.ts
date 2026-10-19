import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  receiveStock,
  Rollback,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { SalesOrdersService } from '../services/sales-orders.service';
import { CancellationLineDerivationError } from './cancellation-lines';
import { recordSalesOrderCancellation } from './record-cancellation';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, salesOrders };
}

/** 라인 하나(주문 수량 quantity), 매칭 SKU 하나 × 1, 재고 넉넉. */
async function seedOrder(tx: DbTx, w: ReturnType<typeof wire>, quantity: number) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
  const variantId = randomUUID();
  await seedMatching(tx, { variantId, skuId, quantity: 1 });
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
  await tx
    .update(wmsTables.salesOrders)
    .set({ shippingAddress: ADDRESS })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  return { salesOrderId, lineId: lineIds[0], warehouseId, skuId };
}

/**
 * 상자 없는 옛(V1) FO 를 두고 셀메이트 스크립트(scripts/ops/cellmate-local/mark-core-shipped.js)처럼 출고로 표시한다 —
 * FO status='shipped'·shipped_at, FOI shipped_qty=qty·status='shipped'. 상자가 없으니 취소는 V1 경로를 탄다.
 */
async function seedShippedV1Fulfillment(
  tx: DbTx,
  o: { salesOrderId: string; lineId: string; warehouseId: string; skuId: string },
  qty: number,
) {
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId, totalItems: 1, totalQty: qty })
    .returning();
  await tx.insert(wmsTables.fulfillmentOrderItems).values({
    fulfillmentOrderId: fo.id,
    salesOrderId: o.salesOrderId,
    salesOrderLineId: o.lineId,
    skuId: o.skuId,
    qty,
  });
  await tx
    .update(wmsTables.fulfillmentOrders)
    .set({ status: 'shipped', shippedAt: new Date(), updatedAt: new Date() })
    .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
  await tx
    .update(wmsTables.fulfillmentOrderItems)
    .set({ shippedQty: qty, status: 'shipped', updatedAt: new Date() })
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
}

async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId))
    .orderBy(wmsTables.salesOrderCancellations.createdAt);
}

async function linesOf(tx: DbTx, cancellationId: string) {
  return tx
    .select({
      salesOrderLineId: wmsTables.salesOrderCancellationLines.salesOrderLineId,
      quantity: wmsTables.salesOrderCancellationLines.quantity,
      shipmentPhase: wmsTables.salesOrderCancellationLines.shipmentPhase,
    })
    .from(wmsTables.salesOrderCancellationLines)
    .where(eq(wmsTables.salesOrderCancellationLines.cancellationId, cancellationId));
}

describeIfDb('recordSalesOrderCancellation — 취소 행과 라인 행을 같은 트랜잭션에 (K6 PR1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('v1 partial before FO writes before_shipment lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(cancellation.cancellationScope).toBe('partial');
      expect(await linesOf(tx, cancellation.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'before_shipment' },
      ]);
      expect(cancellation.metadata).toMatchObject({ cancelledLines: [{ salesOrderLineId: o.lineId, quantity: 1 }] });
    });
  });

  it('v1 partial after shipment writes after_shipment lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 3);
      await seedShippedV1Fulfillment(tx, o, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(await linesOf(tx, cancellation.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'after_shipment' },
      ]);
    });
  });

  it('v1 full writes every remainder', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 2);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );
      await w.salesOrders.cancel(o.salesOrderId, { cancelledBy: 'naver' }, tx);

      const rows = await cancellationsOf(tx, o.salesOrderId);
      const full = rows.find((row) => row.cancellationScope === 'full');
      expect(full).toBeDefined();
      expect(await linesOf(tx, full!.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'before_shipment' },
      ]);
    });
  });

  it('v2 full writes outstanding lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 2);
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { cancelledBy: 'customer', metadata: { sourceEventId: `self-${randomUUID()}` } },
        tx,
      );

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(cancellation.cancellationScope).toBe('full');
      const lines = await linesOf(tx, cancellation.id);
      expect(lines).toEqual([{ salesOrderLineId: o.lineId, quantity: 2, shipmentPhase: 'before_shipment' }]);
      const totals = lines.map(({ salesOrderLineId, quantity }) => ({ salesOrderLineId, quantity }));
      expect(cancellation.metadata).toMatchObject({ cancelledLines: totals });
    });
  });

  it('rejects over-cancellation', async () => {
    await inRollbackTx(db, async (tx) => {
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });

      const error = await tx
        .transaction((nested) =>
          recordSalesOrderCancellation(nested as unknown as DbTx, {
            salesOrderId,
            cancellationScope: 'partial',
            effects: [],
            metadata: { cancelledLines: [{ salesOrderLineId: lineIds[0], quantity: 2 }] },
          }),
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CancellationLineDerivationError);
      expect(await cancellationsOf(tx, salesOrderId)).toEqual([]);
    });
  });

  it('rolls back lines with the cancellation', async () => {
    // 주문은 커밋해 두어야 «트랜잭션 밖에서 0행» 이 취소 기록의 롤백을 뜻한다(주문째 사라진 0행이 아니라).
    const { salesOrderId, lineIds } = await db.transaction((tx) =>
      seedSalesOrder(tx as unknown as DbTx, { lines: [{ variantId: randomUUID(), quantity: 2 }] }),
    );
    try {
      await expect(
        db.transaction(async (tx) => {
          const cancellation = await recordSalesOrderCancellation(tx as unknown as DbTx, {
            salesOrderId,
            cancellationScope: 'partial',
            effects: [],
            metadata: { cancelledLines: [{ salesOrderLineId: lineIds[0], quantity: 1 }] },
          });
          expect(await linesOf(tx as unknown as DbTx, cancellation.id)).toHaveLength(1);
          throw new Rollback('after record');
        }),
      ).rejects.toThrow(Rollback);

      expect(
        await db
          .select()
          .from(wmsTables.salesOrderCancellations)
          .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(wmsTables.salesOrderCancellationLines)
          .where(eq(wmsTables.salesOrderCancellationLines.salesOrderId, salesOrderId)),
      ).toEqual([]);
    } finally {
      await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId));
    }
  });
});
